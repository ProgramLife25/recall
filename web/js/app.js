/**
 * Recall Web - Main Application Controller
 * Exact macOS app UI/UX parity:
 * - Left sidebar nav (Home / Liked / Spaces)
 * - 5-column masonry grid
 * - Right inspector panel (single-click open, double-click lightbox)
 * - Filter bar (Images, Notes, Liked, Color)
 * - Add menu, New Note modal, Lightbox modal
 * - Clipboard paste, Drag & Drop, Toast notifications
 * - Selection mode, keyboard shortcuts
 */

let allItems = [];
let currentTab = 'Everything';
let currentNav = 'home';
let filterImages = false;
let filterNotes = false;
let filterLiked = false;
let selectedColor = '';
let isSelecting = false;
let selectedIds = new Set();
let activeInspectorItem = null;
let activeLightboxItem = null;

// ── DOM Refs ──
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const masonryGrid = document.getElementById('masonryGrid');
const cols = [0,1,2,3,4].map(i => document.getElementById(`col${i}`));
const emptyState = document.getElementById('emptyState');
const statusText = document.getElementById('statusText');
const statusDot = document.getElementById('statusDot');
const canvasLabel = document.getElementById('canvasLabel');
const canvasCount = document.getElementById('canvasCount');

const inspectorPanel = document.getElementById('inspectorPanel');
const inspectorClose = document.getElementById('inspectorClose');
const inspectorType = document.getElementById('inspectorType');
const inspectorThumb = document.getElementById('inspectorThumb');
const inspectorNotePreview = document.getElementById('inspectorNotePreview');
const inspectorName = document.getElementById('inspectorName');
const inspectorDate = document.getElementById('inspectorDate');
const inspectorTldr = document.getElementById('inspectorTldr');
const inspectorPalette = document.getElementById('inspectorPalette');
const paletteSection = document.getElementById('paletteSection');
const inspectorTags = document.getElementById('inspectorTags');
const inspectorOcr = document.getElementById('inspectorOcr');
const inspectorFav = document.getElementById('inspectorFav');
const inspectorOpen = document.getElementById('inspectorOpen');
const inspectorDel = document.getElementById('inspectorDel');

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
const dropOverlay = document.getElementById('dropOverlay');
const toast = document.getElementById('toast');

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  showStatus('Initializing local database…');
  await window.recallDB.init();
  await loadItems();
  setupEventListeners();
});

async function loadItems() {
  allItems = await window.recallDB.getAllItems();
  renderGrid();
}

// ── Render Grid ──
function renderGrid() {
  let pool = [...allItems];

  // Nav filter
  if (currentNav === 'liked') {
    pool = pool.filter(i => i.isFavorite);
  }

  // Mode filter
  if (currentTab === 'TopMind') {
    pool = pool.filter(i => i.isFavorite);
  } else if (currentTab === 'Serendipity') {
    // Show only items with 'article' content type or shuffle everything
    pool = pool.sort(() => Math.random() - 0.5);
  }

  // Chip filters
  if (filterImages) pool = pool.filter(i => i.contentType === 'Image');
  if (filterNotes) pool = pool.filter(i => i.contentType === 'Note');
  if (filterLiked) pool = pool.filter(i => i.isFavorite);
  if (selectedColor) {
    pool = pool.filter(i => (i.dominantColorName || '').toLowerCase() === selectedColor.toLowerCase());
  }

  // Search
  const q = searchInput.value.trim();
  const results = window.searchEngine.search(q, pool);

  // Update header
  const modeLabels = { Everything: 'ALL MEMORIES', TopMind: 'TOP OF MIND', Serendipity: 'SERENDIPITY' };
  canvasLabel.textContent = modeLabels[currentTab] || 'ALL MEMORIES';
  canvasCount.textContent = results.length > 0 ? `${results.length} ${results.length === 1 ? 'memory' : 'memories'}` : '';

  // Render masonry
  cols.forEach(c => { c.innerHTML = ''; });

  if (results.length === 0 && allItems.length === 0) {
    emptyState.style.display = 'flex';
    masonryGrid.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    masonryGrid.style.display = 'flex';

    // New Note card in first column when nothing searched
    if (!q && currentTab !== 'Serendipity') {
      cols[0].appendChild(createNewNoteCard());
    }

    results.forEach(({ item, matchReason }, index) => {
      const col = cols[index % 5];
      col.appendChild(createCard(item, matchReason));
    });
  }

  // Status
  showStatus(`${allItems.length} memories • ${results.length} shown`);
}

