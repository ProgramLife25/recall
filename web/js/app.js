/**
 * Recall Web — Interactive Controller for Exact macOS Layout
 * Handles card selection, inspector updates, dynamic search,
 * color palette switching, note creation, and live entity filtering.
 */

'use strict';

const EXACT_CARDS_DATA = {
  lion: {
    id: 'lion',
    type: 'Web image',
    title: 'Redirect Notice',
    date: 'Nov 17, 2026 at 11:04 PM',
    tldr: 'A black animal image featuring feline, lion',
    source: 'www.google.com',
    heroImg: 'memories_exact/lion_hero.jpg',
    palette: ['#130F0C', '#583515', '#7F532E', '#D08B54', '#E5AB7E'],
    tags: ['animal', 'feline', 'lion', 'mammal', 'black', 'brown', 'orange', 'grass'],
    peopleCount: 0,
    hasAnimals: true
  },
  fran: {
    id: 'fran',
    type: 'Quote & portrait',
    title: 'Fran Lebowitz — On Algebra',
    date: 'Nov 17, 2026 at 10:48 PM',
    tldr: 'In real life, I assure you, there is no such thing as algebra.',
    source: 'www.google.com',
    heroImg: 'memories_exact/fran.jpg',
    palette: ['#2B4C5F', '#4A758D', '#7FA2B8', '#B0C9D9', '#E0EDF5'],
    tags: ['quote', 'author', 'fran lebowitz', 'portrait', 'person', 'blue', 'algebra'],
    peopleCount: 1,
    hasAnimals: false
  },
  tryagain: {
    id: 'tryagain',
    type: 'Graphic sign',
    title: 'TRY AGAIN UNTIL YOU SUCCEED',
    date: 'Nov 17, 2026 at 10:30 PM',
    tldr: 'A textured typographic print on persistence and grit.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/tryagain.jpg',
    palette: ['#D9381E', '#F26419', '#F6AE2D', '#33658A', '#2F4858'],
    tags: ['typography', 'flame', 'grit', 'motivation', 'poster', 'red', 'orange'],
    peopleCount: 0,
    hasAnimals: false
  },
  tables: {
    id: 'tables',
    type: 'Structure image',
    title: 'Tables always turn.',
    date: 'Nov 17, 2026 at 10:15 PM',
    tldr: 'A black structure image with bold scarlet red serif typography.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/tables.jpg',
    palette: ['#C4151C', '#8A0F14', '#2B0608', '#141416', '#3D3D42'],
    tags: ['typography', 'red', 'black', 'minimalism', 'structure', 'dark'],
    peopleCount: 0,
    hasAnimals: false
  },
  givingup: {
    id: 'givingup',
    type: 'Document / photo',
    title: 'Giving up is not in the blood sir',
    date: 'Nov 17, 2026 at 09:50 PM',
    tldr: 'A mountaineer traversing a snowy mountain peak at sunrise.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/givingup.jpg',
    palette: ['#2F4858', '#4B7B9E', '#A6C8E0', '#DDA15E', '#BC6C25'],
    tags: ['mountain', 'snow', 'mountaineer', 'perseverance', 'winter', 'sky'],
    peopleCount: 1,
    hasAnimals: false
  },
  youattract: {
    id: 'youattract',
    type: 'Document / manifesto',
    title: 'You attract better WHEN YOU-',
    date: 'Nov 17, 2026 at 09:20 PM',
    tldr: 'A clean manifesto print on self-worth and alignment.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/youattract.jpg',
    palette: ['#1C2A39', '#3D5A80', '#98C1D9', '#E0FBFC', '#EE6C4D'],
    tags: ['manifesto', 'typography', 'self care', 'white', 'editorial'],
    peopleCount: 0,
    hasAnimals: false
  },
  orange_silhouette: {
    id: 'orange_silhouette',
    type: 'Structure image',
    title: 'GO THE EXTRA MILE, IT\'S NEVER CROWDED.',
    date: 'Nov 17, 2026 at 08:45 PM',
    tldr: 'A glowing red-orange silhouette walking in atmospheric fog.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/orange_silhouette.jpg',
    palette: ['#C82A0A', '#E84A1A', '#FF6B35', '#FFAA5A', '#2D0A04'],
    tags: ['orange', 'silhouette', 'red', 'motivation', 'extra mile', 'glow'],
    peopleCount: 1,
    hasAnimals: false
  },
  studio: {
    id: 'studio',
    type: 'Person & workstation',
    title: 'GET RICH OR DIE TRYIN\'',
    date: 'Nov 17, 2026 at 08:10 PM',
    tldr: 'Music producer at studio workstation with synthesizers and monitors.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/studio.jpg',
    palette: ['#1F1F24', '#3D3D45', '#9E2A2B', '#E03638', '#540B0E'],
    tags: ['person', 'studio', 'coder', 'desk', 'audio', 'neon', 'dark'],
    peopleCount: 1,
    hasAnimals: false
  },
  believe: {
    id: 'believe',
    type: 'Textured document',
    title: 'BELIEVE YOU DESERVE IT AND THE UNIVERSE WILL SERVE IT.',
    date: 'Nov 17, 2026 at 07:40 PM',
    tldr: 'Bold white typography screenprinted over distressed crimson wall.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/believe.jpg',
    palette: ['#800E13', '#AD2831', '#D43841', '#E65C63', '#38040E'],
    tags: ['red', 'universe', 'believe', 'crimson', 'typography', 'wall'],
    peopleCount: 0,
    hasAnimals: false
  },
  redbull: {
    id: 'redbull',
    type: 'Clothing & sports',
    title: 'fall in love with the work.',
    date: 'Nov 17, 2026 at 07:15 PM',
    tldr: 'Red Bull racing driver in aerodynamic helmet and race suit.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/redbull.jpg',
    palette: ['#0A1128', '#1C2541', '#D62246', '#4B5876', '#E8E9EB'],
    tags: ['red bull', 'helmet', 'motorsport', 'racing', 'focus', 'work'],
    peopleCount: 1,
    hasAnimals: false
  },
  memo: {
    id: 'memo',
    type: 'Retro display',
    title: 'Memo — Trust your grind',
    date: 'Nov 17, 2026 at 06:50 PM',
    tldr: 'You struggle for 4 years. Then suddenly in 1 month you achieve more.',
    source: 'in.pinterest.com',
    heroImg: 'memories_exact/memo.jpg',
    palette: ['#1A365D', '#2B6CB0', '#4299E1', '#90CDF4', '#0D1B2A'],
    tags: ['memo', 'retro', 'blue', 'nokia', 'screen', 'trust your grind'],
    peopleCount: 0,
    hasAnimals: false
  }
};

