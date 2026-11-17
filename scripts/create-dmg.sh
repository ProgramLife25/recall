#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR="$PROJECT_DIR/outputs"
APP_DIR="$OUTPUT_DIR/Recall.app"
DMG_PATH="$OUTPUT_DIR/Recall.dmg"

mkdir -p "$OUTPUT_DIR"

# 1. Build the app bundle if it doesn't exist
if [ ! -d "$APP_DIR" ]; then
  echo "Building Recall.app..."
  "$PROJECT_DIR/scripts/build-app.sh"
fi

# 2. Prepare staging directory for DMG
DMG_TEMP=$(mktemp -d /tmp/recall-dmg.XXXXXX)
trap 'rm -rf "$DMG_TEMP"' EXIT

echo "Staging files for DMG..."
cp -R "$APP_DIR" "$DMG_TEMP/Recall.app"
ln -s /Applications "$DMG_TEMP/Applications"

# 3. Create compressed DMG using hdiutil
rm -f "$DMG_PATH"
echo "Creating compressed DMG at $DMG_PATH..."
hdiutil create -volname "Recall" \
  -srcfolder "$DMG_TEMP" \
  -size 280m \
  -ov -format UDZO \
  "$DMG_PATH"

echo "Successfully created installer at: $DMG_PATH"
