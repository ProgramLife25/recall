/**
 * Recall Web — Figma Make Interactive Application Controller
 * Drives the exact Figma design with live IndexedDB storage,
 * instant search, filtering, OCR, drag & drop, clipboard paste, and selection mode.
 */

'use strict';

/* ═══════════════════════════════════════════════
   PRELOADED SEED MEMORIES (FROM FIGMA DESIGN)
═══════════════════════════════════════════════ */
const SEED_MEMORIES = [
  {
    id: 'mem_1',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-1.jpg',
    dataUrl: 'memories/memory-1.jpg',
    title: 'A warm portrait featuring fashion and light…',
    name: 'A warm portrait featuring fashion and light…',
    source: 'unsplash.com',
    tall: true,
    isFavorite: true,
    dominantColorName: 'orange',
    dominantColorHex: '#E29578',
    modifiedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    searchableText: 'A warm portrait featuring fashion, natural golden light and modern style'
  },
  {
    id: 'mem_2',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-2.jpg',
    dataUrl: 'memories/memory-2.jpg',
    title: 'A confident person in modern streetwear…',
    name: 'A confident person in modern streetwear…',
    source: 'unsplash.com',
    tall: true,
    isFavorite: false,
    dominantColorName: 'dark',
    dominantColorHex: '#2B2D42',
    modifiedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    searchableText: 'A confident person in modern streetwear, urban fashion'
  },
  {
    id: 'mem_3',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-3.jpg',
    dataUrl: 'memories/memory-3.jpg',
    title: 'Elephants crossing the grass at golden hour…',
    name: 'Elephants crossing the grass at golden hour…',
    source: 'unsplash.com',
    tall: false,
    isFavorite: false,
    dominantColorName: 'yellow',
    dominantColorHex: '#D4A373',
    modifiedAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    searchableText: 'Elephants crossing the savannah grass at golden hour sunset nature wildlife'
  },
  {
    id: 'mem_4',
    type: 'video',
    contentType: 'Video',
    image: 'memories/memory-4.jpg',
    dataUrl: 'memories/memory-4.jpg',
    title: 'A moment in the wild — special look',
    name: 'A moment in the wild — special look',
    source: 'YouTube',
    tall: false,
    isFavorite: false,
    dominantColorName: 'green',
    dominantColorHex: '#4A5759',
    modifiedAt: new Date(Date.now() - 3600000 * 8).toISOString(),
    searchableText: 'A moment in the wild special look documentary nature wildlife video'
  },
  {
    id: 'mem_5',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-5.jpg',
    dataUrl: 'memories/memory-5.jpg',
    title: 'Soft minimal interior with natural textures…',
    name: 'Soft minimal interior with natural textures…',
    source: 'unsplash.com',
    tall: false,
    isFavorite: false,
    dominantColorName: 'light',
    dominantColorHex: '#EDF2F4',
    modifiedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
    searchableText: 'Soft minimal interior with natural textures aesthetic architecture design room'
  },
  {
    id: 'mem_6',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-6.jpg',
    dataUrl: 'memories/memory-6.jpg',
    title: 'Quiet corner, afternoon reading inspiration…',
    name: 'Quiet corner, afternoon reading inspiration…',
    source: 'unsplash.com',
    tall: true,
    isFavorite: false,
    dominantColorName: 'orange',
    dominantColorHex: '#DDA15E',
    modifiedAt: new Date(Date.now() - 3600000 * 15).toISOString(),
    searchableText: 'Quiet corner afternoon reading inspiration books chair coffee cozy'
  },
  {
    id: 'mem_7',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-7.jpg',
    dataUrl: 'memories/memory-7.jpg',
    title: 'A calm living room built around warm neutrals…',
    name: 'A calm living room built around warm neutrals…',
    source: 'unsplash.com',
    tall: false,
    isFavorite: true,
    dominantColorName: 'light',
    dominantColorHex: '#F4F1DE',
    modifiedAt: new Date(Date.now() - 3600000 * 18).toISOString(),
    searchableText: 'A calm living room built around warm neutrals furniture sofa interior'
  },
  {
    id: 'mem_8',
    type: 'article',
    contentType: 'Article',
    image: 'memories/memory-8.jpg',
    dataUrl: 'memories/memory-8.jpg',
    title: 'The beautiful homes redefining modern comfort',
    name: 'The beautiful homes redefining modern comfort',
    source: 'archdaily.com',
    article: true,
    tall: false,
    isFavorite: false,
    dominantColorName: 'blue',
    dominantColorHex: '#8E9AAF',
    modifiedAt: new Date(Date.now() - 3600000 * 20).toISOString(),
    searchableText: 'The beautiful homes redefining modern comfort architecture design modern living'
  },
  {
    id: 'mem_9',
    type: 'video',
    contentType: 'Video',
    image: 'memories/memory-9.jpg',
    dataUrl: 'memories/memory-9.jpg',
    title: 'Designing a slow and intentional space',
    name: 'Designing a slow and intentional space',
    source: 'YouTube',
    tall: false,
    isFavorite: false,
    dominantColorName: 'light',
    dominantColorHex: '#CBC0D3',
    modifiedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    searchableText: 'Designing a slow and intentional space interior minimalism life design'
  },
  {
    id: 'mem_10',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-10.jpg',
    dataUrl: 'memories/memory-10.jpg',
    title: 'Green accents and sculptural furniture…',
    name: 'Green accents and sculptural furniture…',
    source: 'unsplash.com',
    tall: true,
    isFavorite: false,
    dominantColorName: 'green',
    dominantColorHex: '#588157',
    modifiedAt: new Date(Date.now() - 3600000 * 28).toISOString(),
    searchableText: 'Green accents and sculptural furniture modern plants decor'
  },
  {
    id: 'mem_11',
    type: 'image',
    contentType: 'Image',
    image: 'memories/memory-11.jpg',
    dataUrl: 'memories/memory-11.jpg',
    title: 'Light-filled architecture for everyday living…',
    name: 'Light-filled architecture for everyday living…',
    source: 'unsplash.com',
    tall: false,
    isFavorite: false,
    dominantColorName: 'blue',
    dominantColorHex: '#22577A',
    modifiedAt: new Date(Date.now() - 3600000 * 32).toISOString(),
    searchableText: 'Light-filled architecture for everyday living windows city night'
  }
];

