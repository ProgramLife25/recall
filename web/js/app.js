/**
 * Recall Web — Main Application Controller v3
 * macOS app parity:
 *  - Animated mesh background
 *  - 5-column masonry by column height (not round-robin)
 *  - Dominant color strip at bottom of each card
 *  - Right inspector panel (single-click open, dbl-click lightbox)
 *  - Filter bar + color filter + mode tabs
 *  - Add menu, New Note modal, Lightbox
 *  - Clipboard paste (Cmd+V), Drag & Drop
 *  - Keyboard shortcuts: / or Cmd+K → search, Esc → close
 *  - Proper scope fixes for menu close handlers
 */

'use strict';

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */
let allItems       = [];
let currentTab     = 'Everything';
let currentNav     = 'home';
let filterImages   = false;
let filterNotes    = false;
let filterLiked    = false;
let selectedColor  = '';
let isSelecting    = false;
let selectedIds    = new Set();
let activeInspectorItem = null;
let activeLightboxItem  = null;

/* ═══════════════════════════════════════════
   DOM REFS
═══════════════════════════════════════════ */
const searchInput   = document.getElementById('searchInput');
const searchClear   = document.getElementById('searchClear');
const masonryGrid   = document.getElementById('masonryGrid');
const cols          = [0,1,2,3,4].map(i => document.getElementById(`col${i}`));
const emptyState    = document.getElementById('emptyState');
const statusText    = document.getElementById('statusText');
const statusDot     = document.getElementById('statusDot');
const canvasLabel   = document.getElementById('canvasLabel');
const canvasCount   = document.getElementById('canvasCount');

const inspectorPanel      = document.getElementById('inspectorPanel');
const inspectorClose      = document.getElementById('inspectorClose');
const inspectorType       = document.getElementById('inspectorType');
const inspectorThumb      = document.getElementById('inspectorThumb');
const inspectorNotePreview = document.getElementById('inspectorNotePreview');
const inspectorName       = document.getElementById('inspectorName');
const inspectorDate       = document.getElementById('inspectorDate');
const inspectorTldr       = document.getElementById('inspectorTldr');
const inspectorPalette    = document.getElementById('inspectorPalette');
const paletteSection      = document.getElementById('paletteSection');
const inspectorTags       = document.getElementById('inspectorTags');
const inspectorOcr        = document.getElementById('inspectorOcr');
const inspectorFav        = document.getElementById('inspectorFav');
const inspectorOpen       = document.getElementById('inspectorOpen');
const inspectorDel        = document.getElementById('inspectorDel');

const noteModal         = document.getElementById('noteModal');
const noteTitleInput    = document.getElementById('noteTitleInput');
const noteContentInput  = document.getElementById('noteContentInput');
const lightboxModal     = document.getElementById('lightboxModal');
const lightboxTitle     = document.getElementById('lightboxTitle');
const lightboxImg       = document.getElementById('lightboxImg');
const lightboxOcrText   = document.getElementById('lightboxOcrText');
const lightboxMeta      = document.getElementById('lightboxMeta');
const lightboxColorBadge = document.getElementById('lightboxColorBadge');
const lightboxDeleteBtn = document.getElementById('lightboxDeleteBtn');
const lightboxDoneBtn   = document.getElementById('lightboxDoneBtn');
const copyOcrBtn        = document.getElementById('copyOcrBtn');
const dropOverlay       = document.getElementById('dropOverlay');
const toast             = document.getElementById('toast');

/* keep menu refs in module scope so keyboard handler can close them */
const addBtn   = document.getElementById('addBtn');
const addMenu  = document.getElementById('addMenu');
const colorFilterBtn = document.getElementById('colorFilterBtn');
const colorMenu      = document.getElementById('colorMenu');

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  showStatus('Opening local database…');
  await window.recallDB.init();
  await loadItems();
  setupEventListeners();
  showStatus(`${allItems.length} memories • all shown`);
});

async function loadItems() {
  allItems = await window.recallDB.getAllItems();
  renderGrid();
}