// ── New Note Card ──
function createNewNoteCard() {
  const el = document.createElement('div');
  el.className = 'new-note-card';
  el.innerHTML = `<svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/></svg> New Note`;
  el.addEventListener('click', openNewNoteModal);
  return el;
}

// ── Memory Card ──
function createCard(item, matchReason) {
  const card = document.createElement('div');
  card.className = 'memory-card';
  if (selectedIds.has(item.id)) card.classList.add('selected');

  const isImage = item.contentType === 'Image' && item.dataUrl;

  // Thumbnail or note body
  if (isImage) {
    const img = document.createElement('img');
    img.className = 'card-thumb';
    img.src = item.dataUrl;
    img.alt = item.name;
    img.loading = 'lazy';
    // Vary height slightly for masonry feel
    const seed = simpleHash(item.id);
    const height = 140 + (seed % 120);
    img.style.height = `${height}px`;
    card.appendChild(img);
  } else {
    const noteBody = document.createElement('div');
    noteBody.className = 'card-note-body';
    noteBody.textContent = item.searchableText || item.name;
    card.appendChild(noteBody);
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.innerHTML = `
    <div class="card-title">${escHtml(item.name)}</div>
    <div class="card-tags">
      <span class="card-tag">${escHtml(item.kind || 'NOTE')}</span>
      ${matchReason ? `<span class="card-match-reason">${escHtml(matchReason)}</span>` : ''}
    </div>
  `;
  card.appendChild(footer);

  // Hover action buttons
  const actions = document.createElement('div');
  actions.className = 'card-hover-actions';
  actions.innerHTML = `
    <button class="card-action-btn fav ${item.isFavorite ? 'active' : ''}" title="Favorite">${item.isFavorite ? '★' : '☆'}</button>
    <button class="card-action-btn del" title="Delete">🗑</button>
  `;
  card.appendChild(actions);

  // Events
  actions.querySelector('.fav').addEventListener('click', async e => {
    e.stopPropagation();
    await window.recallDB.toggleFavorite(item.id);
    await loadItems();
    if (activeInspectorItem?.id === item.id) {
      activeInspectorItem.isFavorite = !activeInspectorItem.isFavorite;
      updateInspectorFav();
    }
  });

  actions.querySelector('.del').addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Delete "${item.name}"?`)) {
      await window.recallDB.deleteItem(item.id);
      if (activeInspectorItem?.id === item.id) closeInspector();
      await loadItems();
      showToast(`Deleted "${item.name}"`);
    }
  });

  // Single click → Inspector
  card.addEventListener('click', e => {
    if (isSelecting) {
      toggleSelection(item.id);
      card.classList.toggle('selected', selectedIds.has(item.id));
      return;
    }
    openInspector(item);
  });

  // Double click → Lightbox
  card.addEventListener('dblclick', e => {
    openLightbox(item);
  });

  return card;
}

// ── Inspector ──
function openInspector(item) {
  activeInspectorItem = item;
  inspectorPanel.classList.remove('hidden');

  const isImage = item.contentType === 'Image' && item.dataUrl;
  inspectorType.textContent = item.contentType?.toUpperCase() || 'MEMORY';

  if (isImage) {
    inspectorThumb.src = item.dataUrl;
    inspectorThumb.style.display = 'block';
    inspectorNotePreview.style.display = 'none';
  } else {
    inspectorThumb.style.display = 'none';
    inspectorNotePreview.style.display = 'block';
    inspectorNotePreview.textContent = item.searchableText || item.name;
  }

  inspectorName.textContent = item.name;
  inspectorDate.textContent = new Date(item.modifiedAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  inspectorTldr.textContent = item.searchableText
    ? (item.searchableText.length > 160 ? item.searchableText.slice(0, 157) + '…' : item.searchableText)
    : 'A private memory saved in Recall.';

  // Color palette
  if (isImage && item.dominantColorHex) {
    paletteSection.style.display = 'block';
    inspectorPalette.innerHTML = '';
    const swatch = document.createElement('div');
    swatch.className = 'palette-swatch';
    swatch.style.background = item.dominantColorHex;
    swatch.title = item.dominantColorHex;
    inspectorPalette.appendChild(swatch);
  } else {
    paletteSection.style.display = 'none';
  }

  // Tags from kind
  inspectorTags.innerHTML = '';
  const tags = [item.kind, item.dominantColorName].filter(Boolean);
  tags.forEach(t => {
    const el = document.createElement('span');
    el.className = 'inspector-tag';
    el.textContent = t;
    inspectorTags.appendChild(el);
  });

  // OCR text
  inspectorOcr.textContent = item.searchableText || '(No OCR text)';

  // Fav button
  updateInspectorFav();
}

function updateInspectorFav() {
  if (!activeInspectorItem) return;
  inspectorFav.textContent = activeInspectorItem.isFavorite ? '★' : '☆';
  inspectorFav.classList.toggle('active', activeInspectorItem.isFavorite);
}

function closeInspector() {
  activeInspectorItem = null;
  inspectorPanel.classList.add('hidden');
}

// ── Lightbox ──
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
  lightboxMeta.textContent = `${item.kind || 'NOTE'} • ${new Date(item.modifiedAt).toLocaleString()} • ${((item.byteSize || 0) / 1024).toFixed(1)} KB`;

  if (item.dominantColorHex) {
    lightboxColorBadge.style.background = item.dominantColorHex;
    lightboxColorBadge.style.color = isLight(item.dominantColorHex) ? '#111' : '#fff';
    lightboxColorBadge.textContent = `${item.dominantColorName || ''} ${item.dominantColorHex}`.trim();
    lightboxColorBadge.style.display = 'inline-block';
  } else {
    lightboxColorBadge.style.display = 'none';
  }

  lightboxModal.classList.add('open');
}

function isLight(hex) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 180;
}

// ── File Ingestion ──
async function ingestFile(file, optionalTitle = null) {
  showStatus(`Analyzing ${file.name || 'file'}…`, true);
  const reader = new FileReader();
  return new Promise(resolve => {
    reader.onload = async e => {
      const dataUrl = e.target.result;
      const isImage = file.type.startsWith('image/');
      let kind = 'FILE', contentType = 'File', ocrText = '', colorProfile = { hex: '#D1D5DB', name: 'gray' };

      if (isImage) {
        kind = (file.name || 'png').split('.').pop().toUpperCase();
        contentType = 'Image';
        const img = new Image();
        img.src = dataUrl;
        await new Promise(r => { img.onload = r; });
        colorProfile = await window.visualAnalyzer.extractColorProfile(img);
        showStatus('Running OCR…', true);
        ocrText = await window.visualAnalyzer.extractText(dataUrl, p => showStatus(`OCR (${p}%)…`, true));
      } else {
        kind = 'MD'; contentType = 'Note';
        try { ocrText = await file.text(); } catch {}
      }

      const combinedText = `${optionalTitle || file.name || 'Memory'} ${ocrText}`;
      const embedding = window.searchEngine.generateEmbedding(combinedText);

      const newItem = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
        name: optionalTitle || file.name || `Memory ${new Date().toLocaleDateString()}`,
        kind, contentType,
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
      showToast(`Saved "${newItem.name}"`);
      resolve(newItem);
    };

    if (file.type.startsWith('image/') || file.type.includes('pdf')) {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

// ── Selection Mode ──
function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  document.getElementById('selectBtnLabel').textContent = isSelecting
    ? (selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Done')
    : 'Select';
}

// ── Event Listeners ──
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', () => {
    searchClear.classList.toggle('visible', searchInput.value.length > 0);
    renderGrid();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchClear.classList.remove('visible');
    renderGrid();
    searchInput.focus();
  });

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderGrid();
    });
  });

  // Sidebar nav
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentNav = btn.dataset.nav;
      filterLiked = currentNav === 'liked';
      document.getElementById('filterLiked').classList.toggle('active', filterLiked);
      renderGrid();
    });
  });

  // Add menu
  const addBtn = document.getElementById('addBtn');
  const addMenu = document.getElementById('addMenu');
  addBtn.addEventListener('click', e => { e.stopPropagation(); addMenu.classList.toggle('open'); });
  document.addEventListener('click', () => { addMenu.classList.remove('open'); });

  document.getElementById('menuAddMedia').addEventListener('click', () => { document.getElementById('fileInput').click(); });
  document.getElementById('menuNewNote').addEventListener('click', openNewNoteModal);
  document.getElementById('menuPaste').addEventListener('click', async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            await ingestFile(new File([blob], `Pasted ${new Date().toLocaleTimeString()}.png`, { type }));
          }
        }
      }
    } catch (e) {
      showToast('Paste failed. Try Cmd/Ctrl+V directly in the app window.');
    }
  });
  document.getElementById('menuExport').addEventListener('click', async () => {
    const json = await window.recallDB.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Recall-${new Date().toISOString().slice(0,10)}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  });
  document.getElementById('menuImport').addEventListener('click', () => { document.getElementById('importInput').click(); });

  // File input
  document.getElementById('fileInput').addEventListener('change', async e => {
    for (const file of e.target.files) await ingestFile(file);
    e.target.value = '';
  });

  // Import JSON
  document.getElementById('importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const count = await window.recallDB.importAll(await file.text());
      showToast(`Imported ${count} memories!`);
      await loadItems();
    } catch { showToast('Invalid backup file.'); }
    e.target.value = '';
  });

  // Filter chips
  document.getElementById('filterImages').addEventListener('click', () => {
    filterImages = !filterImages;
    if (filterImages) filterNotes = false;
    document.getElementById('filterImages').classList.toggle('active', filterImages);
    document.getElementById('filterNotes').classList.toggle('active', filterNotes);
    renderGrid();
  });
  document.getElementById('filterNotes').addEventListener('click', () => {
    filterNotes = !filterNotes;
    if (filterNotes) filterImages = false;
    document.getElementById('filterImages').classList.toggle('active', filterImages);
    document.getElementById('filterNotes').classList.toggle('active', filterNotes);
    renderGrid();
  });
  document.getElementById('filterLiked').addEventListener('click', () => {
    filterLiked = !filterLiked;
    document.getElementById('filterLiked').classList.toggle('active', filterLiked);
    renderGrid();
  });

  // Color filter
  const colorFilterBtn = document.getElementById('colorFilterBtn');
  const colorMenu = document.getElementById('colorMenu');
  colorFilterBtn.addEventListener('click', e => { e.stopPropagation(); colorMenu.classList.toggle('open'); });
  document.getElementById('colorMenu').querySelectorAll('.color-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedColor = item.dataset.color || '';
      colorMenu.classList.remove('open');
      const swatchEl = item.querySelector('.color-swatch');
      document.getElementById('colorSwatch').style.background = swatchEl ? swatchEl.style.background : 'transparent';
      document.getElementById('colorFilterLabel').textContent = selectedColor ? (item.textContent.trim()) : 'Color';
      colorFilterBtn.classList.toggle('active', !!selectedColor);
      renderGrid();
    });
  });

  // Select button
  document.getElementById('selectBtn').addEventListener('click', () => {
    isSelecting = !isSelecting;
    if (!isSelecting) { selectedIds.clear(); }
    document.getElementById('selectBtnLabel').textContent = isSelecting ? 'Done' : 'Select';
    renderGrid();
  });

  // Inspector close
  inspectorClose.addEventListener('click', closeInspector);
  inspectorFav.addEventListener('click', async () => {
    if (!activeInspectorItem) return;
    await window.recallDB.toggleFavorite(activeInspectorItem.id);
    activeInspectorItem.isFavorite = !activeInspectorItem.isFavorite;
    updateInspectorFav();
    await loadItems();
  });
  inspectorOpen.addEventListener('click', () => { if (activeInspectorItem) openLightbox(activeInspectorItem); });
  inspectorDel.addEventListener('click', async () => {
    if (!activeInspectorItem) return;
    if (confirm(`Delete "${activeInspectorItem.name}"?`)) {
      await window.recallDB.deleteItem(activeInspectorItem.id);
      closeInspector();
      await loadItems();
      showToast('Memory deleted.');
    }
  });

  // Note Modal
  document.getElementById('btnCancelNote').addEventListener('click', () => noteModal.classList.remove('open'));
  document.getElementById('btnSaveNote').addEventListener('click', async () => {
    const title = noteTitleInput.value.trim() || 'Untitled Note';
    const content = noteContentInput.value;
    const embedding = window.searchEngine.generateEmbedding(`${title} ${content}`);
    await window.recallDB.saveItem({
      id: `mem_${Date.now()}`,
      name: title, kind: 'MD', contentType: 'Note',
      modifiedAt: new Date().toISOString(),
      byteSize: content.length,
      searchableText: content,
      dominantColorHex: '#6366F1', dominantColorName: 'purple',
      isFavorite: false, embedding
    });
    noteModal.classList.remove('open');
    await loadItems();
    showToast(`Saved note: "${title}"`);
  });

  // Lightbox close
  document.getElementById('lightboxCloseBtn').addEventListener('click', () => lightboxModal.classList.remove('open'));
  lightboxDeleteBtn.addEventListener('click', async () => {
    if (!activeLightboxItem) return;
    if (confirm(`Delete "${activeLightboxItem.name}"?`)) {
      await window.recallDB.deleteItem(activeLightboxItem.id);
      lightboxModal.classList.remove('open');
      if (activeInspectorItem?.id === activeLightboxItem.id) closeInspector();
      await loadItems();
      showToast('Memory deleted.');
    }
  });
  copyOcrBtn.addEventListener('click', () => {
    if (activeLightboxItem?.searchableText) {
      navigator.clipboard.writeText(activeLightboxItem.searchableText);
      copyOcrBtn.textContent = '✅ Copied!';
      setTimeout(() => { copyOcrBtn.innerHTML = '📋 Copy'; }, 2000);
    }
  });

  // Drag & Drop
  window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) dropOverlay.classList.add('active'); });
  window.addEventListener('dragleave', e => { if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) dropOverlay.classList.remove('active'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault();
    dropOverlay.classList.remove('active');
    for (const file of e.dataTransfer.files) await ingestFile(file);
  });

  // Clipboard Paste (screenshots)
  window.addEventListener('paste', async e => {
    for (const item of (e.clipboardData || {}).items || []) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await ingestFile(blob, `Pasted Screenshot ${time}`);
      }
    }
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) && document.activeElement !== searchInput) {
      e.preventDefault(); searchInput.focus(); searchInput.select();
    }
    if (e.key === 'Escape') {
      noteModal.classList.remove('open');
      lightboxModal.classList.remove('open');
      addMenu.classList.remove('open');
      colorMenu.classList.remove('open');
    }
  });

  // Settings button (placeholder)
  document.getElementById('settingsBtn').addEventListener('click', () => {
    showToast('Settings coming soon!');
  });
}

function openNewNoteModal() {
  noteTitleInput.value = '';
  noteContentInput.value = '';
  noteModal.classList.add('open');
  setTimeout(() => noteTitleInput.focus(), 50);
}

// ── Toast ──
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

// ── Status bar ──
function showStatus(msg, indexing = false) {
  statusText.textContent = msg;
  statusDot.classList.toggle('indexing', indexing);
}

// ── Helpers ──
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
