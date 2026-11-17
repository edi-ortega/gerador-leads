// Extração de e-mails a partir do site da empresa.
// Visita a home e páginas comuns de contato, procurando e-mails no HTML.

const PAGINAS_CONTATO = ['', '/contato', '/contact', '/fale-conosco', '/sobre', '/quem-somos'];
const REGEX_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const DOMINIOS_LIXO = ['example.com', 'sentry.io', 'wixpress.com', 'sentry-next.wixpress.com', 'schema.org', 'w3.org', 'googleapis.com', 'gstatic.com', 'domain.com', 'yourdomain.com', 'email.com', 'company.net', 'company.com', 'yourcompany.com', 'sentry.wixpress.com'];
// E-mails de exemplo que aparecem em templates de site (não são reais)
const EMAILS_PLACEHOLDER = ['seu@email.com', 'email@email.com', 'nome@email.com', 'exemplo@exemplo.com', 'seuemail@dominio.com', 'contato@seudominio.com.br', 'teste@teste.com'];
const EXTENSOES_LIXO = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.css', '.js'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

function filtrarEmails(brutos) {
  const limpos = new Set();
  for (let e of brutos) {
    e = e.toLowerCase().trim();
    if (EXTENSOES_LIXO.some(ext => e.endsWith(ext))) continue;
    if (DOMINIOS_LIXO.some(d => e.endsWith('@' + d) || e.includes(d))) continue;
    if (EMAILS_PLACEHOLDER.includes(e)) continue;
    if (e.length > 60) continue;
    limpos.add(e);
  }
  return [...limpos];
}

async function buscarHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9'
      }
    });
    if (!res.ok) return '';
    const tipo = res.headers.get('content-type') || '';
    if (!tipo.includes('text/html') && !tipo.includes('text/plain')) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

export async function extrairEmailDoSite(site) {
  if (!site) return '';
  let base;
  try {
    base = new URL(site.startsWith('http') ? site : `https://${site}`);
  } catch {
    return '';
  }
  // Ignora agregadores que não são o site real da empresa
  const hostsIgnorados = ['facebook.com', 'instagram.com', 'wa.me', 'whatsapp.com', 'linktr.ee', 'ifood.com.br'];
  if (hostsIgnorados.some(h => base.hostname.includes(h))) return '';

  for (const caminho of PAGINAS_CONTATO) {
    const html = await buscarHtml(base.origin + caminho);
    if (!html) continue;
    const achados = filtrarEmails(html.match(REGEX_EMAIL) || []);
    if (achados.length) {
      // Prefere e-mail no mesmo domínio do site
      const dominio = base.hostname.replace(/^www\./, '');
      const proprio = achados.find(e => e.endsWith('@' + dominio) || e.includes(dominio));
      return proprio || achados[0];
    }
    await sleep(300);
  }
  return '';
}
