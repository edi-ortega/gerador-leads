// Função IBGE: lista as cidades de um estado (com população do Censo 2022),
// classifica por porte (pequena/média/grande) e monta pacotes de N cidades
// para puxar leads — pacotes ordenados das maiores para as menores.
//
// Fonte: API pública do IBGE (servicodados.ibge.gov.br). Sem chave, sem custo.

// Sigla da UF -> código IBGE do estado.
import { anotar } from './integracoes.js';

const UF_CODIGO = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17,
  MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35,
  PR: 41, SC: 42, RS: 43,
  MS: 50, MT: 51, GO: 52, DF: 53
};

// Nome do estado por extenso -> sigla (aceita "Minas Gerais" ou "MG").
const NOME_UF = {
  'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA',
  'CEARA': 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES', 'GOIAS': 'GO',
  'MARANHAO': 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS',
  'MINAS GERAIS': 'MG', 'PARA': 'PA', 'PARAIBA': 'PB', 'PARANA': 'PR',
  'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ',
  'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO',
  'RORAIMA': 'RR', 'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE',
  'TOCANTINS': 'TO'
};

function siglaUf(estado) {
  const n = String(estado || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (n.length === 2 && UF_CODIGO[n]) return n;
  return NOME_UF[n] || '';
}

export function classificarPorte(pop) {
  if (pop >= 500000) return 'grande';
  if (pop >= 100000) return 'média';
  return 'pequena';
}

const cache = new Map(); // uf -> [{nome, populacao, porte}]

// Lista as cidades do estado, ordenadas da maior para a menor população.
export async function listarCidades(estado) {
  const uf = siglaUf(estado);
  if (!uf) throw new Error(`Estado não reconhecido: "${estado}". Use a sigla (ex.: MG) ou o nome.`);
  if (cache.has(uf)) return cache.get(uf);

  const codigo = UF_CODIGO[uf];
  const url = `https://servicodados.ibge.gov.br/api/v3/agregados/4714/periodos/2022/variaveis/93?localidades=N6%5BN3%5B${codigo}%5D%5D`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`IBGE respondeu ${res.status}`);
  const json = await res.json();

  const series = json?.[0]?.resultados?.[0]?.series || [];
  anotar('ibge', { registros: series.length, operacao: `cidades de ${uf}` });
  const cidades = series.map(s => {
    const nome = String(s.localidade?.nome || '').replace(/\s*-\s*[A-Z]{2}$/, '').trim();
    const pop = parseInt(Object.values(s.serie || {})[0], 10) || 0;
    return { nome, populacao: pop, porte: classificarPorte(pop) };
  }).filter(c => c.nome);

  cidades.sort((a, b) => b.populacao - a.populacao);
  cache.set(uf, cidades);
  return cidades;
}

// Monta pacotes de `tamanho` cidades (padrão 10), das maiores para as menores.
export async function montarPacotes(estado, tamanho = 10) {
  const cidades = await listarCidades(estado);
  const pacotes = [];

  for (let i = 0; i < cidades.length; i += tamanho) {
    const grupo = cidades.slice(i, i + tamanho);
    const cont = { grande: 0, 'média': 0, pequena: 0 };
    for (const c of grupo) cont[c.porte]++;
    const dominante = Object.entries(cont).sort((a, b) => b[1] - a[1])[0][0];
    const portesPresentes = ['grande', 'média', 'pequena'].filter(p => cont[p] > 0);

    pacotes.push({
      indice: pacotes.length + 1,
      cidades: grupo.map(c => c.nome),
      detalhe: grupo.map(c => ({ nome: c.nome, populacao: c.populacao, porte: c.porte })),
      qtd: grupo.length,
      porte: dominante,                // porte predominante do pacote
      portesPresentes,                 // todos os portes que aparecem
      popMax: grupo[0].populacao,
      popMin: grupo[grupo.length - 1].populacao
    });
  }

  return { uf: siglaUf(estado), totalCidades: cidades.length, tamanho, pacotes };
}