/* ═══════════════════════════════════════════════
   APP STATE
═══════════════════════════════════════════════ */
let memories = [];
let query = '';
let activeTab = 'Everything';
let activeNav = 'home';
let imageFilter = false;
let noteFilter = false;
let articleFilter = false;
let likedFilter = false;
let selectedColor = '';
let selectMode = false;
let selectedIds = new Set();
let activeLightboxItem = null;

/* ═══════════════════════════════════════════════
   DOM ELEMENTS
═══════════════════════════════════════════════ */
const searchInput       = document.getElementById('searchInput');
const searchClear       = document.getElementById('searchClear');
const addBtn            = document.getElementById('addBtn');
const addMenu           = document.getElementById('addMenu');
const selectBtn         = document.getElementById('selectBtn');
const selectBtnLabel    = document.getElementById('selectBtnLabel');

const filterImagesBtn   = document.getElementById('filterImages');
const filterNotesBtn    = document.getElementById('filterNotes');
const filterArticlesBtn = document.getElementById('filterArticles');
const filterLikedBtn    = document.getElementById('filterLiked');
const colorFilterBtn    = document.getElementById('colorFilterBtn');
const colorMenu         = document.getElementById('colorMenu');
const colorFilterLabel  = document.getElementById('colorFilterLabel');

const statusDot         = document.getElementById('statusDot');
const statusText        = document.getElementById('statusText');
const libraryHeadTitle  = document.getElementById('libraryHeadTitle');
const libraryHeadCount  = document.getElementById('libraryHeadCount');