/* ═══════════════════════════════════════════
   RENDER GRID
═══════════════════════════════════════════ */
function renderGrid() {
  let pool = [...allItems];

  /* Nav filter */
  if (currentNav === 'liked') {
    pool = pool.filter(i => i.isFavorite);
  }

  /* Mode filter */
  if (currentTab === 'TopMind') {
    pool = pool.filter(i => i.isFavorite);
  } else if (currentTab === 'Serendipity') {
    // Shuffle for serendipity mode
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }

  /* Chip filters */
  if (filterImages) pool = pool.filter(i => i.contentType === 'Image');
  if (filterNotes)  pool = pool.filter(i => i.contentType === 'Note');
  if (filterLiked)  pool = pool.filter(i => i.isFavorite);
  if (selectedColor) {
    pool = pool.filter(i => (i.dominantColorName || '').toLowerCase() === selectedColor.toLowerCase());
  }

  /* Search */
  const q = searchInput.value.trim();
  const results = window.searchEngine.search(q, pool);

  /* Header */
  const labels = { Everything: 'ALL MEMORIES', TopMind: 'TOP OF MIND', Serendipity: 'SERENDIPITY' };
  canvasLabel.textContent = labels[currentTab] || 'ALL MEMORIES';
  canvasCount.textContent = results.length > 0
    ? `${results.length} ${results.length === 1 ? 'memory' : 'memories'}`
    : '';

  /* Clear columns */
  cols.forEach(c => { c.innerHTML = ''; });
  // Track rendered heights for best-fit column selection
  const heights = [0, 0, 0, 0, 0];

  if (results.length === 0 && allItems.length === 0) {
    emptyState.style.display = 'flex';
    masonryGrid.style.display = 'none';
  } else {
    emptyState.style.display = 'none';
    masonryGrid.style.display = 'flex';

    /* New Note placeholder in col 0 when not searching */
    if (!q && currentTab !== 'Serendipity') {
      cols[0].appendChild(createNewNoteCard());
      heights[0] += 110; // approximate card height
    }

    results.forEach(({ item, matchReason }) => {
      /* Pick the shortest column */
      const colIdx = heights.indexOf(Math.min(...heights));
      const card = createCard(item, matchReason);
      cols[colIdx].appendChild(card);
      /* Estimate this card's height for balancing */
      const isImage = item.contentType === 'Image' && item.dataUrl;
      const imgH = isImage ? (140 + (simpleHash(item.id) % 120)) : 110;
      heights[colIdx] += imgH + 60; // thumb + footer
    });
  }

  statusText.textContent = `${allItems.length} memories · ${results.length} shown`;
  statusDot.classList.remove('indexing');
}

