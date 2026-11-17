# Save to Recall for Safari

The toolbar button reads the page Safari has already rendered and saves the original page link, best product image, exact page title, visible current price, website, and content type. It hands this data to the native app with the local `recall://save` URL scheme. Recall then downloads and analyzes the image on-device.

No Recall account, server, or cloud API is used.

## Create the Safari extension project

Safari requires every extension to be embedded in a macOS app built with the full Xcode application. After installing Xcode, run this from the Recall project directory:

```sh
./scripts/package-safari-extension.sh
```

Open the generated project inside `SafariExtension/Xcode`, run its macOS app once, then enable **Save to Recall** in **Safari → Settings → Extensions**.

The existing SwiftPM build of Recall already understands extension captures. In the final Xcode project, use bundle identifier `local.recall.search` for the containing app and include the files in `Sources/Recall` plus `Models/MobileCLIP`.