const defaultGrid       = document.getElementById('defaultGrid');
const filteredGrid      = document.getElementById('filteredGrid');
const noResults         = document.getElementById('noResults');

const noteModal         = document.getElementById('noteModal');
const noteTitleInput    = document.getElementById('noteTitleInput');
const noteContentInput  = document.getElementById('noteContentInput');
const lightboxModal     = document.getElementById('lightboxModal');
const lightboxTitle     = document.getElementById('lightboxTitle');
const lightboxImg       = document.getElementById('lightboxImg');
const lightboxMeta      = document.getElementById('lightboxMeta');
const lightboxOcrText   = document.getElementById('lightboxOcrText');
const lightboxDeleteBtn = document.getElementById('lightboxDeleteBtn');
const lightboxDoneBtn   = document.getElementById('lightboxDoneBtn');
const lightboxCloseBtn  = document.getElementById('lightboxCloseBtn');
const copyOcrBtn        = document.getElementById('copyOcrBtn');

const dropOverlay       = document.getElementById('dropOverlay');
const toast             = document.getElementById('toast');

/* ═══════════════════════════════════════════════
   INITIALIZATION
═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  await window.recallDB.init();
  const stored = await window.recallDB.getAllItems();

  if (!stored || stored.length === 0) {
    // Seed initial memories
    for (const mem of SEED_MEMORIES) {
      await window.recallDB.saveItem(mem);
    }
    memories = [...SEED_MEMORIES];
  } else {
    // Merge seed memories with stored user memories
    const seedIds = new Set(SEED_MEMORIES.map(m => m.id));
    const userOnly = stored.filter(s => !seedIds.has(s.id));
    memories = [...SEED_MEMORIES, ...userOnly];
  }

  setupEventListeners();
  updateView();
});

/* ═══════════════════════════════════════════════
   RENDER & VIEW LOGIC
═══════════════════════════════════════════════ */
function isFiltering() {
  return Boolean(
    query ||
    imageFilter ||
    noteFilter ||
    articleFilter ||
    likedFilter ||
    selectedColor ||
    activeTab !== 'Everything' ||
    activeNav === 'liked'
  );
}

function updateView() {
  const filtering = isFiltering();

  // Title
  if (activeNav === 'liked' || likedFilter) {
    libraryHeadTitle.textContent = 'Liked Memories';
  } else if (activeNav === 'spaces' || activeTab === 'Spaces') {
    libraryHeadTitle.textContent = 'Spaces';
  } else if (activeTab === 'Articles') {
    libraryHeadTitle.textContent = 'Articles & Reads';
  } else {
    const hour = new Date().getHours();
    libraryHeadTitle.textContent = hour < 12 ? 'Good Morning' : (hour < 17 ? 'Good Afternoon' : 'Good Evening');
  }

  if (!filtering) {
    // Show default Figma 5-column layout
    defaultGrid.style.display = 'grid';
    filteredGrid.style.display = 'none';
    noResults.style.display = 'none';
    libraryHeadCount.textContent = `${memories.length + 6} memories`;

    // Sync like state on default grid cards
    document.querySelectorAll('.default-grid .like-button').forEach(btn => {
      const id = btn.dataset.id;
      const mem = memories.find(m => String(m.id) === String(id) || String(m.id) === `mem_${id}`);
      const isLiked = mem ? !!mem.isFavorite : false;
      btn.classList.toggle('liked', isLiked);
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('fill', isLiked ? '#ff7f7f' : 'none');
        svg.setAttribute('stroke', isLiked ? '#ff7f7f' : 'currentColor');
      }
    });

    // Sync selection on default grid cards
    document.querySelectorAll('.default-grid article.memory-card').forEach(card => {
      const id = card.dataset.id;
      card.classList.toggle('selected', selectMode && (selectedIds.has(id) || selectedIds.has(`mem_${id}`)));
    });

  } else {
    // Show filtered grid
    defaultGrid.style.display = 'none';
    filteredGrid.style.display = 'grid';

    const results = filterMemories();
    libraryHeadCount.textContent = `${results.length} ${results.length === 1 ? 'memory' : 'memories'}`;

    filteredGrid.innerHTML = '';

    if (results.length === 0) {
      noResults.style.display = 'block';
    } else {
      noResults.style.display = 'none';

      // If note filter is on, show "Add new note" card first
      if (noteFilter) {
        filteredGrid.appendChild(createNewNoteCard());
      }

      results.forEach(mem => {
        filteredGrid.appendChild(createMemoryCard(mem));
      });
    }
  }

  // Update selection button label
  if (selectMode) {
    selectBtnLabel.textContent = selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'Done';
    selectBtn.classList.add('active');
  } else {
    selectBtnLabel.textContent = 'Select';
    selectBtn.classList.remove('active');
  }
}

