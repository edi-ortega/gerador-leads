// Refinar informações — visita o site do lead (home + páginas de contato),
// lê o rodapé/HTML e extrai dados extras: e-mail, WhatsApp, telefone e redes
// sociais (Instagram, Facebook, LinkedIn, YouTube, TikTok, X/Twitter).
// Usa fetch (rápido) e cai para o navegador (Puppeteer) quando o site bloqueia
// ou vem vazio (sites que montam tudo por JavaScript).

import { novaPagina } from './browser.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const REGEX_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const EMAIL_EXT_LIXO = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js'];
const EMAIL_DOM_LIXO = ['example.com', 'sentry.io', 'wixpress.com', 'schema.org', 'w3.org', 'googleapis.com', 'gstatic.com', 'domain.com', 'yourdomain.com', 'email.com', 'company.com', 'yourcompany.com'];
const EMAIL_PLACEHOLDER = ['seu@email.com', 'email@email.com', 'nome@email.com', 'exemplo@exemplo.com', 'teste@teste.com', 'contato@seudominio.com.br'];
const CAMINHOS_CONTATO = ['/contato', '/contact', '/fale-conosco', '/sobre'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizarUrl(site) {
  if (!site) return '';
  try { return new URL(site.startsWith('http') ? site : 'https://' + site).href; } catch { return ''; }
}

async function baixar(url, timeout = 10000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
    const tipo = res.headers.get('content-type') || '';
    if (!res.ok || !/text\/html|text\/plain/.test(tipo)) return { ok: false, corpo: '' };
    return { ok: true, corpo: await res.text(), finalUrl: res.url };
  } catch { return { ok: false, corpo: '' }; }
  finally { clearTimeout(t); }
}

function extrairEmails(html, origin) {
  const achados = new Set();
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) achados.add(m[1]);
  for (const e of (html.match(REGEX_EMAIL) || [])) achados.add(e);
  const limpos = [];
  for (let e of achados) {
    try { e = decodeURIComponent(e); } catch { /* mantém */ }
    e = e.toLowerCase().trim();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) continue;
    if (EMAIL_EXT_LIXO.some(x => e.endsWith(x))) continue;
    if (EMAIL_DOM_LIXO.some(d => e.endsWith('@' + d) || e.includes(d))) continue;
    if (EMAIL_PLACEHOLDER.includes(e) || e.length > 60) continue;
    limpos.push(e);
  }
  let dominio = '';
  try { dominio = new URL(origin).hostname.replace(/^www\./, ''); } catch { /* ignore */ }
  return [...new Set(limpos)].sort((a, b) => (dominio && a.includes(dominio) ? 0 : 1) - (dominio && b.includes(dominio) ? 0 : 1));
}

function extrairWhatsapp(html) {
  const m = html.match(/(?:wa\.me\/|wa\.link\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)(\+?\d{8,15})/i);
  if (!m) return '';
  const d = m[1].replace(/\D/g, '');
  return d.length >= 10 ? d : '';
}

// Hosts que NÃO são o site da empresa: encurtadores de WhatsApp e serviços de
// "link na bio"/agregadores. O Google Maps costuma cadastrar esses no lugar do
// site — e raspar o rodapé deles traz os links DO SERVIÇO, não da empresa.
const WHATS_HOSTS = ['wa.me', 'wa.link', 'api.whatsapp.com', 'whatsa.me', 'w.app', 'whts.link'];
const AGREGADORES = ['linktr.ee', 'linktree.com', 'bio.link', 'beacons.ai', 'beacons.page', 'campsite.bio',
  'about.me', 'ahazou.com', 'mechamenozap.com.br', 'solo.to', 'znap.link', 'flowpage.com', 'carrd.co',
  'msha.ke', 'linkr.bio', 'koji.to', 'instabio.cc', 'many.link', 'tap.bio', 'lnk.bio', 'linkbio.co', 'hotm.art'];
const REDES_HOSTS = ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'linkedin.com'];
const casaHost = (host, lista) => lista.some(h => host === h || host.endsWith('.' + h));

// Segue o link do encurtador de WhatsApp e devolve só o número (esse é confiável).
async function resolverWhatsapp(url) {
  const direto = (url.match(/(?:wa\.me\/|phone=)(\+?\d{10,15})/i) || [])[1];
  if (direto) { const d = direto.replace(/\D/g, ''); if (d.length >= 10) return d; }
  const r = await baixar(url, 8000);
  return extrairWhatsapp((r.finalUrl || '') + '\n' + (r.corpo || ''));
}

function extrairTelefone(html) {
  const m = html.match(/tel:(\+?[\d().\s-]{8,20})/i);
  if (!m) return '';
  const d = m[1].replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return '';
}

// Handles que NÃO são perfil de empresa (páginas internas/reservadas das redes).
const RESERVADOS = new Set(['whatsapp', 'wa', 'share', 'sharer', 'dialog', 'intent', 'plugins', 'tr', 'home', 'p',
  'reel', 'reels', 'tv', 'explore', 'stories', 'story', 'accounts', 'direct', 'about', 'developer', 'developers',
  'legal', 'privacy', 'terms', 'help', 'press', 'api', 'blog', 'business', 'contact', 'contato', 'login', 'signup',
  'embed', 'tagged', 'saved', 'locations', 'hashtag', 'web', 'l', 's', 'events', 'groups', 'watch', 'gaming',
  'marketplace', 'pages', 'people', 'photo', 'media', 'profile.php', 'story.php', 'permalink.php', 'sharer.php',
  'policy', 'policies', 'cookie', 'support', 'download', 'apps', 'pt-br', 'en', 'lite', 'maps', 'search', 'sorry']);