/* State */
let activeCardId = 'lion';
let selectMode = false;
let selectedCards = new Set();
let currentTab = 'Everything';
let currentNav = 'home';
let searchQuery = '';

/* DOM References */
const inspectorPanel     = document.getElementById('inspectorPanel');
const inspectorCloseBtn  = document.getElementById('inspectorCloseBtn');
const inspectorHeroImg   = document.getElementById('inspectorHeroImg');
const inspectorTitle     = document.getElementById('inspectorTitle');
const inspectorDate      = document.getElementById('inspectorDate');
const inspectorTldr      = document.getElementById('inspectorTldr');
const inspectorSource    = document.getElementById('inspectorSource');
const inspectorPalette   = document.getElementById('inspectorPalette');
const inspectorTags      = document.getElementById('inspectorTags');
const inspectorNotes     = document.getElementById('inspectorNotes');

const searchInput        = document.getElementById('searchInput');
const searchClear        = document.getElementById('searchClear');
const selectBtn          = document.getElementById('selectBtn');
const selectBtnLabel     = document.getElementById('selectBtnLabel');
const noteModal          = document.getElementById('noteModal');
const toast              = document.getElementById('toast');

document.addEventListener('DOMContentLoaded', () => {
  setupCardClicks();
  setupControls();
  selectCard('lion');
});

