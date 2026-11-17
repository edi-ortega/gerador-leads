// Mapeamento de nichos comuns -> códigos CNAE (atividade principal)
// Usado na busca por CNPJ. Se o nicho não estiver aqui, a busca usa o texto livre.

import { readFileSync } from 'fs';

export const NICHO_CNAE = {
  restaurante: ['5611201', '5611203'],
  lanchonete: ['5611203'],
  pizzaria: ['5611201'],
  padaria: ['4721102', '1091101'],
  mercado: ['4711301', '4711302', '4712100'],
  supermercado: ['4711301', '4711302'],
  academia: ['9313100'],
  'salão de beleza': ['9602501'],
  'salao de beleza': ['9602501'],
  barbearia: ['9602501'],
  estética: ['9602502'],
  estetica: ['9602502'],
  clínica: ['8630501', '8630502', '8630503'],
  clinica: ['8630501', '8630502', '8630503'],
  médico: ['8630501', '8630502'],
  medico: ['8630501', '8630502'],
  dentista: ['8630504'],
  odontologia: ['8630504'],
  fisioterapia: ['8650004'],
  psicologia: ['8650003'],
  veterinária: ['7500100'],
  veterinaria: ['7500100'],
  'pet shop': ['4789004', '9609208'],
  petshop: ['4789004', '9609208'],
  farmácia: ['4771701', '4771702'],
  farmacia: ['4771701', '4771702'],
  advocacia: ['6911701'],
  advogado: ['6911701'],
  contabilidade: ['6920601', '6920602'],
  contador: ['6920601'],
  imobiliária: ['6821801', '6821802'],
  imobiliaria: ['6821801', '6821802'],
  'corretor de imóveis': ['6821801'],
  construção: ['4120400'],
  construcao: ['4120400'],
  construtora: ['4120400'],
  engenharia: ['7112000'],
  arquitetura: ['7111100'],
  eletricista: ['4321500'],
  encanador: ['4322301'],
  pintor: ['4330404'],
  marcenaria: ['3101200', '4330402'],
  serralheria: ['2542000'],
  vidraçaria: ['4743100'],
  vidracaria: ['4743100'],
  'oficina mecânica': ['4520001'],
  'oficina mecanica': ['4520001'],
  'auto peças': ['4530703'],
  'auto pecas': ['4530703'],
  'lava rápido': ['4520005'],
  'lava rapido': ['4520005'],
  autoescola: ['8599201'],
  escola: ['8513900', '8520100'],
  'escola infantil': ['8511200'],
  creche: ['8511200'],
  'curso de idiomas': ['8593700'],
  faculdade: ['8531700'],
  hotel: ['5510801'],
  pousada: ['5590601'],
  turismo: ['7911200'],
  'agência de viagens': ['7911200'],
  'agencia de viagens': ['7911200'],
  transportadora: ['4930202'],
  logística: ['5250801', '5250805'],
  logistica: ['5250801', '5250805'],
  'moto táxi': ['4923002'],
  mototaxi: ['4923002'],
  marketing: ['7311400', '7319002'],
  'agência de marketing': ['7311400'],
  'agencia de marketing': ['7311400'],
  publicidade: ['7311400'],
  'desenvolvimento de software': ['6201501', '6202300'],
  software: ['6201501', '6202300'],
  'ti': ['6201501', '6202300', '6209100'],
  informática: ['9511800', '4751201'],
  informatica: ['9511800', '4751201'],
  gráfica: ['1813001', '1813099'],
  grafica: ['1813001', '1813099'],
  papelaria: ['4761003'],
  livraria: ['4761001'],
  'loja de roupas': ['4781400'],
  'loja de calçados': ['4782201'],
  'loja de calcados': ['4782201'],
  'loja de móveis': ['4754701'],
  'loja de moveis': ['4754701'],
  eletrodomésticos: ['4753900'],
  eletrodomesticos: ['4753900'],
  'material de construção': ['4744099', '4744001'],
  'material de construcao': ['4744099', '4744001'],
  tinta: ['4741500', '2071100'],
  tintas: ['4741500', '2071100'],
  'comércio varejista de tintas e materiais para pintura': ['4741500'],
  'comercio varejista de tintas e materiais para pintura': ['4741500'],
  'loja de tintas': ['4741500'],
  'fábrica de tintas': ['2071100'],
  'fabrica de tintas': ['2071100'],
  floricultura: ['4789002'],
  joalheria: ['4783101'],
  ótica: ['4774100'],
  otica: ['4774100'],
  açougue: ['4722901'],
  acougue: ['4722901'],
  hortifruti: ['4724500'],
  distribuidora: ['4639701'],
  'distribuidora de bebidas': ['4635402'],
  bar: ['5611202'],
  cafeteria: ['5611203'],
  'food truck': ['5612100'],
  buffet: ['5620102'],
  confeitaria: ['1091102', '4721104'],
  sorveteria: ['5611203', '1053800'],
  'energia solar': ['4321500', '3511501'],
  segurança: ['8011101'],
  seguranca: ['8011101'],
  limpeza: ['8121400'],
  jardinagem: ['8130300'],
  dedetização: ['8122200'],
  dedetizacao: ['8122200'],
  lavanderia: ['9601701'],
  costura: ['9529199', '1412601'],
  fotografia: ['7420001'],
  eventos: ['8230001'],
  'salão de festas': ['8230002'],
  'salao de festas': ['8230002'],
  igreja: ['9491000'],
  ong: ['9430800'],
  seguros: ['6622300'],
  'corretora de seguros': ['6622300'],
  financeira: ['6499999'],
  imports: ['4693100']
};

