#!/bin/bash
# Builds "Tenner Layout.app" from this folder. Needs Apple's free command line tools (xcode-select --install).
#   ./build.sh            build it into mac/build
#   ./build.sh --install  build it and put it in your Applications folder
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "First install Apple's command line tools: run  xcode-select --install  then try again."; exit 1
fi

APP="build/Tenner Layout.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "Building…"
swiftc -O -parse-as-library -target "$(uname -m)-apple-macos13.0" TennerLayout.swift -o "$APP/Contents/MacOS/TennerLayout"
cp layout.js "$APP/Contents/Resources/"
cp Info.plist "$APP/Contents/"

# The app icon, made from the site's own icon
if [ -f ../site/icon-512.png ] && command -v iconutil >/dev/null 2>&1; then
  SET="build/AppIcon.iconset"; rm -rf "$SET"; mkdir -p "$SET"
  for s in 16 32 128 256; do
    sips -z $s $s ../site/icon-512.png --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) ../site/icon-512.png --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  cp ../site/icon-512.png "$SET/icon_512x512.png"
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "$SET"
fi

codesign --force --sign - "$APP" >/dev/null 2>&1 || true

if [ "${1:-}" = "--install" ]; then
  rm -rf "/Applications/Tenner Layout.app"
  ditto "$APP" "/Applications/Tenner Layout.app"
  echo "Done: Tenner Layout is in your Applications folder."
  [ -n "${CI:-}" ] || open "/Applications/Tenner Layout.app"
else
  echo "Done: $(pwd)/$APP"
  [ -n "${CI:-}" ] || open "$APP"
fi
