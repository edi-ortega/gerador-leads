// Busca de leads via base pública de CNPJ (dados abertos da Receita Federal).
//
// Fluxo:
//   1. Consulta o índice da Casa dos Dados (endpoint público v5) para listar
//      CNPJs que batem com os filtros (UF, município, CNAE do nicho, situação).
//      A chamada roda DENTRO de um navegador real (Puppeteer + stealth) porque
//      a API fica atrás de proteção anti-bot que bloqueia requisições diretas.
//   2. Enriquece cada CNPJ com BrasilAPI / Minha Receita para obter telefone,
//      e-mail e endereço cadastrados na Receita Federal.

import { novaPagina, normalizar } from './browser.js';
import { cnaesPorNicho, cnaesDoCampo } from './cnae.js';
import { anotar } from './integracoes.js';

const V5 = 'https://api.casadosdados.com.br/v5/public/cnpj/pesquisa';

// Nome do estado -> sigla UF (aceita "São Paulo" ou "SP" no filtro).
const NOME_PARA_UF = {
  ACRE: 'AC', ALAGOAS: 'AL', AMAPA: 'AP', AMAZONAS: 'AM', BAHIA: 'BA',
  CEARA: 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', GOIAS: 'GO',
  MARANHAO: 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG', PARA: 'PA', PARAIBA: 'PB', PARANA: 'PR',
  PERNAMBUCO: 'PE', PIAUI: 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', RONDONIA: 'RO',
  RORAIMA: 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', SERGIPE: 'SE',
  TOCANTINS: 'TO'
};

function codigoUf(estado) {
  const n = normalizar(estado);
  if (!n) return '';
  if (n.length === 2) return n;
  return NOME_PARA_UF[n] || n;
}
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Consulta uma página (20 resultados) do índice de CNPJs.
async function buscarPagina(page, corpo) {
  return page.evaluate(async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { erro: res.status };
    return res.json();
  }, V5, corpo);
}

// Anota fora do page.evaluate: lá dentro é o navegador, não o Node.
function anotarBusca(r) {
  if (r?.erro) anotar('casadosdados', { erro: `HTTP ${r.erro}` });
  else anotar('casadosdados', { registros: r?.data?.cnpj?.length ?? null });
  return r;
}

// Busca dados cadastrais completos (telefone, e-mail, endereço) por CNPJ.
async function detalharCnpj(cnpj) {
  const limpo = String(cnpj).replace(/\D/g, '');
  const headers = { 'User-Agent': UA, Accept: 'application/json' };

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${limpo}`, { headers });
    if (res.ok) { anotar('brasilapi', { registros: 1, operacao: 'detalhe de CNPJ' }); return mapearReceita(await res.json()); }
  } catch { /* tenta fallback */ }

  try {
    const res = await fetch(`https://minhareceita.org/${limpo}`, { headers });
    if (res.ok) { anotar('minhareceita', { registros: 1, operacao: 'detalhe de CNPJ' }); return mapearReceita(await res.json()); }
  } catch { /* sem detalhe */ }

  return null;
}

function mapearReceita(d) {
  return {
    // Status cadastral atual na Receita (ATIVA, BAIXADA, INAPTA, SUSPENSA, NULA)
    situacao: String(d.descricao_situacao_cadastral || d.situacao_cadastral || '').toUpperCase().trim(),
    email: (d.email || '').toLowerCase(),
    telefone: formatarTelefone(d.ddd_telefone_1) || formatarTelefone(d.ddd_telefone_2) || '',
    fantasia: d.nome_fantasia || '',
    razao: d.razao_social || '',
    atividade: d.cnae_fiscal_descricao || '',
    endereco: [d.logradouro, d.numero, d.bairro].filter(Boolean).join(', '),
    cidade: d.municipio || '',
    uf: d.uf || '',
    abertura: (d.data_inicio_atividade || '').slice(0, 10),
    porte: d.porte || ''
  };
}

function formatarTelefone(t) {
  if (!t) return '';
  const d = String(t).replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return String(t);
}