export function cnaesPorNicho(nicho) {
  if (!nicho) return [];
  const chave = nicho.trim().toLowerCase();
  if (NICHO_CNAE[chave]) return NICHO_CNAE[chave];
  // 1) Palavra inteira, aceitando plural no fim ("restaurantes", "contadores",
  //    "pet shops"): nunca pedaço solto de palavra — senão "ti" casaria dentro
  //    de "tinta" e traria CNAE de software. Fronteira Unicode (acentos contam
  //    como letra), então sigla curta como "ti" vale como palavra ("ti em
  //    goiânia") mas nunca dentro de outra. Vence a mais específica (a mais longa).
  const maisLonga = (achou, k, v) => (!achou || k.length > achou.k.length ? { k, v } : achou);
  let achou = null;
  for (const [k, v] of Object.entries(NICHO_CNAE)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu');
    if (re.test(chave)) achou = maisLonga(achou, k, v);
  }
  if (achou) return achou.v;
  // 2) Nada bateu: volta ao "contém" de antes, só com chaves de 4+ letras —
  //    o que já funcionava continua funcionando; "ti", "bar" e "ong" ficam de fora.
  for (const [k, v] of Object.entries(NICHO_CNAE)) {
    if (k.length >= 4 && chave.includes(k)) achou = maisLonga(achou, k, v);
  }
  return achou ? achou.v : [];
}

// Campo "CNAE (só Base Nacional)". Aceita código(s) — "4741-5/00", "4741500",
// vários separados por vírgula — ou o nome da atividade como está na lista
// oficial do IBGE (public/cnaes.json, embutida no app). Devolve os códigos de
// 7 dígitos; lista vazia = não reconheceu.
let LISTA_CNAE = null;
export function listaCnae() {
  if (!LISTA_CNAE) {
    try { LISTA_CNAE = JSON.parse(readFileSync(new URL('../public/cnaes.json', import.meta.url), 'utf8')); }
    catch { LISTA_CNAE = []; }
  }
  return LISTA_CNAE;
}

const semAcento = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function cnaesDoCampo(texto) {
  const codigos = new Set();
  for (const parte of String(texto || '').split(/[,;\n]+/)) {
    const p = parte.trim();
    if (!p) continue;
    // Código no começo: "4741-5/00 — Comércio…" (vindo do autocompletar) ou só "4741500".
    const m = p.match(/^(\d{4})\s*-?\s*(\d)\s*\/?\s*(\d{2})(?!\d)/);
    if (m) { codigos.add(m[1] + m[2] + m[3]); continue; }
    // Pelo nome da atividade: igual primeiro; senão, as que contêm o texto.
    const alvo = semAcento(p);
    const lista = listaCnae();
    const iguais = lista.filter(([, d]) => semAcento(d) === alvo);
    const achados = iguais.length ? iguais : lista.filter(([, d]) => semAcento(d).includes(alvo));
    for (const [c] of achados.slice(0, 20)) codigos.add(c);
  }
  return [...codigos];
}
