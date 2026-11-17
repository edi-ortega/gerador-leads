// Raspador de Leads — servidor local.
// Duas telas: Gerador de Leads (Google Maps + base de CNPJ) e IBGE · Cidades
// (monta a fila de pacotes de cidades e guarda o histórico de disparos).
// 100% local: os dados ficam em ./dados. Interface em http://localhost:3344

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { buscarLeadsMaps } from './scraper/maps.js';
import { buscarLeadsCnpj } from './scraper/cnpj.js';
import { extrairEmailDoSite } from './scraper/email.js';
import { montarPacotes, listarCidades } from './scraper/ibge.js';
import { urlAutorizacao, trocarCodigoPorTokens, renovarAcesso, obterEmail, criarPlanilha } from './scraper/google.js';
import { refinarLead } from './scraper/refinar.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4545;

const DIR_DADOS = process.env.DADOS_DIR || path.join(__dirname, 'dados');
const DIR_LISTAS = path.join(DIR_DADOS, 'listas');
const ARQ_USADOS = path.join(DIR_DADOS, 'ibge-usados.json');
const ARQ_HIST = path.join(DIR_DADOS, 'ibge-historico.json');
const ARQ_CONFIG = path.join(DIR_DADOS, 'config.json');
fs.mkdirSync(DIR_LISTAS, { recursive: true });

// Colunas exportadas (usadas no CSV e no Google Sheets).
const COLUNAS = [['empresa', 'Empresa'], ['razaoSocial', 'Razão Social'], ['cnpj', 'CNPJ'], ['telefone', 'Telefone'],
  ['whatsapp', 'WhatsApp'], ['email', 'E-mail'], ['site', 'Site'], ['instagram', 'Instagram'], ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['endereco', 'Endereço'], ['cidade', 'Cidade'],
  ['estado', 'UF/Região'], ['atividade', 'Atividade'], ['abertura', 'Data de Abertura'], ['porte', 'Porte'], ['fonte', 'Fonte']];
function linhasDeLeads(leads) {
  return [COLUNAS.map(c => c[1]), ...leads.map(l => COLUNAS.map(c => String(l[c[0]] ?? '')))];
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- utilidades ----------
const jobs = new Map();
let proximoId = 1;

function slugificar(nome) {
  const s = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'lista';
}
function normalizarNicho(n) {
  return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim() || '(sem nicho)';
}
function lerJson(arq, padrao) { try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return padrao; } }
function gravarJson(arq, dado) { fs.writeFileSync(arq, JSON.stringify(dado, null, 2), 'utf8'); }

// Chaves de deduplicação/ignorar (por CNPJ e por empresa+telefone).
function chavesDeLead(l) {
  const ks = [];
  const cnpj = (l.cnpj || '').replace(/\D/g, '');
  if (cnpj) ks.push('cnpj:' + cnpj);
  const empresa = (l.empresa || '').toLowerCase().trim();
  const tel = (l.telefone || '').replace(/\D/g, '');
  if (empresa || tel) ks.push('et:' + empresa + '|' + tel);
  return ks;
}
function montarIgnorar(slugs) {
  const set = new Set();
  for (const slug of slugs || []) {
    const d = lerLista(slug);
    if (!d) continue;
    for (const lead of d.leads || []) for (const k of chavesDeLead(lead)) set.add(k);
  }
  return set;
}

// ---------- listas salvas (em ./dados/listas) ----------
function caminhoLista(slug) { return path.join(DIR_LISTAS, `${slug}.leads.json`); }
function lerLista(slug) { return lerJson(caminhoLista(slug), null); }
function listarListas() {
  let arqs = [];
  try { arqs = fs.readdirSync(DIR_LISTAS).filter(f => f.endsWith('.leads.json')); } catch { return []; }
  const out = [];
  for (const f of arqs) {
    const d = lerJson(path.join(DIR_LISTAS, f), null);
    if (d) out.push({ nome: d.nome || f.replace(/\.leads\.json$/, ''), slug: f.replace(/\.leads\.json$/, ''), total: (d.leads || []).length, atualizadoEm: d.atualizadoEm || '' });
  }
  return out.sort((a, b) => (b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''));
}

