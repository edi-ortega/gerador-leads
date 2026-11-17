#!/usr/bin/env bash
# Gera dist/Gerador-de-Leads-PRO-Setup.exe (instalador do Windows).
# Precisa de: node/npm, curl, unzip, ImageMagick (magick) e NSIS (makensis).
#   Linux/WSL:  brew install makensis imagemagick
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSAO="${NODE_VERSAO:-22.20.0}"
VERSAO="$(node -p "require('$RAIZ/package.json').version")"
CACHE="$RAIZ/windows/.cache"
STAGE="$RAIZ/windows/.stage"
SAIDA="$RAIZ/dist/Gerador-de-Leads-PRO-Setup.exe"

rm -rf "$STAGE" && mkdir -p "$STAGE/app" "$CACHE" "$RAIZ/dist"

echo "→ Node.js $NODE_VERSAO para Windows"
ZIP="$CACHE/node-v$NODE_VERSAO-win-x64.zip"
[ -f "$ZIP" ] || curl -fL -o "$ZIP" "https://nodejs.org/dist/v$NODE_VERSAO/node-v$NODE_VERSAO-win-x64.zip"
unzip -p "$ZIP" "node-v$NODE_VERSAO-win-x64/node.exe" > "$STAGE/gerador-leads-node.exe"

echo "→ Código do app"
cp -r "$RAIZ/server.js" "$RAIZ/package.json" "$RAIZ/package-lock.json" "$RAIZ/scraper" "$RAIZ/public" "$STAGE/app/"
mkdir -p "$STAGE/app/windows" && cp "$RAIZ/windows/iniciar.mjs" "$STAGE/app/windows/"

echo "→ Dependências (sem baixar Chromium: usa o Edge/Chrome do Windows)"
(cd "$STAGE/app" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund --loglevel=error)
rm -f "$STAGE/app/package-lock.json"

echo "→ Ícone"
magick "$RAIZ/public/logo.webp" -background none -gravity center -resize 256x256 -extent 256x256 \
  -define icon:auto-resize=256,64,48,32,16 "$STAGE/icone.ico"

echo "→ Instalador"
makensis -V2 -DSTAGE="$STAGE" -DSAIDA="$SAIDA" -DVERSAO="$VERSAO" "$RAIZ/windows/instalador.nsi"

rm -rf "$STAGE"
echo "✅ $(du -h "$SAIDA" | cut -f1)  $SAIDA"
