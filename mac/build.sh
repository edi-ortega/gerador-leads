#!/usr/bin/env bash
# Gera dist/Gerador de Leads PRO.app (app do macOS) e o zip entregável.
# Bundla o Node, o código e as dependências. Não baixa Chromium: usa o
# Google Chrome do sistema (como a versão Windows usa o Edge/Chrome).
# Precisa de: node/npm, curl, unzip, ImageMagick (magick), sips, iconutil.
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VERSAO="${NODE_VERSAO:-22.20.0}"
VERSAO="$(node -p "require('$RAIZ/package.json').version")"
case "$(uname -m)" in
  arm64) NARCH="darwin-arm64" ;;
  x86_64) NARCH="darwin-x64" ;;
  *) echo "arquitetura não suportada: $(uname -m)"; exit 1 ;;
esac

CACHE="$RAIZ/mac/.cache"
STAGE="$RAIZ/mac/.stage"
APP="$RAIZ/dist/Gerador de Leads PRO.app"
ZIP="$RAIZ/dist/Gerador-de-Leads-PRO-mac.zip"

rm -rf "$STAGE" "$APP"; mkdir -p "$CACHE" "$RAIZ/dist"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/app"

echo "→ Node.js $NODE_VERSAO ($NARCH)"
TGZ="$CACHE/node-v$NODE_VERSAO-$NARCH.tar.gz"
[ -f "$TGZ" ] || curl -fL -o "$TGZ" "https://nodejs.org/dist/v$NODE_VERSAO/node-v$NODE_VERSAO-$NARCH.tar.gz"
tar -xzf "$TGZ" -C "$CACHE"
cp "$CACHE/node-v$NODE_VERSAO-$NARCH/bin/node" "$APP/Contents/Resources/node"
chmod +x "$APP/Contents/Resources/node"

echo "→ Código do app"
cp -R "$RAIZ/server.js" "$RAIZ/package.json" "$RAIZ/package-lock.json" "$RAIZ/scraper" "$RAIZ/public" "$APP/Contents/Resources/app/"

echo "→ Dependências (sem Chromium: usa o Chrome do sistema)"
( cd "$APP/Contents/Resources/app" && PUPPETEER_SKIP_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund --loglevel=error )
rm -f "$APP/Contents/Resources/app/package-lock.json"

echo "→ Ícone"
ICONSET="$STAGE/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  magick "$RAIZ/public/logo.webp" -background none -gravity center -resize ${s}x${s} -extent ${s}x${s} "$ICONSET/icon_${s}x${s}.png"
  d=$((s*2))
  magick "$RAIZ/public/logo.webp" -background none -gravity center -resize ${d}x${d} -extent ${d}x${d} "$ICONSET/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

echo "→ Info.plist + launcher"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Gerador de Leads PRO</string>
  <key>CFBundleDisplayName</key><string>Gerador de Leads PRO</string>
  <key>CFBundleIdentifier</key><string>com.biema.geradordeleadspro</string>
  <key>CFBundleVersion</key><string>$VERSAO</string>
  <key>CFBundleShortVersionString</key><string>$VERSAO</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>gerador</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST

cat > "$APP/Contents/MacOS/gerador" <<'LAUNCH'
#!/bin/bash
# Sobe o servidor local e abre o navegador. Fecha pela barra de menu (ícone some do Dock).
DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
APPDIR="$DIR/app"
NODEBIN="$DIR/node"
URL="http://localhost:4545"

# Dados do usuário fora do bundle (sobrevive a atualizações do app).
export DADOS_DIR="$HOME/Library/Application Support/Gerador de Leads PRO/dados"
mkdir -p "$DADOS_DIR"

# Puppeteer usa o Google Chrome instalado (não baixamos Chromium).
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] && export CHROME_PATH="$CHROME"
export ABRIR_NAVEGADOR=1

cd "$APPDIR" || exit 1
# Escolhe o node embarcado; se a arquitetura não bater, cai pro node do sistema.
if "$NODEBIN" -v >/dev/null 2>&1; then EXE="$NODEBIN"; else EXE="node"; fi
exec "$EXE" server.js
LAUNCH
chmod +x "$APP/Contents/MacOS/gerador"

echo "→ Zip entregável"
rm -f "$ZIP"
( cd "$RAIZ/dist" && ditto -c -k --sequesterRsrc --keepParent "Gerador de Leads PRO.app" "$ZIP" )

rm -rf "$STAGE"
echo "✅ App:  $APP"
echo "✅ Zip:  $ZIP  ($(du -h "$ZIP" | cut -f1))"