function gerarCsv(leads) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const linhas = [COLUNAS.map(c => esc(c[1])).join(';')];
  for (const l of leads) linhas.push(COLUNAS.map(c => esc(l[c[0]])).join(';'));
  return '﻿' + linhas.join('\r\n');
}

// ---------- IBGE: "já usei" + histórico de disparos ----------
function usadosDe(nicho, uf) {
  const all = lerJson(ARQ_USADOS, {}) || {};
  return (all[normalizarNicho(nicho)] || {})[uf] || [];
}
function marcarUsado(nicho, uf, assinatura, usado = true) {
  const chave = normalizarNicho(nicho);
  const all = lerJson(ARQ_USADOS, {}) || {};
  if (!all[chave]) all[chave] = {};
  const set = new Set(all[chave][uf] || []);
  if (usado) set.add(assinatura); else set.delete(assinatura);
  all[chave][uf] = [...set];
  gravarJson(ARQ_USADOS, all);
  return all[chave][uf].length;
}
// Histórico: cada pacote varrido vira um registro { em, nicho, uf, cidades, leads }.
function registrarHistorico(reg) {
  const hist = lerJson(ARQ_HIST, []) || [];
  hist.unshift({ em: new Date().toISOString(), ...reg });
  gravarJson(ARQ_HIST, hist.slice(0, 1000)); // guarda os 1000 mais recentes
}

// ---------- busca ----------
app.post('/api/buscar', (req, res) => {
  const { fontes = ['maps', 'cnpj'], pais = 'Brasil', estado = '', cidade = '', nicho = '', palavraChave = '', limite = 30, buscarEmails = true, ignorarListas = [] } = req.body || {};
  // CNAE exclusivo da Base Nacional: quando vem preenchido, a busca de CNPJ usa
  // esse CNAE em vez de deduzir pelo nicho (o nicho segue valendo pro Maps).
  const cnae = String(req.body?.cnae || '').trim();
  if (!nicho && !palavraChave && !cnae) return res.status(400).json({ erro: 'Informe o nicho, uma palavra-chave ou o CNAE.' });

  const ehBrasil = /bra[sz]il/i.test(pais) || pais === 'BR';
  let fontesEfetivas = ehBrasil ? fontes : fontes.filter(f => f !== 'cnpj');
  // Só com CNAE (sem nicho/palavra) o Maps não tem o que procurar: roda só a Base.
  if (!nicho && !palavraChave) fontesEfetivas = fontesEfetivas.filter(f => f !== 'maps');
  if (!fontesEfetivas.length) fontesEfetivas.push(cnae ? 'cnpj' : 'maps');

  const cidades = (Array.isArray(req.body?.cidades) && req.body.cidades.length)
    ? req.body.cidades.map(c => String(c).trim()).filter(Boolean)
    : String(cidade || '').split(/[,;\n]+/).map(c => c.trim()).filter(Boolean);

  const filaIbge = Array.isArray(req.body?.filaIbge) ? req.body.filaIbge : [];
  const grupos = filaIbge.length
    ? filaIbge.map(g => ({ uf: g.uf, cidades: (Array.isArray(g.cidades) ? g.cidades : []).map(c => String(c).trim()).filter(Boolean) }))
        .filter(g => g.cidades.length)
        .map(g => ({ uf: g.uf, cidades: g.cidades, assinatura: g.cidades.join('|') }))
    : [{ uf: null, cidades, assinatura: null }];

  const id = String(proximoId++);
  const job = {
    id, status: 'rodando', cancelado: false, mensagem: 'Iniciando busca...', leads: [],
    pacoteAtual: grupos.length > 1 ? 0 : null, totalPacotes: grupos.length > 1 ? grupos.length : null,
    filtros: { fontes: fontesEfetivas, pais, estado, cidade, cidades, grupos, nicho, palavraChave, cnae, limite, buscarEmails, ignorarListas },
    criadoEm: new Date().toISOString()
  };
  jobs.set(id, job);
  executarJob(job).catch(e => { job.status = 'erro'; job.mensagem = `Erro: ${e.message}`; });
  res.json({ id });
});

