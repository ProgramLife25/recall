#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DESTINATION="$PROJECT_DIR/SafariExtension/Xcode"

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "Safari's extension converter was not found. Install the full Xcode app, open it once, and select it with:"
  echo "sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer"
  exit 1
fi

mkdir -p "$DESTINATION"
xcrun safari-web-extension-converter "$PROJECT_DIR/SafariExtension" \
  --project-location "$DESTINATION" \
  --app-name Recall \
  --bundle-identifier local.recall.search \
  --swift

echo "Safari extension project created in $DESTINATION"