/* ── Select Card & Update Inspector ── */
function selectCard(cardId) {
  const data = EXACT_CARDS_DATA[cardId];
  if (!data) return;

  activeCardId = cardId;

  // Outline active card
  document.querySelectorAll('.card-item').forEach(card => {
    card.classList.toggle('selected', card.dataset.id === cardId);
  });

  // Make sure inspector is visible
  inspectorPanel.classList.remove('hidden');

  // Populate Inspector
  inspectorHeroImg.src = data.heroImg;
  inspectorHeroImg.alt = data.title;
  inspectorTitle.textContent = data.title;
  inspectorDate.textContent = data.date;
  inspectorTldr.textContent = data.tldr;
  inspectorSource.textContent = data.source;

  // Swatches
  inspectorPalette.innerHTML = '';
  data.palette.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'swatch-box';
    sw.style.background = color;
    sw.title = color;
    inspectorPalette.appendChild(sw);
  });

  // Mind tags
  inspectorTags.innerHTML = '';
  data.tags.forEach(t => {
    const tag = document.createElement('span');
    tag.className = 'mind-tag';
    tag.textContent = t;
    inspectorTags.appendChild(tag);
  });
}

/* ── Setup Card Interactions ── */
function setupCardClicks() {
  document.querySelectorAll('.card-item').forEach(card => {
    const id = card.dataset.id;
    if (!id) return;

    card.addEventListener('click', () => {
      if (selectMode) {
        if (selectedCards.has(id)) selectedCards.delete(id);
        else selectedCards.add(id);
        card.classList.toggle('selected', selectedCards.has(id));
        selectBtnLabel.textContent = selectedCards.size > 0 ? `${selectedCards.size} Selected` : 'Done';
      } else {
        selectCard(id);
      }
    });

    // Heart favorite toggle
    const heart = card.querySelector('.card-badge-heart');
    if (heart) {
      heart.addEventListener('click', (e) => {
        e.stopPropagation();
        const liked = heart.classList.toggle('liked');
        heart.textContent = liked ? '♥' : '♡';
        showToast(liked ? 'Added to Liked' : 'Removed from Liked');
      });
    }

    // Trash button
    const trash = card.querySelector('.card-trash-btn');
    if (trash) {
      trash.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${card.dataset.title || 'this memory'}"?`)) {
          card.style.display = 'none';
          showToast('Memory deleted');
        }
      });
    }
  });

  // Note card opens modal
  const noteAddCard = document.getElementById('noteAddCard');
  if (noteAddCard) {
    noteAddCard.addEventListener('click', () => {
      noteModal.classList.add('open');
      document.getElementById('noteTitleInput').focus();
    });
  }
}