/* ═══════════════════════════════════════════
   NEW NOTE CARD
═══════════════════════════════════════════ */
function createNewNoteCard() {
  const el = document.createElement('div');
  el.className = 'new-note-card';
  el.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" style="opacity:0.5">
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z"/>
    </svg>
    <span>New Note</span>`;
  el.addEventListener('click', openNewNoteModal);
  return el;
}

/* ═══════════════════════════════════════════
   MEMORY CARD
═══════════════════════════════════════════ */
function createCard(item, matchReason) {
  const card = document.createElement('div');
  card.className = 'memory-card';
  if (selectedIds.has(item.id)) card.classList.add('selected');

  const isImage = item.contentType === 'Image' && item.dataUrl;

  /* Thumbnail or note body */
  if (isImage) {
    const img = document.createElement('img');
    img.className = 'card-thumb';
    img.src = item.dataUrl;
    img.alt = item.name;
    img.loading = 'lazy';
    img.decoding = 'async';
    // Variable height for organic masonry feel
    const seed = simpleHash(item.id);
    img.style.height = `${140 + (seed % 120)}px`;
    card.appendChild(img);
  } else {
    const noteBody = document.createElement('div');
    noteBody.className = 'card-note-body';
    noteBody.textContent = item.searchableText || item.name;
    card.appendChild(noteBody);
  }

  /* Footer */
  const footer = document.createElement('div');
  footer.className = 'card-footer';
  footer.innerHTML = `
    <div class="card-title">${escHtml(item.name)}</div>
    <div class="card-tags">
      <span class="card-tag">${escHtml(item.kind || 'NOTE')}</span>
      ${matchReason ? `<span class="card-match-reason">${escHtml(matchReason)}</span>` : ''}
    </div>`;
  card.appendChild(footer);

  /* Dominant color accent strip (macOS parity) */
  if (item.dominantColorHex) {
    const strip = document.createElement('div');
    strip.className = 'card-color-strip';
    strip.style.background = item.dominantColorHex;
    card.appendChild(strip);
  }

  /* Hover action buttons */
  const actions = document.createElement('div');
  actions.className = 'card-hover-actions';
  actions.innerHTML = `
    <button class="card-action-btn fav ${item.isFavorite ? 'active' : ''}" title="Favorite">${item.isFavorite ? '★' : '☆'}</button>
    <button class="card-action-btn del" title="Delete">🗑</button>`;
  card.appendChild(actions);

  /* Favorite button */
  actions.querySelector('.fav').addEventListener('click', async e => {
    e.stopPropagation();
    await window.recallDB.toggleFavorite(item.id);
    await loadItems();
    if (activeInspectorItem?.id === item.id) {
      activeInspectorItem.isFavorite = !activeInspectorItem.isFavorite;
      updateInspectorFav();
    }
  });

  /* Delete button */
  actions.querySelector('.del').addEventListener('click', async e => {
    e.stopPropagation();
    if (confirm(`Delete "${item.name}"?`)) {
      await window.recallDB.deleteItem(item.id);
      if (activeInspectorItem?.id === item.id) closeInspector();
      await loadItems();
      showToast(`Deleted "${item.name}"`);
    }
  });

  /* Single click → Inspector; selection mode → toggle */
  card.addEventListener('click', e => {
    if (isSelecting) {
      toggleSelection(item.id);
      card.classList.toggle('selected', selectedIds.has(item.id));
      return;
    }
    openInspector(item);
  });

  /* Double click → Lightbox */
  card.addEventListener('dblclick', () => openLightbox(item));

  return card;
}

/* ═══════════════════════════════════════════
   INSPECTOR
═══════════════════════════════════════════ */
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

  /* TLDR */
  const text = item.searchableText || '';
  inspectorTldr.textContent = text.length > 180
    ? text.slice(0, 177) + '…'
    : (text || 'A private memory saved in Recall.');

  /* Color palette */
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

  /* Tags */
  inspectorTags.innerHTML = '';
  [item.kind, item.dominantColorName].filter(Boolean).forEach(t => {
    const el = document.createElement('span');
    el.className = 'inspector-tag';
    el.textContent = t;
    inspectorTags.appendChild(el);
  });

  /* OCR */
  inspectorOcr.textContent = item.searchableText || '(No text extracted)';

  updateInspectorFav();
}

function updateInspectorFav() {
  if (!activeInspectorItem) return;
  inspectorFav.textContent = activeInspectorItem.isFavorite ? '★' : '☆';
  inspectorFav.classList.toggle('active', !!activeInspectorItem.isFavorite);
}

function closeInspector() {
  activeInspectorItem = null;
  inspectorPanel.classList.add('hidden');
}

/* ═══════════════════════════════════════════
   LIGHTBOX
═══════════════════════════════════════════ */
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
  const kb = ((item.byteSize || 0) / 1024).toFixed(1);
  lightboxMeta.textContent = `${item.kind || 'NOTE'}  ·  ${new Date(item.modifiedAt).toLocaleString()}  ·  ${kb} KB`;

  if (item.dominantColorHex) {
    lightboxColorBadge.style.background = item.dominantColorHex;
    lightboxColorBadge.style.color = isColorLight(item.dominantColorHex) ? '#111' : '#fff';
    lightboxColorBadge.textContent = `${item.dominantColorName || ''} ${item.dominantColorHex}`.trim();
    lightboxColorBadge.style.display = 'inline-block';
  } else {
    lightboxColorBadge.style.display = 'none';
  }

  lightboxModal.classList.add('open');
}

function isColorLight(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return (r*299 + g*587 + b*114) / 1000 > 160;
}

/* ═══════════════════════════════════════════
   FILE INGESTION
═══════════════════════════════════════════ */
async function ingestFile(file, optionalTitle = null) {
  showStatus(`Analyzing ${file.name || 'file'}…`, true);
  const reader = new FileReader();

  return new Promise(resolve => {
    reader.onload = async e => {
      const dataUrl = e.target.result;
      const isImage = file.type.startsWith('image/');
      let kind = 'FILE', contentType = 'File';
      let ocrText = '';
      let colorProfile = { hex: '#D1D5DB', name: 'gray' };

      if (isImage) {
        kind = (file.name || 'png').split('.').pop().toUpperCase();
        contentType = 'Image';

        // Load image element for color analysis
        const img = new Image();
        img.src = dataUrl;
        await new Promise(r => { img.onload = r; });

        colorProfile = await window.visualAnalyzer.extractColorProfile(img);

        showStatus('Running on-device OCR…', true);
        ocrText = await window.visualAnalyzer.extractText(dataUrl, p => {
          showStatus(`OCR — ${p}% complete…`, true);
        });
      } else if (file.type === 'application/pdf') {
        kind = 'PDF'; contentType = 'File';
        ocrText = '(PDF — text extraction not supported in browser)';
      } else {
        kind = file.name.split('.').pop()?.toUpperCase() || 'TXT';
        contentType = 'Note';
        try { ocrText = await file.text(); } catch {}
      }

      const combinedText = `${optionalTitle || file.name || 'Memory'} ${ocrText}`;
      const embedding = window.searchEngine.generateEmbedding(combinedText);

      const newItem = {
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
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
      showToast(`Saved "${newItem.name}"`);
      resolve(newItem);
    };

    if (file.type.startsWith('image/') || file.type === 'application/pdf') {
      reader.readAsDataURL(file);
    } else {
      reader.readAsText(file);
    }
  });
}

/* ═══════════════════════════════════════════
   SELECTION MODE
═══════════════════════════════════════════ */
function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  const lbl = document.getElementById('selectBtnLabel');
  lbl.textContent = isSelecting
    ? (selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Done')
    : 'Select';
}

/* ═══════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════ */
function setupEventListeners() {

  /* ── Search ── */
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

  /* ── Mode tabs ── */
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderGrid();
    });
  });

  /* ── Sidebar nav ── */
  document.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.nav === 'spaces') {
        showToast('Spaces coming soon! 📦');
        return;
      }
      document.querySelectorAll('.sidebar-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentNav = btn.dataset.nav;
      filterLiked = currentNav === 'liked';
      document.getElementById('filterLiked').classList.toggle('active', filterLiked);
      renderGrid();
    });
  });

  /* ── Add menu ── */
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = addMenu.classList.contains('open');
    addMenu.classList.toggle('open', !isOpen);
    addBtn.setAttribute('aria-expanded', String(!isOpen));
    colorMenu.classList.remove('open');
  });

  document.getElementById('menuAddMedia').addEventListener('click', () => {
    addMenu.classList.remove('open');
    document.getElementById('fileInput').click();
  });
  document.getElementById('menuNewNote').addEventListener('click', () => {
    addMenu.classList.remove('open');
    openNewNoteModal();
  });
  document.getElementById('menuPaste').addEventListener('click', async () => {
    addMenu.classList.remove('open');
    try {
      const items = await navigator.clipboard.read();
      let saved = 0;
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            await ingestFile(new File([blob], `Pasted ${time}.png`, { type }));
            saved++;
          }
        }
      }
      if (saved === 0) showToast('No image found in clipboard. Try Cmd+V.');
    } catch {
      showToast('Clipboard access denied. Try Cmd+V directly.');
    }
  });
  document.getElementById('menuExport').addEventListener('click', async () => {
    addMenu.classList.remove('open');
    const json = await window.recallDB.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `Recall-backup-${new Date().toISOString().slice(0,10)}.json`
    });
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Backup exported!');
  });
  document.getElementById('menuImport').addEventListener('click', () => {
    addMenu.classList.remove('open');
    document.getElementById('importInput').click();
  });

  /* ── File input ── */
  document.getElementById('fileInput').addEventListener('change', async e => {
    for (const file of e.target.files) await ingestFile(file);
    e.target.value = '';
  });

  /* ── Import JSON ── */
  document.getElementById('importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const count = await window.recallDB.importAll(await file.text());
      showToast(`Imported ${count} memories!`);
      await loadItems();
    } catch {
      showToast('Invalid or corrupt backup file.');
    }
    e.target.value = '';
  });

  /* ── Filter chips ── */
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

  /* ── Color filter ── */
  colorFilterBtn.addEventListener('click', e => {
    e.stopPropagation();
    colorMenu.classList.toggle('open');
    addMenu.classList.remove('open');
  });
  colorMenu.querySelectorAll('.color-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedColor = item.dataset.color || '';
      colorMenu.classList.remove('open');
      const swatchEl = item.querySelector('.color-swatch');
      document.getElementById('colorSwatch').style.background = swatchEl ? swatchEl.style.background : 'transparent';
      document.getElementById('colorFilterLabel').textContent = selectedColor ? item.textContent.trim() : 'Color';
      colorFilterBtn.classList.toggle('active', !!selectedColor);
      renderGrid();
    });
  });

  /* ── Global click closes menus ── */
  document.addEventListener('click', e => {
    if (!addBtn.contains(e.target)) addMenu.classList.remove('open');
    if (!colorFilterBtn.contains(e.target)) colorMenu.classList.remove('open');
  });

  /* ── Select button ── */
  document.getElementById('selectBtn').addEventListener('click', () => {
    isSelecting = !isSelecting;
    if (!isSelecting) selectedIds.clear();
    document.getElementById('selectBtnLabel').textContent = isSelecting ? 'Done' : 'Select';
    renderGrid();
  });

  /* ── Inspector ── */
  inspectorClose.addEventListener('click', closeInspector);

  inspectorFav.addEventListener('click', async () => {
    if (!activeInspectorItem) return;
    await window.recallDB.toggleFavorite(activeInspectorItem.id);
    activeInspectorItem.isFavorite = !activeInspectorItem.isFavorite;
    updateInspectorFav();
    await loadItems();
  });

  inspectorOpen.addEventListener('click', () => {
    if (activeInspectorItem) openLightbox(activeInspectorItem);
  });

  inspectorDel.addEventListener('click', async () => {
    if (!activeInspectorItem) return;
    if (confirm(`Delete "${activeInspectorItem.name}"?`)) {
      await window.recallDB.deleteItem(activeInspectorItem.id);
      closeInspector();
      await loadItems();
      showToast('Memory deleted.');
    }
  });

  /* ── Note Modal ── */
  document.getElementById('btnCancelNote').addEventListener('click', () => {
    noteModal.classList.remove('open');
  });
  document.getElementById('btnSaveNote').addEventListener('click', async () => {
    const title   = noteTitleInput.value.trim() || 'Untitled Note';
    const content = noteContentInput.value.trim();
    if (!content && !confirm('Save an empty note?')) return;

    const embedding = window.searchEngine.generateEmbedding(`${title} ${content}`);
    await window.recallDB.saveItem({
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      name: title,
      kind: 'MD',
      contentType: 'Note',
      modifiedAt: new Date().toISOString(),
      byteSize: content.length,
      searchableText: content,
      dominantColorHex: '#6366F1',
      dominantColorName: 'purple',
      isFavorite: false,
      embedding
    });
    noteModal.classList.remove('open');
    await loadItems();
    showToast(`Saved note: "${title}"`);
  });

  /* ── Lightbox ── */
  lightboxDoneBtn.addEventListener('click', () => lightboxModal.classList.remove('open'));
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
      navigator.clipboard.writeText(activeLightboxItem.searchableText).then(() => {
        copyOcrBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyOcrBtn.innerHTML = '📋 Copy'; }, 2200);
      });
    }
  });

  /* ── Drag & Drop ── */
  let dragCounter = 0;
  window.addEventListener('dragenter', e => {
    if (e.dataTransfer.types.includes('Files')) {
      dragCounter++;
      dropOverlay.classList.add('active');
    }
  });
  window.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      dropOverlay.classList.remove('active');
    }
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    for (const file of e.dataTransfer.files) await ingestFile(file);
  });

  /* ── Clipboard Paste (Cmd+V screenshots) ── */
  window.addEventListener('paste', async e => {
    // Ignore paste inside text inputs / textareas
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    for (const item of (e.clipboardData || {}).items || []) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await ingestFile(blob, `Screenshot ${time}`);
      }
    }
  });

  /* ── Keyboard shortcuts ── */
  window.addEventListener('keydown', e => {
    // / or Cmd+K → focus search
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'))
        && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
      return;
    }
    // Escape → close modals / menus
    if (e.key === 'Escape') {
      noteModal.classList.remove('open');
      lightboxModal.classList.remove('open');
      addMenu.classList.remove('open');
      colorMenu.classList.remove('open');
      if (!noteModal.classList.contains('open')
          && !lightboxModal.classList.contains('open')) {
        closeInspector();
      }
    }
  });

  /* ── Settings (placeholder) ── */
  document.getElementById('settingsBtn').addEventListener('click', () => {
    showToast('Settings panel coming soon!');
  });
}

/* ═══════════════════════════════════════════
   MODALS
═══════════════════════════════════════════ */
function openNewNoteModal() {
  noteTitleInput.value = '';
  noteContentInput.value = '';
  noteModal.classList.add('open');
  setTimeout(() => noteTitleInput.focus(), 60);
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800);
}

/* ═══════════════════════════════════════════
   STATUS BAR
═══════════════════════════════════════════ */
function showStatus(msg, indexing = false) {
  statusText.textContent = msg;
  statusDot.classList.toggle('indexing', indexing);
}

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