function formatarCnpj(c) {
  const d = String(c).replace(/\D/g, '').padStart(14, '0');
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export async function buscarLeadsCnpj({ estado, cidade, nicho, palavraChave, cnae = '', limite = 50, onProgress = () => {}, deveCancelar = () => false, ignorar = new Set() }) {
  // O campo CNAE (exclusivo da Base Nacional) manda; vazio = deduz pelo nicho.
  const cnaes = cnae ? cnaesDoCampo(cnae) : cnaesPorNicho(nicho);
  if (cnae && !cnaes.length) {
    onProgress({ etapa: 'cnpj', mensagem: `CNAE "${cnae}" não reconhecido. Use o código (ex.: 4741-5/00) ou escolha na lista.` });
    return [];
  }
  const corpoBase = {
    situacao_cadastral: ['ATIVA'],
    pagina: 1
  };
  if (estado) corpoBase.uf = [codigoUf(estado)];
  if (cidade) corpoBase.municipio = [normalizar(cidade)];
  if (cnaes.length) corpoBase.codigo_atividade_principal = cnaes;

  const palavra = normalizar(palavraChave);

  const fmtCnae = c => `${c.slice(0, 4)}-${c.slice(4, 5)}/${c.slice(5)}`;
  onProgress({ etapa: 'cnpj', mensagem: cnae
    ? `Consultando base pública de CNPJs (CNAE ${cnaes.map(fmtCnae).join(', ')})...`
    : 'Consultando base pública de CNPJs (Receita Federal)...' });

  const page = await novaPagina();
  const leads = [];
  const vistos = new Set();

  try {
    // Estabelece a sessão no domínio antes de chamar a API (passa pela proteção)
    await page.goto('https://casadosdados.com.br/solucao/cnpj', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2500);

    let pagina = 1;
    const maxPaginas = 80; // teto de segurança (80 x 20 = 1600 candidatos)
    let semDados = 0; // candidatos seguidos sem dados na Receita (empresas muito novas)

    while (leads.length < limite && pagina <= maxPaginas) {
      if (deveCancelar()) break;
      const resultado = anotarBusca(await buscarPagina(page, { ...corpoBase, pagina }));
      if (resultado?.erro) {
        onProgress({ etapa: 'cnpj', mensagem: `Aviso: base de CNPJ respondeu ${resultado.erro} na página ${pagina}.` });
        break;
      }
      const lote = resultado?.cnpjs || [];
      if (!lote.length) break;

      for (const item of lote) {
        if (leads.length >= limite || deveCancelar()) break;
        if (vistos.has(item.cnpj)) continue;
        vistos.add(item.cnpj);

        // Não repetir: pula CNPJs que já estão nas listas escolhidas (antes de
        // gastar a consulta de enriquecimento).
        if (ignorar.has('cnpj:' + String(item.cnpj).replace(/\D/g, ''))) continue;

        // Filtro de palavra-chave no cliente (a API não faz busca textual)
        if (palavra) {
          const alvo = normalizar(`${item.razao_social} ${item.nome_fantasia}`);
          if (!alvo.includes(palavra)) continue;
        }

        // Enriquece com os dados da Receita (telefone, e-mail, endereço).
        // Empresas muito recentes ainda não constam no snapshot público e
        // retornam vazio — nesse caso pulamos, ficando com leads utilizáveis.
        const det = await detalharCnpj(item.cnpj);
        await sleep(300); // respeita o limite das APIs gratuitas

        if (!det) {
          semDados++;
          // Se muitos seguidos vierem vazios, mostramos aviso, mas seguimos.
          if (semDados % 15 === 0) {
            onProgress({ etapa: 'cnpj', mensagem: `Base de CNPJ: pulando empresas muito recentes sem dados cadastrais...` });
          }
          continue;
        }
        // Nunca traz empresa inativa: confere o status atual na Receita e
        // descarta qualquer coisa que não seja ATIVA (baixada/inapta/suspensa/nula).
        if (det.situacao && det.situacao !== 'ATIVA') {
          continue;
        }
        semDados = 0;

        const lead = {
          fonte: 'CNPJ (Receita Federal)',
          empresa: det.fantasia || item.nome_fantasia || det.razao || item.razao_social || '',
          razaoSocial: det.razao || item.razao_social || '',
          cnpj: formatarCnpj(item.cnpj),
          email: det.email || '',
          telefone: det.telefone || '',
          site: '',
          endereco: det.endereco || '',
          cidade: det.cidade || cidade || '',
          estado: det.uf || codigoUf(estado),
          atividade: det.atividade || '',
          abertura: det.abertura || '',
          porte: det.porte || ''
        };
        leads.push(lead);
        onProgress({
          etapa: 'cnpj',
          mensagem: `Base de CNPJ: ${leads.length} de ${limite} leads com dados cadastrais...`,
          parcial: lead
        });
      }
      pagina++;
      await sleep(400);
    }
  } finally {
    await page.close().catch(() => {});
  }

  return leads;
}