async function executarJob(job) {
  const { fontes, pais, estado, grupos, nicho, palavraChave, cnae, limite, buscarEmails, ignorarListas } = job.filtros;
  const ignorarUsuario = montarIgnorar(ignorarListas);
  const estaIgnorado = l => chavesDeLead(l).some(k => ignorarUsuario.has(k));
  const jaColetados = new Set();

  let pacoteCtx = '';
  const onProgress = ({ mensagem, parcial }) => {
    if (mensagem) job.mensagem = pacoteCtx ? `${pacoteCtx} — ${mensagem}` : mensagem;
    if (parcial && !estaIgnorado(parcial)) job.leads.push(parcial);
  };
  const deveCancelar = () => job.cancelado;
  const multiGrupos = grupos.length > 1;

  for (let gi = 0; gi < grupos.length; gi++) {
    if (job.cancelado || job.leads.length >= limite) break;
    const grupo = grupos[gi];
    if (multiGrupos) job.pacoteAtual = gi + 1;
    const listaCidades = grupo.cidades.length ? grupo.cidades : [''];
    const multiCidades = listaCidades.length > 1;
    let grupoCompleto = true;
    const antesDoGrupo = job.leads.length;

    for (let ci = 0; ci < listaCidades.length; ci++) {
      if (job.cancelado) { grupoCompleto = false; break; }
      const cid = listaCidades[ci];
      if (limite - job.leads.length <= 0) { grupoCompleto = false; break; }

      if (multiGrupos) {
        pacoteCtx = `Pacote ${gi + 1}/${grupos.length}${grupo.uf ? ' · ' + grupo.uf : ''} · cidade ${ci + 1}/${listaCidades.length} (${cid})`;
        job.mensagem = `${pacoteCtx} · ${job.leads.length}/${limite} leads`;
      } else if (multiCidades) {
        job.mensagem = `Cidade ${ci + 1}/${listaCidades.length} — ${cid} · ${job.leads.length}/${limite} leads`;
      }

      const ignorarCidade = new Set(ignorarUsuario);
      for (const k of jaColetados) ignorarCidade.add(k);

      if (!job.cancelado && fontes.includes('cnpj')) {
        try { await buscarLeadsCnpj({ estado, cidade: cid, nicho, palavraChave, cnae, limite: limite - job.leads.length, onProgress, deveCancelar, ignorar: ignorarCidade }); }
        catch (e) { job.mensagem = `CNPJ falhou em ${cid}: ${e.message}. Continuando...`; }
      }
      if (!job.cancelado && (limite - job.leads.length) > 0 && fontes.includes('maps')) {
        try { await buscarLeadsMaps({ estado, cidade: cid, nicho, palavraChave, pais, limite: limite - job.leads.length, onProgress, deveCancelar, ignorar: ignorarCidade }); }
        catch (e) { job.mensagem = `Google Maps falhou em ${cid}: ${e.message}. Continuando...`; }
      }
      for (const l of job.leads) for (const k of chavesDeLead(l)) jaColetados.add(k);
    }

    // Pacote da fila IBGE varrido por completo → marca "já usei" e registra no histórico.
    if (grupo.assinatura && grupoCompleto && !job.cancelado) {
      marcarUsado(nicho, grupo.uf, grupo.assinatura, true);
      registrarHistorico({ nicho: normalizarNicho(nicho), uf: grupo.uf, cidades: grupo.cidades, leads: job.leads.length - antesDoGrupo });
    }
  }

  if (ignorarUsuario.size) job.leads = job.leads.filter(l => !estaIgnorado(l));
  const vistos = new Set();
  job.leads = job.leads.filter(l => {
    const k = `${(l.empresa || '').toLowerCase().trim()}|${(l.telefone || '').replace(/\D/g, '')}`;
    if (vistos.has(k)) return false; vistos.add(k); return true;
  });

  if (buscarEmails && !job.cancelado) {
    const semEmail = job.leads.filter(l => !l.email && l.site);
    let i = 0;
    for (const lead of semEmail) {
      if (job.cancelado) break;
      i++;
      job.mensagem = `Procurando e-mail no site das empresas... ${i} de ${semEmail.length}`;
      lead.email = await extrairEmailDoSite(lead.site);
    }
  }

  job.status = 'concluido';
  const comTel = job.leads.filter(l => l.telefone).length;
  const comEmail = job.leads.filter(l => l.email).length;
  const resumo = `${job.leads.length} leads (${comTel} com telefone, ${comEmail} com e-mail)`;
  job.mensagem = job.cancelado ? `Interrompida — ${resumo} até aqui.` : `Concluído: ${resumo}.`;
}

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ erro: 'Busca não encontrada' });
  res.json(job);
});
app.post('/api/jobs/:id/cancelar', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job) job.cancelado = true;
  res.json({ ok: true });
});
app.get('/api/jobs/:id/exportar', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ erro: 'Busca não encontrada' });
  const nome = ['leads', job.filtros.nicho, job.filtros.cidade, new Date().toISOString().slice(0, 10)].filter(Boolean).join('-').replace(/[^a-zA-Z0-9-]/g, '-');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
  res.send(gerarCsv(job.leads));
});

