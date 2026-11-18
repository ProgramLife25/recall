/**
 * Recall Web - Main Application Controller
 * Handles UI interactions, ingestion pipeline, clipboard paste, drag & drop, and modals.
 */

let allItems = [];
let currentTab = 'Everything';
let deferredPrompt = null;

// DOM Elements
const searchInput = document.getElementById('searchInput');
const cardsGrid = document.getElementById('cardsGrid');
const emptyState = document.getElementById('emptyState');
const statusText = document.getElementById('statusText');
const dropOverlay = document.getElementById('dropOverlay');

// Modal Elements
const noteModal = document.getElementById('noteModal');
const noteTitleInput = document.getElementById('noteTitleInput');
const noteContentInput = document.getElementById('noteContentInput');
const lightboxModal = document.getElementById('lightboxModal');
const lightboxTitle = document.getElementById('lightboxTitle');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxOcrText = document.getElementById('lightboxOcrText');
const lightboxMeta = document.getElementById('lightboxMeta');
const lightboxColorBadge = document.getElementById('lightboxColorBadge');
const lightboxDeleteBtn = document.getElementById('lightboxDeleteBtn');
const copyOcrBtn = document.getElementById('copyOcrBtn');

let activeLightboxItem = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  try {
    statusText.textContent = 'Initializing local database...';
    await window.recallDB.init();
    await loadItems();
    setupEventListeners();
    setupPwaPrompt();
  } catch (err) {
    console.error('Failed to initialize Recall:', err);
    statusText.textContent = 'Failed to load local storage.';
  }
});

async function loadItems() {
  allItems = await window.recallDB.getAllItems();
  renderGrid();
}

function renderGrid() {
  let pool = [...allItems];

  if (currentTab === 'TopMind') {
    pool = pool.filter((item) => item.isFavorite);
  } else if (currentTab === 'Serendipity') {
    pool = pool.sort(() => Math.random() - 0.5);
  }

  const query = searchInput.value;
  const searchResults = window.searchEngine.search(query, pool);

  cardsGrid.innerHTML = '';

  if (searchResults.length === 0) {
    emptyState.style.display = 'flex';
  } else {
    emptyState.style.display = 'none';
  }

  searchResults.forEach(({ item, matchReason }) => {
    const card = createCardElement(item, matchReason);
    cardsGrid.appendChild(card);
  });

  statusText.textContent = `Library: ${allItems.length} memories saved • Showing ${searchResults.length} results • 100% Local & Private`;
}

function createCardElement(item, matchReason) {
  const card = document.createElement('div');
  card.className = 'memory-card';

  const isImage = item.contentType === 'Image';
  const thumbHtml = isImage && item.dataUrl
    ? `<img class="card-thumb" src="${item.dataUrl}" alt="${escapeHtml(item.name)}" loading="lazy" />`
    : `<div class="card-note-preview">${escapeHtml(item.searchableText || item.name)}</div>`;

  const colorStyle = item.dominantColorHex ? `border-top: 3px solid ${item.dominantColorHex};` : '';

  card.innerHTML = `
    <div class="card-thumb-container" style="${colorStyle}">
      ${thumbHtml}
    </div>
    <div class="card-info">
      <div class="card-title-row">
        <span class="card-title" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <button class="card-fav-btn ${item.isFavorite ? 'active' : ''}" title="Favorite">
          ${item.isFavorite ? '❤️' : '🤍'}
        </button>
      </div>
      <div class="card-meta-row">
        <span class="card-badge">${escapeHtml(item.kind || 'NOTE')}</span>
        <span class="card-reason" title="${escapeHtml(matchReason || '')}">${escapeHtml(matchReason || '')}</span>
      </div>
    </div>
  `;

  // Favorite button click
  const favBtn = card.querySelector('.card-fav-btn');
  favBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.recallDB.toggleFavorite(item.id);
    await loadItems();
  });

  // Card click opens Lightbox
  card.addEventListener('click', () => {
    openLightbox(item);
  });

  return card;
}