function filterMemories() {
  return memories.filter(mem => {
    // Text search
    if (query) {
      const hay = `${mem.title || ''} ${mem.name || ''} ${mem.source || ''} ${mem.searchableText || ''}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }

    // Liked
    if ((likedFilter || activeNav === 'liked') && !mem.isFavorite) return false;

    // Type filters
    if (imageFilter && mem.type !== 'image' && mem.contentType !== 'Image') return false;
    if (noteFilter && mem.type !== 'note' && mem.contentType !== 'Note') return false;
    if (articleFilter && mem.type !== 'article' && !mem.article) return false;
    if (activeTab === 'Articles' && mem.type !== 'article' && !mem.article) return false;

    // Color filter
    if (selectedColor && (mem.dominantColorName || '').toLowerCase() !== selectedColor.toLowerCase()) {
      return false;
    }

    return true;
  });
}

/* ═══════════════════════════════════════════════
   CARD CREATION (MATCHING FIGMA CSS)
═══════════════════════════════════════════════ */
function createNewNoteCard() {
  const btn = document.createElement('button');
  btn.className = 'new-note';
  btn.innerHTML = `
    <b>Add new note</b>
    <strong>Start typing here…</strong>
    <i></i><i></i><i></i><i></i><i></i>
  `;
  btn.addEventListener('click', openNoteModal);
  return btn;
}

function createMemoryCard(mem) {
  const card = document.createElement('article');
  card.className = `memory-card ${mem.tall ? 'tall' : ''} ${selectedIds.has(mem.id) ? 'selected' : ''}`;
  card.dataset.id = mem.id;

  const imgSrc = mem.image || mem.dataUrl || 'memories/memory-1.jpg';
  const title = mem.title || mem.name || 'Untitled Memory';
  const source = mem.source || (mem.contentType === 'Note' ? 'Personal Note' : 'Recall');

  let extraHtml = '';
  if (mem.type === 'video') {
    extraHtml += `<span class="play"><svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="m9 7 9 5-9 5z" /></svg></span>`;
  }
  if (mem.article || mem.type === 'article') {
    extraHtml += `<span class="article-tag"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M6 2h9l4 4v16H6z" /><path d="M15 2v5h4M9 12h7M9 16h7" /></svg> Article</span>`;
  }
  if (selectMode) {
    extraHtml += `<span class="select-dot">${selectedIds.has(mem.id) ? '✓' : ''}</span>`;
  }

  card.innerHTML = `
    <img src="${escHtml(imgSrc)}" alt="${escHtml(title)}" loading="lazy" />
    <div class="card-shade"></div>
    ${extraHtml}
    <div class="card-copy">
      <strong>${escHtml(title)}</strong>
      <small>${escHtml(source)}</small>
    </div>
    <button class="like-button ${mem.isFavorite ? 'liked' : ''}" aria-label="Favorite">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="${mem.isFavorite ? '#ff7f7f' : 'none'}" stroke="${mem.isFavorite ? '#ff7f7f' : 'currentColor'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20.8 5.8c-1.7-1.8-4.5-1.8-6.2 0L12 8.4 9.4 5.8a4.38 4.38 0 0 0-6.2 6.2l2.6 2.6L12 20.8l6.2-6.2 2.6-2.6a4.38 4.38 0 0 0 0-6.2Z" />
      </svg>
    </button>
  `;

  // Like button
  card.querySelector('.like-button').addEventListener('click', async e => {
    e.stopPropagation();
    mem.isFavorite = !mem.isFavorite;
    await window.recallDB.saveItem(mem);
    showToast(mem.isFavorite ? 'Added to Liked' : 'Removed from Liked');
    updateView();
  });

  // Card click: Select mode toggle or Lightbox open
  card.addEventListener('click', () => {
    if (selectMode) {
      if (selectedIds.has(mem.id)) selectedIds.delete(mem.id);
      else selectedIds.add(mem.id);
      updateView();
    } else {
      openLightbox(mem);
    }
  });

  return card;
}

/* ═══════════════════════════════════════════════
   MODALS: NOTE & LIGHTBOX
═══════════════════════════════════════════════ */
function openNoteModal() {
  noteTitleInput.value = '';
  noteContentInput.value = '';
  noteModal.classList.add('open');
  setTimeout(() => noteTitleInput.focus(), 60);
}

function openLightbox(mem) {
  activeLightboxItem = mem;
  lightboxTitle.textContent = mem.title || mem.name || 'Memory';

  const imgSrc = mem.image || mem.dataUrl;
  if (imgSrc) {
    lightboxImg.src = imgSrc;
    lightboxImg.style.display = 'block';
  } else {
    lightboxImg.style.display = 'none';
  }

  lightboxMeta.textContent = `${mem.source || 'Recall'} • ${new Date(mem.modifiedAt || Date.now()).toLocaleDateString()}`;
  lightboxOcrText.textContent = mem.searchableText || '(No OCR text extracted)';
  lightboxModal.classList.add('open');
}

/* ═══════════════════════════════════════════════
   FILE INGESTION & OCR
═══════════════════════════════════════════════ */
async function ingestFile(file) {
  showStatus(`Analyzing ${file.name}…`, true);
  const reader = new FileReader();

  reader.onload = async e => {
    const dataUrl = e.target.result;
    const isImage = file.type.startsWith('image/');
    let ocrText = '';
    let colorProfile = { hex: '#2B2D42', name: 'dark' };

    if (isImage) {
      const img = new Image();
      img.src = dataUrl;
      await new Promise(r => { img.onload = r; });
      colorProfile = await window.visualAnalyzer.extractColorProfile(img);

      showStatus('Running on-device OCR…', true);
      ocrText = await window.visualAnalyzer.extractText(dataUrl, p => {
        showStatus(`OCR: ${p}% complete…`, true);
      });
    } else {
      try { ocrText = await file.text(); } catch {}
    }

    const title = file.name.replace(/\.[^/.]+$/, '');
    const newMem = {
      id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: isImage ? 'image' : 'note',
      contentType: isImage ? 'Image' : 'Note',
      image: dataUrl,
      dataUrl: dataUrl,
      title: title,
      name: title,
      source: 'Local Upload',
      tall: false,
      isFavorite: false,
      dominantColorName: colorProfile.name,
      dominantColorHex: colorProfile.hex,
      modifiedAt: new Date().toISOString(),
      searchableText: `${title} ${ocrText}`
    };

    memories.unshift(newMem);
    await window.recallDB.saveItem(newMem);
    showStatus('On-device analysis complete', false);
    showToast(`Saved "${title}"`);
    updateView();
  };

  if (file.type.startsWith('image/')) {
    reader.readAsDataURL(file);
  } else {
    reader.readAsText(file);
  }
}

/* ═══════════════════════════════════════════════
   EVENT LISTENERS
═══════════════════════════════════════════════ */
function setupEventListeners() {
  // Search
  searchInput.addEventListener('input', () => {
    query = searchInput.value.trim();
    searchClear.classList.toggle('visible', query.length > 0);
    updateView();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    query = '';
    searchClear.classList.remove('visible');
    updateView();
    searchInput.focus();
  });

  // Top Tabs
  document.querySelectorAll('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.tab;
      updateView();
    });
  });

  // Side Rail Navigation
  document.querySelectorAll('.side-rail nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.side-rail nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeNav = btn.dataset.nav;
      if (activeNav === 'liked') {
        likedFilter = true;
        filterLikedBtn.classList.add('active');
      } else {
        likedFilter = false;
        filterLikedBtn.classList.remove('active');
      }
      updateView();
    });
  });

  // Filter Buttons
  filterImagesBtn.addEventListener('click', () => {
    imageFilter = !imageFilter;
    filterImagesBtn.classList.toggle('active', imageFilter);
    updateView();
  });

  filterNotesBtn.addEventListener('click', () => {
    noteFilter = !noteFilter;
    filterNotesBtn.classList.toggle('active', noteFilter);
    updateView();
  });

  filterArticlesBtn.addEventListener('click', () => {
    articleFilter = !articleFilter;
    filterArticlesBtn.classList.toggle('active', articleFilter);
    updateView();
  });

  filterLikedBtn.addEventListener('click', () => {
    likedFilter = !likedFilter;
    filterLikedBtn.classList.toggle('active', likedFilter);
    updateView();
  });

  // Color Filter
  colorFilterBtn.addEventListener('click', e => {
    e.stopPropagation();
    colorMenu.classList.toggle('open');
    addMenu.classList.remove('open');
  });

  colorMenu.querySelectorAll('.color-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      selectedColor = item.dataset.color || '';
      colorFilterLabel.textContent = selectedColor ? item.textContent.trim() : 'Color';
      colorFilterBtn.classList.toggle('active', !!selectedColor);
      colorMenu.classList.remove('open');
      updateView();
    });
  });

  // Select Mode Toggle
  selectBtn.addEventListener('click', () => {
    selectMode = !selectMode;
    if (!selectMode) selectedIds.clear();
    updateView();
  });

  // Add Menu Toggle
  addBtn.addEventListener('click', e => {
    e.stopPropagation();
    addMenu.classList.toggle('open');
    colorMenu.classList.remove('open');
  });

  document.addEventListener('click', e => {
    if (!addBtn.contains(e.target)) addMenu.classList.remove('open');
    if (!colorFilterBtn.contains(e.target)) colorMenu.classList.remove('open');
  });

  // Add Menu Actions
  document.getElementById('menuAddMedia').addEventListener('click', () => {
    addMenu.classList.remove('open');
    document.getElementById('fileInput').click();
  });

  document.getElementById('menuNewNote').addEventListener('click', () => {
    addMenu.classList.remove('open');
    openNoteModal();
  });

  document.getElementById('defaultNewNoteBtn').addEventListener('click', openNoteModal);

  document.getElementById('menuPaste').addEventListener('click', async () => {
    addMenu.classList.remove('open');
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            await ingestFile(new File([blob], `Pasted Screenshot ${time}.png`, { type }));
          }
        }
      }
    } catch {
      showToast('Paste with Cmd+V directly in window');
    }
  });

  document.getElementById('menuExport').addEventListener('click', async () => {
    addMenu.classList.remove('open');
    const json = JSON.stringify(memories, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `Recall-${new Date().toISOString().slice(0, 10)}.json`
    });
    a.click();
    showToast('Backup exported!');
  });

  document.getElementById('menuImport').addEventListener('click', () => {
    addMenu.classList.remove('open');
    document.getElementById('importInput').click();
  });

  document.getElementById('fileInput').addEventListener('change', async e => {
    for (const file of e.target.files) await ingestFile(file);
    e.target.value = '';
  });

  document.getElementById('importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      for (const item of imported) await window.recallDB.saveItem(item);
      memories = await window.recallDB.getAllItems();
      showToast(`Imported ${imported.length} memories!`);
      updateView();
    } catch {
      showToast('Invalid backup file');
    }
  });

  // Default Grid Likes
  document.querySelectorAll('.default-grid .like-button').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const mem = memories.find(m => String(m.id) === String(id) || String(m.id) === `mem_${id}`);
      if (mem) {
        mem.isFavorite = !mem.isFavorite;
        await window.recallDB.saveItem(mem);
        showToast(mem.isFavorite ? 'Saved to Liked' : 'Removed from Liked');
        updateView();
      }
    });
  });

  // Default Grid Card Clicks
  document.querySelectorAll('.default-grid article.memory-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const mem = memories.find(m => String(m.id) === String(id) || String(m.id) === `mem_${id}`);
      if (selectMode) {
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        updateView();
      } else if (mem) {
        openLightbox(mem);
      }
    });
  });

  // Note Modal Save
  document.getElementById('btnCancelNote').addEventListener('click', () => {
    noteModal.classList.remove('open');
  });

  document.getElementById('btnSaveNote').addEventListener('click', async () => {
    const title = noteTitleInput.value.trim() || 'Untitled Note';
    const content = noteContentInput.value.trim();
    if (!content) return;

    const newNote = {
      id: `mem_${Date.now()}`,
      type: 'note',
      contentType: 'Note',
      title: title,
      name: title,
      source: 'Personal Note',
      tall: false,
      isFavorite: false,
      modifiedAt: new Date().toISOString(),
      searchableText: `${title} ${content}`
    };

    memories.unshift(newNote);
    await window.recallDB.saveItem(newNote);
    noteModal.classList.remove('open');
    showToast(`Saved "${title}"`);
    updateView();
  });

  // Lightbox Close & Delete
  lightboxCloseBtn.addEventListener('click', () => lightboxModal.classList.remove('open'));
  lightboxDoneBtn.addEventListener('click', () => lightboxModal.classList.remove('open'));

  lightboxDeleteBtn.addEventListener('click', async () => {
    if (!activeLightboxItem) return;
    if (confirm(`Delete "${activeLightboxItem.title || activeLightboxItem.name}"?`)) {
      memories = memories.filter(m => m.id !== activeLightboxItem.id);
      await window.recallDB.deleteItem(activeLightboxItem.id);
      lightboxModal.classList.remove('open');
      showToast('Memory deleted');
      updateView();
    }
  });

  copyOcrBtn.addEventListener('click', () => {
    if (activeLightboxItem?.searchableText) {
      navigator.clipboard.writeText(activeLightboxItem.searchableText).then(() => {
        copyOcrBtn.textContent = '✅ Copied!';
        setTimeout(() => { copyOcrBtn.textContent = '📋 Copy'; }, 2000);
      });
    }
  });

  // Drag & Drop
  window.addEventListener('dragenter', e => {
    if (e.dataTransfer.types.includes('Files')) dropOverlay.classList.add('active');
  });

  window.addEventListener('dragleave', e => {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      dropOverlay.classList.remove('active');
    }
  });

  window.addEventListener('dragover', e => e.preventDefault());

  window.addEventListener('drop', async e => {
    e.preventDefault();
    dropOverlay.classList.remove('active');
    for (const file of e.dataTransfer.files) await ingestFile(file);
  });

  // Clipboard Paste
  window.addEventListener('paste', async e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;

    for (const item of (e.clipboardData || {}).items || []) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        await ingestFile(new File([blob], `Pasted Screenshot ${time}.png`, { type: item.type }));
      }
    }
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', e => {
    if ((e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      noteModal.classList.remove('open');
      lightboxModal.classList.remove('open');
      addMenu.classList.remove('open');
      colorMenu.classList.remove('open');
      if (selectMode) {
        selectMode = false;
        selectedIds.clear();
        updateView();
      }
    }
  });

  // Settings
  document.getElementById('settingsBtn').addEventListener('click', () => {
    showToast('Settings opened');
  });
}

/* ═══════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════ */
let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function showStatus(msg, indexing = false) {
  statusText.textContent = msg;
  statusDot.classList.toggle('indexing', indexing);
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