// ---------- refinar (visita o site do lead e coleta dados extras) ----------
async function refinarLeads(leads, controle) {
  const alvos = leads.filter(l => l.site);
  controle.total = alvos.length;
  controle.feito = 0;
  controle.encontrados = 0;
  controle.novos = { email: 0, telefone: 0, whatsapp: 0, redes: 0 }; // quantas informações novas entraram
  let i = 0;
  const CONCORRENCIA = 4;
  async function trabalhador() {
    while (i < alvos.length && !controle.cancelado) {
      const lead = alvos[i++];
      try {
        const r = await refinarLead(lead.site, { deveParar: () => controle.cancelado });
        if (r) {
          let ganhou = false;
          if (!lead.email && r.email) { lead.email = r.email; controle.novos.email++; ganhou = true; }
          if (!lead.telefone && r.telefone) { lead.telefone = r.telefone; controle.novos.telefone++; ganhou = true; }
          if (r.whatsapp && !lead.whatsapp) { lead.whatsapp = r.whatsapp; controle.novos.whatsapp++; ganhou = true; }
          for (const [rede, url] of Object.entries(r.redes || {})) {
            if (!lead[rede]) { lead[rede] = url; controle.novos.redes++; ganhou = true; }
          }
          if (ganhou) controle.encontrados++;
        }
      } catch { /* segue para o próximo */ }
      controle.feito++;
      controle.mensagem = `Refinando informações... ${controle.feito} de ${controle.total} sites`;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, alvos.length) }, trabalhador));
  controle.rodando = false;
  const n = controle.novos;
  const totalNovos = n.email + n.whatsapp + n.redes + n.telefone;
  controle.melhoradas = totalNovos;
  const partes = [];
  if (n.whatsapp) partes.push(`${n.whatsapp} WhatsApp`);
  if (n.redes) partes.push(`${n.redes} rede${n.redes > 1 ? 's' : ''}`);
  if (n.email) partes.push(`${n.email} e-mail${n.email > 1 ? 's' : ''}`);
  if (n.telefone) partes.push(`${n.telefone} telefone${n.telefone > 1 ? 's' : ''}`);
  const detalhe = partes.length ? ' — ' + partes.join(', ') : '';
  const cab = controle.cancelado ? 'Interrompido' : 'Pronto';
  controle.mensagem = totalNovos
    ? `${cab}! ${totalNovos} informaç${totalNovos > 1 ? 'ões' : 'ão'} melhorada${totalNovos > 1 ? 's' : ''} em ${controle.total} site${controle.total > 1 ? 's' : ''}${detalhe}.`
    : `${cab} — nenhuma informação nova nos ${controle.total} site${controle.total > 1 ? 's' : ''} acessado${controle.total > 1 ? 's' : ''}.`;
}

app.post('/api/jobs/:id/refinar', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ erro: 'Busca não encontrada' });
  if (job.refino?.rodando) return res.json({ ok: true, jaRodando: true });
  const comSite = (job.leads || []).filter(l => l.site).length;
  if (!comSite) return res.status(400).json({ erro: 'Nenhum lead com site para refinar.' });
  job.refino = { rodando: true, cancelado: false, total: comSite, feito: 0, encontrados: 0, novos: { email: 0, telefone: 0, whatsapp: 0, redes: 0 }, mensagem: 'Iniciando refino...' };
  refinarLeads(job.leads, job.refino).catch(e => {
    job.refino.rodando = false; job.refino.mensagem = `Erro no refino: ${e.message}`;
  });
  res.json({ ok: true, total: comSite });
});
app.post('/api/jobs/:id/refinar/cancelar', (req, res) => {
  const job = jobs.get(req.params.id);
  if (job?.refino) job.refino.cancelado = true;
  res.json({ ok: true });
});

