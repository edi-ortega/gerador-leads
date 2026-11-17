// Scraper do Google Maps com Puppeteer.
// Abre a busca, rola a lista de resultados e visita cada ficha para extrair
// nome, telefone, site, endereço, categoria e avaliação.

import { novaPagina } from './browser.js';
import { anotar } from './integracoes.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Formata telefone brasileiro; para outros países mantém o formato exibido
// pelo próprio Google (que já traz código do país e máscara local corretos).
function formatarTelefone(t, ehBrasil) {
  if (!t) return '';
  const texto = String(t).trim();
  if (!ehBrasil) return texto; // internacional: mantém como o Google mostra
  let d = texto.replace(/\D/g, '');
  if (d.startsWith('55') && d.length > 11) d = d.slice(2); // remove código do país
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return texto;
}

async function textoSeletor(page, seletores) {
  for (const sel of seletores) {
    try {
      const txt = await page.$eval(sel, el => el.textContent?.trim() || el.getAttribute('aria-label') || '');
      if (txt) return txt;
    } catch { /* tenta o próximo */ }
  }
  return '';
}

async function atributoSeletor(page, seletores, attr) {
  for (const sel of seletores) {
    try {
      const val = await page.$eval(sel, (el, a) => el.getAttribute(a) || '', attr);
      if (val) return val;
    } catch { /* tenta o próximo */ }
  }
  return '';
}

export async function buscarLeadsMaps({ estado, cidade, nicho, palavraChave, pais = 'Brasil', limite = 30, onProgress = () => {}, deveCancelar = () => false, ignorar = new Set() }) {
  const ehBrasil = /bra[sz]il/i.test(pais || '') || pais === 'BR';
  const termoBusca = [nicho, palavraChave].filter(Boolean).join(' ');
  const local = [cidade, estado, ehBrasil ? '' : pais].filter(Boolean).join(', ');
  const conector = ehBrasil ? 'em' : 'in';
  const query = local ? `${termoBusca} ${conector} ${local}` : termoBusca;

  onProgress({ etapa: 'maps', mensagem: `Abrindo Google Maps: "${query}"...` });

  const page = await novaPagina();

  const leads = [];
  try {
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=pt-BR`, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Aceita tela de consentimento, se aparecer (vários idiomas)
    try {
      const btnConsent = await page.$('button[aria-label*="ceitar"], button[aria-label*="ccept"], button[aria-label*=" acept"], form[action*="consent"] button');
      if (btnConsent) { await btnConsent.click(); await sleep(2000); }
    } catch { /* segue */ }

    // Rola o painel de resultados para carregar mais itens
    let links = [];
    try {
      await page.waitForSelector('div[role="feed"], a.hfpxzc', { timeout: 20000 });
    } catch {
      // Pode ter caído direto na ficha de um único lugar
      const nomeUnico = await textoSeletor(page, ['h1.DUwDvf', 'h1']);
      if (nomeUnico) {
        const lead = await extrairFicha(page, page.url());
        if (lead) leads.push(lead);
      }
      return leads;
    }

    // Quando há listas a ignorar, coletamos um pool maior de links para ainda
    // conseguir `limite` empresas NOVAS depois de descartar as já conhecidas.
    const poolAlvo = ignorar.size ? Math.max(limite * 4, limite + 30) : limite;
    let tentativasSemNovos = 0;
    while (links.length < poolAlvo && tentativasSemNovos < 8) {
      if (deveCancelar()) break;
      const novos = await page.$$eval('a.hfpxzc', els => els.map(e => e.href));
      const antes = links.length;
      links = [...new Set([...links, ...novos])];
      if (links.length === antes) tentativasSemNovos++; else tentativasSemNovos = 0;

      onProgress({ etapa: 'maps', mensagem: `Carregando resultados do Maps... ${links.length} encontrados` });

      await page.evaluate(() => {
        const feed = document.querySelector('div[role="feed"]');
        if (feed) feed.scrollBy(0, 2500);
      });
      await sleep(1500);

      const fim = await page.evaluate(() =>
        !!document.querySelector('span.HlvSq') ||
        (document.body.innerText || '').includes('Você chegou ao final da lista')
      );
      if (fim) break;
    }

    onProgress({ etapa: 'maps', mensagem: `${links.length} empresas na lista. Extraindo dados de cada uma...` });

    let i = 0;
    for (const link of links) {
      if (deveCancelar()) break;
      if (leads.length >= limite) break; // já juntamos leads novos suficientes
      i++;
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2200);
        const lead = await extrairFicha(page, link);
        if (lead && lead.empresa) {
          // Não repetir: pula empresas já presentes nas listas escolhidas.
          const chave = 'et:' + lead.empresa.toLowerCase().trim() + '|' + (lead.telefone || '').replace(/\D/g, '');
          if (ignorar.has(chave)) continue;
          leads.push(lead);
          onProgress({ etapa: 'maps', mensagem: `Maps: ${leads.length} de ${limite} — ${lead.empresa}`, parcial: lead });
        }
      } catch {
        onProgress({ etapa: 'maps', mensagem: `Maps: falha ao abrir empresa ${i}, pulando...` });
      }
    }
  } finally {
    await page.close().catch(() => {});
  }

  anotar('maps', { registros: leads.length, operacao: [nicho || palavraChave, cidade].filter(Boolean).join(' · ') });
  return leads;

  async function extrairFicha(page, url) {
    const empresa = await textoSeletor(page, ['h1.DUwDvf', 'h1[class*="fontHeadline"]', 'h1']);
    if (!empresa) return null;

    // Prefere o rótulo legível (já formatado por país); usa o tel: como reforço.
    let telefone = await atributoSeletor(page, ['button[data-item-id^="phone"]'], 'aria-label');
    telefone = telefone.replace(/^(Telefone|Phone|Teléfono):\s*/i, '').trim();
    if (!telefone) {
      const tel = await atributoSeletor(page, ['button[data-item-id^="phone:tel:"]'], 'data-item-id');
      telefone = tel.replace('phone:tel:', '');
    }

    const site = await atributoSeletor(page, ['a[data-item-id="authority"]'], 'href');
    const enderecoRaw = await atributoSeletor(page, ['button[data-item-id="address"]'], 'aria-label');
    const endereco = enderecoRaw.replace(/^(Endereço|Address|Dirección):\s*/i, '');
    const categoria = await textoSeletor(page, ['button.DkEaL', 'button[jsaction*="category"]']);
    const notaRaw = await textoSeletor(page, ['div.F7nice span[aria-hidden="true"]']);

    return {
      fonte: 'Google Maps',
      empresa,
      razaoSocial: '',
      cnpj: '',
      email: '',
      telefone: formatarTelefone(telefone, ehBrasil),
      site: site.trim(),
      endereco: endereco.trim(),
      cidade: cidade || '',
      estado: estado || '',
      atividade: categoria.trim(),
      avaliacao: notaRaw.trim(),
      urlMaps: url
    };
  }
}
