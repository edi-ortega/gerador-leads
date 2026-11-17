// Iniciador do Windows (o atalho da Área de Trabalho aponta para cá).
// Guarda os dados em %APPDATA% (sobrevivem a reinstalação), usa o Edge/Chrome
// que já vem no Windows e abre o navegador sozinho.
import fs from 'fs';
import path from 'path';

process.title = 'Gerador de Leads PRO';

process.env.DADOS_DIR ||= path.join(process.env.APPDATA || process.cwd(), 'Gerador de Leads PRO');
process.env.ABRIR_NAVEGADOR ??= '1';

if (!process.env.CHROME_PATH) {
  const bases = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const candidatos = bases.flatMap(b => [
    path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ]);
  const achado = candidatos.find(c => fs.existsSync(c));
  if (achado) process.env.CHROME_PATH = achado;
  else console.log('⚠️  Não achei o Google Chrome nem o Microsoft Edge. Instale o Chrome para as buscas funcionarem.');
}

console.log('==============================================================');
console.log('  🟠 GERADOR DE LEADS PRO');
console.log('');
console.log('  O programa abre sozinho no seu navegador.');
console.log('  NÃO FECHE esta janela enquanto estiver usando.');
console.log('  Para sair do programa, é só fechar esta janela.');
console.log('==============================================================');

await import('../server.js');