// Redes sociais: pega o PRIMEIRO handle válido de cada rede (pula os reservados).
const REDES = [
  ['instagram', /(?:https?:)?\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)/gi],
  ['facebook', /(?:https?:)?\/\/(?:www\.|m\.|pt-br\.|business\.)?facebook\.com\/([a-zA-Z0-9.]+)/gi],
  ['linkedin', /(?:https?:)?\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/(?:company|in)\/([a-zA-Z0-9._%-]+)/gi],
  ['youtube', /(?:https?:)?\/\/(?:www\.)?youtube\.com\/(?:@|channel\/|c\/|user\/)([a-zA-Z0-9._%-]+)/gi],
  ['tiktok', /(?:https?:)?\/\/(?:www\.)?tiktok\.com\/@([a-zA-Z0-9._]+)/gi],
  ['twitter', /(?:https?:)?\/\/(?:www\.)?(?:twitter|x)\.com\/([a-zA-Z0-9._]+)/gi]
];

function extrairRedes(html) {
  const out = {};
  for (const [rede, re] of REDES) {
    for (const m of html.matchAll(re)) {
      const handle = (m[1] || '').toLowerCase().replace(/\/+$/, '');
      if (!handle || RESERVADOS.has(handle) || handle.length < 2 || handle.length > 40) continue;
      let u = m[0].replace(/\\/g, '').replace(/["')>].*$/, '').replace(/\/+$/, '');
      if (!/^https?:/i.test(u)) u = 'https://' + u.replace(/^\/\//, '');
      out[rede] = u;
      break; // primeiro handle válido dessa rede
    }
  }
  return out;
}

function coletar(html, origin) {
  return {
    emails: extrairEmails(html, origin),
    whatsapp: extrairWhatsapp(html),
    telefone: extrairTelefone(html),
    redes: extrairRedes(html)
  };
}
const semSinal = d => !d.emails.length && !d.whatsapp && !d.telefone && Object.keys(d.redes).length === 0;

// Renderiza a página no navegador (executa o JS) e devolve o HTML final —
// necessário para sites feitos em Wix/React/Next, onde o rodapé só aparece
// depois que o JavaScript roda.
async function renderizar(url) {
  const page = await novaPagina();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
    await new Promise(r => setTimeout(r, 600));
    return await page.content();
  } catch { return ''; }
  finally { await page.close().catch(() => {}); }
}

// Junta home + páginas de contato e devolve os campos extras encontrados.
export async function refinarLead(site, { deveParar = () => false } = {}) {
  const url = normalizarUrl(site);
  if (!url) return null;
  let origin = '', host = '';
  try { const u = new URL(url); origin = u.origin; host = u.hostname.replace(/^www\./, ''); } catch { return null; }

  // Encurtador de WhatsApp: resolve só o número (confiável) e para por aqui.
  if (casaHost(host, WHATS_HOSTS)) {
    const w = await resolverWhatsapp(url).catch(() => '');
    return w ? { email: '', emails: [], whatsapp: w, telefone: '', redes: {} } : null;
  }
  // O "site" é o próprio perfil de rede social: usa ele como o perfil da empresa.
  if (casaHost(host, REDES_HOSTS)) {
    const redes = extrairRedes(url);
    return Object.keys(redes).length ? { email: '', emails: [], whatsapp: '', telefone: '', redes } : null;
  }
  // Agregador "link na bio": os links são do serviço, não da empresa → não dá pra confiar.
  if (casaHost(host, AGREGADORES) || host.includes('ahazou') || host.includes('mechamenozap')) return null;
  if (host.includes('ifood.com')) return null;

  // 1) HTTP na home
  const r = await baixar(url);
  let dados = r.corpo ? coletar(r.corpo, origin) : { emails: [], whatsapp: '', telefone: '', redes: {} };

  // 2) fallback: bloqueado (sem HTML) OU nada encontrado (site montado por JS) → renderiza
  if ((!r.corpo || semSinal(dados)) && !deveParar()) {
    const rendered = await renderizar(url);
    if (rendered) { const d2 = coletar(rendered, origin); if (!semSinal(d2)) dados = d2; }
  }

  let { emails, whatsapp, telefone, redes } = dados;

  // 3) se faltou e-mail/rede, tenta páginas de contato
  const faltando = !emails.length || Object.keys(redes).length < 2;
  if (faltando && !deveParar()) {
    for (const caminho of CAMINHOS_CONTATO) {
      if (deveParar()) break;
      const rc = await baixar(origin.replace(/\/$/, '') + caminho, 8000);
      if (!rc.ok || !rc.corpo) continue;
      if (!emails.length) emails = extrairEmails(rc.corpo, origin);
      if (!whatsapp) whatsapp = extrairWhatsapp(rc.corpo);
      if (!telefone) telefone = extrairTelefone(rc.corpo);
      redes = { ...extrairRedes(rc.corpo), ...redes };
      if (emails.length && Object.keys(redes).length >= 2) break;
      await sleep(200);
    }
  }

  return { email: emails[0] || '', emails, whatsapp, telefone, redes };
}