// Ingestion Pipeline: Ingest File from Drag/Drop, Paste, or File Picker
async function ingestFile(file, optionalTitle = null) {
  statusText.textContent = `Analyzing ${file.name || 'image'}...`;

  const reader = new FileReader();
  return new Promise((resolve) => {
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const isImage = file.type.startsWith('image/');
      let kind = 'FILE';
      let contentType = 'File';
      let ocrText = '';
      let colorProfile = { hex: '#1E293B', name: 'dark' };

      if (isImage) {
        kind = (file.name ? file.name.split('.').pop() : 'png').toUpperCase();
        contentType = 'Image';

        // 1. Color Profile
        const img = new Image();
        img.src = dataUrl;
        await new Promise((r) => { img.onload = r; });
        colorProfile = await window.visualAnalyzer.extractColorProfile(img);

        // 2. OCR Text extraction
        statusText.textContent = `Extracting OCR text from ${file.name || 'image'}...`;
        ocrText = await window.visualAnalyzer.extractText(dataUrl, (progress) => {
          statusText.textContent = `Running OCR (${progress}%)...`;
        });
      } else if (file.type.includes('text') || file.type.includes('markdown')) {
        kind = 'MD';
        contentType = 'Note';
        ocrText = await file.text();
      }

      // 3. Compute vector embedding
      const combinedText = `${optionalTitle || file.name || 'Pasted Image'} ${ocrText}`;
      const embedding = window.searchEngine.generateEmbedding(combinedText);

      const newItem = {
        id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        name: optionalTitle || file.name || `Memory ${new Date().toLocaleDateString()}`,
        kind,
        contentType,
        modifiedAt: new Date().toISOString(),
        byteSize: file.size || dataUrl.length,
        searchableText: ocrText,
        dominantColorHex: colorProfile.hex,
        dominantColorName: colorProfile.name,
        isFavorite: false,
        dataUrl,
        embedding
      };

      await window.recallDB.saveItem(newItem);
      await loadItems();
      statusText.textContent = `Remembered "${newItem.name}" successfully!`;
      resolve(newItem);
    };

    if (file.type.startsWith('image/') || file.type.includes('pdf')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

// Event Listeners Setup
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', () => {
    renderGrid();
  });

  // Tab Switching
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderGrid();
    });
  });

  // Action: Add Media File Picker
  const fileInput = document.getElementById('fileInput');
  document.getElementById('btnAddMedia').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      await ingestFile(file);
    }
    fileInput.value = '';
  });

  // Action: New Note
  document.getElementById('btnNewNote').addEventListener('click', () => {
    noteTitleInput.value = '';
    noteContentInput.value = '';
    noteModal.classList.add('open');
    noteTitleInput.focus();
  });

  document.getElementById('btnCancelNote').addEventListener('click', () => {
    noteModal.classList.remove('open');
  });

  document.getElementById('btnSaveNote').addEventListener('click', async () => {
    const title = noteTitleInput.value.trim() || 'Untitled Note';
    const content = noteContentInput.value;

    const embedding = window.searchEngine.generateEmbedding(`${title} ${content}`);
    const noteItem = {
      id: 'mem_' + Date.now(),
      name: title,
      kind: 'MD',
      contentType: 'Note',
      modifiedAt: new Date().toISOString(),
      byteSize: content.length,
      searchableText: content,
      dominantColorHex: '#6366F1',
      dominantColorName: 'blue',
      isFavorite: false,
      embedding
    };

    await window.recallDB.saveItem(noteItem);
    noteModal.classList.remove('open');
    await loadItems();
  });

  // Drag and Drop Handling on Window
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropOverlay.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.clientX <= 0 || e.clientY <= 0) {
      dropOverlay.classList.remove('active');
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropOverlay.classList.remove('active');

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await ingestFile(file);
    }
  });

  // Clipboard Paste (Screenshots, Copied Images)
  window.addEventListener('paste', async (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        const dateStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await ingestFile(blob, `Pasted Screenshot ${dateStr}`);
      }
    }
  });

  // Lightbox Close
  document.getElementById('lightboxCloseBtn').addEventListener('click', () => {
    lightboxModal.classList.remove('open');
  });

  // Lightbox Delete
  lightboxDeleteBtn.addEventListener('click', async () => {
    if (activeLightboxItem && confirm(`Delete "${activeLightboxItem.name}"?`)) {
      await window.recallDB.deleteItem(activeLightboxItem.id);
      lightboxModal.classList.remove('open');
      await loadItems();
    }
  });

  // Copy OCR Text
  copyOcrBtn.addEventListener('click', () => {
    if (activeLightboxItem && activeLightboxItem.searchableText) {
      navigator.clipboard.writeText(activeLightboxItem.searchableText);
      const originalText = copyOcrBtn.textContent;
      copyOcrBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyOcrBtn.textContent = originalText; }, 2000);
    }
  });

  // Backup: Export / Import
  document.getElementById('btnExport').addEventListener('click', async () => {
    const json = await window.recallDB.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Recall-Backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  const importInput = document.getElementById('importInput');
  document.getElementById('btnImport').addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) {
      const text = await file.text();
      try {
        const count = await window.recallDB.importAll(text);
        alert(`Successfully imported ${count} memories!`);
        await loadItems();
      } catch (err) {
        alert('Invalid backup file.');
      }
      importInput.value = '';
    }
  });

  // Global Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Focus search on '/' or 'Cmd+K' / 'Ctrl+K'
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }

    // Esc closes modals
    if (e.key === 'Escape') {
      noteModal.classList.remove('open');
      lightboxModal.classList.remove('open');
    }
  });
}

function openLightbox(item) {
  activeLightboxItem = item;
  lightboxTitle.textContent = item.name;

  if (item.contentType === 'Image' && item.dataUrl) {
    lightboxImg.src = item.dataUrl;
    lightboxImg.style.display = 'block';
  } else {
    lightboxImg.style.display = 'none';
  }

  lightboxOcrText.textContent = item.searchableText || '(No OCR text extracted)';
  lightboxMeta.textContent = `${item.kind} • ${new Date(item.modifiedAt).toLocaleString()} • ${(item.byteSize / 1024).toFixed(1)} KB`;

  if (item.dominantColorHex) {
    lightboxColorBadge.style.backgroundColor = item.dominantColorHex;
    lightboxColorBadge.textContent = `${item.dominantColorName || 'Color'}: ${item.dominantColorHex}`;
    lightboxColorBadge.style.display = 'inline-block';
  } else {
    lightboxColorBadge.style.display = 'none';
  }

  lightboxModal.classList.add('open');
}

function setupPwaPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installBtn = document.getElementById('btnInstallPwa');
    if (installBtn) {
      installBtn.style.display = 'inline-flex';
      installBtn.addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const { outcome } = await deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            installBtn.style.display = 'none';
          }
          deferredPrompt = null;
        }
      });
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
