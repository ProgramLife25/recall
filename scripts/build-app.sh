#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUTPUT_DIR="$PROJECT_DIR/outputs"
APP_DIR="$OUTPUT_DIR/Recall.app"
SDK_PATH=${SDKROOT:-$(xcrun --show-sdk-path)}
CACHE_DIR="$PROJECT_DIR/work/cache"

mkdir -p "$CACHE_DIR" "$PROJECT_DIR/work/swiftpm-config" "$PROJECT_DIR/work/swiftpm-security"
cd "$PROJECT_DIR"

SDKROOT="$SDK_PATH" \
CLANG_MODULE_CACHE_PATH="$CACHE_DIR" \
SWIFTPM_MODULECACHE_OVERRIDE="$CACHE_DIR" \
swift build -c release --disable-sandbox \
  --cache-path "$CACHE_DIR" \
  --config-path "$PROJECT_DIR/work/swiftpm-config" \
  --security-path "$PROJECT_DIR/work/swiftpm-security"

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
cp "$PROJECT_DIR/.build/release/Recall" "$APP_DIR/Contents/MacOS/Recall"
cp "$PROJECT_DIR/Support/Info.plist" "$APP_DIR/Contents/Info.plist"
if [ -d "$PROJECT_DIR/Models/MobileCLIP" ]; then
  mkdir -p "$APP_DIR/Contents/Resources/Models"
  rsync -a --exclude='.cache' "$PROJECT_DIR/Models/MobileCLIP/" "$APP_DIR/Contents/Resources/Models/MobileCLIP/"
fi
if [ -d "$PROJECT_DIR/SafariBookmarklet" ]; then
  cp -R "$PROJECT_DIR/SafariBookmarklet" "$APP_DIR/Contents/Resources/SafariBookmarklet"
fi
SIGN_DIR=$(mktemp -d /tmp/recall-sign.XXXXXX)
mv "$APP_DIR" "$SIGN_DIR/Recall.app"
xattr -cr "$SIGN_DIR/Recall.app"
find "$SIGN_DIR/Recall.app" -exec xattr -d com.apple.FinderInfo {} \; 2>/dev/null || true
find "$SIGN_DIR/Recall.app" -exec xattr -d 'com.apple.fileprovider.fpfs#P' {} \; 2>/dev/null || true
codesign --force --deep --sign - "$SIGN_DIR/Recall.app"
ditto --norsrc "$SIGN_DIR/Recall.app" "$APP_DIR"
echo "$APP_DIR"