// ---------- listas ----------
app.get('/api/listas', (req, res) => res.json({ listas: listarListas() }));
app.get('/api/listas/:slug', (req, res) => {
  const d = lerLista(req.params.slug);
  if (!d) return res.status(404).json({ erro: 'Lista não encontrada' });
  res.json(d);
});
app.post('/api/listas/salvar', (req, res) => {
  const job = jobs.get(String(req.body?.jobId || ''));
  if (!job) return res.status(404).json({ erro: 'Busca não encontrada' });
  const nome = String(req.body?.nome || '').trim();
  if (!nome) return res.status(400).json({ erro: 'Dê um nome para a lista.' });
  const slug = slugificar(nome);
  const agora = new Date().toISOString();
  const existente = lerLista(slug);
  const dados = existente || { nome, slug, criadoEm: agora, atualizadoEm: agora, leads: [] };
  dados.nome = nome;
  const chaves = new Set(dados.leads.map(l => chavesDeLead(l).join('~')));
  let adicionados = 0;
  for (const lead of job.leads) {
    const k = chavesDeLead(lead).join('~');
    if (chaves.has(k)) continue;
    chaves.add(k);
    dados.leads.push({ ...lead, salvoEm: agora });
    adicionados++;
  }
  dados.atualizadoEm = agora;
  gravarJson(caminhoLista(slug), dados);
  res.json({ nome, slug, total: dados.leads.length, adicionados, nova: !existente });
});
app.delete('/api/listas/:slug', (req, res) => {
  try { fs.unlinkSync(caminhoLista(req.params.slug)); } catch { /* já não existe */ }
  res.json({ ok: true });
});
app.get('/api/listas/:slug/exportar', (req, res) => {
  const d = lerLista(req.params.slug);
  if (!d) return res.status(404).json({ erro: 'Lista não encontrada' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.slug}.csv"`);
  res.send(gerarCsv(d.leads || []));
});

// ---------- IBGE ----------
app.get('/api/ibge/pacotes', async (req, res) => {
  try {
    const tamanho = Math.max(1, Math.min(50, parseInt(req.query.tamanho, 10) || 10));
    res.json(await montarPacotes(req.query.uf, tamanho));
  } catch (e) { res.status(400).json({ erro: e.message }); }
});
app.get('/api/ibge/cidades', async (req, res) => {
  try { res.json(await listarCidades(req.query.uf)); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});
app.get('/api/ibge/usados', (req, res) => {
  const { uf, nicho } = req.query;
  if (!uf) return res.json(lerJson(ARQ_USADOS, {}) || {});
  res.json(usadosDe(nicho, uf));
});
app.post('/api/ibge/usados', (req, res) => {
  const { uf, nicho, assinatura, usado } = req.body || {};
  if (!uf || !assinatura) return res.status(400).json({ erro: 'uf e assinatura são obrigatórios.' });
  const total = marcarUsado(nicho, uf, assinatura, !!usado);
  res.json({ uf, nicho: normalizarNicho(nicho), total });
});
// Histórico de disparos do IBGE (termos + cidades executadas).
app.get('/api/ibge/historico', (req, res) => {
  const hist = lerJson(ARQ_HIST, []) || [];
  const nicho = req.query.nicho ? normalizarNicho(req.query.nicho) : null;
  res.json({ historico: nicho ? hist.filter(h => h.nicho === nicho) : hist });
});
app.delete('/api/ibge/historico', (req, res) => { gravarJson(ARQ_HIST, []); res.json({ ok: true }); });

// ---------- Configurações + Google Sheets ----------
function lerConfig() { return lerJson(ARQ_CONFIG, {}) || {}; }
function gravarConfig(c) { gravarJson(ARQ_CONFIG, c); }
function redirectUri(req) { return `${req.protocol}://${req.get('host')}/api/google/callback`; }

app.get('/api/config', (req, res) => {
  const c = lerConfig();
  res.json({ googleClientId: c.googleClientId || '', temSecret: !!c.googleClientSecret, googleConta: c.googleEmail || '', destinoListas: c.destinoListas || 'app' });
});
app.post('/api/config', (req, res) => {
  const c = lerConfig();
  if (typeof req.body?.googleClientId === 'string') c.googleClientId = req.body.googleClientId.trim();
  if (req.body?.googleClientSecret) c.googleClientSecret = String(req.body.googleClientSecret).trim();
  if (req.body?.destinoListas === 'app' || req.body?.destinoListas === 'sheets') c.destinoListas = req.body.destinoListas;
  gravarConfig(c);
  res.json({ ok: true });
});

app.get('/api/google/status', (req, res) => {
  const c = lerConfig();
  res.json({ configurado: !!(c.googleClientId && c.googleClientSecret), conectado: !!c.googleRefreshToken, conta: c.googleEmail || '', redirect: redirectUri(req) });
});
app.get('/api/google/conectar', (req, res) => {
  const c = lerConfig();
  if (!c.googleClientId || !c.googleClientSecret) return res.status(400).send('Configure o Client ID/Secret do Google primeiro.');
  res.redirect(urlAutorizacao({ clientId: c.googleClientId, redirectUri: redirectUri(req) }));
});
app.get('/api/google/callback', async (req, res) => {
  const c = lerConfig();
  try {
    const tokens = await trocarCodigoPorTokens({ code: req.query.code, clientId: c.googleClientId, clientSecret: c.googleClientSecret, redirectUri: redirectUri(req) });
    if (tokens.refresh_token) c.googleRefreshToken = tokens.refresh_token;
    try { c.googleEmail = await obterEmail(tokens.access_token); } catch { /* segue */ }
    gravarConfig(c);
    res.send('<script>window.location="/#google-ok"</script>Conta Google conectada. Pode fechar esta aba.');
  } catch (e) {
    res.status(400).send('Falha ao conectar: ' + e.message);
  }
});
app.delete('/api/google/conta', (req, res) => {
  const c = lerConfig(); delete c.googleRefreshToken; delete c.googleEmail; gravarConfig(c); res.json({ ok: true });
});

async function acessoGoogle() {
  const c = lerConfig();
  if (!c.googleRefreshToken) throw new Error('Nenhuma conta Google conectada.');
  const t = await renovarAcesso({ refreshToken: c.googleRefreshToken, clientId: c.googleClientId, clientSecret: c.googleClientSecret });
  return t.access_token;
}

// Exporta os leads (de um job ou de uma lista salva) para uma planilha nova.
app.post('/api/sheets/exportar', async (req, res) => {
  let leads, titulo;
  if (req.body?.jobId) {
    const job = jobs.get(String(req.body.jobId));
    if (!job) return res.status(404).json({ erro: 'Busca não encontrada' });
    leads = job.leads; titulo = req.body?.nome || `Leads ${job.filtros.nicho || ''}`.trim();
  } else if (req.body?.slug) {
    const d = lerLista(req.body.slug);
    if (!d) return res.status(404).json({ erro: 'Lista não encontrada' });
    leads = d.leads; titulo = d.nome || req.body.slug;
  } else return res.status(400).json({ erro: 'Informe jobId ou slug.' });

  if (!leads?.length) return res.status(400).json({ erro: 'Não há leads para exportar.' });
  try {
    const accessToken = await acessoGoogle();
    const { url } = await criarPlanilha({ accessToken, titulo: `${titulo} — ${new Date().toLocaleDateString('pt-BR')}`, linhas: linhasDeLeads(leads) });
    res.json({ ok: true, url });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

const servidor = app.listen(PORT, () => {
  console.log(`\n✅ Raspador de Leads rodando em http://localhost:${PORT}\n`);
  if (process.env.ABRIR_NAVEGADOR) abrirNavegador(`http://localhost:${PORT}`);
});
// Já tem uma cópia rodando (clicou duas vezes no atalho): só abre a tela e sai.
servidor.on('error', e => {
  if (e.code !== 'EADDRINUSE' || !process.env.ABRIR_NAVEGADOR) throw e;
  abrirNavegador(`http://localhost:${PORT}`);
  setTimeout(() => process.exit(0), 1500);
});
function abrirNavegador(url) {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  import('child_process').then(({ exec }) => exec(cmd));
}
