// Browser Puppeteer compartilhado (com plugin stealth para passar por proteções
// anti-bot). Um único navegador é reaproveitado entre as buscas.

import puppeteer from 'puppeteer-extra';
import Stealth from 'puppeteer-extra-plugin-stealth';

puppeteer.use(Stealth());

let browserPromise = null;

// Fecha sozinho depois de 2 min sem uso e sem página aberta; reabre sob
// demanda. Sem isso o Chrome ficava residente (~200–400 MB) enquanto o servidor
// vivesse — inclusive durante os renders, num Mac de 8 GB.
const OCIOSO_MS = Number(process.env.BROWSER_OCIOSO_MS) || 2 * 60 * 1000;
let timerOcioso = null;
let _paginasIniciais = 1;
// Fecha agora se não houver trabalho em andamento. Devolve true se fechou.
// Quem sabe que vem coisa pesada em seguida (o render, depois das capturas do
// "Gerar vídeo") chama isto em vez de esperar os 2 min do fechamento sozinho.
export async function fecharSeOcioso() {
  if (!browserPromise) return false;
  try {
    const b = await browserPromise;
    if ((await b.pages()).length > _paginasIniciais) return false;
    await fecharBrowser();
    return true;
  } catch { return false; }
}

function agendarFechamento() {
  clearTimeout(timerOcioso);
  timerOcioso = setTimeout(async () => {
    if (!browserPromise) return;
    try {
      const b = await browserPromise;
      // Qualquer página além das que o Chrome abriu sozinho é trabalho em
      // andamento — inclusive uma recém-criada ainda em about:blank. (Filtrar por
      // URL, ou supor 1 aba inicial, fechava o Chrome no meio de um goto: o
      // headless novo pode abrir com 0 abas. Os testes pegaram as duas.)
      if ((await b.pages()).length > _paginasIniciais) return agendarFechamento();
      await fecharBrowser();
    } catch { /* navegador já caiu: o próximo getBrowser reabre */ }
  }, OCIOSO_MS);
  timerOcioso.unref?.();
}

export async function getBrowser() {
  agendarFechamento();
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      // No instalador do Windows usa o Edge/Chrome da máquina (ver windows/iniciar.mjs).
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR']
    }).then(async b => {
      // Quantas páginas o Chrome já abre sozinho (0 ou 1, conforme o modo headless).
      try { _paginasIniciais = (await b.pages()).length; } catch { _paginasIniciais = 1; }
      return b;
    });
  }
  return browserPromise;
}

export async function novaPagina() {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 900 });
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  // Bloqueia recursos de anúncios/tracking para acelerar e evitar ruído
  await page.setRequestInterception(true);
  page.on('request', req => {
    const u = req.url();
    if (u.match(/doubleclick|googlesyndication|vidcrunch|aniview|sparteo|yandex|pubmatic|intentiq|bidmatic|denakop|servg1|avplayer|google-analytics|fundingchoices|gampad|adserver|criteo|cdn-cgi\/rum/)) {
      return req.abort();
    }
    req.continue();
  });
  return page;
}

export async function fecharBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}

// Remove acentos e coloca em maiúsculas — formato exigido pela API de CNPJ.
export function normalizar(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim();
}
