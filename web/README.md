# 🧠 Recall Web

> **Your private, visual second brain on the web.**  
> Live at **[recall-web-puce.vercel.app](https://recall-web-puce.vercel.app)** — works across macOS, Windows, Linux, iOS, and Android.

---

## ✨ Features

### 🔄 Local-First + Real-Time Cloud Sync
- **Instant Local Persistence**: All memories are cached locally in **IndexedDB** for zero-flicker loading.
- **Firebase Cloud Sync**: Sign in with Google to sync memories, tags, notes, deletions, and your optional Groq API key in real time across browsers and devices.
- **JSON Backup & Restore**: Export or import your entire memory library at any time.

### 🧩 Rich Memory Types
- **🖼️ Images & Screenshots**: Paste (`Cmd/Ctrl + V`) or drag & drop images. Includes client-side **Tesseract.js OCR**, **MobileCLIP** visual embeddings, and automatic color palette extraction.
- **📄 Documents, Research Papers & Spreadsheets**:
  - Save **PDFs** and **arXiv** research papers with an inline PDF reader.
  - Upload or link **Excel (`.xlsx`, `.xls`)**, **CSV/TSV**, and **Google Sheets** with an interactive searchable table viewer.
- **💬 Social Posts**: Save and preview posts from **𝕏 / Twitter**, **Reddit**, **LinkedIn**, **Threads**, **Bluesky**, and **Instagram**.
- **💻 Code Snippets & GitHub**:
  - Save **GitHub files**, **Gists**, **Repositories**, direct code URLs, or local code files (`.py`, `.js`, `.ts`, `.rs`, `.go`, `.cpp`, `.sql`, `.sh`, etc.).
  - Syntax-highlighted cards and modal viewer (Prism.js), line numbers, one-click **Copy** & **Download**, and a built-in code editor (`Tab` indentation, `Cmd/Ctrl + Enter` to save).
- **🎵 Audio & Video**: Embedded **Spotify**, **SoundCloud**, **YouTube**, and uploaded audio/video playback.
- **📰 Articles, Quotes & Notes**: Clean Reader Mode for web articles, automatic quote attribution detection, and quick notes.

### ⚡ Search & AI Enrichment
- **Hybrid Semantic & Color Search**: Search by keywords, OCR text, visual concepts, or color filters (`red`, `blue`, `dark`, etc.), and filter by category (`Articles`, `Documents`, `Audio`, `Social`, `Code`, `Images`, `Notes`, `Videos`, `Liked`).
- **Optional Groq AI**: Add your Groq API key (`gsk_...`) in Settings (synced securely to your account) for automatic titles, TL;DR summaries, and smart tagging.

---

## 🚀 Running Locally

1. **Start the backend + static server** (supports `/api/scrape-url` for links, GitHub, PDFs, and social posts):
   ```bash
   cd recall-web
   python3 server.py
   ```
   Or deploy directly to **Vercel** (`vercel --prod`), which uses `vercel.json` and `api/index.py`.

2. Open [http://localhost:8080](http://localhost:8080) in your browser.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Cmd/Ctrl + K` or `/` | Focus search bar |
| `Cmd/Ctrl + V` | Paste screenshot, URL, text, or code snippet into memory |
| `Cmd/Ctrl + Enter` | Save inside the New Code Snippet editor |
| `Esc` | Close open modal or clear selection |
