# Raspador de Leads

Gerador de leads B2B **100% local**: junta **Google Maps** e a **base pública de CNPJ**
(dados abertos da Receita Federal), com uma **fila de cidades montada pela API do IBGE**
para varrer um estado inteiro das maiores cidades para as menores, sem repetir.

## Telas
- **Gerador de Leads** — busca por nicho/palavra-chave, estado e cidade(s). Traz
  empresa, telefone, e-mail, site, endereço, atividade e CNPJ. Salva listas,
  exporta **CSV** ou envia direto para o **Google Sheets**.
- **IBGE · Cidades** — monta pacotes de cidades (as maiores primeiro), manda a fila
  pro Gerador e guarda o **histórico de disparos** (termo + cidades executadas).
  Cada pacote varrido por completo é marcado "já usei" sozinho.

## Como rodar
```bash
npm install       # baixa o Chromium do Puppeteer na primeira vez
npm start         # http://localhost:4545
```
Os dados ficam em `./dados/` (fora do Git).

## Instalador para Windows
```bash
brew install makensis imagemagick   # uma vez
./windows/build.sh                  # gera dist/Gerador-de-Leads-PRO-Setup.exe
```
O instalador não pede administrador, já leva o Node embutido e usa o Edge/Chrome
da máquina. Cria um atalho na Área de Trabalho que abre o app no navegador.
No Windows as listas ficam em `%APPDATA%\Gerador de Leads PRO`.

## Google Sheets (opcional)
Em **⚙️ Configurações**, cole o **Client ID/Secret** de um OAuth Client
("Aplicativo Web") do Google Cloud, com o redirect
`http://localhost:4545/api/google/callback`, e conecte a conta. Depois o botão
**📊 Google Sheets** cria uma planilha nova com os leads.

## Observações
- A base de CNPJ (Casa dos Dados, endpoint público) retorna ~20 por combinação de
  filtro; o **Google Maps** é a fonte de volume (pagina por rolagem).
- O e-mail é o dado mais difícil: vem do cadastro da Receita ou do site da empresa,
  quando disponível.

Projeto privado.