/* ── Controls, Tabs, Search ── */
function setupControls() {
  // Inspector Close
  inspectorCloseBtn.addEventListener('click', () => {
    inspectorPanel.classList.add('hidden');
  });

  // Search filter
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    searchClear.classList.toggle('visible', searchQuery.length > 0);
    filterCards();
  });

  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.remove('visible');
    filterCards();
    searchInput.focus();
  });

  // Segmented Tabs
  document.querySelectorAll('.segmented-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.segmented-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;
      filterCards();
    });
  });

  // Sidebar Nav
  document.querySelectorAll('.sidebar-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentNav = btn.dataset.nav;
      if (currentNav === 'liked') {
        showToast('Viewing Liked Memories');
      }
      filterCards();
    });
  });

  // Filter Chips
  document.querySelectorAll('.filter-chip').forEach(chip => {
    if (chip.id === 'colorFilterBtn') return;
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      filterCards();
    });
  });

  // Color Filter Dropdown
  const colorBtn = document.getElementById('colorFilterBtn');
  const colorMenu = document.getElementById('colorMenu');
  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    colorMenu.classList.toggle('open');
  });

  document.querySelectorAll('.color-item').forEach(item => {
    item.addEventListener('click', () => {
      const color = item.dataset.color;
      colorMenu.classList.remove('open');
      document.getElementById('colorFilterLabel').textContent = color ? item.textContent.trim() : 'Color';
      filterCards(color);
    });
  });

  document.addEventListener('click', () => {
    colorMenu.classList.remove('open');
    const addMenu = document.getElementById('addMenu');
    if (addMenu) addMenu.classList.remove('open');
  });

  // Add menu
  const addBtn = document.getElementById('addBtn');
  const addMenu = document.getElementById('addMenu');
  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addMenu.classList.toggle('open');
  });

  document.getElementById('menuNewNote').addEventListener('click', () => {
    addMenu.classList.remove('open');
    noteModal.classList.add('open');
  });

  document.getElementById('menuAddMedia').addEventListener('click', () => {
    addMenu.classList.remove('open');
    document.getElementById('fileInput').click();
  });

  // Select Mode
  selectBtn.addEventListener('click', () => {
    selectMode = !selectMode;
    selectBtn.classList.toggle('active', selectMode);
    if (!selectMode) {
      selectedCards.clear();
      selectBtnLabel.textContent = 'Select';
      document.querySelectorAll('.card-item').forEach(c => c.classList.remove('selected'));
      selectCard(activeCardId);
    } else {
      selectBtnLabel.textContent = 'Done';
    }
  });

  // Note Modal Save
  document.getElementById('btnCancelNote').addEventListener('click', () => {
    noteModal.classList.remove('open');
  });

  document.getElementById('btnSaveNote').addEventListener('click', () => {
    const title = document.getElementById('noteTitleInput').value.trim() || 'Untitled Note';
    noteModal.classList.remove('open');
    showToast(`Note saved: "${title}"`);
  });

  // Inspector Toolbar Buttons
  document.getElementById('toolFavBtn').addEventListener('click', () => {
    showToast('Saved to Favorites');
  });

  document.getElementById('toolDeleteBtn').addEventListener('click', () => {
    if (confirm(`Delete "${EXACT_CARDS_DATA[activeCardId]?.title || 'this item'}"?`)) {
      const cardEl = document.querySelector(`.card-item[data-id="${activeCardId}"]`);
      if (cardEl) cardEl.style.display = 'none';
      showToast('Memory deleted');
    }
  });

  document.getElementById('settingsBtn').addEventListener('click', () => {
    showToast('Settings opened');
  });
}

/* ── Live Filtering ── */
function filterCards(colorFilter = '') {
  const imagesOnly = document.getElementById('filterImages').classList.contains('active');
  const notesOnly  = document.getElementById('filterNotes').classList.contains('active');
  const likedOnly  = document.getElementById('filterLiked').classList.contains('active');

  let visibleCount = 0;

  document.querySelectorAll('.card-item').forEach(card => {
    const id = card.dataset.id;
    if (!id && card.id === 'noteAddCard') {
      card.style.display = (searchQuery || colorFilter || imagesOnly) ? 'none' : 'flex';
      return;
    }

    const data = EXACT_CARDS_DATA[id] || {};
    let show = true;

    if (searchQuery) {
      const hay = `${data.title || ''} ${(data.tags || []).join(' ')} ${data.tldr || ''}`.toLowerCase();
      if (!hay.includes(searchQuery)) show = false;
    }

    if (colorFilter && !data.tags?.includes(colorFilter)) show = false;

    if (likedOnly) {
      const heart = card.querySelector('.card-badge-heart');
      if (!heart || !heart.classList.contains('liked')) show = false;
    }

    if (notesOnly && data.type !== 'document' && card.id !== 'noteAddCard') show = false;

    card.style.display = show ? 'flex' : 'none';
    if (show) visibleCount++;
  });

  document.getElementById('subheadCount').textContent = `${visibleCount} memories`;
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => toast.classList.remove('visible'), 2200);
}
