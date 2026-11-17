// Google Sheets — OAuth + criação de planilha (para o "Salvar em Google Sheets").
// O usuário cria um OAuth Client (tipo "Aplicativo Web") no Google Cloud e cola
// o Client ID/Secret nas Configurações. O redirect autorizado deve ser
// http://localhost:3344/api/google/callback

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const ESCOPOS = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email'
].join(' ');

export function urlAutorizacao({ clientId, redirectUri, estado }) {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: ESCOPOS, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true'
  });
  if (estado) p.set('state', estado);
  return `${AUTH_URL}?${p.toString()}`;
}

async function postToken(corpo) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(corpo).toString()
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error_description || json.error || `Google respondeu ${res.status}`);
  return json;
}

export async function trocarCodigoPorTokens({ code, clientId, clientSecret, redirectUri }) {
  return postToken({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' });
}
export async function renovarAcesso({ refreshToken, clientId, clientSecret }) {
  return postToken({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' });
}
export async function obterEmail(accessToken) {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Não consegui identificar a conta (${res.status})`);
  return (await res.json()).email || '';
}

// Cria uma planilha nova com os dados e devolve { id, url }.
// `linhas` é uma matriz (primeira linha = cabeçalho).
export async function criarPlanilha({ accessToken, titulo, linhas }) {
  const criar = await fetch(SHEETS_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: titulo || 'Leads' } })
  });
  const j = await criar.json().catch(() => ({}));
  if (!criar.ok) throw new Error(j.error?.message || `Falha ao criar planilha (${criar.status})`);
  const id = j.spreadsheetId;
  const url = j.spreadsheetUrl;

  const escrever = await fetch(`${SHEETS_API}/${id}/values/A1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: linhas })
  });
  if (!escrever.ok) {
    const e = await escrever.json().catch(() => ({}));
    throw new Error(e.error?.message || `Falha ao gravar dados (${escrever.status})`);
  }
  return { id, url };
}
