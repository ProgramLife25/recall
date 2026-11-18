# 🧠 Recall Web (PWA)

> **Private, local-first visual memory library that runs 100% in your browser.**  
> Works on any device: Windows, macOS, Linux, iPad, Android, and Chromebook.

---

## ✨ Features

- **🔒 100% Client-Side & Private**: All memories, screenshots, and notes are saved directly in your browser's local **IndexedDB**. Nothing is ever sent to any remote server.
- **👁️ In-Browser OCR**: Extracts text from screenshots, documents, and receipts client-side with Tesseract.js.
- **⚡ Hybrid Semantic Search**:
  - Semantic vector similarity + OCR matching + exact keywords.
  - Natural query filters: `type:image`, `type:note`, `liked:true`, `today`, `yesterday`.
  - Color filters: search by `red`, `blue`, `green`, `dark`, `white`, etc.
- **🎨 Automatic Palette Extraction**: Identifies the dominant hex color and color family for each saved image.
- **📋 Clipboard Paste & Drag-and-Drop**:
  - Press `Ctrl + V` or `Cmd + V` anywhere to instantly paste screenshots from your clipboard.
  - Drag and drop image files or PDFs directly into the browser window.
- **📱 Installable Progressive Web App (PWA)**:
  - Click **Install** in Chrome or Edge to run Recall as a standalone desktop app without browser tabs.
  - Fully functional offline via Service Worker caching.
- **💾 Local Backup & Restore**: One-click JSON backup export and restore to migrate between computers or browsers.

---

## 🚀 How to Run

### Method 1: Instant Local Open (Zero Install)
You can directly double-click `index.html` to open it in Chrome, Edge, Safari, Brave, or Firefox!

### Method 2: Local HTTP Server (Recommended for PWA & Service Workers)
Run any local server in the `web` folder:

```bash
# Using Python
python3 -m http.server 8080

# Or using npx
npx serve .
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd/Ctrl + K` or `/` | Focus search bar |
| `Cmd/Ctrl + V` | Paste screenshot from clipboard into memory |
| `Esc` | Close open lightbox / note modal |
