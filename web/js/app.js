/**
 * Recall Web — Interactive Controller for Exact macOS Layout
 * Handles card selection, inspector updates, dynamic search,
 * color palette switching, note creation, and live entity filtering.
 */

'use strict';

const EXACT_CARDS_DATA = {};

/* State */
let activeCardId = null;
let selectMode = false;
let selectedCards = new Set();
let currentTab = 'Everything';
let currentNav = 'home';
let searchQuery = '';
let selectedColorFilter = null;
let deletedCardIdsSet = new Set(JSON.parse(localStorage.getItem('recall_deleted_ids') || '[]'));
const undoSnapshots = new Map();

/* DOM References */
const searchInput = document.getElementById('searchInput');
const searchClear = document.getElementById('searchClear');
const selectBtn = document.getElementById('selectBtn');
const selectBtnLabel = document.getElementById('selectBtnLabel');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const bulkDeleteLabel = document.getElementById('bulkDeleteLabel');
const noteModal = document.getElementById('noteModal');
const codeModal = document.getElementById('codeModal');
const toast = document.getElementById('toast');

/* ── Code Support Helpers ── */
function detectCodeLanguage(code, filename = '') {
  if (filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const map = {
      py: 'Python', js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript React', jsx: 'JavaScript React',
      rs: 'Rust', go: 'Go', cpp: 'C++', c: 'C', h: 'C/C++', hpp: 'C++', java: 'Java', kt: 'Kotlin',
      swift: 'Swift', rb: 'Ruby', php: 'PHP', sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
      yaml: 'YAML', yml: 'YAML', json: 'JSON', toml: 'TOML', css: 'CSS', scss: 'SCSS', html: 'HTML',
      md: 'Markdown', vue: 'Vue', svelte: 'Svelte', lua: 'Lua', r: 'R', zig: 'Zig'
    };
    if (map[ext]) return map[ext];
  }
  const clean = String(code || '').trim();
  if (/^\s*(import\s|from\s.*import|def\s|class\s|print\(|if __name__ ==)/m.test(clean)) return 'Python';
  if (/^\s*(const\s|let\s|var\s|function\s|import\s.*from|export\s|console\.log)/m.test(clean)) return 'JavaScript';
  if (/^\s*(fn\s|pub\s|use\s|struct\s|impl\s|let mut\s)/m.test(clean)) return 'Rust';
  if (/^\s*(package\s|func\s|import\s\()/m.test(clean)) return 'Go';
  if (/^\s*(#include\s|int main\(|std::)/m.test(clean)) return 'C++';
  if (/^\s*(SELECT\s|INSERT INTO\s|UPDATE\s.*SET|DELETE FROM\s|CREATE TABLE\s)/im.test(clean)) return 'SQL';
  if (/^\s*(<(!DOCTYPE|html|div|span|script|template))/im.test(clean)) return 'HTML';
  if (/^\s*(\{[\s\S]*\}|\[[\s\S]*\])$/.test(clean)) {
    try { JSON.parse(clean); return 'JSON'; } catch (e) {}
  }
  return 'Code';
}

function formatCodePreview(code, lang = 'javascript') {
  const safeLang = (lang || 'javascript').toLowerCase().replace(/[^a-z0-9]/g, '');
  const prismLang = safeLang === 'python' ? 'python'
    : (safeLang === 'typescript' || safeLang === 'ts' ? 'typescript'
    : (safeLang === 'rust' ? 'rust'
    : (safeLang === 'go' ? 'go'
    : (safeLang === 'html' ? 'markup'
    : (safeLang === 'css' ? 'css'
    : (safeLang === 'sql' ? 'sql'
    : (safeLang === 'json' ? 'json'
    : (safeLang === 'shell' || safeLang === 'bash' || safeLang === 'sh' ? 'bash'
    : (safeLang === 'c' || safeLang === 'cpp' ? 'cpp' : 'javascript')))))))));

  if (typeof Prism !== 'undefined' && Prism.languages && Prism.languages[prismLang]) {
    try {
      return Prism.highlight(code, Prism.languages[prismLang], prismLang);
    } catch (e) {}
  }

  // Built-in resilient fallback syntax highlighter
  return escapeHtml(code)
    .replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, '<span class="token comment">$1</span>')
    .replace(/(['"`])(?:(?=(\\?))\2.)*?\1/g, '<span class="token string">$&</span>')
    .replace(/\b(const|let|var|function|return|def|class|import|from|export|async|await|if|else|for|while|try|catch|fn|pub|struct|impl|type|interface|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\b/g, '<span class="token keyword">$1</span>')
    .replace(/\b(true|false|null|None|undefined|nil)\b/g, '<span class="token boolean">$1</span>')
    .replace(/\b\d+(\.\d+)?\b/g, '<span class="token number">$&</span>')
    .replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)(?=\()/g, '<span class="token function">$1</span>');
}

/* ── Code Snippet Modal & Creation Helpers ── */
function openCodeModal() {
  if (!codeModal) return;
  codeModal.classList.add('open');
  const titleInput = document.getElementById('codeTitleInput');
  const contentInput = document.getElementById('codeContentInput');
  const langSelect = document.getElementById('codeLangSelect');
  if (titleInput) titleInput.value = '';
  if (contentInput) contentInput.value = '';
  if (langSelect) langSelect.value = 'auto';
  setTimeout(() => { if (titleInput) titleInput.focus(); }, 50);
}

function closeCodeModal() {
  if (codeModal) codeModal.classList.remove('open');
}

function setupCodeModalHandlers() {
  const menuAddCode = document.getElementById('menuAddCode');
  if (menuAddCode) {
    menuAddCode.addEventListener('click', () => {
      const addMenu = document.getElementById('addMenu');
      if (addMenu) addMenu.classList.remove('open');
      openCodeModal();
    });
  }

  const btnCancelCode = document.getElementById('btnCancelCode');
  if (btnCancelCode) {
    btnCancelCode.addEventListener('click', closeCodeModal);
  }

  if (codeModal) {
    codeModal.addEventListener('click', (e) => {
      if (e.target === codeModal) closeCodeModal();
    });
  }

  const contentInput = document.getElementById('codeContentInput');
  if (contentInput) {
    contentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = contentInput.selectionStart;
        const end = contentInput.selectionEnd;
        contentInput.value = contentInput.value.substring(0, start) + '  ' + contentInput.value.substring(end);
        contentInput.selectionStart = contentInput.selectionEnd = start + 2;
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        saveCodeSnippetFromModal();
      }
    });
  }

  const btnSaveCode = document.getElementById('btnSaveCode');
  if (btnSaveCode) {
    btnSaveCode.addEventListener('click', saveCodeSnippetFromModal);
  }
}

async function saveCodeSnippetFromModal() {
  const titleInput = document.getElementById('codeTitleInput');
  const contentInput = document.getElementById('codeContentInput');
  const langSelect = document.getElementById('codeLangSelect');

  const rawCode = contentInput ? contentInput.value : '';
  if (!rawCode.trim()) {
    showToast('Please enter some code to save');
    return;
  }

  let title = (titleInput ? titleInput.value.trim() : '');
  const selectedLang = langSelect ? langSelect.value : 'auto';
  let lang = selectedLang;
  if (selectedLang === 'auto') {
    lang = detectCodeLanguage(rawCode, title);
  } else {
    lang = selectedLang.charAt(0).toUpperCase() + selectedLang.slice(1);
  }

  if (!title) {
    const extMap = { Python: 'py', JavaScript: 'js', TypeScript: 'ts', Rust: 'rs', Go: 'go', HTML: 'html', CSS: 'css', SQL: 'sql', Shell: 'sh', 'C++': 'cpp', C: 'c', Java: 'java', JSON: 'json', YAML: 'yml' };
    const ext = extMap[lang] || 'txt';
    title = `snippet.${ext}`;
  }

  closeCodeModal();
  await createAndSaveCode(title, rawCode, lang, title);
}

async function createAndSaveCode(title, code, lang, filename, repo = '', placeholder = null, customTags = null, customSource = '') {
  const id = 'code_' + Date.now();
  if (!placeholder) {
    placeholder = createSavingPlaceholder(id);
  } else {
    placeholder.dataset.id = id;
  }

  const cleanCode = String(code || '').trim();
  const detectedLang = lang || detectCodeLanguage(cleanCode, filename || title);
  const detectedFilename = filename || title || 'snippet';
  const lineCount = cleanCode ? cleanCode.split('\n').length : 1;
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = dateStr + ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const allTags = Array.from(new Set([
    'code',
    detectedLang.toLowerCase(),
    ...(customTags || []),
    ...(repo ? [repo.toLowerCase()] : [])
  ]));

  const newMem = {
    id,
    type: 'Code',
    contentType: 'Code',
    isCode: true,
    codeLanguage: detectedLang,
    codeFilename: detectedFilename,
    codeLines: lineCount,
    codeSnippet: cleanCode,
    codeText: cleanCode,
    codeRepo: repo || '',
    title: title || detectedFilename,
    body: cleanCode.slice(0, 500),
    tldr: `${detectedLang} snippet (${lineCount} lines)`,
    source: customSource || (repo ? `github.com/${repo}` : 'Code Snippet'),
    date: dateStr,
    dateDetail: timeStr,
    heroImg: '',
    palette: ['#18181C', '#27272A', '#3F3F46', '#71717A', '#A1A1AA'],
    tags: allTags,
    createdAt: Date.now(),
    isLiked: false,
    userId: window.firebaseSync && window.firebaseSync.currentUser ? window.firebaseSync.currentUser.uid : null
  };

  EXACT_CARDS_DATA[id] = newMem;
  await saveUserMemory(newMem);

  setTimeout(() => {
    morphPlaceholderToMemory(placeholder, newMem);
    showToast(`Code saved: "${detectedFilename}"`);
  }, 260);

  return newMem;
}

async function handleCodeFileUpload(file) {
  if (!file) return;
  const filename = file.name;
  showToast(`Reading code file "${filename}"…`);
  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    const lang = detectCodeLanguage(content, filename);
    await createAndSaveCode(filename, content, lang, filename, '', null, ['file_upload'], filename);
  };
  reader.readAsText(file);
}

document.addEventListener('DOMContentLoaded', async () => {
  // Apply persisted deletions immediately for smooth zero-flicker paint
  applyDeletedState();
  if (window.recallStorage) {
    try {
      deletedCardIdsSet = await window.recallStorage.getDeletedIds();
      applyDeletedState();
    } catch (e) { }
  }

  // Load persistent memories from IndexedDB
  await loadUserMemories();

  setupCardClicks();
  setupCodeModalHandlers();
  setupControls();
  setupKeyboardShortcuts();
  setupCopyPasteHandlers();
  reflowMasonry();

  // Run on-device color detection & MobileCLIP embeddings
  initCardColorsAndEmbeddings();

  // Pick first available card if present
  const allCards = Array.from(document.querySelectorAll('.card-item[data-id]'))
    .filter(c => !deletedCardIdsSet.has(c.dataset.id) && c.style.display !== 'none');
  if (allCards.length > 0) {
    selectCard(allCards[0].dataset.id);
  } else {
    activeCardId = null;
  }
  updateMemoryCount();

  if (window.location.hash === '#settings') {
    openSettingsModal();
  }
  window.addEventListener('hashchange', () => {
    if (window.location.hash === '#settings') openSettingsModal();
    else closeSettingsModal();
  });

  // Extension Inbox Sync (Pulls one-click saves from "Save to Recall" extension)
  initExtensionInboxSync();
});

/* ── Extension Inbox Sync Engine ── */
async function syncExtensionInbox() {
  if (localStorage.getItem('recall_user_cleared_all') === 'true') {
    return;
  }
  const currentUser = window.firebaseSync?.currentUser;
  if (!currentUser || !currentUser.uid) {
    return;
  }
  const currentUid = currentUser.uid;

  try {
    const res = await fetch(`/api/inbox?userId=${encodeURIComponent(currentUid)}`);
    if (!res.ok) return;
    const json = await res.json();
    const items = json.memories || [];
    if (!Array.isArray(items) || items.length === 0) return;

    const newlyImportedIds = [];
    for (const mem of items) {
      if (!mem || !mem.id) continue;

      // Ignore memories tagged with another user's ID
      if (mem.userId && mem.userId !== currentUid) continue;

      // Purge contaminated notes
      const t = (mem.title || '').toLowerCase();
      const b = (mem.body || '').toLowerCase();
      if (t.includes('abhinav dumb') || b.includes('abhinav dumb')) continue;

      // Skip if already in memory & grid or deleted
      if (EXACT_CARDS_DATA[mem.id] || (typeof deletedCardIdsSet !== 'undefined' && deletedCardIdsSet.has(mem.id))) {
        continue;
      }

      mem.userId = currentUid;
      newlyImportedIds.push(mem.id);
      EXACT_CARDS_DATA[mem.id] = mem;
      EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);

      if (mem.isNote || mem.type === 'note' || mem.type === 'Note') {
        renderNoteCardInGrid(mem);
      } else {
        renderCardInGrid(mem, true);
      }

      // Real-time Groq AI enrichment for imported memory (all types except products)
      const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
      const isProduct = Boolean(mem.isBuying || mem.price || mem.type === 'Product');
      if (groqKey && !isProduct) {
        enrichMemoryWithGroq(mem, groqKey).catch(() => {});
      }
    }

    // Acknowledge imported memories so backend inbox clears
    const allIds = items.map(m => m.id).filter(Boolean);
    if (allIds.length > 0) {
      fetch('/api/inbox/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: allIds, userId: currentUid })
      }).catch(() => {});
    }

    if (newlyImportedIds.length > 0) {
      // Clear active filter so imported item is immediately visible
      if (searchQuery) {
        searchQuery = '';
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.classList.remove('visible');
      }

      reflowMasonry();
      updateMemoryCount();
      const newest = items.find(m => m.id === newlyImportedIds[0]);
      if (newest && newest.id) {
        selectCard(newest.id);
      }
      showToast(`Saved from extension: "${newest?.title || 'New Memory'}"`);
    }
  } catch (e) {
    // Silent polling error (e.g. server restarting)
  }
}

function handleIncomingExtensionMemory(mem) {
  if (!mem || !mem.id) {
    if (mem) mem.id = 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    else return;
  }
  if (typeof deletedCardIdsSet !== 'undefined' && deletedCardIdsSet.has(mem.id)) return;
  if (EXACT_CARDS_DATA[mem.id] || document.querySelector(`.card-item[data-id="${mem.id}"]`)) {
    return;
  }

  if (mem.heroImg) {
    mem.heroImg = upgradeImageUrlToMaxRes(mem.heroImg);
  }
  if (mem.imageUrl) {
    mem.imageUrl = upgradeImageUrlToMaxRes(mem.imageUrl);
  } else if (mem.heroImg) {
    mem.imageUrl = mem.heroImg;
  }
  if (!mem.url && mem.source) {
    mem.url = mem.source;
  }

  // Clear any active search filter so new card is immediately visible
  if (searchQuery) {
    searchQuery = '';
    const searchInput = document.getElementById('searchInput');
    const searchClear = document.getElementById('searchClear');
    if (searchInput) searchInput.value = '';
    if (searchClear) searchClear.classList.remove('visible');
  }

  // Initial save and instant render (no blocking)
  EXACT_CARDS_DATA[mem.id] = mem;
  saveUserMemory(mem);

  if (mem.isNote || mem.type === 'note' || mem.type === 'Note') {
    renderNoteCardInGrid(mem);
  } else {
    renderCardInGrid(mem, true);
  }

  reflowMasonry();
  updateMemoryCount();
  selectCard(mem.id);
  showToast(`Saved to Recall: "${mem.title || 'New Memory'}"`);

  // Asynchronous Groq AI enrichment across memory types (Notes, Quotes, Articles, Videos, Images - NOT products)
  const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
  const isProduct = Boolean(mem.isBuying || mem.price || mem.type === 'Product');
  if (groqKey && !isProduct) {
    enrichMemoryWithGroq(mem, groqKey).catch(() => {});
  }
}

// Global Extension Message Listeners
window.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'RECALL_SAVE_MEMORY' || event.data.action === 'recall_save_memory') && event.data.memory) {
    handleIncomingExtensionMemory(event.data.memory);
  }
});

document.addEventListener('recall-import-memory', (event) => {
  if (event.detail) {
    handleIncomingExtensionMemory(event.detail);
  }
});

function cleanContaminatedMemories() {
  const currentUid = (window.firebaseSync && window.firebaseSync.currentUser) ? window.firebaseSync.currentUser.uid : localStorage.getItem('recall_current_user_uid');
  let removedCount = 0;
  for (const id in EXACT_CARDS_DATA) {
    const mem = EXACT_CARDS_DATA[id];
    if (!mem) continue;
    const title = (mem.title || '').toLowerCase();
    const body = (mem.body || '').toLowerCase();
    const quote = (mem.quote || '').toLowerCase();
    const isContaminated = title.includes('abhinav dumb') || body.includes('abhinav dumb') || quote.includes('abhinav dumb');
    const isForeign = Boolean(mem.userId && currentUid && mem.userId !== currentUid);

    if (isContaminated || isForeign) {
      delete EXACT_CARDS_DATA[id];
      const card = document.querySelector(`.card-item[data-id="${id}"]`);
      if (card) card.remove();
      if (window.recallStorage) window.recallStorage.deleteMemory(id).catch(() => {});
      if (window.firebaseSync && window.firebaseSync.currentUser) {
        window.firebaseSync.deleteMemoryFromFirestore(id).catch(() => {});
      }
      removedCount++;
    }
  }
  if (removedCount > 0) {
    if (typeof reflowMasonry === 'function') reflowMasonry();
    if (typeof updateMemoryCount === 'function') updateMemoryCount();
  }
}
window.cleanContaminatedMemories = cleanContaminatedMemories;

function initExtensionInboxSync() {
  cleanContaminatedMemories();
  syncExtensionInbox();
  window.addEventListener('focus', () => {
    cleanContaminatedMemories();
    syncExtensionInbox();
  });
  setInterval(() => {
    cleanContaminatedMemories();
    syncExtensionInbox();
  }, 30000);
}

/* ── Real On-Device Color Detection & MobileCLIP Embeddings ── */
async function initCardColorsAndEmbeddings() {
  const cards = Array.from(document.querySelectorAll('.card-item[data-id]'));
  for (const card of cards) {
    const id = card.dataset.id;
    const data = EXACT_CARDS_DATA[id];
    if (!data) continue;

    const img = card.querySelector('img');
    if (img && (!img.complete || img.naturalWidth === 0)) {
      await new Promise(r => { img.onload = r; img.onerror = r; });
    }

    // 1. Color extraction via 14x14 HSB grid (matching macOS ContentExtractor.swift)
    if (img && img.naturalWidth > 0 && typeof extractDominantColorWords === 'function') {
      try {
        const domColors = extractDominantColorWords(img);
        if (domColors && domColors.length > 0) {
          data.dominantColors = domColors;
          data.paletteTones = domColors;
          domColors.forEach(c => {
            if (!data.tags.includes(c)) data.tags.push(c);
          });
        }
      } catch (e) { }
    }

    // 2. MobileCLIP 512-dim visual embedding (100% On-Device WebGPU / WASM)
    if (window.mobileClip) {
      try {
        if (img && img.naturalWidth > 0) {
          data.visualEmbedding = window.mobileClip.imageEmbedding(img);
        } else {
          data.visualEmbedding = window.mobileClip.textEmbedding(`${data.title} ${data.ocrText || ''} ${data.tldr || ''}`);
        }

        // Search text embedding
        data.embedding = window.searchEngine.generateEmbedding(`${data.title} ${data.ocrText || ''} ${data.tags.join(' ')}`);

        // MobileCLIP zero-shot category prediction
        if (data.visualEmbedding) {
          const predicted = window.mobileClip.predictTags(data.visualEmbedding, 0.15);
          for (const pred of predicted) {
            if (!data.tags.includes(pred.tag)) data.tags.push(pred.tag);
            if (pred.tag === 'book') data.isBook = true;
            if (pred.tag === 'animal') data.hasAnimals = true;
            if (pred.tag === 'quote') data.isQuote = true;
          }
        }
      } catch (e) { }
    }
  }

  // Reflow masonry once natural heights are verified
  reflowMasonry();
}

/* ── Hide Persisted Deleted Cards on Load ── */
function applyDeletedState() {
  deletedCardIdsSet.forEach(id => {
    const el = document.querySelector(`.card-item[data-id="${id}"]`);
    if (el) el.style.display = 'none';
  });
}

/* ── Update Memory Count in Subheader ── */
function updateMemoryCount() {
  const countEl = document.getElementById('subheadCount');
  if (countEl) {
    const total = (typeof currentFilteredIds !== 'undefined' && currentFilteredIds.length > 0)
      ? currentFilteredIds.length
      : Array.from(document.querySelectorAll('.card-item[data-id]')).filter(c => c.style.display !== 'none' && !deletedCardIdsSet.has(c.dataset.id)).length;
    countEl.textContent = `${total} memories`;
  }
}

/* ── Central Delete Memory Function (IndexedDB Persistent Storage) ── */
function deleteMemory(cardIdOrIds, withUndo = true) {
  const ids = (Array.isArray(cardIdOrIds) ? cardIdOrIds : [cardIdOrIds]).filter(Boolean);
  if (ids.length === 0) return;

  // Snapshot before deletion for reliable Undo
  ids.forEach(id => {
    if (EXACT_CARDS_DATA[id]) {
      undoSnapshots.set(id, Object.assign({}, EXACT_CARDS_DATA[id]));
    }
  });

  // Animate and mark as deleted
  ids.forEach(id => {
    deletedCardIdsSet.add(id);
    delete EXACT_CARDS_DATA[id];
    if (window.recallStorage) {
      window.recallStorage.deleteMemory(id);
    }
    if (window.firebaseSync && window.firebaseSync.currentUser) {
      window.firebaseSync.deleteMemoryFromFirestore(id);
    }
    const cardEl = document.querySelector(`.card-item[data-id="${CSS.escape(String(id))}"]`);
    if (cardEl) {
      cardEl.classList.add('deleting');
      setTimeout(() => {
        cardEl.remove();
        reflowMasonry();
        updateMemoryCount();
      }, 200);
    }
  });

  // Persist to localStorage for synchronous first-paint sync
  localStorage.setItem('recall_deleted_ids', JSON.stringify([...deletedCardIdsSet]));

  // Remove from select set if needed
  ids.forEach(id => selectedCards.delete(id));
  if (selectMode) {
    if (selectedCards.size > 0) {
      selectBtnLabel.textContent = `${selectedCards.size} Selected`;
      if (bulkDeleteBtn) {
        bulkDeleteBtn.style.display = 'inline-flex';
        bulkDeleteLabel.textContent = `Delete (${selectedCards.size})`;
      }
    } else {
      selectBtnLabel.textContent = 'Done';
      if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
    }
  }

  // If deleted item was the active one in the inspector, select next available
  if (ids.includes(activeCardId)) {
    const remaining = Array.from(document.querySelectorAll('.card-item[data-id]'))
      .filter(c => !deletedCardIdsSet.has(c.dataset.id) && !ids.includes(c.dataset.id));
    if (remaining.length > 0) {
      selectCard(remaining[0].dataset.id);
    } else {
      activeCardId = null;
    }
  }

  // Update memory list and count
  currentFilteredIds = currentFilteredIds.filter(cid => !ids.includes(cid));
  renderedCount = Math.min(renderedCount, currentFilteredIds.length);
  setTimeout(updateMemoryCount, 210);

  // Toast with interactive Undo
  const msg = ids.length > 1 ? `${ids.length} memories deleted` : 'Memory deleted';
  if (withUndo) {
    showToast(msg, async () => {
      // Restore deleted memories
      for (const id of ids) {
        deletedCardIdsSet.delete(id);
        const snapshot = undoSnapshots.get(id);
        if (snapshot && window.recallStorage) {
          await window.recallStorage.restoreMemory(id, snapshot);
          EXACT_CARDS_DATA[id] = snapshot;
        } else if (window.recallStorage) {
          await window.recallStorage.removeDeletedId(id);
        }
        if (window.firebaseSync && window.firebaseSync.currentUser) {
          window.firebaseSync.restoreMemoryInFirestore(id, snapshot);
        }
        if (snapshot) {
          if (!currentFilteredIds.includes(snapshot.id)) {
            currentFilteredIds.unshift(snapshot.id);
            renderedCount++;
          }
          if (snapshot.isNote || snapshot.type === 'Note' || snapshot.type === 'note') {
            renderNoteCardInGrid(snapshot);
          } else {
            renderCardInGrid(snapshot, true);
          }
          updateMemoryCount();
        }
      }
      localStorage.setItem('recall_deleted_ids', JSON.stringify([...deletedCardIdsSet]));
      reflowMasonry();
      updateMemoryCount();
      if (ids.length > 0) selectCard(ids[0]);
      showToast('Restored');
    });
  } else {
    showToast(msg);
  }
}

/* ── Delete Confirmation Warning Modal (Image 2 Parity) ── */
let pendingDeleteId = null;

function promptDeleteMemory(idOrIds) {
  if (!idOrIds) return;
  const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
  if (ids.length === 0) return;

  const settings = getRecallSettings();
  if (settings && settings.confirmDelete === false) {
    deleteMemory(idOrIds);
    return;
  }

  pendingDeleteId = idOrIds;

  const firstId = ids[0];
  const data = EXACT_CARDS_DATA[firstId] || {};
  const deleteModal = document.getElementById('deleteModal');
  const thumbEl = document.getElementById('deleteModalThumb');
  const noteThumbEl = document.getElementById('deleteModalNoteThumb');
  const noteTitleEl = document.getElementById('deleteModalNoteTitle');
  const subEl = document.getElementById('deleteModalSub');
  const titleEl = document.querySelector('.delete-modal-title');

  if (!deleteModal) {
    deleteMemory(idOrIds);
    return;
  }

  const hasImg = Boolean(data.heroImg && (data.heroImg.startsWith('http') || data.heroImg.startsWith('data:')));
  if (hasImg) {
    thumbEl.style.display = 'block';
    thumbEl.src = data.heroImg;
    noteThumbEl.style.display = 'none';
  } else {
    thumbEl.style.display = 'none';
    noteThumbEl.style.display = 'flex';
    const displayNoteTitle = (data.title && data.title !== 'Untitled Note')
      ? data.title
      : (data.quote || (data.body ? data.body.slice(0, 45) : 'Note'));
    noteTitleEl.textContent = displayNoteTitle;
  }

  if (titleEl) {
    titleEl.textContent = ids.length > 1 ? `Remove ${ids.length} memories?` : 'Remove this memory?';
  }
  subEl.textContent = ids.length > 1
    ? `${ids.length} selected items will be moved to Trash`
    : (data.body && data.body !== data.title ? data.body.slice(0, 90) : (data.tldr || data.title || 'Selected Memory'));
  deleteModal.classList.add('open');
}

function closeDeleteModal() {
  const deleteModal = document.getElementById('deleteModal');
  if (deleteModal) {
    deleteModal.classList.remove('open');
  }
  pendingDeleteId = null;
  const titleEl = document.querySelector('.delete-modal-title');
  if (titleEl) titleEl.textContent = 'Remove this memory?';
}

/* ── Source Link & Domain Helpers ── */
function openExternalSource(src) {
  if (!src) return;
  let target = String(src).trim();
  if (target.startsWith('data:') || target.startsWith('blob:') || target === 'Local Note' || target === 'Clipboard' || target === 'Saved') return;
  if (!/^https?:\/\//i.test(target)) {
    target = 'https://' + target;
  }
  try {
    window.open(target, '_blank', 'noopener,noreferrer');
  } catch (e) {
    console.error('Failed to open source URL:', e);
  }
}

function getDisplaySource(sourceUrl) {
  if (!sourceUrl) return 'Web';
  try {
    let clean = String(sourceUrl).trim();
    if (!/^https?:\/\//i.test(clean) && clean.includes('.')) {
      clean = 'https://' + clean;
    }
    if (/^https?:\/\//i.test(clean)) {
      const hostname = new URL(clean).hostname;
      return hostname.replace(/^www\./, '');
    }
    return clean.replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0] || 'Web';
  } catch (e) {
    return String(sourceUrl).replace(/^https?:\/\//i, '').replace(/^www\./, '').split('/')[0] || 'Web';
  }
}

/* ── Select Card (Updates activeCardId and highlights card) ── */
function selectCard(cardId) {
  const data = EXACT_CARDS_DATA[cardId];
  if (!data) return;

  activeCardId = cardId;

  // Outline active card
  document.querySelectorAll('.card-item').forEach(card => {
    card.classList.toggle('selected', card.dataset.id === cardId);
  });
}

/* ══════════════════════════════════════════════════════
   MEMORY DETAIL MODAL & READING MODE (Matching Image 3)
══════════════════════════════════════════════════════ */
let currentDetailMemId = null;
let readerTheme = 'light';
let readerFont = 'serif';
let readerFontSize = 18.5;

function openMemoryDetailModal(memId) {
  const mem = EXACT_CARDS_DATA[memId];
  if (!mem) return;
  currentDetailMemId = memId;

  const modal = document.getElementById('memoryDetailModal');
  if (!modal) return;

  const isDocument = Boolean(mem.isDocument || mem.type === 'Document' || mem.isPDF || mem.isSpreadsheet || mem.isResearchPaper || mem.pdfUrl || (mem.tags && (mem.tags.includes('document') || mem.tags.includes('paper') || mem.tags.includes('spreadsheet'))));
  const isAudio = Boolean(!isDocument && (mem.isAudio || mem.type === 'Audio' || mem.type === 'audio' || mem.audioUrl || mem.audioEmbedUrl || (mem.tags && (mem.tags.includes('audio') || mem.tags.includes('music') || mem.tags.includes('spotify')))));
  const isVideo = Boolean(!isDocument && !isAudio && (mem.isVideo || mem.type === 'Video' || mem.type === 'video' || (mem.tags && mem.tags.includes('video'))));
  const isSocial = Boolean(!isDocument && !isAudio && !isVideo && (mem.isSocial || mem.socialPlatform || mem.type === 'social' || (mem.tags && mem.tags.includes('social'))));
  const isCode = Boolean(!isDocument && !isAudio && !isVideo && !isSocial && (mem.isCode || mem.type === 'Code' || mem.codeSnippet || (mem.tags && mem.tags.includes('code'))));
  const isQuote = Boolean(!isDocument && !isAudio && !isVideo && !isSocial && !isCode && (mem.isQuote || mem.type === 'Quote' || mem.type === 'quote'));
  const isNote = Boolean(!isDocument && !isAudio && !isVideo && !isSocial && !isCode && !isQuote && (mem.isNote || mem.type === 'Note' || mem.type === 'note'));
  const isArticle = Boolean(!isDocument && !isAudio && !isVideo && !isSocial && !isCode && !isQuote && !isNote && (mem.type === 'Article' || mem.type === 'article' || mem.isArticle || (mem.tags && mem.tags.includes('article'))));

  // Hide all left preview containers
  const docPreview = document.getElementById('modalDocPreview');
  const articlePreview = document.getElementById('modalArticlePreview');
  const quotePreview = document.getElementById('modalQuotePreview');
  const imagePreview = document.getElementById('modalImagePreview');
  const notePreview = document.getElementById('modalNotePreview');
  const videoPreview = document.getElementById('modalVideoPreview');
  const audioPreview = document.getElementById('modalAudioPreview');
  const socialPreview = document.getElementById('modalSocialPreview');
  const codePreview = document.getElementById('modalCodePreview');

  if (docPreview) docPreview.style.display = 'none';
  if (articlePreview) articlePreview.style.display = 'none';
  if (quotePreview) quotePreview.style.display = 'none';
  if (imagePreview) imagePreview.style.display = 'none';
  if (notePreview) notePreview.style.display = 'none';
  if (videoPreview) videoPreview.style.display = 'none';
  if (audioPreview) audioPreview.style.display = 'none';
  if (socialPreview) socialPreview.style.display = 'none';
  if (codePreview) codePreview.style.display = 'none';

  if (isDocument) {
    if (docPreview) docPreview.style.display = 'flex';
    const pdfWrap = document.getElementById('modalPdfViewerWrap');
    const sheetWrap = document.getElementById('modalSpreadsheetWrap');
    const pdfIframe = document.getElementById('modalPdfIframe');
    const docPill = document.getElementById('modalDocPill');
    const docMetaInfo = document.getElementById('modalDocMetaInfo');
    const downloadBtn = document.getElementById('modalDocDownloadBtn');

    if (mem.isSpreadsheet || mem.tableData) {
      if (pdfWrap) pdfWrap.style.display = 'none';
      if (sheetWrap) sheetWrap.style.display = 'flex';
      const sheetPill = document.getElementById('modalSheetPill');
      const sheetMeta = document.getElementById('modalSheetMetaInfo');
      const tableEl = document.getElementById('modalSpreadsheetTable');
      const searchInput = document.getElementById('modalSheetSearchInput');

      if (sheetPill) sheetPill.textContent = (mem.docType || 'EXCEL').toUpperCase();
      const rows = mem.tableData || [];
      const rowCount = rows.length > 0 ? rows.length - 1 : 0;
      const colCount = rows.length > 0 ? (rows[0] ? rows[0].length : 0) : 0;
      if (sheetMeta) sheetMeta.textContent = `${rowCount} rows • ${colCount} columns`;

      renderSpreadsheetTable(tableEl, rows);
      if (searchInput) {
        searchInput.value = '';
        searchInput.oninput = () => {
          const q = searchInput.value.toLowerCase();
          filterSpreadsheetTable(tableEl, q);
        };
      }
    } else {
      if (sheetWrap) sheetWrap.style.display = 'none';
      if (pdfWrap) pdfWrap.style.display = 'flex';
      const isArxiv = Boolean(mem.arxivId || mem.isResearchPaper);
      if (docPill) {
        docPill.textContent = isArxiv ? 'ARXIV PAPER' : 'PDF DOCUMENT';
      }
      if (docMetaInfo) {
        docMetaInfo.textContent = mem.pageCount ? `${mem.pageCount} pages` : (mem.fileSize || 'PDF Reader');
      }
      const targetPdfUrl = mem.pdfUrl || mem.docUrl || mem.fileUrl || mem.url || mem.source;
      if (pdfIframe) {
        pdfIframe.src = targetPdfUrl || '';
      }
      if (downloadBtn) {
        downloadBtn.href = targetPdfUrl || '#';
        downloadBtn.textContent = isArxiv ? 'Open / Download PDF' : 'Download Document';
      }
    }
  } else if (isAudio) {
    if (audioPreview) audioPreview.style.display = 'flex';
    const embedWrap = document.getElementById('modalAudioEmbedWrap');
    const directWrap = document.getElementById('modalAudioDirectWrap');
    const iframe = document.getElementById('modalAudioIframe');
    const durEl = document.getElementById('modalAudioDuration');
    const transcriptEl = document.getElementById('modalAudioTranscript');
    const playBtn = document.getElementById('modalAudioPlayBtn');
    const waveformEl = document.getElementById('modalAudioWaveform');
    const badgeLabel = document.getElementById('modalAudioBadgeLabel');
    const badgePill = document.getElementById('modalAudioBadgePill');

    const isSpotify = mem.audioProvider === 'spotify' || (mem.audioPlatform && mem.audioPlatform.toLowerCase() === 'spotify') || (mem.source && mem.source.includes('spotify.com'));
    const isSoundCloud = mem.audioProvider === 'soundcloud' || (mem.source && mem.source.includes('soundcloud.com'));
    const isApple = mem.audioProvider === 'applemusic' || mem.audioProvider === 'applepodcasts' || (mem.source && mem.source.includes('apple.com'));

    if (badgeLabel) {
      badgeLabel.textContent = isSpotify ? 'SPOTIFY' : (isSoundCloud ? 'SOUNDCLOUD' : (isApple ? 'APPLE MUSIC' : 'AUDIO'));
    }
    if (badgePill) {
      badgePill.className = 'audio-badge-pill ' + (isSpotify ? 'spotify' : (isSoundCloud ? 'soundcloud' : ''));
    }

    if (mem.audioEmbedUrl) {
      if (embedWrap) embedWrap.style.display = 'block';
      if (directWrap) directWrap.style.display = 'none';
      if (iframe) {
        iframe.src = mem.audioEmbedUrl;
        iframe.style.height = isSpotify ? (mem.audioType === 'track' ? '152px' : '352px') : (isSoundCloud ? '166px' : '175px');
      }
    } else {
      if (embedWrap) embedWrap.style.display = 'none';
      if (directWrap) directWrap.style.display = 'block';
      if (iframe) iframe.src = '';

      if (durEl) durEl.textContent = formatAudioDuration(mem.duration || 0);
      if (transcriptEl) transcriptEl.textContent = mem.artist || mem.author || mem.body || mem.title || 'Audio Track';

      if (waveformEl) {
        let wHtml = '';
        const wHeights = [30, 50, 75, 90, 60, 45, 80, 100, 70, 55, 85, 95, 65, 45, 80, 90, 60, 40, 75, 95, 85, 60, 50, 70, 55, 40, 30, 20];
        for (let i = 0; i < wHeights.length; i++) {
          wHtml += `<span class="audio-waveform-bar" style="height:${wHeights[i]}%; flex:1;"></span>`;
        }
        waveformEl.innerHTML = wHtml;
      }

      if (playBtn) {
        setAudioBtnPlaying(playBtn, false);
        playBtn.onclick = (e) => {
          e.stopPropagation();
          toggleAudioPlayback(playBtn, mem.audioFileUrl || mem.audioUrl, null);
        };
      }
    }
  } else if (isVideo) {
    if (videoPreview) videoPreview.style.display = 'flex';
    const iframe = document.getElementById('modalVideoIframe');
    const player = document.getElementById('modalVideoPlayer');
    const watchBtn = document.getElementById('modalWatchOriginalBtn');

    if (mem.videoEmbedUrl || mem.videoId) {
      const embedUrl = mem.videoEmbedUrl || `https://www.youtube-nocookie.com/embed/${mem.videoId}?autoplay=1`;
      if (iframe) {
        iframe.style.display = 'block';
        iframe.src = embedUrl;
      }
      if (player) {
        player.style.display = 'none';
        player.src = '';
      }
    } else if (mem.videoFileUrl || (mem.source && mem.source.match(/\.(mp4|webm|mov|mkv)/i))) {
      if (iframe) {
        iframe.style.display = 'none';
        iframe.src = '';
      }
      if (player) {
        player.style.display = 'block';
        player.src = mem.videoFileUrl || mem.source;
        player.play().catch(() => { });
      }
    }

    const channelName = mem.author || mem.channel || getDisplaySource(mem.source) || 'YouTube';
    const chanEl = document.getElementById('modalVideoChannel');
    if (chanEl) chanEl.textContent = channelName;
    const titleEl = document.getElementById('modalVideoTitle');
    if (titleEl) titleEl.textContent = mem.title;
    const descEl = document.getElementById('modalVideoDesc');
    if (descEl) descEl.textContent = mem.tldr || mem.subtitle || mem.body || '';
    if (watchBtn) watchBtn.href = mem.source || '#';
  } else if (isSocial) {
    if (socialPreview) socialPreview.style.display = 'flex';
    const avatarImg = document.getElementById('modalSocialAvatar');
    const avatarFallback = document.getElementById('modalSocialAvatarFallback');
    const nameEl = document.getElementById('modalSocialName');
    const verifiedEl = document.getElementById('modalSocialVerified');
    const handleEl = document.getElementById('modalSocialHandle');
    const platformBadge = document.getElementById('modalSocialPlatformBadge');
    const badgeText = document.getElementById('modalSocialBadgeText');
    const bodyEl = document.getElementById('modalSocialBody');
    const mediaWrap = document.getElementById('modalSocialMedia');
    const mediaImg = document.getElementById('modalSocialMediaImg');
    const likesEl = document.getElementById('modalSocialLikes');
    const repostsEl = document.getElementById('modalSocialReposts');
    const repliesEl = document.getElementById('modalSocialReplies');
    const extLink = document.getElementById('modalSocialExternalLink');
    const extLabel = document.getElementById('modalSocialExternalLabel');

    const platform = (mem.socialPlatform || 'x').toLowerCase();
    const platformBadgeClass = ['x', 'reddit', 'linkedin', 'threads', 'bluesky', 'instagram'].includes(platform) ? platform : 'x';
    const platformLabel = mem.socialPlatformLabel || (platform === 'x' ? '𝕏 Post' : platform.toUpperCase());
    const authorName = mem.socialAuthorName || mem.author || 'Social User';
    const handle = mem.socialHandle || (authorName.startsWith('@') || authorName.startsWith('r/') ? authorName : `@${authorName}`);
    const avatar = mem.socialAvatar || '';
    const initial = (authorName.replace(/^[@r/]+/, '')[0] || 'S').toUpperCase();
    const bodyText = mem.socialText || mem.body || mem.title || '';
    const hasMedia = Boolean(mem.heroImg || mem.socialMediaUrl);
    const mediaUrl = mem.heroImg || mem.socialMediaUrl || '';
    const likes = mem.socialLikes || mem.likes || 0;
    const reposts = mem.socialReposts || mem.retweets || 0;
    const replies = mem.socialReplies || mem.replies || 0;

    if (nameEl) nameEl.textContent = authorName;
    if (handleEl) handleEl.textContent = handle;
    if (verifiedEl) verifiedEl.style.display = mem.socialVerified ? 'inline-block' : 'none';

    if (avatarImg && avatarFallback) {
      if (avatar) {
        avatarImg.src = avatar;
        avatarImg.style.display = 'block';
        avatarFallback.style.display = 'none';
        avatarImg.onerror = () => {
          avatarImg.style.display = 'none';
          avatarFallback.style.display = 'flex';
          avatarFallback.textContent = initial;
        };
      } else {
        avatarImg.style.display = 'none';
        avatarFallback.style.display = 'flex';
        avatarFallback.textContent = initial;
      }
    }

    if (platformBadge) platformBadge.className = `modal-social-platform-badge social-badge-pill ${platformBadgeClass}`;
    if (badgeText) badgeText.textContent = platformLabel;
    if (bodyEl) bodyEl.innerHTML = formatSocialText(bodyText);

    const socialIframe = document.getElementById('modalSocialIframe');
    if (mediaWrap) {
      if (platform === 'instagram' && (mem.socialEmbedUrl || mem.embedUrl)) {
        mediaWrap.style.display = 'block';
        if (mediaImg) mediaImg.style.display = 'none';
        if (socialIframe) {
          socialIframe.style.display = 'block';
          socialIframe.src = mem.socialEmbedUrl || mem.embedUrl;
        }
      } else if (hasMedia) {
        mediaWrap.style.display = 'block';
        if (socialIframe) {
          socialIframe.style.display = 'none';
          socialIframe.src = '';
        }
        if (mediaImg) {
          mediaImg.style.display = 'block';
          mediaImg.src = mediaUrl;
        }
      } else {
        mediaWrap.style.display = 'none';
        if (socialIframe) {
          socialIframe.style.display = 'none';
          socialIframe.src = '';
        }
      }
    }

    if (likesEl) likesEl.textContent = likes >= 1000 ? (likes / 1000).toFixed(1) + 'k' : likes;
    if (repostsEl) repostsEl.textContent = reposts >= 1000 ? (reposts / 1000).toFixed(1) + 'k' : reposts;
    if (repliesEl) repliesEl.textContent = replies >= 1000 ? (replies / 1000).toFixed(1) + 'k' : replies;

    if (extLink) {
      extLink.href = mem.source && !mem.source.startsWith('data:') ? mem.source : (mem.url || '#');
    }
    if (extLabel) {
      extLabel.textContent = `Open on ${platformLabel.replace(' Post', '')}`;
    }
  } else if (isCode) {
    if (codePreview) codePreview.style.display = 'flex';
    const filenameEl = document.getElementById('modalCodeFilename');
    const langEl = document.getElementById('modalCodeLang');
    const metaEl = document.getElementById('modalCodeMeta');
    const gutterEl = document.getElementById('modalCodeGutter');
    const contentEl = document.getElementById('modalCodeContent');
    const copyBtn = document.getElementById('modalCodeCopyBtn');
    const copyLabel = document.getElementById('modalCodeCopyLabel');
    const downloadBtn = document.getElementById('modalCodeDownloadBtn');

    const codeText = mem.codeSnippet || mem.codeText || mem.body || '';
    const lang = mem.codeLanguage || detectCodeLanguage(codeText, mem.codeFilename || mem.title);
    const filename = mem.codeFilename || mem.title || 'snippet.txt';
    const lines = codeText ? codeText.split('\n') : [''];
    const lineCount = lines.length;

    if (filenameEl) filenameEl.textContent = filename;
    if (langEl) {
      langEl.textContent = lang.toUpperCase();
      langEl.className = `code-lang-pill lang-${lang.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    }
    if (metaEl) {
      metaEl.textContent = `${lineCount} ${lineCount === 1 ? 'line' : 'lines'} • ${codeText.length} chars`;
    }

    if (gutterEl) {
      let gutterHtml = '';
      for (let i = 1; i <= lineCount; i++) {
        gutterHtml += `<span>${i}</span>`;
      }
      gutterEl.innerHTML = gutterHtml;
    }

    if (contentEl) {
      contentEl.innerHTML = formatCodePreview(codeText, lang);
    }

    if (copyBtn) {
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(codeText).then(() => {
          if (copyLabel) copyLabel.textContent = 'Copied!';
          showToast('Code copied to clipboard');
          setTimeout(() => {
            if (copyLabel) copyLabel.textContent = 'Copy Code';
          }, 1600);
        });
      };
    }

    if (downloadBtn) {
      const blob = new Blob([codeText], { type: 'text/plain;charset=utf-8' });
      downloadBtn.href = URL.createObjectURL(blob);
      downloadBtn.download = filename;
    }
  } else if (isArticle) {
    articlePreview.style.display = 'flex';
    const heroEl = document.getElementById('modalHeroImg');
    if (mem.heroImg) {
      heroEl.style.display = 'block';
      heroEl.src = mem.heroImg;
    } else {
      heroEl.style.display = 'none';
    }
    const displayDomain = mem.publication || mem.publisher || mem.displaySource || getDisplaySource(mem.source) || 'The New York Times';
    document.getElementById('modalMasthead').textContent = displayDomain;
    document.getElementById('modalArticleTitle').textContent = mem.title;
    document.getElementById('modalArticleSubtitle').textContent = mem.subtitle || mem.tldr || '';

    const origLink = document.getElementById('modalLinkOriginal');
    origLink.href = mem.source && !mem.source.startsWith('data:') ? mem.source : '#';

    // Reading mode button
    const readingBtn = document.getElementById('modalReadingModeBtn');
    readingBtn.onclick = () => {
      openArticleReader(memId);
    };
  } else if (isQuote) {
    quotePreview.style.display = 'flex';
    document.getElementById('modalQuoteBody').textContent = mem.quote || mem.title || mem.body || '';
    const qCaption = (mem.attribution || (mem.source !== 'Quote' && mem.source !== 'Local' ? mem.source : '')).trim();
    const captionEl = document.getElementById('modalQuoteCaption');
    if (qCaption) {
      captionEl.style.display = 'block';
      captionEl.textContent = qCaption;
    } else {
      captionEl.style.display = 'none';
    }
  } else if (isNote) {
    notePreview.style.display = 'flex';
    document.getElementById('modalNoteTitle').textContent = mem.title;
    document.getElementById('modalNoteBody').textContent = mem.body || mem.tldr || '';
  } else {
    // Standard visual / product / web image
    imagePreview.style.display = 'flex';
    const fullImg = document.getElementById('modalFullImage');
    if (mem.heroImg) {
      fullImg.style.display = 'block';
      fullImg.src = mem.heroImg;
    } else {
      fullImg.style.display = 'none';
    }
    const palEl = document.getElementById('modalImagePalette');
    palEl.innerHTML = '';
    const colors = mem.palette || ['#1C1C1E', '#48484A', '#8E8E93', '#D1D1D6', '#F2F2F7'];
    colors.forEach(col => {
      const sw = document.createElement('div');
      sw.style.width = '24px';
      sw.style.height = '24px';
      sw.style.borderRadius = '5px';
      sw.style.background = col;
      sw.style.boxShadow = '0 1px 3px rgba(0,0,0,0.15)';
      sw.title = col;
      palEl.appendChild(sw);
    });
  }

  // Populate Right Column
  document.getElementById('modalMetaTitle').textContent = mem.title;
  document.getElementById('modalMetaTime').textContent = mem.date || 'Just now';
  const displayDomain = mem.displaySource || getDisplaySource(mem.source) || 'Web';
  document.getElementById('modalMetaSourceName').textContent = displayDomain;
  const linkHref = (mem.source && !mem.source.startsWith('data:') && mem.source !== 'Pasted Screenshot')
    ? mem.source
    : ((mem.imageUrl && !mem.imageUrl.startsWith('data:'))
      ? mem.imageUrl
      : (mem.heroImg || '#'));
  document.getElementById('modalMetaSourceLink').href = linkHref;
  document.getElementById('modalTldrBox').textContent = mem.tldr || mem.subtitle || mem.body || mem.title;

  // Render Tags
  renderModalTags(mem);

  // Render Notes
  const notesTextarea = document.getElementById('modalNotesTextarea');
  notesTextarea.value = mem.notes || '';
  notesTextarea.oninput = () => {
    mem.notes = notesTextarea.value;
    saveUserMemory(mem);
  };

  // Like button
  const likeBtn = document.getElementById('modalActionLikeBtn');
  if (likeBtn) {
    likeBtn.style.display = (isVideo || isCode) ? 'none' : 'flex';
    likeBtn.className = `modal-action-circle-btn ${mem.isLiked ? 'liked' : ''}`;
    const likeSvg = likeBtn.querySelector('svg');
    if (likeSvg) {
      likeSvg.setAttribute('fill', mem.isLiked ? '#ff3b30' : 'none');
      likeSvg.setAttribute('stroke', mem.isLiked ? '#ff3b30' : 'currentColor');
    }
    likeBtn.onclick = async () => {
      mem.isLiked = !mem.isLiked;
      likeBtn.classList.toggle('liked', mem.isLiked);
      if (likeSvg) {
        likeSvg.setAttribute('fill', mem.isLiked ? '#ff3b30' : 'none');
        likeSvg.setAttribute('stroke', mem.isLiked ? '#ff3b30' : 'currentColor');
      }
      EXACT_CARDS_DATA[mem.id] = mem;
      await saveUserMemory(mem);
      const cardEl = document.querySelector(`.card-item[data-id="${mem.id}"] .card-heart-btn`);
      if (cardEl) {
        cardEl.classList.toggle('liked', mem.isLiked);
        const cSvg = cardEl.querySelector('svg');
        if (cSvg) {
          cSvg.setAttribute('fill', mem.isLiked ? '#ff3b30' : 'none');
          cSvg.setAttribute('stroke', mem.isLiked ? '#ff3b30' : 'currentColor');
        }
      }
      showToast(mem.isLiked ? 'Added to Liked' : 'Removed from Liked');
    };
  }

  // Share button
  const shareBtn = document.getElementById('modalActionShareBtn');
  if (shareBtn) {
    shareBtn.onclick = () => {
      const textToCopy = mem.source && !mem.source.startsWith('data:') ? mem.source : (mem.quote || mem.title);
      navigator.clipboard.writeText(textToCopy);
      showToast('Copied to clipboard');
    };
  }

  // Trash button (Prompts identical native delete confirmation dialog)
  const trashBtn = document.getElementById('modalActionTrashBtn');
  if (trashBtn) {
    trashBtn.onclick = () => {
      closeMemoryDetailModal();
      promptDeleteMemory(mem.id);
    };
  }

  modal.style.display = 'flex';
}

function closeMemoryDetailModal() {
  const modal = document.getElementById('memoryDetailModal');
  if (modal) modal.style.display = 'none';

  const iframe = document.getElementById('modalVideoIframe');
  if (iframe) iframe.src = '';
  const player = document.getElementById('modalVideoPlayer');
  if (player) {
    try { player.pause(); } catch (e) { }
    player.src = '';
  }
  const socialIframe = document.getElementById('modalSocialIframe');
  if (socialIframe) {
    socialIframe.src = '';
    socialIframe.style.display = 'none';
  }

  currentDetailMemId = null;
}

function renderModalTags(mem) {
  const tagsFlow = document.getElementById('modalTagsFlow');
  if (!tagsFlow) return;

  const chips = tagsFlow.querySelectorAll('.modal-tag-chip');
  chips.forEach(c => c.remove());

  const addBtn = document.getElementById('modalAddTagBtn');
  const inputEl = document.getElementById('modalNewTagInput');

  addBtn.onclick = () => {
    addBtn.style.display = 'none';
    inputEl.style.display = 'inline-block';
    inputEl.value = '';
    inputEl.focus();
  };

  inputEl.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const val = inputEl.value.trim().toLowerCase();
      if (val && !mem.tags.includes(val)) {
        mem.tags.push(val);
        saveUserMemory(mem);
        renderModalTags(mem);
        selectCard(mem.id);
      }
      inputEl.style.display = 'none';
      addBtn.style.display = 'inline-block';
    } else if (e.key === 'Escape') {
      inputEl.style.display = 'none';
      addBtn.style.display = 'inline-block';
    }
  };

  inputEl.onblur = () => {
    inputEl.style.display = 'none';
    addBtn.style.display = 'inline-block';
  };

  (mem.tags || []).forEach(tag => {
    const chip = document.createElement('span');
    chip.className = `modal-tag-chip ${tag === 'article' || tag === 'Article' ? 'tag-article-type' : ''}`;
    chip.innerHTML = `${tag === 'article' || tag === 'Article' ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>' : ''}<span>${escapeHtml(tag)}</span>`;
    chip.title = `Filter by "${tag}"`;
    chip.onclick = () => {
      closeMemoryDetailModal();
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = tag;
        filterCards();
      }
    };
    tagsFlow.appendChild(chip);
  });
}

/* ── Reading Mode Fullscreen Reader ── */
async function openArticleReader(memId) {
  const mem = EXACT_CARDS_DATA[memId];
  if (!mem) return;

  const reader = document.getElementById('articleReaderModal');
  if (!reader) return;

  const displaySource = mem.publication || mem.publisher || mem.displaySource || getDisplaySource(mem.source) || 'The New York Times';
  document.getElementById('readerDomain').textContent = displaySource;
  document.getElementById('readerMasthead').textContent = displaySource;
  document.getElementById('readerTitle').textContent = mem.title;
  document.getElementById('readerAuthor').textContent = mem.author ? `By ${mem.author}` : `By ${displaySource}`;
  document.getElementById('readerDate').textContent = mem.date || 'Today';

  const heroWrapper = document.getElementById('readerHeroWrapper');
  const heroImg = document.getElementById('readerHeroImg');
  if (mem.heroImg) {
    heroWrapper.style.display = 'block';
    heroImg.src = mem.heroImg;
  } else {
    heroWrapper.style.display = 'none';
  }

  const subtitle = document.getElementById('readerLeadSubtitle');
  if (mem.subtitle || mem.tldr) {
    subtitle.style.display = 'block';
    subtitle.textContent = mem.subtitle || mem.tldr;
  } else {
    subtitle.style.display = 'none';
  }

  const parasContainer = document.getElementById('readerParagraphs');
  parasContainer.innerHTML = '';

  let paragraphs = Array.isArray(mem.paragraphs) && mem.paragraphs.length > 0 ? mem.paragraphs : null;
  if (!paragraphs && mem.body) {
    paragraphs = mem.body.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  }

  function renderParagraphsList(paras) {
    parasContainer.innerHTML = '';
    const wordCount = paras.join(' ').split(/\s+/).length;
    const readMins = Math.max(1, Math.round(wordCount / 200));
    document.getElementById('readerReadTime').textContent = `${readMins} min read`;

    paras.forEach(pText => {
      if (pText.startsWith('### ')) {
        const h = document.createElement('h3');
        h.textContent = pText.replace(/^###\s+/, '');
        parasContainer.appendChild(h);
      } else if (pText.startsWith('## ')) {
        const h = document.createElement('h2');
        h.textContent = pText.replace(/^##\s+/, '');
        parasContainer.appendChild(h);
      } else {
        const p = document.createElement('p');
        p.textContent = pText;
        parasContainer.appendChild(p);
      }
    });
  }

  if (paragraphs && paragraphs.length > 0) {
    renderParagraphsList(paragraphs);
  } else {
    const loadingP = document.createElement('p');
    loadingP.style.opacity = '0.6';
    loadingP.style.fontStyle = 'italic';
    loadingP.textContent = 'Fetching complete article text…';
    parasContainer.appendChild(loadingP);
  }

  reader.style.display = 'flex';

  // If article has no full paragraphs or only 1 short snippet, fetch complete article from server
  if ((!mem.paragraphs || mem.paragraphs.length <= 1) && mem.source && mem.source.startsWith('http')) {
    try {
      const res = await fetch(`/api/article-content?url=${encodeURIComponent(mem.source)}&id=${encodeURIComponent(memId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.paragraphs) && json.paragraphs.length > 0) {
          mem.paragraphs = json.paragraphs;
          mem.articleBody = json.articleBody || '';
          if (json.author && !mem.author) {
            mem.author = json.author;
            document.getElementById('readerAuthor').textContent = `By ${json.author}`;
          }
          if (json.publication && !mem.publication) {
            mem.publication = json.publication;
            document.getElementById('readerMasthead').textContent = json.publication;
          }
          renderParagraphsList(mem.paragraphs);
          saveUserMemory(mem);
        }
      }
    } catch (e) {
      console.warn('[Full Article Fetch]', e);
    }
  }

  if (parasContainer.children.length === 0 || parasContainer.textContent.includes('Fetching complete article text…')) {
    renderParagraphsList([
      mem.tldr || mem.subtitle || mem.title,
      mem.body || "No additional article text could be extracted."
    ]);
  }

  const visitLink = document.getElementById('readerVisitLink');
  visitLink.href = mem.source && !mem.source.startsWith('data:') ? mem.source : '#';
  visitLink.textContent = `Visit Original Publication on ${displaySource} ↗`;

  // Reading progress
  const scrollContainer = document.getElementById('readerScrollContainer');
  const progressBar = document.getElementById('readerProgressBar');
  scrollContainer.scrollTop = 0;
  progressBar.style.width = '0%';
  scrollContainer.onscroll = () => {
    const total = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (total > 0) {
      const pct = Math.min(100, Math.max(0, (scrollContainer.scrollTop / total) * 100));
      progressBar.style.width = `${pct}%`;
    }
  };
}

function closeArticleReader() {
  const reader = document.getElementById('articleReaderModal');
  if (reader) reader.style.display = 'none';
}

/* ── Setup Card Interactions ── */
function setupCardClicks() {
  // Only handle static elements like noteAddCard; dynamic cards are bound in attachCardListeners
  const noteAddCard = document.getElementById('noteAddCard');
  if (noteAddCard && !noteAddCard._listenersAttached) {
    noteAddCard._listenersAttached = true;
    noteAddCard.addEventListener('click', () => {
      noteModal.classList.add('open');
      document.getElementById('noteTitleInput').value = '';
      document.getElementById('noteContentInput').value = '';
      document.getElementById('noteTitleInput').focus();
    });
  }
}

/* ── Keyboard Shortcuts (Backspace / Delete) ── */
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const readerModal = document.getElementById('articleReaderModal');
      if (readerModal && readerModal.style.display !== 'none') {
        closeArticleReader();
        return;
      }
      const detailModal = document.getElementById('memoryDetailModal');
      if (detailModal && detailModal.style.display !== 'none') {
        closeMemoryDetailModal();
        return;
      }
      const deleteModal = document.getElementById('deleteModal');
      if (deleteModal && deleteModal.classList.contains('open')) {
        closeDeleteModal();
        return;
      }
      if (noteModal && noteModal.classList.contains('open')) {
        noteModal.classList.remove('open');
        return;
      }
    }

    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || document.activeElement.isContentEditable) {
      return;
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (selectMode && selectedCards.size > 0) {
        e.preventDefault();
        deleteMemory(Array.from(selectedCards));
      } else if (activeCardId && !deletedCardIdsSet.has(activeCardId)) {
        e.preventDefault();
        promptDeleteMemory(activeCardId);
      }
    }
  });
}

/* ── Controls, Tabs, Search ── */
function setupControls() {
  // Memory Detail Modal Controls
  document.getElementById('modalCloseBtn')?.addEventListener('click', closeMemoryDetailModal);
  document.getElementById('memoryDetailBackdrop')?.addEventListener('click', closeMemoryDetailModal);
  document.getElementById('readerBackBtn')?.addEventListener('click', () => {
    closeArticleReader();
    if (currentDetailMemId) openMemoryDetailModal(currentDetailMemId);
  });
  document.getElementById('readerCloseBtn')?.addEventListener('click', () => {
    closeArticleReader();
    closeMemoryDetailModal();
  });

  // Reader Themes
  document.querySelectorAll('.reader-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.reader-theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const theme = btn.dataset.readerTheme;
      const r = document.getElementById('articleReaderModal');
      if (r) {
        r.classList.remove('theme-sepia', 'theme-dark');
        if (theme === 'sepia') r.classList.add('theme-sepia');
        if (theme === 'dark') r.classList.add('theme-dark');
      }
    });
  });

  // Reader Font Toggle
  const fontToggle = document.getElementById('readerFontToggle');
  if (fontToggle) {
    fontToggle.addEventListener('click', () => {
      const r = document.getElementById('articleReaderModal');
      if (r) {
        r.classList.toggle('font-sans');
        const isSans = r.classList.contains('font-sans');
        fontToggle.textContent = isSans ? 'Sans' : 'Serif';
      }
    });
  }

  // Reader Font Sizing
  const sizeMinus = document.getElementById('readerSizeMinus');
  const sizePlus = document.getElementById('readerSizePlus');
  if (sizeMinus && sizePlus) {
    sizeMinus.addEventListener('click', () => {
      readerFontSize = Math.max(14, readerFontSize - 1.5);
      document.querySelectorAll('.reader-paragraphs p').forEach(p => p.style.fontSize = `${readerFontSize}px`);
    });
    sizePlus.addEventListener('click', () => {
      readerFontSize = Math.min(26, readerFontSize + 1.5);
      document.querySelectorAll('.reader-paragraphs p').forEach(p => p.style.fontSize = `${readerFontSize}px`);
    });
  }

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

  // Color Filter Dropdown (matching macOS RecallColorFilter)
  const colorBtn = document.getElementById('colorFilterBtn');
  const colorMenu = document.getElementById('colorMenu');
  const colorLabel = document.getElementById('colorFilterLabel');
  const colorDot = document.getElementById('colorFilterDot');

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    colorMenu.classList.toggle('open');
  });

  document.querySelectorAll('.color-item').forEach(item => {
    item.addEventListener('click', () => {
      const color = item.dataset.color || null;
      selectedColorFilter = color;
      colorMenu.classList.remove('open');

      if (selectedColorFilter) {
        colorLabel.textContent = item.textContent.trim();
        const filterDef = (window.RECALL_COLOR_FILTERS || []).find(f => f.name.toLowerCase() === selectedColorFilter.toLowerCase());
        if (colorDot) {
          colorDot.style.background = filterDef ? filterDef.color : '#007AFF';
          colorDot.style.display = 'inline-block';
        }
      } else {
        colorLabel.textContent = 'Color';
        if (colorDot) colorDot.style.display = 'none';
      }
      filterCards();
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

  const menuNewQuote = document.getElementById('menuNewQuote');
  if (menuNewQuote) {
    menuNewQuote.addEventListener('click', () => {
      addMenu.classList.remove('open');
      const quoteInput = prompt('Enter quote text:');
      if (quoteInput && quoteInput.trim()) {
        const attrInput = prompt('Enter author or attribution (optional, e.g. Walt Disney):', '');
        createAndSaveQuote(quoteInput.trim(), attrInput ? attrInput.trim() : '');
      }
    });
  }

  document.getElementById('menuAddMedia').addEventListener('click', () => {
    addMenu.classList.remove('open');
    document.getElementById('fileInput').click();
  });

  const menuAddSocial = document.getElementById('menuAddSocial');
  if (menuAddSocial) {
    menuAddSocial.addEventListener('click', () => {
      addMenu.classList.remove('open');
      const input = prompt('Enter an 𝕏 / Twitter, Reddit, LinkedIn, Threads, or Bluesky post link:');
      if (input && input.trim()) {
        processPastedText(input.trim());
      }
    });
  }

  const menuAddDoc = document.getElementById('menuAddDoc');
  if (menuAddDoc) {
    menuAddDoc.addEventListener('click', () => {
      addMenu.classList.remove('open');
      const input = prompt('Enter an arXiv paper URL, PDF link, or Google Sheets link (or leave empty to browse files):', '');
      if (input && input.trim()) {
        processPastedText(input.trim());
      } else if (input !== null) {
        document.getElementById('fileInput').click();
      }
    });
  }

  const menuAddAudio = document.getElementById('menuAddAudio');
  if (menuAddAudio) {
    menuAddAudio.addEventListener('click', () => {
      addMenu.classList.remove('open');
      const url = prompt('Enter a Spotify track/album, SoundCloud, Podcast, or Audio link:');
      if (url && url.trim()) {
        processPastedText(url.trim());
      }
    });
  }

  // Select Mode
  selectBtn.addEventListener('click', () => {
    selectMode = !selectMode;
    selectBtn.classList.toggle('active', selectMode);
    document.querySelectorAll('.card-item').forEach(c => c.classList.toggle('in-select-mode', selectMode));
    if (!selectMode) {
      selectedCards.clear();
      selectBtnLabel.textContent = 'Select';
      if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
      document.querySelectorAll('.card-item').forEach(c => c.classList.remove('selected'));
      if (activeCardId && !deletedCardIdsSet.has(activeCardId)) {
        selectCard(activeCardId);
      }
    } else {
      selectBtnLabel.textContent = 'Done';
    }
  });

  // Bulk Delete in Select Mode (Prompts Confirmation Modal)
  if (bulkDeleteBtn) {
    bulkDeleteBtn.addEventListener('click', () => {
      if (selectedCards.size > 0) {
        promptDeleteMemory(Array.from(selectedCards));
      }
    });
  }

  // Delete Warning Modal (Image 2 Parity)
  const deleteModal = document.getElementById('deleteModal');
  const keepBtn = document.getElementById('deleteModalKeepBtn');
  const trashBtn = document.getElementById('deleteModalTrashBtn');

  if (keepBtn) {
    keepBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDeleteModal();
    });
  }

  if (trashBtn) {
    trashBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (pendingDeleteId) {
        const idToDelete = pendingDeleteId;
        closeDeleteModal();
        deleteMemory(idToDelete);
      }
    });
  }

  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) {
        closeDeleteModal();
      }
    });
  }

  // Delegated Global Trash & Action Handlers (Guarantees delete works on Notes, Quotes, Articles, Videos, Images)
  document.addEventListener('click', (e) => {
    const trashBtn = e.target.closest('.card-trash-btn');
    if (trashBtn) {
      e.preventDefault();
      e.stopPropagation();
      const card = trashBtn.closest('.card-item');
      if (card && card.dataset.id) {
        promptDeleteMemory(card.dataset.id);
      }
      return;
    }

    const heartBtn = e.target.closest('.card-heart-btn, .card-badge-heart');
    if (heartBtn) {
      e.preventDefault();
      e.stopPropagation();
      const card = heartBtn.closest('.card-item');
      if (card && card.dataset.id) {
        toggleCardLiked(card.dataset.id, heartBtn);
      }
      return;
    }
  }, true); // Capture phase: catches clicks before card modal handler can trigger

  // Note Modal Save
  document.getElementById('btnCancelNote').addEventListener('click', () => {
    noteModal.classList.remove('open');
  });

  document.getElementById('btnSaveNote').addEventListener('click', async () => {
    const title = document.getElementById('noteTitleInput').value.trim() || 'Untitled Note';
    const body = document.getElementById('noteContentInput').value.trim() || '';
    document.getElementById('noteTitleInput').value = '';
    document.getElementById('noteContentInput').value = '';
    noteModal.classList.remove('open');

    const fullText = (body ? `${title}\n\n${body}` : title).trim();
    const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
    const placeholder = createSavingPlaceholder();

    if (groqKey && fullText.length > 10) {
      showToast('Enhancing note with Groq AI…');
      try {
        const groqAnalysis = await analyzeTextWithGroq(fullText, groqKey);
        if (groqAnalysis) {
          if (groqAnalysis.isQuote) {
            createAndSaveQuote(
              groqAnalysis.quoteText || body || title,
              groqAnalysis.quoteAttribution || '',
              placeholder,
              groqAnalysis.tags,
              groqAnalysis.tldr
            );
            return;
          } else {
            createAndSaveNote(
              (title !== 'Untitled Note' ? title : groqAnalysis.title) || groqAnalysis.title || 'Note',
              body || title,
              placeholder,
              groqAnalysis.tags,
              groqAnalysis.tldr
            );
            return;
          }
        }
      } catch (e) {}
    }

    createAndSaveNote(title, body, placeholder);
  });

  const handleNoteKeydown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('btnSaveNote').click();
    }
  };
  document.getElementById('noteTitleInput').addEventListener('keydown', handleNoteKeydown);
  document.getElementById('noteContentInput').addEventListener('keydown', handleNoteKeydown);

  // Inspector Toolbar Buttons (safely handled if present)
  document.getElementById('toolFavBtn')?.addEventListener('click', () => {
    showToast('Saved to Favorites');
  });

  const toolExpandBtn = document.getElementById('toolExpandBtn');
  if (toolExpandBtn) {
    toolExpandBtn.addEventListener('click', () => {
      if (activeCardId && EXACT_CARDS_DATA[activeCardId]) {
        window.open(EXACT_CARDS_DATA[activeCardId].heroImg, '_blank');
      }
    });
  }

  const toolMoreBtn = document.getElementById('toolMoreBtn');
  if (toolMoreBtn) {
    toolMoreBtn.addEventListener('click', () => {
      if (activeCardId && EXACT_CARDS_DATA[activeCardId]) {
        const d = EXACT_CARDS_DATA[activeCardId];
        const text = `${d.title}\nSource: ${d.source}\n${d.tldr || ''}`;
        navigator.clipboard.writeText(text);
        showToast(`Copied "${d.title}" to clipboard`);
      }
    });
  }

  document.getElementById('toolDeleteBtn')?.addEventListener('click', () => {
    if (activeCardId && !deletedCardIdsSet.has(activeCardId)) {
      deleteMemory(activeCardId);
    }
  });

  // Settings Button -> Opens macOS Settings Modal
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      openSettingsModal();
    });
  }

  setupSettingsModalHandlers();
}

/* ══════════════════════════════════════════════
   macOS NATIVE SETTINGS CONTROLLER
══════════════════════════════════════════════ */
const SETTINGS_STORAGE_KEY = 'recall_user_settings_v1';
const DEFAULT_SETTINGS = {
  theme: 'light',
  showGreeting: true,
  defaultTab: 'Everything',
  autoOcr: true,
  mobileClip: true,
  autoPalette: true,
  autoScrape: true,
  confirmDelete: true
};

function getRecallSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) { }
  return { ...DEFAULT_SETTINGS };
}

function saveRecallSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) { }
}

function applySettingsEffects(settings) {
  // 1. Theme
  const theme = settings.theme || 'system';
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (theme === 'light') {
    document.body.classList.remove('dark-theme');
  } else {
    // System
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }

  // 2. Greeting Header
  const subhead = document.querySelector('.subhead-row');
  if (subhead) {
    subhead.style.display = settings.showGreeting ? 'flex' : 'none';
  }
}

function openSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (!modal) return;

  const settings = getRecallSettings();

  // Populate values
  const greetingToggle = document.getElementById('settingShowGreeting');
  if (greetingToggle) greetingToggle.checked = Boolean(settings.showGreeting);

  const defaultTabSelect = document.getElementById('settingDefaultTab');
  if (defaultTabSelect) defaultTabSelect.value = settings.defaultTab || 'Everything';

  const autoOcrToggle = document.getElementById('settingAutoOcr');
  if (autoOcrToggle) autoOcrToggle.checked = Boolean(settings.autoOcr);

  const mobileClipToggle = document.getElementById('settingMobileClip');
  if (mobileClipToggle) mobileClipToggle.checked = Boolean(settings.mobileClip);

  const autoPaletteToggle = document.getElementById('settingAutoPalette');
  if (autoPaletteToggle) autoPaletteToggle.checked = Boolean(settings.autoPalette);

  const autoScrapeToggle = document.getElementById('settingAutoScrape');
  if (autoScrapeToggle) autoScrapeToggle.checked = Boolean(settings.autoScrape);

  const confirmDeleteToggle = document.getElementById('settingConfirmDelete');
  if (confirmDeleteToggle) confirmDeleteToggle.checked = Boolean(settings.confirmDelete);

  // Active theme segmented buttons
  const themeButtons = document.querySelectorAll('#themeSegmented .seg-btn');
  themeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === (settings.theme || 'system'));
  });

  // Active memory count
  const activeCountEl = document.getElementById('settingActiveMemoryCount');
  if (activeCountEl) {
    const totalCount = Object.keys(EXACT_CARDS_DATA).filter(id => !deletedCardIdsSet.has(id)).length;
    activeCountEl.textContent = `${totalCount} memories`;
  }

  // Populate Groq Vision AI key & badge & model
  window.updateGroqUIFromStorage = function () {
    const groqKeyInput = document.getElementById('settingGroqKey');
    const groqBadge = document.getElementById('groqStatusBadge');
    const groqModelSelect = document.getElementById('settingGroqModel');
    const savedGroqKey = localStorage.getItem('recall_groq_api_key') || '';
    const savedGroqModel = localStorage.getItem('recall_groq_model') || 'qwen/qwen3.8-27b';
    if (groqKeyInput && document.activeElement !== groqKeyInput) groqKeyInput.value = savedGroqKey;
    if (groqModelSelect) groqModelSelect.value = savedGroqModel;
    if (groqBadge) {
      if (savedGroqKey) {
        groqBadge.textContent = `● Active (${savedGroqModel.split('/')[1] || savedGroqModel})`;
        groqBadge.style.background = 'rgba(34, 197, 94, 0.2)';
        groqBadge.style.color = '#4ade80';
      } else {
        groqBadge.textContent = 'Not Configured';
        groqBadge.style.background = 'rgba(255, 255, 255, 0.08)';
        groqBadge.style.color = '#aaa';
      }
    }
  };

  window.updateGroqUIFromStorage();

  modal.classList.add('open');
}

function closeSettingsModal() {
  const modal = document.getElementById('settingsModal');
  if (modal) {
    modal.classList.remove('open');
  }
}

/**
 * Provider Auto-Detection & Key Sanitizer
 * Automatically detects whether user entered a Groq LPU key (gsk_...)
 * or an xAI Grok key (xai-...) and configures the correct endpoint & model.
 */
function getVisionApiConfig(rawKey, preferredModel = '') {
  const cleanKey = String(rawKey || '').trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["'`]|["'`]$/g, '')
    .trim();

  if (cleanKey.startsWith('xai-')) {
    return {
      provider: 'xAI Grok',
      endpoint: 'https://api.x.ai/v1/chat/completions',
      modelsEndpoint: 'https://api.x.ai/v1/models',
      model: preferredModel || 'grok-2-vision-1212',
      key: cleanKey
    };
  } else {
    // Groq LPU (gsk_...)
    return {
      provider: 'Groq LPU',
      endpoint: 'https://api.groq.com/openai/v1/chat/completions',
      modelsEndpoint: 'https://api.groq.com/openai/v1/models',
      model: preferredModel || 'qwen/qwen3.8-27b',
      key: cleanKey
    };
  }
}

/**
 * Creates a valid 64x64 pixel image for testing vision models
 * (Qwen Vision requires image dimensions to be at least 32px)
 */
function createTestImage64() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f97316';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(16, 16, 32, 32);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch (e) {
    return 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAAgACABREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  }
}

function setupSettingsModalHandlers() {
  const modal = document.getElementById('settingsModal');
  if (!modal || modal._handlersAttached) return;
  modal._handlersAttached = true;

  // Groq API Key Save & Test Handlers
  const btnSaveGroqKey = document.getElementById('btnSaveGroqKey');
  const btnTestGroqKey = document.getElementById('btnTestGroqKey');
  const groqKeyInput = document.getElementById('settingGroqKey');
  const groqModelSelect = document.getElementById('settingGroqModel');
  const groqTestResult = document.getElementById('groqTestResult');

  if (groqModelSelect) {
    groqModelSelect.addEventListener('change', () => {
      localStorage.setItem('recall_groq_model', groqModelSelect.value);
      if (window.firebaseSync && typeof window.firebaseSync.saveUserSettings === 'function') {
        window.firebaseSync.saveUserSettings({
          groqModel: groqModelSelect.value
        });
      }
    });
  }

  if (btnSaveGroqKey && groqKeyInput) {
    btnSaveGroqKey.addEventListener('click', () => {
      const rawVal = groqKeyInput.value.trim();
      const config = getVisionApiConfig(rawVal, groqModelSelect ? groqModelSelect.value : '');
      const groqBadge = document.getElementById('groqStatusBadge');
      if (config.key) {
        localStorage.setItem('recall_groq_api_key', config.key);
        localStorage.setItem('recall_groq_model', config.model);
        window.postMessage({ type: 'RECALL_SET_GROQ_KEY', key: config.key }, '*');
        if (groqBadge) {
          groqBadge.textContent = `● Active (${config.provider})`;
          groqBadge.style.background = 'rgba(34, 197, 94, 0.2)';
          groqBadge.style.color = '#4ade80';
        }
        if (window.firebaseSync && typeof window.firebaseSync.saveUserSettings === 'function') {
          window.firebaseSync.saveUserSettings({
            groqApiKey: config.key,
            groqModel: config.model
          });
        }
        showToast(`AI key saved securely to your account (${config.provider})!`);
      } else {
        localStorage.removeItem('recall_groq_api_key');
        if (groqBadge) {
          groqBadge.textContent = 'Not Configured';
          groqBadge.style.background = 'rgba(255, 255, 255, 0.08)';
          groqBadge.style.color = '#aaa';
        }
        if (window.firebaseSync && typeof window.firebaseSync.saveUserSettings === 'function') {
          window.firebaseSync.saveUserSettings({
            groqApiKey: '',
            groqModel: ''
          });
        }
        showToast('API Key removed (using local AI fallback)');
      }
    });
  }

  if (btnTestGroqKey) {
    btnTestGroqKey.addEventListener('click', async () => {
      const rawInput = (groqKeyInput ? groqKeyInput.value : '').trim();
      if (!rawInput) {
        if (groqTestResult) {
          groqTestResult.style.display = 'block';
          groqTestResult.textContent = 'Please enter an API key first.';
          groqTestResult.style.color = '#f87171';
        }
        return;
      }
      const config = getVisionApiConfig(rawInput, groqModelSelect ? groqModelSelect.value : '');
      if (groqTestResult) {
        groqTestResult.style.display = 'block';
        groqTestResult.textContent = `Verifying ${config.provider} authentication…`;
        groqTestResult.style.color = '#facc15';
      }
      try {
        const start = Date.now();
        // 1. Verify Authentication against Provider's /models endpoint
        const authRes = await fetch(config.modelsEndpoint, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${config.key}`
          }
        });

        if (!authRes.ok) {
          const authErr = await authRes.text();
          let msg = `HTTP ${authRes.status}`;
          try {
            const parsed = JSON.parse(authErr);
            msg += `: ${parsed.error?.message || authErr}`;
          } catch (e) {
            msg += `: ${authErr}`;
          }
          if (authRes.status === 401) {
            msg = `Invalid API Key (HTTP 401): ${config.provider} rejected this key. Please make sure you generated it from ${config.provider === 'xAI Grok' ? 'console.x.ai' : 'console.groq.com/keys'}.`;
          }
          if (groqTestResult) {
            groqTestResult.textContent = `✕ ${msg}`;
            groqTestResult.style.color = '#f87171';
          }
          return;
        }

        // 2. Authentication passed! Now test vision inference
        if (groqTestResult) {
          groqTestResult.textContent = `✓ Key valid! Testing vision inference with ${config.model}…`;
          groqTestResult.style.color = '#facc15';
        }

        const testImage = createTestImage64();
        const res = await fetch(config.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Answer in 2 words: what is this image?' },
                  { type: 'image_url', image_url: { url: testImage } }
                ]
              }
            ],
            reasoning_effort: 'none',
            max_completion_tokens: 30
          })
        });
        const elapsed = Date.now() - start;
        if (res.ok) {
          const json = await res.json();
          const respText = json.choices?.[0]?.message?.content || 'OK';
          if (groqTestResult) {
            groqTestResult.textContent = `✓ Connected to ${config.provider}! Model: ${config.model} (${elapsed}ms) — "${respText.trim()}"`;
            groqTestResult.style.color = '#4ade80';
          }
        } else {
          const errText = await res.text();
          let parsedMsg = `HTTP ${res.status}`;
          try {
            const errJson = JSON.parse(errText);
            parsedMsg += `: ${errJson.error?.message || errText}`;
          } catch (e) {
            parsedMsg += `: ${errText}`;
          }
          if (groqTestResult) {
            groqTestResult.textContent = `✕ Key is valid, but model rejected: ${parsedMsg}`;
            groqTestResult.style.color = '#f87171';
          }
        }
      } catch (networkErr) {
        if (groqTestResult) {
          groqTestResult.textContent = `✕ Network Error: ${networkErr.message}`;
          groqTestResult.style.color = '#f87171';
        }
      }
    });
  }

  // Initial apply of saved settings
  const settings = getRecallSettings();
  applySettingsEffects(settings);

  // Close handler
  const xCloseBtn = document.getElementById('settingsXCloseBtn');
  if (xCloseBtn) xCloseBtn.addEventListener('click', closeSettingsModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSettingsModal();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('open')) {
      closeSettingsModal();
    }
  });

  // Sidebar Tab Navigation
  const tabBtns = modal.querySelectorAll('.settings-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.dataset.tab;
      modal.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      const activePanel = document.getElementById(`settingsPanel-${targetTab}`);
      if (activePanel) activePanel.classList.add('active');
    });
  });

  // Theme Segmented Control
  const themeBtns = modal.querySelectorAll('#themeSegmented .seg-btn');
  themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      themeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const current = getRecallSettings();
      current.theme = btn.dataset.theme;
      saveRecallSettings(current);
      applySettingsEffects(current);
      showToast(`Appearance: ${btn.textContent}`);
    });
  });

  // Toggle Handlers
  const bindToggle = (elId, key, label) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.addEventListener('change', () => {
      const current = getRecallSettings();
      current[key] = el.checked;
      saveRecallSettings(current);
      applySettingsEffects(current);
      showToast(`${label}: ${el.checked ? 'Enabled' : 'Disabled'}`);
    });
  };

  bindToggle('settingShowGreeting', 'showGreeting', 'Greeting Header');
  bindToggle('settingAutoOcr', 'autoOcr', 'PaddleOCR Auto-Extract');
  bindToggle('settingMobileClip', 'mobileClip', 'MobileCLIP Smart Search');
  bindToggle('settingAutoPalette', 'autoPalette', 'Color Palette Detection');
  bindToggle('settingAutoScrape', 'autoScrape', 'Auto-Scrape Links');
  bindToggle('settingConfirmDelete', 'confirmDelete', 'Delete Warning Dialog');

  // Default Tab Select
  const defaultTabSelect = document.getElementById('settingDefaultTab');
  if (defaultTabSelect) {
    defaultTabSelect.addEventListener('change', () => {
      const current = getRecallSettings();
      current.defaultTab = defaultTabSelect.value;
      saveRecallSettings(current);
      showToast(`Default View: ${current.defaultTab}`);
    });
  }

  // Sync with Extension Button
  const syncBtn = document.getElementById('settingSyncNowBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing…';
      await syncExtensionInbox();
      setTimeout(() => {
        syncBtn.disabled = false;
        syncBtn.textContent = 'Sync Now';
        showToast('Extension inbox checked & synced');
      }, 500);
    });
  }

  // Backup & Export Button
  const exportBtn = document.getElementById('settingExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      const allMems = Object.values(EXACT_CARDS_DATA).filter(m => !deletedCardIdsSet.has(m.id));
      const backupData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        count: allMems.length,
        memories: allMems
      };
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recall-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported ${allMems.length} memories to backup file`);
    });
  }

  // Restore from Backup Button
  const restoreBtn = document.getElementById('settingRestoreBtn');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async (evt) => {
        const file = evt.target.files && evt.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const json = JSON.parse(text);
          const memsToImport = Array.isArray(json.memories) ? json.memories : (Array.isArray(json) ? json : []);
          if (memsToImport.length === 0) {
            showToast('No memories found in selected file');
            return;
          }
          let count = 0;
          for (const m of memsToImport) {
            if (m && m.id) {
              EXACT_CARDS_DATA[m.id] = m;
              deletedCardIdsSet.delete(m.id);
              if (window.recallStorage) {
                await window.recallStorage.saveMemory(m);
              }
              renderCardInGrid(m, true);
              count++;
            }
          }
          reflowMasonry();
          updateMemoryCount();
          closeSettingsModal();
          showToast(`Restored ${count} memories from backup!`);
        } catch (err) {
          showToast('Invalid backup file');
        }
      };
      input.click();
    });
  }

  // Clean Stale & Deleted Cloud Memories
  const cleanStaleBtn = document.getElementById('settingCleanStaleBtn');
  if (cleanStaleBtn) {
    cleanStaleBtn.addEventListener('click', async () => {
      cleanStaleBtn.textContent = 'Cleaning…';
      cleanStaleBtn.disabled = true;
      try {
        if (window.firebaseSync && window.firebaseSync.currentUser) {
          await window.firebaseSync.cleanStaleCloudMemories();
        }
        showToast('Cloud library cleaned & synchronized.');
      } catch (err) {
        showToast('Error cleaning cloud memories');
      } finally {
        cleanStaleBtn.textContent = 'Clean Cloud Memories';
        cleanStaleBtn.disabled = false;
      }
    });
  }

  // Force Push Local Memories to Cloud
  const forceSyncBtn = document.getElementById('settingForceSyncBtn');
  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', async () => {
      forceSyncBtn.textContent = 'Syncing…';
      forceSyncBtn.disabled = true;
      try {
        if (window.firebaseSync) {
          const res = await window.firebaseSync.forceSyncAllLocalMemories();
          if (res && res.success) {
            showToast('All local memories successfully uploaded to Cloud!');
          } else {
            showToast(res?.reason || 'Sync completed');
          }
        }
      } catch (err) {
        showToast('Error syncing to cloud');
      } finally {
        forceSyncBtn.textContent = 'Push to Cloud Now';
        forceSyncBtn.disabled = false;
      }
    });
  }

  // Clear All Memories (Danger Zone)
  const clearAllBtn = document.getElementById('settingClearAllBtn');
  if (clearAllBtn) {
    clearAllBtn.addEventListener('click', async () => {
      const totalCount = Object.keys(EXACT_CARDS_DATA).length;
      const confirmReset = confirm(
        `Recall — Fresh Canvas\n\nAre you sure you want to permanently erase all memories (${totalCount} active)?\n\n• OK = Clear all data\n• Cancel = Keep current memories`
      );
      if (confirmReset) {
        localStorage.setItem('recall_user_cleared_all', 'true');
        localStorage.removeItem('recall_deleted_ids');
        localStorage.removeItem('recall_user_memories');

        if (window.recallStorage) {
          await window.recallStorage.clearAll();
        }

        if (window.firebaseSync && window.firebaseSync.currentUser) {
          await window.firebaseSync.clearAllMemoriesFromFirestore();
        }

        deletedCardIdsSet.clear();
        for (const k in EXACT_CARDS_DATA) delete EXACT_CARDS_DATA[k];
        document.querySelectorAll('.card-item[data-id]').forEach(c => c.remove());
        activeCardId = null;
        reflowMasonry();
        updateMemoryCount();
        closeSettingsModal();
        showToast('All memories cleared. Fresh canvas ready.');
      }
    });
  }
}

/* ══════════════════════════════════════════════
   COPY & PASTE ENGINE (100% Client-Side)
══════════════════════════════════════════════ */

/* Extract 5-color palette from an image element */
function extractPaletteFromImage(imgEl) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0, 64, 64);
    const data = ctx.getImageData(0, 0, 64, 64).data;
    const colors = [];
    const step = 4 * 16;
    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      colors.push({
        r, g, b,
        hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase()}`
      });
    }
    const palette = [];
    for (const c of colors) {
      if (!palette.some(p => Math.abs(p.r - c.r) + Math.abs(p.g - c.g) + Math.abs(p.b - c.b) < 65)) {
        palette.push(c);
        if (palette.length === 5) break;
      }
    }
    while (palette.length < 5) {
      palette.push(colors[palette.length] || { hex: '#4A5568' });
    }
    return palette.map(p => p.hex);
  } catch (e) {
    return ['#1C1C1E', '#48484A', '#8E8E93', '#D1D1D6', '#F2F2F7'];
  }
}

/* Save / Load User Memories using Persistent IndexedDB (no 5MB quota limit) */
async function saveUserMemory(mem) {
  try {
    localStorage.removeItem('recall_user_cleared_all');
    const fbUser = (window.firebaseSync && window.firebaseSync.currentUser) ||
      (window.firebaseSync && window.firebaseSync.auth && window.firebaseSync.auth.currentUser) ||
      (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
    if (fbUser && fbUser.uid) {
      mem.userId = fbUser.uid;
    }
    if (window.recallStorage) {
      await window.recallStorage.saveMemory(mem);
    }
    if (window.firebaseSync) {
      await window.firebaseSync.saveMemoryToFirestore(mem);
    }
  } catch (e) {
    console.error('Error saving user memory to persistent storage', e);
  }
}

async function loadUserMemories() {
  try {
    const isLoggedIn = localStorage.getItem('recall_logged_in') === 'true';
    const userCleared = !isLoggedIn && localStorage.getItem('recall_user_cleared_all') === 'true';
    if (userCleared) {
      updateMemoryCount();
      reflowMasonry();
      return;
    }

    let list = [];
    if (window.recallStorage) {
      list = await window.recallStorage.getAllMemories();
    }
    const DEMO_MEMORY_IDS = new Set([
      'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
      'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
      'believe', 'redbull', 'memo', 'gtavi_hero'
    ]);

    // Filter out deleted IDs and demo memories
    list = (list || []).filter(m => m && m.id && !deletedCardIdsSet.has(m.id) && !DEMO_MEMORY_IDS.has(m.id) && !m.isDemo);

    // Purge any legacy demo cards from local storage
    DEMO_MEMORY_IDS.forEach(dId => {
      if (window.recallStorage) window.recallStorage.deleteMemory(dId);
      const el = document.querySelector(`.card-item[data-id="${CSS.escape(String(dId))}"]`);
      if (el) el.remove();
    });
    localStorage.setItem('recall_initialized', 'true');
    list.forEach(mem => {
      // Ensure tags array and key flags are always present
      if (!Array.isArray(mem.tags)) mem.tags = [];

      // Re-derive isBook / hasAnimals from tags if missing (strictly books, not generic reading mode articles)
      const isArticleOrVideo = mem.isArticle || mem.type === 'Article' || mem.isVideo || mem.type === 'Video';
      if (!mem.isBook && !isArticleOrVideo && mem.tags.some(t => ['book', 'books', 'novel', 'literature', 'volume', 'saga', 'comic'].includes(String(t).toLowerCase()))) {
        mem.isBook = true;
      }
      if (!mem.hasAnimals && mem.tags.some(t => ['animal', 'animals', 'lion', 'tiger', 'bear', 'wildlife', 'wolf', 'leopard', 'cheetah', 'elephant', 'zebra', 'feline', 'mammal', 'predator'].includes(String(t).toLowerCase()))) {
        mem.hasAnimals = true;
      }
      // Re-derive from tldr/ocrText keywords too
      const hayLower = `${mem.tldr || ''} ${mem.ocrText || ''} ${mem.title || ''}`.toLowerCase();
      if (!mem.isBook && !isArticleOrVideo && (hayLower.includes('volume') || hayLower.includes('saga') || /\b(book|books|novel|comic)\b/.test(hayLower))) {
        mem.isBook = true;
        if (!mem.tags.includes('book')) mem.tags.push('book');
        if (!mem.tags.includes('books')) mem.tags.push('books');
      }
      if (!mem.hasAnimals && /\b(lion|tiger|bear|wolf|animal|animals|leopard|cheetah|elephant|zebra|wildlife|feline)\b/.test(hayLower)) {
        mem.hasAnimals = true;
        if (!mem.tags.includes('animal')) mem.tags.push('animal');
        if (!mem.tags.includes('animals')) mem.tags.push('animals');
      }

      // Auto-heal any memories that have an image but were mistakenly classified as Quote
      const hasImage = Boolean(mem.heroImg && (mem.heroImg.startsWith('http') || mem.heroImg.startsWith('data:')));
      if (hasImage && (mem.isQuote || mem.type === 'Quote' || mem.type === 'quote')) {
        mem.isQuote = false;
        mem.type = mem.isBook ? 'Book' : 'Web image';
        mem.contentType = mem.isBook ? 'Book' : 'Image';
        mem.quote = undefined;
        if (!isNaturalReadableText(mem.title) || mem.title.startsWith('—')) {
          mem.title = mem.hasAnimals ? 'Tiger Portrait' : 'Visual Memory';
        }
        if (!isNaturalReadableText(mem.ocrText)) {
          mem.ocrText = '';
        }
        saveUserMemory(mem);
      }

      EXACT_CARDS_DATA[mem.id] = mem;

      // Auto-backfill article body for existing web memories that have empty/sparse body
      if (mem.source && mem.source.startsWith('http') && (!mem.articleBody || mem.articleBody.length < 80)) {
        fetch('/api/scrape-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: mem.source })
        }).then(r => r.json()).then(res => {
          if (res && res.data && res.data.articleBody) {
            mem.articleBody = res.data.articleBody;
            mem.paragraphs = res.data.paragraphs || [];
            if (!mem.body || mem.body === mem.title) {
              mem.body = res.data.articleBody.slice(0, 600);
            }
            EXACT_CARDS_DATA[mem.id] = mem;
            saveUserMemory(mem);
          }
        }).catch(() => {});
      }
    });

    filterCards();
    initInfiniteScroll();
  } catch (e) {
    console.error('Error loading user memories from storage', e);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CANONICAL_COLS = {
  tables: 0,
  youattract: 0,
  fran: 1,
  tryagain: 1,
  givingup: 1,
  lion: 2,
  orange_silhouette: 2,
  studio: 3,
  believe: 3,
  redbull: 4,
  memo: 4
};

const ROW_MAJOR_ORDER = [
  'fran',
  'lion',
  'orange_silhouette',
  'redbull',
  'tables',
  'tryagain',
  'givingup',
  'studio',
  'memo',
  'youattract',
  'believe'
];

function getCardNaturalHeight(card) {
  if (card.classList.contains('card-saved-note')) return 195;
  if (card.id === 'noteAddCard') return 208;
  const id = card.dataset.id;
  const d = EXACT_CARDS_DATA[id];
  if (d && (d.isNote || d.type === 'note' || d.type === 'Note')) return 195;
  const img = card.querySelector('img');
  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    const colW = card.offsetWidth || 180;
    const ratio = img.naturalHeight / img.naturalWidth;
    return Math.min(320, Math.max(140, Math.round(colW * ratio) + 36));
  }
  return 208;
}

function getCardSortIndex(id) {
  const d = EXACT_CARDS_DATA[id];
  if (d && d.createdAt) {
    return -d.createdAt;
  }
  if (id && id.includes('_')) {
    const parts = id.split('_');
    const ts = parseInt(parts[1], 10) || 0;
    if (ts > 0) return -ts; // newer items come first
  }
  const idx = ROW_MAJOR_ORDER.indexOf(id);
  return idx >= 0 ? idx : 999;
}

/* ── Dynamic Masonry Reflow Engine (Autofill deleted spaces) ── */
function reflowMasonry() {
  const cols = [
    document.getElementById('col0'),
    document.getElementById('col1'),
    document.getElementById('col2'),
    document.getElementById('col3'),
    document.getElementById('col4')
  ];
  if (!cols.every(Boolean)) return;

  const noteAddCard = document.getElementById('noteAddCard');
  if (noteAddCard && noteAddCard.parentElement !== cols[0]) {
    cols[0].insertBefore(noteAddCard, cols[0].firstChild);
  }

  // Get all active cards in logical sequence
  const allCards = Array.from(document.querySelectorAll('.card-item[data-id]'));
  allCards.sort((a, b) => getCardSortIndex(a.dataset.id) - getCardSortIndex(b.dataset.id));

  const visibleCards = allCards.filter(c => {
    const id = c.dataset.id;
    return !deletedCardIdsSet.has(id) && c.style.display !== 'none';
  });

  // Dynamic Reflow: Greedily place each visible card into the column with smallest height!
  // This automatically fills all 5 columns evenly.
  const colHeights = [
    (noteAddCard && noteAddCard.style.display !== 'none') ? 208 : 0,
    0, 0, 0, 0
  ];

  visibleCards.forEach(card => {
    let minIdx = 0;
    let minH = colHeights[0];
    for (let i = 1; i < cols.length; i++) {
      if (colHeights[i] < minH) {
        minH = colHeights[i];
        minIdx = i;
      }
    }

    cols[minIdx].appendChild(card);
    const cardH = getCardNaturalHeight(card);
    colHeights[minIdx] += cardH + 11;
  });
}

/* ── Validate Natural Human-Readable Text (Reject OCR Glitches & Random Symbol Noise) ── */
function isNaturalReadableText(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.length < 8) return false;

  // Count letters and spaces vs total length (must be at least 65% alphanumeric letters/spaces)
  const lettersAndSpaces = (clean.match(/[a-zA-Z\s]/g) || []).length;
  if (lettersAndSpaces / clean.length < 0.65) return false;

  // Reject if excessive special symbols / math characters / backslashes
  const weirdPunct = (clean.match(/[\/\\#~=<>_{}[\]|;^]/g) || []).length;
  if (weirdPunct / clean.length > 0.05) return false;

  // Must contain at least 3 recognizable word tokens with length >= 3
  const words = clean.split(/[^a-zA-Z]+/).filter(w => w.length >= 3);
  if (words.length < 3) return false;

  return true;
}

/* ── Detect Quotes (Aphorisms, Proverbs, Quotes, Wisdom matching Image 1) ── */
function detectQuote(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  if (raw.length < 15 || raw.length > 700) return null;
  if (/^https?:\/\//i.test(raw)) return null;

  // Strictly reject OCR noise, symbol soup, or gibberish
  if (!isNaturalReadableText(raw)) return null;

  let body = raw;
  let attribution = '';

  // 1. Check for attribution at end: e.g. "— Walt Disney", "- Steve Jobs", "~ Einstein"
  const attrMatch = raw.match(/(?:[\n\r]+|\s+)[—\u2013~-]\s*([A-Za-z0-9 .'-]{2,50})$/);
  if (attrMatch) {
    attribution = attrMatch[1].trim();
    body = raw.slice(0, raw.length - attrMatch[0].length).trim();
  }

  // 2. Strip surrounding quotation marks if present
  const hasSurroundingQuotes = (/^["“‘'].*["”’']$/s.test(body)) ||
    (body.startsWith('"') && body.endsWith('"')) ||
    (body.startsWith('“') && body.endsWith('”'));
  if (hasSurroundingQuotes) {
    body = body.replace(/^["“‘']\s*/, '').replace(/\s*["”’']$/, '').trim();
  }

  // Check for paired quotes inside (at least 8 chars enclosed)
  const hasInnerQuote = /(?:^|\s)["“‘'][^"”’']{8,}["”’'](?:\s|[.,!?;]|$)/.test(body);
  const knownQuotePhrasing = /\b(dreams?\s+can\s+come\s+true|courage\s+to\s+pursue|words\s+to\s+live\s+by|stay\s+hungry|stay\s+foolish|only\s+way\s+to\s+do\s+great\s+work|be\s+the\s+change|in\s+the\s+middle\s+of\s+difficulty|never\s+give\s+up|to\s+be\s+or\s+not\s+to\s+be|happiness\s+is|success\s+is|life\s+is\s+what\s+happens|do\s+what\s+you\s+can|it\s+always\s+seems\s+impossible|wisdom|aphorism|proverb)\b/i.test(raw);

  const isPoignantThought = body.length >= 20 && body.length <= 350 &&
    !body.includes('```') &&
    body.split('\n').filter(Boolean).length <= 2 &&
    /[.!?]$/.test(body.trim());

  const isAQuote = hasSurroundingQuotes ||
    Boolean(attribution) ||
    hasInnerQuote ||
    knownQuotePhrasing ||
    (isPoignantThought && (knownQuotePhrasing || /courage|dream|dreams|pursue|truth|love|live|hope|fear|soul|heart|wisdom/i.test(body)));

  if (!isAQuote) return null;

  return {
    quoteText: body,
    attribution: attribution.trim()
  };
}

/* ── Create Saving Placeholder Card (Matching User Image 2) ── */
function createSavingPlaceholder(targetId = null) {
  const col0 = document.getElementById('col0');
  if (!col0) return null;

  if (targetId && document.querySelector(`.card-item[data-id="${targetId}"]`)) {
    return document.querySelector(`.card-item[data-id="${targetId}"]`);
  }

  const placeholder = document.createElement('div');
  const tempId = 'saving_' + Date.now();
  placeholder.id = tempId;
  if (targetId) {
    placeholder.dataset.id = targetId;
  }
  placeholder.className = 'card-item card-saving-placeholder';
  placeholder.innerHTML = `
    <svg class="saving-clock-icon" viewBox="0 0 34 42" fill="none">
      <ellipse cx="17" cy="21" rx="10" ry="14" stroke="#687385" stroke-width="2.2" transform="rotate(-15 17 21)" />
      <circle cx="17" cy="21" r="1.6" fill="#687385" />
      <line class="saving-clock-hand" x1="17" y1="21" x2="22" y2="12" stroke="#687385" stroke-width="2.2" stroke-linecap="round" />
    </svg>
    <div class="saving-title">One moment.</div>
    <div class="saving-subtitle">I'm saving this for you.</div>
  `;

  const noteAddCard = document.getElementById('noteAddCard');
  if (noteAddCard && noteAddCard.nextSibling) {
    col0.insertBefore(placeholder, noteAddCard.nextSibling);
  } else if (noteAddCard) {
    col0.appendChild(placeholder);
  } else if (col0.firstChild) {
    col0.insertBefore(placeholder, col0.firstChild);
  } else {
    col0.appendChild(placeholder);
  }

  reflowMasonry();
  return placeholder;
}

/* ── Morph Saving Placeholder to Real Memory Card ── */
function morphPlaceholderToMemory(placeholder, mem) {
  // If another element already rendered this memory ID, eliminate duplicate
  const duplicates = Array.from(document.querySelectorAll(`.card-item[data-id="${mem.id}"]`));
  if (duplicates.length > 1) {
    duplicates.slice(1).forEach(el => el.remove());
    reflowMasonry();
    selectCard(mem.id);
    return;
  }

  if (!placeholder || !placeholder.parentNode) {
    if (!document.querySelector(`.card-item[data-id="${mem.id}"]`)) {
      renderCardInGrid(mem, true);
    }
    return;
  }

  placeholder.style.transition = 'opacity 0.18s ease, transform 0.18s ease';
  placeholder.style.opacity = '0';
  placeholder.style.transform = 'scale(0.96)';

  setTimeout(() => {
    // Check again in case another card was inserted during transition
    const existingOther = Array.from(document.querySelectorAll(`.card-item[data-id="${mem.id}"]`)).find(el => el !== placeholder);
    if (existingOther) {
      placeholder.remove();
      reflowMasonry();
      selectCard(mem.id);
      return;
    }

    placeholder.removeAttribute('id');
    placeholder.removeAttribute('style');
    placeholder.className = 'card-item restoring card-morph-reveal';
    placeholder.dataset.id = mem.id;
    placeholder.dataset.title = mem.title;
    placeholder.dataset.source = mem.source || 'Local';
    placeholder.dataset.type = mem.type || (mem.isQuote ? 'Quote' : (mem.isNote ? 'note' : 'image'));
    placeholder.dataset.tags = (mem.tags || []).join(',');

    populateCardContent(placeholder, mem);
    attachCardListeners(placeholder);

    const imgEl = placeholder.querySelector('img');
    if (imgEl) {
      imgEl.onload = () => reflowMasonry();
    }
    reflowMasonry();
    selectCard(mem.id);
    updateMemoryCount();
  }, 180);
}

/* ── Real-Time Video Detection (YouTube, Vimeo, Web Video, Direct Files) ── */
function detectVideo(url, data) {
  if (!url) return null;
  const cleanUrl = url.trim();

  // YouTube (watch?v=, youtu.be/, /shorts/, /embed/)
  const ytMatch = cleanUrl.match(/(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch) {
    const videoId = ytMatch[1];
    return {
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1`,
      thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
      channel: data?.author || data?.publication || 'YouTube'
    };
  }

  // Vimeo
  const vimeoMatch = cleanUrl.match(/vimeo\.com\/(?:video\/)?([0-9]+)/i);
  if (vimeoMatch) {
    const videoId = vimeoMatch[1];
    return {
      provider: 'vimeo',
      videoId,
      embedUrl: `https://player.vimeo.com/video/${videoId}?autoplay=1`,
      thumbnail: data?.heroImg || '',
      channel: data?.author || 'Vimeo'
    };
  }

  // Direct video file
  if (/\.(mp4|webm|mov|mkv|m4v|ogv)(\?.*)?$/i.test(cleanUrl)) {
    return {
      provider: 'file',
      videoId: '',
      videoFileUrl: cleanUrl,
      thumbnail: data?.heroImg || '',
      channel: 'Video file'
    };
  }

  if (data?.isVideo || data?.videoEmbedUrl) {
    return {
      provider: 'web',
      videoId: data?.videoId || '',
      embedUrl: data?.videoEmbedUrl || '',
      thumbnail: data?.heroImg || '',
      channel: data?.author || data?.domain || 'Video'
    };
  }

  return null;
}

/* ══════════════════ Audio & Music Engine (Spotify, SoundCloud, Audio Files) ══════════════════ */
let activeAudioEl = null;
let activeAudioBtn = null;
let activeAudioCard = null;

function formatAudioDuration(sec) {
  const s = Math.round(sec || 0);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function setAudioBtnPlaying(btn, isPlaying) {
  if (!btn) return;
  const playIcon = btn.querySelector('.play-icon') || btn.querySelector('.modal-play-icon');
  const pauseIcon = btn.querySelector('.pause-icon') || btn.querySelector('.modal-pause-icon');
  if (isPlaying) {
    btn.classList.add('playing');
    if (playIcon) playIcon.style.display = 'none';
    if (pauseIcon) pauseIcon.style.display = 'block';
  } else {
    btn.classList.remove('playing');
    if (playIcon) playIcon.style.display = 'block';
    if (pauseIcon) pauseIcon.style.display = 'none';
  }
}

function toggleAudioPlayback(btn, audioSrc, cardEl) {
  if (!audioSrc) {
    showToast('No audio source found.');
    return;
  }

  // If already playing this audio
  if (activeAudioBtn === btn && activeAudioEl && !activeAudioEl.paused) {
    activeAudioEl.pause();
    setAudioBtnPlaying(btn, false);
    if (activeAudioCard) activeAudioCard.classList.remove('playing');
    return;
  }

  // Stop any other active audio
  if (activeAudioEl) {
    activeAudioEl.pause();
    if (activeAudioBtn) setAudioBtnPlaying(activeAudioBtn, false);
    if (activeAudioCard) activeAudioCard.classList.remove('playing');
  }

  activeAudioEl = new Audio(audioSrc);
  activeAudioBtn = btn;
  activeAudioCard = cardEl || btn.closest('.card-item');

  setAudioBtnPlaying(btn, true);
  if (activeAudioCard) activeAudioCard.classList.add('playing');

  activeAudioEl.play().catch(e => {
    console.warn('Playback error:', e);
    setAudioBtnPlaying(btn, false);
    if (activeAudioCard) activeAudioCard.classList.remove('playing');
    showToast('Could not play audio');
  });

  activeAudioEl.onended = () => {
    setAudioBtnPlaying(btn, false);
    if (activeAudioCard) activeAudioCard.classList.remove('playing');
    activeAudioEl = null;
    activeAudioBtn = null;
    activeAudioCard = null;
  };
}

/* ── Real-Time Audio & Music Detection (Spotify, SoundCloud, Apple Music/Podcasts, Audio Files) ── */
function detectAudio(url, data) {
  if (!url && !data) return null;
  const cleanUrl = (url || '').trim();

  // 1. Spotify
  const spotifyMatch = cleanUrl.match(/open\.spotify\.com\/(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/i);
  if (spotifyMatch || data?.audioProvider === 'spotify' || cleanUrl.includes('spotify.com')) {
    const type = spotifyMatch ? spotifyMatch[1].toLowerCase() : (data?.audioType || 'track');
    const id = spotifyMatch ? spotifyMatch[2] : (data?.audioId || '');
    return {
      provider: 'spotify',
      audioType: type,
      audioId: id,
      embedUrl: data?.audioEmbedUrl || `https://open.spotify.com/embed/${type}/${id}?utm_source=generator`,
      sourceUrl: cleanUrl,
      platform: 'Spotify',
      thumbnail: data?.heroImg || '',
      artist: data?.author || ''
    };
  }

  // 2. SoundCloud
  const scMatch = cleanUrl.match(/soundcloud\.com\/([a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+)/i);
  if (scMatch || data?.audioProvider === 'soundcloud' || cleanUrl.includes('soundcloud.com')) {
    return {
      provider: 'soundcloud',
      audioType: 'track',
      audioId: scMatch ? scMatch[1] : '',
      embedUrl: data?.audioEmbedUrl || `https://w.soundcloud.com/player/?url=${encodeURIComponent(cleanUrl)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&show_teaser=false`,
      sourceUrl: cleanUrl,
      platform: 'SoundCloud',
      thumbnail: data?.heroImg || '',
      artist: data?.author || 'SoundCloud'
    };
  }

  // 3. Apple Music / Apple Podcasts
  if (cleanUrl.includes('music.apple.com') || cleanUrl.includes('podcasts.apple.com') || data?.audioProvider === 'applemusic' || data?.audioProvider === 'applepodcasts') {
    const isPod = cleanUrl.includes('podcasts.apple.com') || data?.audioProvider === 'applepodcasts';
    const embedUrl = data?.audioEmbedUrl || cleanUrl.replace('music.apple.com', 'embed.music.apple.com').replace('podcasts.apple.com', 'embed.podcasts.apple.com');
    return {
      provider: isPod ? 'applepodcasts' : 'applemusic',
      audioType: isPod ? 'podcast' : 'music',
      embedUrl: embedUrl,
      sourceUrl: cleanUrl,
      platform: isPod ? 'Apple Podcasts' : 'Apple Music',
      thumbnail: data?.heroImg || '',
      artist: data?.author || (isPod ? 'Apple Podcasts' : 'Apple Music')
    };
  }

  // 4. Direct Audio Files (.mp3, .wav, .m4a, .aac, .ogg, .flac)
  if (/\.(mp3|wav|m4a|aac|ogg|flac|opus)(\?.*)?$/i.test(cleanUrl) || data?.audioFileUrl) {
    return {
      provider: 'audiofile',
      audioType: 'audio',
      audioFileUrl: cleanUrl || data?.audioFileUrl,
      sourceUrl: cleanUrl,
      platform: 'Audio File',
      thumbnail: data?.heroImg || '',
      artist: data?.author || 'Audio'
    };
  }

  if (data?.isAudio || data?.type === 'Audio') {
    return {
      provider: data?.audioProvider || 'audio',
      audioType: data?.audioType || 'audio',
      embedUrl: data?.audioEmbedUrl || '',
      audioFileUrl: data?.audioFileUrl || data?.audioUrl || '',
      sourceUrl: cleanUrl,
      platform: data?.audioPlatform || 'Audio',
      thumbnail: data?.heroImg || '',
      artist: data?.author || ''
    };
  }

  return null;
}

/* ── Real-Time Document Detection (arXiv, Research Papers, PDFs, Excel, CSV) ── */
function detectDocument(url, data) {
  if (!url && !data) return null;
  const cleanUrl = (url || '').trim();

  // 1. arXiv Research Paper
  const arxivMatch = cleanUrl.match(/arxiv\.org\/(abs|pdf)\/([0-9]+\.[0-9]+|[a-z\-]+(\.[A-Z]{2})?\/[0-9]+)/i);
  if (arxivMatch || data?.isResearchPaper || data?.arxivId) {
    const arxivId = arxivMatch ? arxivMatch[2].replace('.pdf', '') : (data?.arxivId || '');
    return {
      type: 'paper',
      isResearchPaper: true,
      isPDF: true,
      arxivId: arxivId,
      pdfUrl: data?.pdfUrl || `https://arxiv.org/pdf/${arxivId}.pdf`,
      abstract: data?.abstract || data?.description || '',
      authors: data?.author || '',
      publication: 'arXiv.org'
    };
  }

  // 2. Direct PDF Document
  if (cleanUrl.match(/\.pdf(\?.*)?$/i) || data?.isPDF || data?.docType === 'pdf') {
    return {
      type: 'pdf',
      isPDF: true,
      pdfUrl: data?.pdfUrl || cleanUrl,
      abstract: data?.description || '',
      publication: data?.domain || 'PDF'
    };
  }

  // 3. Spreadsheet / Excel / CSV
  if (cleanUrl.match(/\.(xlsx|xls|csv|tsv|ods)(\?.*)?$/i) || cleanUrl.includes('docs.google.com/spreadsheets') || data?.isSpreadsheet) {
    const ext = cleanUrl.includes('google.com') ? 'sheet' : (cleanUrl.split('.').pop().split('?')[0].toLowerCase() || 'excel');
    return {
      type: 'spreadsheet',
      isSpreadsheet: true,
      docType: ext,
      sheetUrl: cleanUrl,
      publication: data?.domain || 'Spreadsheet'
    };
  }

  if (data?.isDocument || data?.type === 'Document') {
    return {
      type: data?.docType || 'document',
      isDocument: true,
      isPDF: Boolean(data?.isPDF),
      isSpreadsheet: Boolean(data?.isSpreadsheet)
    };
  }

  return null;
}

function formatSocialText(text) {
  if (!text) return '';
  const escaped = escapeHtml(text);
  let formatted = escaped.replace(/(#[a-zA-Z0-9_]+)/g, '<span class="social-hashtag">$1</span>');
  formatted = formatted.replace(/(@[a-zA-Z0-9_.]+)/g, '<span class="social-mention">$1</span>');
  return formatted;
}

/* ── Real-Time Social Post Detection (X/Twitter, Reddit, LinkedIn, Threads, Bluesky, Instagram) ── */
function detectSocialPost(url, data) {
  if (!url && !data) return null;
  const cleanUrl = (url || '').trim();

  // 1. Twitter / X
  const xMatch = cleanUrl.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)\/status\/([0-9]+)/i);
  if (xMatch || data?.socialPlatform === 'x' || (data?.tags && (data.tags.includes('twitter') || data.tags.includes('x')))) {
    const handle = xMatch ? `@${xMatch[1]}` : (data?.socialHandle || '@user');
    const authorName = data?.socialAuthorName || data?.author || (xMatch ? xMatch[1] : 'X User');
    return {
      isSocial: true,
      platform: 'x',
      platformLabel: '𝕏 Post',
      handle: handle,
      authorName: authorName,
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || '',
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || 0,
      reposts: data?.retweets || data?.socialReposts || 0,
      replies: data?.replies || data?.socialReplies || 0,
      url: cleanUrl
    };
  }

  // 2. Reddit
  const redditMatch = cleanUrl.match(/reddit\.com\/r\/([a-zA-Z0-9_]+)(?:\/comments\/([a-zA-Z0-9]+)(?:\/([a-zA-Z0-9_]+)?)?)?/i);
  if (redditMatch || data?.socialPlatform === 'reddit' || (data?.tags && data.tags.includes('reddit'))) {
    const sub = redditMatch ? `r/${redditMatch[1]}` : (data?.socialHandle || 'Reddit');
    let title = data?.title || '';
    if ((!title || title.includes('Reddit')) && redditMatch && redditMatch[3]) {
      title = redditMatch[3].split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return {
      isSocial: true,
      platform: 'reddit',
      platformLabel: 'Reddit',
      handle: sub,
      authorName: data?.socialAuthorName || data?.author || sub,
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || title,
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || data?.ups || 0,
      reposts: 0,
      replies: data?.replies || data?.socialReplies || data?.numComments || 0,
      url: cleanUrl
    };
  }

  // 3. LinkedIn
  const liMatch = cleanUrl.match(/linkedin\.com\/(?:posts|feed\/update|pulse)\/([a-zA-Z0-9_-]+)/i);
  if (liMatch || data?.socialPlatform === 'linkedin' || (data?.tags && data.tags.includes('linkedin'))) {
    return {
      isSocial: true,
      platform: 'linkedin',
      platformLabel: 'LinkedIn',
      handle: data?.socialHandle || 'LinkedIn',
      authorName: data?.socialAuthorName || data?.author || 'LinkedIn Post',
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || data?.title || '',
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || 0,
      reposts: data?.retweets || data?.socialReposts || 0,
      replies: data?.replies || data?.socialReplies || 0,
      url: cleanUrl
    };
  }

  // 4. Threads
  const thMatch = cleanUrl.match(/threads\.net\/@([a-zA-Z0-9_.]+)(?:\/post\/([a-zA-Z0-9_-]+))?/i);
  if (thMatch || data?.socialPlatform === 'threads' || (data?.tags && data.tags.includes('threads'))) {
    const handle = thMatch ? `@${thMatch[1]}` : (data?.socialHandle || '@user');
    return {
      isSocial: true,
      platform: 'threads',
      platformLabel: 'Threads',
      handle: handle,
      authorName: data?.socialAuthorName || data?.author || (thMatch ? thMatch[1] : 'Threads User'),
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || '',
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || 0,
      reposts: data?.retweets || data?.socialReposts || 0,
      replies: data?.replies || data?.socialReplies || 0,
      url: cleanUrl
    };
  }

  // 5. Bluesky
  const bskyMatch = cleanUrl.match(/bsky\.app\/profile\/([a-zA-Z0-9_.]+)\/post\/([a-zA-Z0-9_-]+)/i);
  if (bskyMatch || data?.socialPlatform === 'bluesky' || (data?.tags && data.tags.includes('bluesky'))) {
    const handle = bskyMatch ? `@${bskyMatch[1]}` : (data?.socialHandle || '@user');
    return {
      isSocial: true,
      platform: 'bluesky',
      platformLabel: 'Bluesky',
      handle: handle,
      authorName: data?.socialAuthorName || data?.author || (bskyMatch ? bskyMatch[1] : 'Bluesky User'),
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || '',
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || 0,
      reposts: data?.retweets || data?.socialReposts || 0,
      replies: data?.replies || data?.socialReplies || 0,
      url: cleanUrl
    };
  }

  // 6. Instagram
  const igMatch = cleanUrl.match(/instagram\.com\/(?:p|reel)\/([a-zA-Z0-9_-]+)/i);
  if (igMatch || data?.socialPlatform === 'instagram' || (data?.tags && data.tags.includes('instagram'))) {
    return {
      isSocial: true,
      platform: 'instagram',
      platformLabel: 'Instagram',
      handle: data?.socialHandle || '@instagram',
      authorName: data?.socialAuthorName || data?.author || 'Instagram',
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || data?.title || '',
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || 0,
      reposts: 0,
      replies: data?.replies || data?.socialReplies || 0,
      url: cleanUrl
    };
  }

  if (data?.isSocial || data?.type === 'social') {
    return {
      isSocial: true,
      platform: data?.socialPlatform || 'social',
      platformLabel: (data?.socialPlatform || 'Social').toUpperCase(),
      handle: data?.socialHandle || '@user',
      authorName: data?.socialAuthorName || data?.author || 'User',
      avatar: data?.socialAvatar || '',
      text: data?.socialText || data?.description || data?.body || '',
      mediaUrl: data?.heroImg || data?.socialMediaUrl || '',
      likes: data?.likes || data?.socialLikes || 0,
      reposts: data?.retweets || data?.socialReposts || 0,
      replies: data?.replies || data?.socialReplies || 0,
      url: cleanUrl
    };
  }

  return null;
}

function renderSpreadsheetTable(tableEl, rows) {
  if (!tableEl) return;
  if (!rows || rows.length === 0) {
    tableEl.innerHTML = '<tbody><tr><td style="padding:24px; text-align:center; color:#8e8e93;">No data rows available in spreadsheet</td></tr></tbody>';
    return;
  }
  const headers = rows[0] || [];
  const bodyRows = rows.slice(1, 150);

  let html = '<thead><tr>';
  headers.forEach((h, idx) => {
    html += `<th>${escapeHtml(String(h || `Column ${idx + 1}`))}</th>`;
  });
  html += '</tr></thead><tbody>';

  bodyRows.forEach(r => {
    html += '<tr>';
    for (let c = 0; c < headers.length; c++) {
      const cellVal = r && r[c] !== undefined && r[c] !== null ? String(r[c]) : '';
      html += `<td>${escapeHtml(cellVal)}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody>';
  tableEl.innerHTML = html;
}

function filterSpreadsheetTable(tableEl, query) {
  if (!tableEl) return;
  const trs = tableEl.querySelectorAll('tbody tr');
  trs.forEach(tr => {
    const text = tr.textContent.toLowerCase();
    tr.style.display = !query || text.includes(query) ? '' : 'none';
  });
}

async function handleDocumentFileUpload(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  const baseName = file.name.replace(/\.[^/.]+$/, '');
  const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
  const sizeStr = file.size > 1024 * 1024 ? `${sizeMB} MB` : `${Math.round(file.size / 1024)} KB`;

  // 1. Excel / Spreadsheet / CSV files
  if (['xlsx', 'xls', 'csv', 'tsv', 'ods'].includes(ext)) {
    showToast(`Parsing spreadsheet "${file.name}"…`);
    const reader = new FileReader();
    reader.onload = async (e) => {
      let tableData = [];
      let sheetName = 'Sheet1';
      try {
        if (typeof XLSX !== 'undefined') {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          sheetName = workbook.SheetNames[0] || 'Sheet1';
          const worksheet = workbook.Sheets[sheetName];
          tableData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) || [];
        } else if (ext === 'csv' || ext === 'tsv') {
          const text = new TextDecoder().decode(e.target.result);
          const sep = ext === 'tsv' ? '\t' : ',';
          tableData = text.split('\n').map(line => line.split(sep));
        }
      } catch (err) {
        console.warn('Excel parse note:', err);
      }

      const rowCount = tableData.length > 0 ? tableData.length - 1 : 0;
      const colCount = tableData.length > 0 ? (tableData[0] ? tableData[0].length : 0) : 0;
      const now = new Date();
      const memId = 'doc_' + Date.now();
      const mem = {
        id: memId,
        type: 'Document',
        contentType: 'Document',
        isDocument: true,
        isSpreadsheet: true,
        docType: ext,
        title: baseName,
        sheetName: sheetName,
        rowCount: rowCount,
        colCount: colCount,
        fileSize: sizeStr,
        tableData: tableData.slice(0, 300),
        tags: ['document', 'spreadsheet', ext, 'data'],
        date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        dateDetail: now.toLocaleString(),
        createdAt: Date.now(),
        userId: window.firebaseSync && window.firebaseSync.currentUser ? window.firebaseSync.currentUser.uid : null
      };

      EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
      renderCardInGrid(mem, true);
      updateMemoryCount();
      showToast(`Spreadsheet saved: "${baseName}" (${rowCount} rows)`);
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  // 2. PDF Document / Research Paper
  if (ext === 'pdf') {
    showToast(`Processing PDF document "${file.name}"…`);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      let pageCount = 1;
      let thumbnailDataUrl = '';
      let extractedText = '';

      try {
        if (typeof pdfjsLib !== 'undefined') {
          const typedArray = new Uint8Array(e.target.result);
          const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
          pageCount = pdf.numPages || 1;
          const page = await pdf.getPage(1);
          const textContent = await page.getTextContent();
          extractedText = textContent.items.map(it => it.str).join(' ').slice(0, 500);

          // Render Page 1 to canvas for crisp thumbnail
          const viewport = page.getViewport({ scale: 1.2 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport: viewport }).promise;
          thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        }
      } catch (pdfErr) {
        console.warn('PDF.js render note:', pdfErr);
      }

      // Fallback dataURL reader for viewer
      const blobReader = new FileReader();
      blobReader.onload = async (be) => {
        const fullPdfDataUrl = be.target.result;
        const now = new Date();
        const memId = 'doc_' + Date.now();
        const isPaper = file.name.toLowerCase().includes('paper') || file.name.toLowerCase().includes('arxiv') || extractedText.toLowerCase().includes('abstract');
        const mem = {
          id: memId,
          type: 'Document',
          contentType: 'Document',
          isDocument: true,
          isPDF: true,
          isResearchPaper: isPaper,
          docType: isPaper ? 'paper' : 'pdf',
          title: baseName,
          subtitle: extractedText ? extractedText.slice(0, 160) + '…' : `PDF Document • ${pageCount} pages`,
          tldr: extractedText ? extractedText.slice(0, 220) : `PDF Document (${pageCount} pages)`,
          body: extractedText,
          pdfUrl: fullPdfDataUrl,
          docUrl: fullPdfDataUrl,
          pageCount: pageCount,
          fileSize: sizeStr,
          heroImg: thumbnailDataUrl || '',
          tags: ['document', 'pdf', isPaper ? 'research' : 'file'],
          date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
          dateDetail: now.toLocaleString(),
          createdAt: Date.now(),
          userId: window.firebaseSync && window.firebaseSync.currentUser ? window.firebaseSync.currentUser.uid : null
        };

        EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
        renderCardInGrid(mem, true);
        updateMemoryCount();
        showToast(`Document saved: "${baseName}" (${pageCount} pages)`);
      };
      blobReader.readAsDataURL(file);
    };
    reader.readAsArrayBuffer(file);
    return;
  }

  // 3. Text / Word / Markdown
  const textReader = new FileReader();
  textReader.onload = async (e) => {
    processPastedText(e.target.result);
  };
  textReader.readAsText(file);
}

async function handleAudioFileUpload(file) {
  if (!file) return;
  showToast('Processing audio file…');
  const reader = new FileReader();
  reader.onloadend = async () => {
    const audioDataUrl = reader.result;
    let dur = 0;
    try {
      const tempAudio = new Audio(audioDataUrl);
      await new Promise(r => {
        tempAudio.onloadedmetadata = () => { dur = tempAudio.duration || 0; r(); };
        tempAudio.onerror = () => r();
        setTimeout(r, 1200);
      });
    } catch(e) {}
    const baseName = file.name.replace(/\.[^/.]+$/, '');
    const now = new Date();
    const mem = {
      id: `audio_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      type: 'Audio',
      contentType: 'Audio',
      isAudio: true,
      title: baseName,
      body: `Audio file: ${file.name}`,
      audioUrl: audioDataUrl,
      audioFileUrl: audioDataUrl,
      audioPlatform: 'Audio File',
      duration: dur,
      tags: ['audio', 'music'],
      createdAt: now.toISOString(),
      modifiedAt: now.toISOString(),
      userId: window.firebaseSync && window.firebaseSync.currentUser ? window.firebaseSync.currentUser.uid : null
    };
    EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
    renderCardInGrid(mem, true);
    updateMemoryCount();
    showToast(`Audio saved: "${baseName}"`);
  };
  reader.readAsDataURL(file);
}

/* ── Populate Card Content (Quote, Article, Note, Product, Image, Audio, Document) ── */
function populateCardContent(card, mem) {
  const isDocument = Boolean(mem.isDocument || mem.type === 'Document' || mem.isPDF || mem.isSpreadsheet || mem.isResearchPaper || mem.pdfUrl || (mem.tags && (mem.tags.includes('document') || mem.tags.includes('paper') || mem.tags.includes('spreadsheet') || mem.tags.includes('excel'))));
  const isAudio = Boolean(!isDocument && (mem.isAudio || mem.type === 'Audio' || mem.type === 'audio' || mem.audioUrl || mem.audioEmbedUrl || (mem.tags && (mem.tags.includes('audio') || mem.tags.includes('music') || mem.tags.includes('spotify')))));

  // Document (PDF, Research Paper, Excel, CSV) Card Layout
  if (isDocument) {
    card.classList.add('card-document-layout');
    const isArxiv = Boolean(mem.arxivId || mem.isResearchPaper);
    const isPDF = Boolean(mem.isPDF || mem.docType === 'pdf' || isArxiv);
    const isSheet = Boolean(mem.isSpreadsheet || mem.docType === 'xlsx' || mem.docType === 'xls' || mem.docType === 'csv');
    const badgeText = isArxiv ? 'ARXIV' : (isPDF ? 'PDF' : (isSheet ? (mem.docType || 'EXCEL').toUpperCase() : 'DOC'));
    const badgeClass = isArxiv ? 'arxiv' : (isPDF ? 'pdf' : (isSheet ? 'excel' : 'pdf'));
    const titleText = mem.title || 'Document';
    const subText = mem.author || mem.authors || mem.publication || (isSheet ? (mem.sheetName || 'Spreadsheet') : 'Document');
    const metaStr = isSheet ? `${mem.rowCount || 0} rows • ${mem.colCount || 0} cols` : (mem.pageCount ? `${mem.pageCount} pages` : (mem.fileSize || 'Document'));
    const hasCover = Boolean(mem.heroImg && (mem.heroImg.startsWith('http') || mem.heroImg.startsWith('data:')));

    card.innerHTML = `
      <button class="card-trash-btn" title="Remove document">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <div class="doc-card-cover">
        <div class="doc-badge-pill ${badgeClass}">${badgeText}</div>
        ${hasCover ? `<img src="${mem.heroImg}" loading="lazy" decoding="async" alt="${escapeHtml(titleText)}" />` : `
          <div class="doc-card-fallback-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
        `}
      </div>
      <div class="doc-card-info">
        <div class="doc-card-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>
        <div class="doc-card-authors">${escapeHtml(subText)}</div>
        <div class="doc-card-meta-line">
          <span>${escapeHtml(metaStr)}</span>
          <span>${escapeHtml(mem.date || '')}</span>
        </div>
      </div>
    `;
    return;
  }

  // Audio / Spotify / SoundCloud / Music Card Layout
  if (isAudio) {
    card.classList.add('card-audio-layout');
    const isSpotify = mem.audioProvider === 'spotify' || (mem.audioPlatform && mem.audioPlatform.toLowerCase() === 'spotify') || (mem.source && mem.source.includes('spotify.com'));
    const isSoundCloud = mem.audioProvider === 'soundcloud' || (mem.source && mem.source.includes('soundcloud.com'));
    const hasArt = Boolean(mem.heroImg && (mem.heroImg.startsWith('http') || mem.heroImg.startsWith('data:')));
    const platformLabel = isSpotify ? 'SPOTIFY' : (isSoundCloud ? 'SOUNDCLOUD' : (mem.audioPlatform ? mem.audioPlatform.toUpperCase() : 'AUDIO'));
    const badgeColorClass = isSpotify ? 'spotify' : (isSoundCloud ? 'soundcloud' : '');
    const titleText = mem.title || 'Audio Memory';
    const subText = mem.artist || mem.author || mem.tldr || mem.body || (isSpotify ? 'Spotify' : 'Audio');
    const durStr = mem.duration ? formatAudioDuration(mem.duration) : '';

    if (hasArt) {
      // Rich Album Artwork Layout
      card.classList.add('card-audio-artwork');
      card.innerHTML = `
        <button class="card-trash-btn" title="Remove audio">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
          </svg>
        </button>
        <div class="audio-card-art-box">
          <img src="${mem.heroImg}" loading="lazy" decoding="async" alt="${escapeHtml(titleText)}" />
          <div class="audio-card-play-overlay">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3" />
            </svg>
          </div>
          <div class="audio-badge-pill ${badgeColorClass}">
            ${isSpotify ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>` : `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>`}
            <span>${platformLabel}</span>
          </div>
        </div>
        <div class="audio-card-info">
          <div class="audio-card-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>
          <div class="audio-card-artist">${escapeHtml(subText)}</div>
        </div>
      `;
      return;
    }

    // Direct Audio / Waveform Layout
    let barsHtml = '';
    const heights = [35, 60, 45, 80, 100, 70, 50, 90, 65, 40, 75, 95, 85, 60, 45, 80, 55, 70, 90, 60, 45, 75, 50, 65, 40, 30];
    for (let i = 0; i < heights.length; i++) {
      barsHtml += `<span class="audio-waveform-bar" style="height:${heights[i]}%;"></span>`;
    }

    card.innerHTML = `
      <button class="card-trash-btn" title="Remove audio">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <div class="audio-card-header">
        <div class="audio-badge-pill ${badgeColorClass}">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
          <span>${platformLabel}</span>
        </div>
        ${durStr ? `<span class="audio-duration-pill">${durStr}</span>` : ''}
      </div>
      <div class="audio-player-control">
        <button class="audio-play-btn" data-audio-src="${escapeHtml(mem.audioFileUrl || mem.audioUrl || '')}" title="Play audio">
          <svg class="play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          <svg class="pause-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
        </button>
        <div class="audio-waveform-visualizer">
          ${barsHtml}
        </div>
      </div>
      <div class="audio-card-title" title="${escapeHtml(titleText)}">${escapeHtml(titleText)}</div>
      <div class="audio-card-meta">${escapeHtml(subText)}</div>
    `;
    return;
  }

  // Social Post Card Layout (X/Twitter, Reddit, LinkedIn, Threads, Bluesky, Instagram)
  const isSocial = Boolean(!isDocument && !isAudio && (mem.isSocial || mem.socialPlatform || mem.type === 'social' || (mem.tags && mem.tags.includes('social'))));
  if (isSocial) {
    card.classList.add('card-social-layout');
    const platform = (mem.socialPlatform || 'x').toLowerCase();
    const platformBadgeClass = ['x', 'reddit', 'linkedin', 'threads', 'bluesky', 'instagram'].includes(platform) ? platform : 'x';
    const platformLabel = mem.socialPlatformLabel || (platform === 'x' ? '𝕏 Post' : platform.toUpperCase());
    const authorName = mem.socialAuthorName || mem.author || 'Social User';
    const handle = mem.socialHandle || (authorName.startsWith('@') || authorName.startsWith('r/') ? authorName : `@${authorName}`);
    const avatar = mem.socialAvatar || '';
    const initial = (authorName.replace(/^[@r/]+/, '')[0] || 'S').toUpperCase();
    const bodyText = mem.socialText || mem.body || mem.title || '';
    const hasMedia = Boolean(mem.heroImg || mem.socialMediaUrl);
    const mediaUrl = mem.heroImg || mem.socialMediaUrl || '';
    const likes = mem.socialLikes || mem.likes || 0;
    const reposts = mem.socialReposts || mem.retweets || 0;
    const replies = mem.socialReplies || mem.replies || 0;
    const isLiked = Boolean(mem.isLiked);

    const isInstagram = platform === 'instagram';
    const isLongText = Boolean(bodyText && bodyText.length > 220);

    if (hasMedia) {
      card.classList.add('has-media');
    }

    card.innerHTML = `
      <button class="card-trash-btn" title="Remove post">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <button class="card-heart-btn ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Unlike' : 'Like'}">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="${isLiked ? '#ff3b30' : 'none'}" stroke="${isLiked ? '#ff3b30' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
        </svg>
      </button>
      <div class="social-card-header">
        <div class="social-avatar-wrap">
          ${avatar ? `<img src="${avatar}" class="social-avatar" loading="lazy" alt="${escapeHtml(authorName)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />` : ''}
          <div class="social-avatar-fallback" style="${avatar ? 'display:none;' : ''}">${escapeHtml(initial)}</div>
        </div>
        <div class="social-author-info">
          <div class="social-author-name" title="${escapeHtml(authorName)}">${escapeHtml(authorName)}</div>
          <div class="social-author-handle">${escapeHtml(handle)}</div>
        </div>
        <div class="social-badge-pill ${platformBadgeClass}">${escapeHtml(platformLabel)}</div>
      </div>
      <div class="social-card-body">${formatSocialText(bodyText)}</div>
      ${isLongText ? `<div class="social-read-more-hint">Read full post →</div>` : ''}
      ${isInstagram && !hasMedia ? `
        <div class="social-ig-placeholder-banner">
          <div class="social-ig-gradient-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
          </div>
          <div class="social-ig-cta">
            <span class="social-ig-cta-title">Instagram Post</span>
            <span class="social-ig-cta-sub">Tap to open preview</span>
          </div>
        </div>
      ` : ''}
      ${hasMedia ? `
        <div class="social-card-media">
          <img src="${mediaUrl}" loading="lazy" alt="Media" onerror="this.parentElement.style.display='none';" />
        </div>
      ` : ''}
      <div class="social-card-footer">
        <div class="social-stats-line">
          ${likes > 0 ? `
            <span class="social-stat-unit" title="Likes">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
              <span>${likes >= 1000 ? (likes / 1000).toFixed(1) + 'k' : likes}</span>
            </span>
          ` : ''}
          ${reposts > 0 ? `
            <span class="social-stat-unit" title="Reposts">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
              <span>${reposts >= 1000 ? (reposts / 1000).toFixed(1) + 'k' : reposts}</span>
            </span>
          ` : ''}
          ${replies > 0 ? `
            <span class="social-stat-unit" title="Replies">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>${replies >= 1000 ? (replies / 1000).toFixed(1) + 'k' : replies}</span>
            </span>
          ` : ''}
        </div>
        <span class="social-time-label">${escapeHtml(mem.date || '')}</span>
      </div>
    `;
    return;
  }

  // Code Snippet, Code File, or Developer Repository Layout
  const isCode = Boolean(mem.isCode || mem.type === 'Code' || mem.codeSnippet || (mem.tags && mem.tags.includes('code')));
  if (isCode) {
    card.classList.add('card-code-layout');
    const codeText = mem.codeSnippet || mem.codeText || mem.body || '';
    const lang = mem.codeLanguage || detectCodeLanguage(codeText, mem.codeFilename || mem.title);
    const filename = mem.codeFilename || mem.title || 'snippet';
    const isRepoCard = Boolean(mem.isRepo && !mem.codeSnippet);
    const lines = codeText ? codeText.split('\n') : [];
    const lineCount = mem.codeLines || lines.length || 1;
    const previewLines = lines.slice(0, 8).join('\n');
    const previewHighlighted = formatCodePreview(previewLines, lang);
    const gutterCount = Math.min(Math.max(lineCount, 1), 8);
    let gutterHtml = '';
    for (let i = 1; i <= gutterCount; i++) {
      gutterHtml += `<span>${i}</span>`;
    }
    const safeLangClass = (lang || 'code').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (isRepoCard) {
      const repoDesc = mem.subtitle || mem.tldr || mem.body || `GitHub repository ${mem.codeRepo || filename}`;
      const hasBanner = Boolean(mem.heroImg && mem.heroImg.startsWith('http'));
      card.innerHTML = `
        <button class="card-trash-btn" title="Remove repository">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
          </svg>
        </button>
        <div class="code-card-header">
          <span class="code-card-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
              <path d="M9 18c-4.51 2-5-2-7-2"/>
            </svg>
          </span>
          <div class="code-card-filename" title="${escapeHtml(mem.codeRepo || filename)}">${escapeHtml(mem.codeRepo || filename)}</div>
          <div class="code-lang-pill lang-repo">REPO</div>
        </div>
        ${hasBanner ? `<div class="code-repo-banner"><img src="${mem.heroImg}" loading="lazy" decoding="async" alt="${escapeHtml(filename)}" onerror="this.parentElement.style.display='none';" /></div>` : ''}
        <div class="code-repo-desc">${escapeHtml(repoDesc)}</div>
        <div class="code-card-footer">
          <div class="code-card-meta">
            <span>github.com</span>
          </div>
          <span class="code-card-date">${escapeHtml(mem.date || '')}</span>
        </div>
      `;
      return;
    }

    card.innerHTML = `
      <button class="card-trash-btn" title="Remove code">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <div class="code-card-header">
        <span class="code-card-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </span>
        <div class="code-card-filename" title="${escapeHtml(filename)}">${escapeHtml(filename)}</div>
        <div class="code-lang-pill lang-${safeLangClass}">${escapeHtml(lang)}</div>
      </div>
      <div class="code-card-body">
        <div class="code-card-gutter">${gutterHtml}</div>
        <pre class="code-card-pre"><code>${previewHighlighted}</code></pre>
      </div>
      <div class="code-card-footer">
        <div class="code-card-meta">
          <span>${lineCount} ${lineCount === 1 ? 'line' : 'lines'}</span>
          ${mem.codeRepo ? `<span> • ${escapeHtml(mem.codeRepo)}</span>` : ''}
        </div>
        <button class="code-card-quick-copy" title="Copy code snippet">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          <span>Copy</span>
        </button>
      </div>
    `;

    const copyBtn = card.querySelector('.code-card-quick-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(codeText).then(() => {
          showToast(`Copied "${filename}" code to clipboard`);
          const span = copyBtn.querySelector('span');
          if (span) {
            span.textContent = 'Copied!';
            setTimeout(() => { span.textContent = 'Copy'; }, 1500);
          }
        });
      });
    }
    return;
  }
  const isVideo = Boolean(mem.isVideo || mem.type === 'Video' || mem.type === 'video' || (mem.tags && mem.tags.includes('video')));
  const hasImg = Boolean(mem.heroImg && (mem.heroImg.startsWith('http') || mem.heroImg.startsWith('data:')));
  // Visual memories with an image must ALWAYS render as image cards, never as text-only quote cards!
  const isQuote = Boolean(!isVideo && !hasImg && (mem.isQuote || mem.type === 'Quote' || mem.type === 'quote'));
  const isNote = Boolean(!isVideo && !isQuote && !hasImg && (mem.isNote || mem.type === 'Note' || mem.type === 'note'));
  const isArticle = Boolean(!isVideo && !isQuote && !isNote && (mem.type === 'Article' || mem.type === 'article' || mem.isArticle || (mem.tags && mem.tags.includes('article'))));
  const isLiked = Boolean(mem.isLiked);

  // 0. Video Card Layout (mymind style)
  if (isVideo) {
    card.classList.add('card-video-layout');
    const heroImg = mem.heroImg || (mem.videoId ? `https://img.youtube.com/vi/${mem.videoId}/hqdefault.jpg` : '');
    const channelName = mem.author || mem.channel || getDisplaySource(mem.source) || 'Video';
    card.innerHTML = `
      <button class="card-trash-btn" title="Remove video">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <div class="video-card-media">
        ${heroImg ? `<img src="${heroImg}" loading="lazy" decoding="async" alt="${escapeHtml(mem.title)}" onerror="this.onerror=null; if(this.src.includes('maxresdefault')) this.src=this.src.replace('maxresdefault','hqdefault');" />` : `<div style="width:100%; height:100%; background:#111317;"></div>`}
        <div class="video-play-overlay">
          <svg width="22" height="22" viewBox="0 0 24 24">
            <polygon points="6 3 20 12 6 21 6 3" />
          </svg>
        </div>
        <div class="video-badge-pill">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>VIDEO</span>
        </div>
      </div>
      <div class="video-card-bottom">
        <div class="video-card-title" title="${escapeHtml(mem.title)}">${escapeHtml(mem.title)}</div>
        <div class="video-card-channel">${escapeHtml(channelName)}</div>
      </div>
    `;
    return;
  }

  // 1. Quote Card Layout (Matching User Image 1)
  if (isQuote) {
    card.classList.add('card-quote-layout');
    const quoteText = mem.quote || mem.title || mem.body || mem.tldr || '';
    const captionText = (mem.attribution || (mem.source !== 'Quote' && mem.source !== 'Local' && !mem.source.startsWith('data:') ? mem.source : '')).trim();
    card.innerHTML = `
      <div class="card-quote-box">
        <button class="card-trash-btn" title="Remove quote">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
          </svg>
        </button>
        <button class="card-heart-btn ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Unlike' : 'Like'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isLiked ? '#ff3b30' : 'none'}" stroke="${isLiked ? '#ff3b30' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
        <div class="quote-mark quote-mark-top">&ldquo;</div>
        <div class="quote-body-text">${escapeHtml(quoteText)}</div>
        <div class="quote-mark quote-mark-bottom">&rdquo;</div>
      </div>
      ${captionText ? `<div class="card-quote-caption">${escapeHtml(captionText)}</div>` : ''}
    `;
    return;
  }

  // 2. Article Card Layout
  if (isArticle) {
    card.classList.add('card-article-layout');
    const caption = mem.tldr || mem.title;
    const publicationName = mem.publication || mem.author || getDisplaySource(mem.source) || 'Article';
    const excerpt = mem.body || mem.subtitle || '';

    card.innerHTML = `
      <button class="card-trash-btn" title="Remove memory">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <div class="article-card-top">
        <div class="article-card-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6e7382" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="8" y1="13" x2="16" y2="13"/>
            <line x1="8" y1="17" x2="13" y2="17"/>
          </svg>
        </div>
        <div class="article-card-title" title="${escapeHtml(caption)}">${escapeHtml(caption)}</div>
      </div>
      ${hasImg ? `
      <div class="article-card-media">
        <img src="${mem.heroImg}" loading="lazy" decoding="async" alt="${escapeHtml(mem.title)}" style="max-height:220px; object-fit:cover; width:100%; display:block;" />
        <div class="card-article-pill" title="Open Article">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="m9 15 6-6M9 9h6v6" />
          </svg>
          <span>ARTICLE</span>
        </div>
      </div>` : `
      <div style="padding:14px 16px; background:#fbfbfe; border-top:1px solid rgba(0,0,0,0.04); display:flex; flex-direction:column; gap:8px;">
        <div style="font-size:11px; font-weight:600; color:#8e8e93; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(publicationName)}</div>
        ${excerpt ? `<div style="font-size:12.5px; color:#555d6e; line-height:1.45; max-height:60px; overflow:hidden;">${escapeHtml(excerpt)}</div>` : ''}
        <div style="display:flex; align-items:center; justify-content:space-between; margin-top:4px;">
          <div class="card-article-pill" style="position:static; margin:0;" title="Open Article">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="m9 15 6-6M9 9h6v6" />
            </svg>
            <span>ARTICLE</span>
          </div>
          <span style="font-size:11px; color:#a0aec0;">Reading mode</span>
        </div>
      </div>`}
    `;
    return;
  }

  // 3. Local Note Layout
  if (isNote) {
    card.classList.add('card-saved-note');
    card.innerHTML = `
      <button class="card-trash-btn" title="Remove note">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
        </svg>
      </button>
      <div class="saved-note-title">${escapeHtml(mem.title)}</div>
      <div class="saved-note-body">${escapeHtml(mem.body || mem.tldr || '')}</div>
      <div class="saved-note-footer">
        <span class="saved-note-date">${mem.date || 'Nov 19, 2026'}</span>
        <div class="saved-note-badge">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/></svg>
          <span>NOTE</span>
        </div>
      </div>
    `;
    return;
  }

  // 4. Standard Product, Web, or Image Card
  const caption = mem.tldr || mem.title;
  const displayDomain = getDisplaySource(mem.source);
  const sourceText = mem.price ? `${escapeHtml(displayDomain)} • ${escapeHtml(mem.price)}` : escapeHtml(displayDomain);
  const isWebLink = Boolean(mem.source && !mem.source.startsWith('data:') && !mem.source.startsWith('blob:') && mem.source !== 'Local Note' && mem.source !== 'Clipboard' && mem.source !== 'Saved');

  const imgHtml = hasImg
    ? `<img src="${mem.heroImg}" loading="lazy" decoding="async" alt="${escapeHtml(mem.title)}" style="max-height:260px; object-fit:cover;" />`
    : `<div style="padding:18px 16px; min-height:130px; background:#fbfbfe; display:flex; flex-direction:column; justify-content:center;">
         <div style="font-size:10px; font-weight:700; color:#ff8500; letter-spacing:0.05em; text-transform:uppercase;">${escapeHtml(mem.type || 'SAVED ITEM')}</div>
         <div style="font-size:14px; font-weight:600; color:#1c1c1e; margin-top:5px; line-height:1.35;">${escapeHtml(mem.title)}</div>
         ${mem.price ? `<div style="font-size:13px; font-weight:700; color:#28c840; margin-top:6px;">${escapeHtml(mem.price)}</div>` : ''}
         ${mem.body ? `<div style="font-size:12px; color:#6e6e73; margin-top:5px; line-height:1.4; max-height:50px; overflow:hidden;">${escapeHtml(mem.body)}</div>` : ''}
       </div>`;

  card.innerHTML = `
    <button class="card-trash-btn" title="Remove memory">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />
      </svg>
    </button>
    ${imgHtml}
    <div class="card-footer-overlay" style="${hasImg ? '' : 'position:relative; background:transparent; padding:8px 12px;'}">
      <div class="card-footer-info">
        <div class="card-footer-title" style="${hasImg ? '' : 'color:#1c1c1e; text-shadow:none;'}" title="${escapeHtml(caption)}">${escapeHtml(caption)}</div>
        <div class="card-footer-source" style="${hasImg ? '' : 'color:#8e8e93; text-shadow:none;'}" title="${isWebLink ? 'Open source link in new tab' : ''}">${sourceText}</div>
      </div>
      <div class="card-actions">
        ${isWebLink ? `
        <button class="card-link-btn" title="Open source in new tab" style="${hasImg ? '' : 'color:#8e8e93;'}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="m9 15 6-6M9 9h6v6" />
          </svg>
        </button>` : ''}
        <button class="card-heart-btn ${isLiked ? 'liked' : ''}" title="${isLiked ? 'Unlike' : 'Like'}" style="${hasImg ? '' : 'color:#8e8e93;'}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isLiked ? '#ff3b30' : 'none'}" stroke="${isLiked ? '#ff3b30' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </button>
      </div>
    </div>
  `;
}

/* ── Create and Save Quote ── */
function createAndSaveQuote(quoteText, attribution, placeholder = null, customTags = null, customTldr = null) {
  const id = 'quote_' + Date.now();
  if (!placeholder) {
    placeholder = createSavingPlaceholder(id);
  } else {
    placeholder.dataset.id = id;
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = dateStr + ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const attr = (attribution || '').trim();
  const allTags = Array.from(new Set([
    'quote',
    ...(attr ? [attr.toLowerCase()] : []),
    'inspiration',
    'typography',
    ...(customTags || [])
  ]));

  const newMem = {
    id,
    type: 'Quote',
    contentType: 'Quote',
    isQuote: true,
    title: quoteText,
    quote: quoteText,
    attribution: attr,
    body: attr ? `"${quoteText}" — ${attr}` : `"${quoteText}"`,
    tldr: customTldr || quoteText,
    source: attr || 'Quote',
    date: dateStr,
    dateDetail: timeStr,
    heroImg: '',
    palette: ['#FFFFFF', '#F2F2F7', '#D1D1D6', '#8E8E93', '#1C1C1E'],
    tags: allTags,
    isLiked: false,
    createdAt: Date.now()
  };

  EXACT_CARDS_DATA[id] = newMem;
  saveUserMemory(newMem);

  setTimeout(() => {
    morphPlaceholderToMemory(placeholder, newMem);
    showToast(attr ? `Quote saved: "${attr}"` : 'Quote saved');
  }, 320);
}

/* ── Create and Save Note ── */
function createAndSaveNote(title, body, placeholder = null, customTags = null, customTldr = null) {
  const quoteData = detectQuote(body || title);
  if (quoteData && !customTags) {
    createAndSaveQuote(quoteData.quoteText, quoteData.attribution, placeholder);
    return;
  }

  const id = 'note_' + Date.now();
  if (!placeholder) {
    placeholder = createSavingPlaceholder(id);
  } else {
    placeholder.dataset.id = id;
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const allTags = Array.from(new Set([
    'note',
    'text',
    ...(customTags || ['macOS'])
  ]));

  const newMem = {
    id,
    isNote: true,
    type: 'Note',
    contentType: 'Note',
    title: title || 'Untitled Note',
    body: body || '',
    date: dateStr,
    dateDetail: timeStr,
    tldr: customTldr || body || title,
    source: 'Local Note',
    heroImg: '',
    palette: ['#FFFFFF', '#F2F2F7', '#D1D1D6', '#8E8E93', '#1C1C1E'],
    tags: allTags,
    peopleCount: 0,
    hasAnimals: false
  };

  EXACT_CARDS_DATA[id] = newMem;
  saveUserMemory(newMem);

  setTimeout(() => {
    morphPlaceholderToMemory(placeholder, newMem);
    showToast(`Note saved: "${newMem.title}"`);
  }, 280);
}

/* ── Render Note Card in Grid ── */
function renderNoteCardInGrid(mem) {
  renderCardInGrid(mem, true);
}

/* ── Clear Grid on Sign Out ── */
function clearGridOnSignOut() {
  document.querySelectorAll('.card-item[data-id]').forEach(c => c.remove());
  for (const k of Object.keys(EXACT_CARDS_DATA)) {
    delete EXACT_CARDS_DATA[k];
  }
  activeCardId = null;
  reflowMasonry();
  updateMemoryCount();
}
window.clearGridOnSignOut = clearGridOnSignOut;

/* ── Render newly pasted/created card in Grid ── */
function renderCardInGrid(mem, prepend = true) {
  const DEMO_IDS = new Set([
    'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
    'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
    'believe', 'redbull', 'memo', 'gtavi_hero'
  ]);
  if (!mem || !mem.id || DEMO_IDS.has(mem.id) || mem.isDemo) return;
  const col0 = document.getElementById('col0');
  if (!col0) return;
  if (document.querySelector(`.card-item[data-id="${mem.id}"]`)) return;

  const card = document.createElement('div');
  card.className = 'card-item restoring';
  card.style.display = 'flex';
  card.dataset.id = mem.id;
  card.dataset.title = mem.title;
  card.dataset.source = mem.source || 'Local';
  card.dataset.type = mem.type || (mem.isQuote ? 'Quote' : (mem.isNote ? 'note' : 'image'));
  card.dataset.tags = (mem.tags || []).join(',');

  if (selectMode) card.classList.add('in-select-mode');
  if (selectedCards.has(mem.id)) card.classList.add('selected');
  if (activeCardId === mem.id) card.classList.add('selected');

  populateCardContent(card, mem);

  const imgEl = card.querySelector('img');
  if (imgEl) {
    imgEl.onload = () => reflowMasonry();
  }

  const noteAddCard = document.getElementById('noteAddCard');
  if (prepend && noteAddCard && noteAddCard.nextSibling) {
    col0.insertBefore(card, noteAddCard.nextSibling);
  } else if (prepend && noteAddCard) {
    col0.appendChild(card);
  } else if (prepend && col0.firstChild) {
    col0.insertBefore(card, col0.firstChild);
  } else {
    col0.appendChild(card);
  }

  attachCardListeners(card);

  if (prepend) {
    if (!currentFilteredIds.includes(mem.id)) {
      currentFilteredIds.unshift(mem.id);
      renderedCount++;
      updateMemoryCount();
    }
  }
}

function attachCardListeners(card) {
  if (!card || card._listenersAttached) return;
  card._listenersAttached = true;

  const id = card.dataset.id;
  if (!id) return;

  card.addEventListener('click', () => {
    if (selectMode) {
      if (selectedCards.has(id)) {
        selectedCards.delete(id);
        card.classList.remove('selected');
      } else {
        selectedCards.add(id);
        card.classList.add('selected');
      }
      if (selectedCards.size > 0) {
        selectBtnLabel.textContent = `${selectedCards.size} Selected`;
        if (bulkDeleteBtn) {
          bulkDeleteBtn.style.display = 'inline-flex';
          bulkDeleteLabel.textContent = `Delete (${selectedCards.size})`;
        }
      } else {
        selectBtnLabel.textContent = 'Done';
        if (bulkDeleteBtn) bulkDeleteBtn.style.display = 'none';
      }
    } else {
      selectCard(id);
      openMemoryDetailModal(id);
    }
  });

  const audioPlayBtn = card.querySelector('.audio-play-btn');
  if (audioPlayBtn) {
    audioPlayBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const audioSrc = audioPlayBtn.dataset.audioSrc;
      toggleAudioPlayback(audioPlayBtn, audioSrc, card);
    });
  }

  const heart = card.querySelector('.card-heart-btn, .card-badge-heart');
  if (heart) {
    heart.addEventListener('click', async (e) => {
      e.stopPropagation();
      await toggleCardLiked(id, heart);
    });
  }

  const articlePill = card.querySelector('.card-article-pill');
  if (articlePill) {
    articlePill.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCard(id);
      openArticleReader(id);
    });
  }

  const linkBtn = card.querySelector('.card-link-btn');
  if (linkBtn) {
    linkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openExternalSource(card.dataset.source);
    });
  }

  const footerSource = card.querySelector('.card-footer-source');
  if (footerSource) {
    footerSource.addEventListener('click', (e) => {
      e.stopPropagation();
      openExternalSource(card.dataset.source);
    });
  }

  const trash = card.querySelector('.card-trash-btn');
  if (trash) {
    trash.addEventListener('click', (e) => {
      e.stopPropagation();
      promptDeleteMemory(id);
    });
  }
}

async function toggleCardLiked(id, heartEl) {
  if (!id) return;
  const d = EXACT_CARDS_DATA[id] || {};
  d.isLiked = !Boolean(d.isLiked);
  const liked = d.isLiked;
  if (heartEl) {
    heartEl.classList.toggle('liked', liked);
    const svg = heartEl.querySelector('svg');
    if (svg) {
      svg.setAttribute('fill', liked ? '#ff3b30' : 'none');
      svg.setAttribute('stroke', liked ? '#ff3b30' : 'currentColor');
    } else {
      heartEl.textContent = liked ? '♥' : '♡';
    }
    heartEl.title = liked ? 'Unlike' : 'Like';
  }
  await saveUserMemory(d);
  showToast(liked ? 'Added to Liked' : 'Removed from Liked');
  const likedOnly = Boolean(document.getElementById('filterLiked')?.classList.contains('active') || currentNav === 'liked');
  if (likedOnly) {
    filterCards();
  }
}

/* Process Pasted Image Blob (Real On-Device OCR & Mac Color Analysis) */
/**
 * Upgrade product or web image URLs to maximum possible resolution
 * Strips low-resolution thumbnail parameters and query transforms from major platforms
 */
function upgradeImageUrlToMaxRes(url) {
  if (!url || typeof url !== 'string') return url;
  let u = url.trim();

  // 1. Amazon: strip thumbnail dimensions/tokens to get original uncompressed master
  if (u.includes('media-amazon.com') || u.includes('images-amazon.com') || u.includes('ssl-images-amazon')) {
    u = u.replace(/\._[A-Z0-9_,]+_\.([a-zA-Z]+)(\?.*)?$/i, '.$1$2');
  }
  // 2. Flipkart: upgrade thumbnail dimensions to high-res (1664x1664)
  else if (u.includes('flixcart.com')) {
    u = u.replace(/\/image\/\d+\/\d+\//, '/image/1664/1664/');
  }
  // 3. Shopify: upgrade thumbnail suffixes (_small, _medium, _compact, etc.) to 2048x2048
  else if (u.includes('cdn.shopify.com')) {
    u = u.replace(/_(?:pico|icon|thumb|small|compact|medium|large|grande|\d+x\d+)\.([a-zA-Z]+)(\?.*)?$/i, '_2048x2048.$1$2');
  }
  // 4. Walmart: upgrade odnHeight & odnWidth to 1200
  else if (u.includes('walmartimages.com')) {
    u = u.replace(/odnHeight=\d+&odnWidth=\d+/, 'odnHeight=1200&odnWidth=1200');
  }
  // 5. Target / Scene7: upgrade width and height
  else if (u.includes('scene7.com') || u.includes('target.com')) {
    u = u.replace(/wid=\d+&hei=\d+/, 'wid=1200&hei=1200');
  }
  // 6. Myntra: upgrade dynamic transform to high-res
  else if (u.includes('myntassets.com')) {
    u = u.replace(/\/h_\d+,q_\d+,w_\d+\//, '/h_1440,q_95,w_1080/');
  }
  // 7. AliExpress / Taobao: strip dimension suffix
  else if (u.includes('alicdn.com')) {
    u = u.replace(/_\d+x\d+\.([a-zA-Z]+)(\?.*)?$/i, '.$1$2');
  }
  // 8. Generic thumbnail suffixes
  else {
    u = u.replace(/[-_](?:thumb|thumbnail|small|preview|min)\.([a-zA-Z]+)(\?.*)?$/i, '.$1$2');
  }
  return u;
}

/**
 * Helper to downscale image for lightning-fast network transmission to Groq LPUs
 * Shrinks 10MB+ images to ~100KB JPEG in 15ms
 */
function downscaleImageForVision(img, maxDim = 1024, quality = 0.85) {
  try {
    let w = img.naturalWidth || img.width || 800;
    let h = img.naturalHeight || img.height || 600;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    // Enforce Qwen minimum dimension constraint of 32px
    w = Math.max(32, w);
    h = Math.max(32, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (e) {
    return null;
  }
}

/**
 * Ultra-Fast Dense Vision & OCR Analysis via Groq (qwen/qwen3.8-27b with vision fallback)
 */
async function analyzeImageWithGroq(imageDataUrl, apiKey = null) {
  const rawKey = apiKey || localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
  if (!rawKey) return null;

  const config = getVisionApiConfig(rawKey);
  const preferredModel = localStorage.getItem('recall_groq_model') || config.model;
  const candidateModels = ['qwen/qwen3.8-27b'];

  const prompt = `Analyze this image thoroughly for Recall, a visual memory and personal search app.
Your objective is to make this image discoverable under ANY relevant search query.
Return ONLY a valid strict JSON object with NO markdown formatting, NO backticks, and NO other surrounding text:
{
  "title": "A precise, natural title. If a book cover, exact book title + author/volume. If an animal/creature, species + action + environment (e.g. 'Male African Lion Resting on Golden Savanna Grass'). If a product, exact brand + product. If a photo, primary subject + setting.",
  "ocrText": "Extract ALL visible text verbatim. Every single word, book title, author, publisher, quote, subtitle, chapter, brand label, sign, or stamp.",
  "tldr": "A detailed 2-3 sentence descriptive caption summarizing the primary subject, secondary elements, physical appearance, colors, lighting, setting/backdrop, actions, and overall mood.",
  "tags": ["15-20 lowercase search keywords covering: primary subject, species/category, secondary objects, colors, environment/scene, actions, materials, art style, mood, synonyms (e.g. lion, african-lion, feline, predator, cat, wildlife, savanna, safari, grassland, resting, golden, mane, nature, outdoors, mammal, wild)"],
  "isBook": true or false,
  "hasAnimals": true or false,
  "isQuote": true or false,
  "primarySubject": "Specific noun (e.g. lion, book, quote, sneakers)",
  "author": "Author name if book or quote, else empty string",
  "action": "Action if animal or person is moving (e.g. resting, walking, running, sitting, standing), else empty string",
  "scene": "Environment (e.g. savanna, safari, nature, office, studio, outdoors), else empty string"
}`;

  // If input is an HTTP/HTTPS URL, route directly through the backend proxy
  // because Groq Vision endpoints strictly reject HTTP URLs and throw 400 Bad Request.
  if (typeof imageDataUrl === 'string' && (imageDataUrl.startsWith('http://') || imageDataUrl.startsWith('https://'))) {
    try {
      const proxyRes = await fetch('/api/ai/groq-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.key}`
        },
        body: JSON.stringify({
          image: imageDataUrl,
          apiKey: config.key,
          model: 'qwen/qwen3.8-27b'
        })
      });
      if (proxyRes && proxyRes.ok) {
        const proxyJson = await proxyRes.json();
        if (proxyJson.success && proxyJson.data) {
          console.log(`[Groq Server Proxy Success]`, proxyJson.data);
          return proxyJson.data;
        }
      }
    } catch (proxyErr) {
      console.warn('[Groq Proxy HTTP URL Notice]', proxyErr);
    }
  }

  for (const model of candidateModels) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout per model candidate

      const payload = {
        model: model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: imageDataUrl } }
            ]
          }
        ],
        reasoning_effort: 'none',
        max_completion_tokens: 1024,
        temperature: 0.1
      };

      let res = null;
      try {
        res = await fetch(config.endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
      } catch (directErr) {
        console.warn(`[${config.provider} Direct Fetch Notice]`, directErr.message || directErr);
        // Fallback to Vercel backend proxy
        try {
          res = await fetch('/api/ai/groq-analyze', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${config.key}`
            },
            body: JSON.stringify({
              image: imageDataUrl,
              apiKey: config.key,
              model: model
            }),
            signal: controller.signal
          });
          if (res && res.ok) {
            const proxyJson = await res.json();
            if (proxyJson.success && proxyJson.data) {
              clearTimeout(timeoutId);
              console.log(`[${config.provider} Server Proxy] Success:`, proxyJson.data);
              return proxyJson.data;
            }
          }
        } catch (proxyErr) {
          console.warn('[Groq Proxy Notice]', proxyErr.message || proxyErr);
        }
      }
      clearTimeout(timeoutId);

      if (!res || !res.ok) {
        const errText = res ? await res.text() : 'Network unreachable';
        let errMsg = `HTTP ${res?.status || 500}`;
        try {
          const parsedErr = JSON.parse(errText);
          errMsg = parsedErr.error?.message || errText;
        } catch (e) {
          errMsg = errText;
        }
        console.warn(`[${config.provider} Vision: ${model}] ${errMsg}`);
        continue;
      }

      const data = await res.json();
      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) continue;

      const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[${config.provider} Vision: ${model}] Successfully analyzed:`, parsed);
        return parsed;
      }
    } catch (err) {
      console.warn(`[${config.provider} Vision: ${model}] Exception:`, err.message || err);
    }
  }

  return null;
}

/**
 * Fast Text Intelligence & Semantic Analysis via Groq (qwen/qwen3.8-27b)
 * Classifies text into Quote / Note / Idea, extracts smart title, quote attribution, summary & tags
 */
async function analyzeTextWithGroq(text, apiKey = null) {
  if (!text || typeof text !== 'string') return null;
  const rawKey = apiKey || localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
  if (!rawKey) return null;

  const config = getVisionApiConfig(rawKey);
  const model = localStorage.getItem('recall_groq_model') || 'qwen/qwen3.8-27b';

  const prompt = `Analyze this text thoroughly for Recall (a personal visual memory and search app).
Determine if it is a Quote (inspirational saying, proverb, aphorism, memorable statement, or attributed thought) or a Note / Idea / Snippet.
Extract an engaging, concise title (3 to 7 words), a 1-2 sentence summary, and semantic tags.
Return ONLY a valid strict JSON object with NO markdown formatting, NO backticks:
{
  "isQuote": true or false,
  "quoteText": "The verbatim quote if quote, else empty string",
  "quoteAttribution": "Author, speaker, or attribution if available, else empty string",
  "title": "A short, clean, descriptive title (3 to 7 words) capturing the main point",
  "tldr": "A 1-2 sentence concise summary of the core insight or note",
  "tags": ["3", "to", "6", "relevant", "lowercase", "tags"]
}

Text to analyze:
"""
${text.slice(0, 4000)}
"""`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const payload = {
      model: model,
      messages: [
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_completion_tokens: 450,
      response_format: { type: 'json_object' }
    };

    let res = null;
    try {
      res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.key}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (directErr) {
      try {
        res = await fetch('/api/ai/groq-analyze', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.key}`
          },
          body: JSON.stringify({
            text: text,
            apiKey: config.key,
            model: model
          }),
          signal: controller.signal
        });
      } catch (proxyErr) {}
    }
    clearTimeout(timeoutId);

    if (res && res.ok) {
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || (json.data && (json.data.content || json.data));
      if (content) {
        if (typeof content === 'object') return content;
        const jsonMatch = String(content).match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          console.log(`[Groq Text Analysis: ${model}] Successfully analyzed:`, parsed);
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('[Groq Text Analysis Notice]', err.message || err);
  }
  return null;
}

/**
 * Universal Groq JSON completions helper using qwen/qwen3.8-27b
 */
async function callGroqJsonPrompt(prompt, apiKey = null) {
  const rawKey = apiKey || localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
  if (!rawKey || !prompt) return null;

  const config = getVisionApiConfig(rawKey);
  const model = localStorage.getItem('recall_groq_model') || 'qwen/qwen3.8-27b';

  const payload = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_completion_tokens: 550,
    response_format: { type: 'json_object' }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    let res = null;
    try {
      res = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.key}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (directErr) {
      res = await fetch('/api/ai/groq-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.key}`
        },
        body: JSON.stringify({ text: prompt, apiKey: config.key, model: model }),
        signal: controller.signal
      });
    }
    clearTimeout(timeoutId);

    if (res && res.ok) {
      const json = await res.json();
      const content = json.choices?.[0]?.message?.content || (json.data && (json.data.content || json.data));
      if (content) {
        if (typeof content === 'object') return content;
        const match = String(content).match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
      }
    }
  } catch (err) {
    console.warn('[callGroqJsonPrompt Notice]', err.message || err);
  }
  return null;
}

/**
 * Master Groq AI Intelligence Engine for EVERY Memory Type
 * - Notes: smart title, 1-2 sentence TLDR, tags, quote detection
 * - Quotes: verbatim quote text, attribution, thematic tags
 * - Articles / Webpages: clean title, author, publication, executive TLDR, topic tags
 * - Videos: clean title without caps, video topic summary, channel, tags
 * - Products: product name, category tags, summary, price context
 * - Images / Visuals: Groq Vision scene caption, OCR text, tags, object detection
 */
async function enrichMemoryWithGroq(mem, apiKey = null) {
  if (!mem || !mem.id) return null;
  const rawKey = apiKey || localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
  if (!rawKey) return null;

  const isVideo = Boolean(mem.isVideo || mem.type === 'Video' || mem.type === 'video');
  const isProduct = Boolean(mem.isBuying || mem.price || mem.type === 'Product');
  const isQuote = Boolean(mem.isQuote || mem.type === 'Quote' || mem.quote);
  const isNote = Boolean(!isVideo && !isProduct && !isQuote && (mem.isNote || mem.type === 'Note' || mem.type === 'note' || !mem.heroImg));
  const isArticle = Boolean(!isVideo && !isProduct && !isQuote && !isNote && (mem.isArticle || mem.type === 'Article' || mem.articleBody || (mem.source && mem.source.startsWith('http'))));
  const hasHeroImg = Boolean(mem.heroImg && (mem.heroImg.startsWith('http') || mem.heroImg.startsWith('data:')));

  // For products, always use exact product page info NOT Groq (prevents confusing iPad with Galaxy Tab)
  if (isProduct) {
    return mem;
  }

  try {
    // 1. Visual Memories / Images / Screenshots / Books (Groq Vision)
    if (!isProduct && hasHeroImg && (!mem.ocrText || !mem.tldr || (mem.tags && mem.tags.length <= 6) || !isNaturalReadableText(mem.title))) {
      const groqVision = await analyzeImageWithGroq(mem.heroImg, rawKey);
      if (groqVision) {
        const currTitle = mem.title || '';
        const isGenericTitle = !currTitle ||
          !isNaturalReadableText(currTitle) ||
          currTitle.startsWith('—') ||
          currTitle === 'Web image' ||
          currTitle === 'Saved Image' ||
          currTitle === 'Saved Memory' ||
          currTitle === 'Saved Item' ||
          currTitle === 'Pasted Image' ||
          currTitle === 'Pasted Screenshot' ||
          currTitle.startsWith('mem_') ||
          currTitle.startsWith('ext_') ||
          currTitle.includes('Google Search') ||
          currTitle.includes('Google Images') ||
          currTitle.includes('gstatic.com');

        if (groqVision.title && (isGenericTitle || groqVision.title.length > currTitle.length)) {
          mem.title = groqVision.title;
        }
        if (groqVision.tldr) mem.tldr = groqVision.tldr;
        if (groqVision.ocrText) mem.ocrText = groqVision.ocrText;
        if (groqVision.isBook) {
          mem.isBook = true;
          mem.type = 'Book';
          mem.contentType = 'Book';
          mem.isQuote = false;
        }
        if (groqVision.hasAnimals) {
          mem.hasAnimals = true;
          mem.isQuote = false;
          mem.type = 'Web image';
          mem.contentType = 'Image';
          mem.quote = undefined;
        } else if (!groqVision.isQuote) {
          mem.isQuote = false;
          mem.type = mem.isBook ? 'Book' : 'Web image';
          mem.contentType = mem.isBook ? 'Book' : 'Image';
          mem.quote = undefined;
        }
        if (groqVision.tags && Array.isArray(groqVision.tags)) {
          const merged = new Set((mem.tags || []).map(t => String(t).toLowerCase().trim()));
          groqVision.tags.forEach(t => {
            const cleanT = String(t).toLowerCase().trim();
            if (cleanT) merged.add(cleanT);
          });
          if (groqVision.primarySubject) merged.add(String(groqVision.primarySubject).toLowerCase().trim());
          if (groqVision.action) merged.add(String(groqVision.action).toLowerCase().trim());
          if (groqVision.scene) merged.add(String(groqVision.scene).toLowerCase().trim());
          mem.tags = Array.from(merged);
        }
        EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
        const cardEl = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
        if (cardEl) {
          populateCardContent(cardEl, mem);
          reflowMasonry();
        }
        return mem;
      }
    }

    // 2. Videos (YouTube, Vimeo, Web Video)
    if (isVideo) {
      const videoText = `${mem.title || ''}\n${mem.author || mem.channel || ''}\n${mem.body || mem.tldr || ''}`;
      const prompt = `Analyze this video for Recall (a personal visual memory app).
Return ONLY a valid strict JSON object:
{
  "title": "Clean, engaging video title without clickbait all-caps",
  "tldr": "A 1-2 sentence descriptive summary of what this video covers",
  "channel": "Channel or creator name if identifiable, else empty string",
  "tags": ["video", "and", "4-6", "topic", "tags"]
}

Video details:
"""
${videoText.slice(0, 3000)}
"""`;
      const analysis = await callGroqJsonPrompt(prompt, rawKey);
      if (analysis) {
        if (analysis.title && (mem.title.length > 50 || mem.title === mem.source)) mem.title = analysis.title;
        if (analysis.tldr) mem.tldr = analysis.tldr;
        if (analysis.channel && (!mem.author && !mem.channel)) mem.channel = analysis.channel;
        if (analysis.tags) mem.tags = Array.from(new Set([...(mem.tags || ['video']), ...analysis.tags]));
        EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
        const cardEl = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
        if (cardEl) {
          populateCardContent(cardEl, mem);
          reflowMasonry();
        }
        return mem;
      }
    }

    // 3. E-Commerce Products / Shopping Links
    if (isProduct) {
      const prodText = `${mem.title || ''}\nPrice: ${mem.price || ''}\n${mem.body || mem.tldr || ''}\nSource: ${mem.source || ''}`;
      const prompt = `Analyze this product for Recall (a personal visual memory app).
Return ONLY a valid strict JSON object:
{
  "title": "Clean, concise product name (strip seller SEO spam and model noise)",
  "tldr": "A 1-2 sentence description of the product and its primary purpose",
  "category": "Broad category (e.g. 'electronics', 'furniture', 'apparel')",
  "tags": ["product", "buying", "and", "3-5", "category", "tags"]
}

Product details:
"""
${prodText.slice(0, 3000)}
"""`;
      const analysis = await callGroqJsonPrompt(prompt, rawKey);
      if (analysis) {
        if (analysis.title && (mem.title.length > 40 || mem.title === mem.source)) mem.title = analysis.title;
        if (analysis.tldr) mem.tldr = analysis.tldr;
        if (analysis.tags) mem.tags = Array.from(new Set([...(mem.tags || ['product', 'buying']), ...analysis.tags]));
        EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
        const cardEl = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
        if (cardEl) {
          populateCardContent(cardEl, mem);
          reflowMasonry();
        }
        return mem;
      }
    }

    // 4. Articles / Web Pages / Reading Mode
    if (isArticle) {
      const articleText = `${mem.title || ''}\nSource: ${mem.source || ''}\n${mem.body || mem.tldr || ''}\n${(mem.paragraphs || []).slice(0, 8).join('\n')}`;
      const prompt = `Analyze this article or web page for Recall (a personal visual memory app).
Return ONLY a valid strict JSON object:
{
  "title": "Clean, informative article title",
  "tldr": "A 1-2 sentence executive summary of the article's core thesis or key takeaway",
  "author": "Author name if mentioned, else empty string",
  "publication": "Publication or publication domain (e.g. 'The Verge', 'Substack'), else empty string",
  "tags": ["article", "reading", "and", "4-6", "specific", "subject", "tags"]
}

Article content:
"""
${articleText.slice(0, 4000)}
"""`;
      const analysis = await callGroqJsonPrompt(prompt, rawKey);
      if (analysis) {
        if (analysis.title && (!mem.title || mem.title.length > 55 || mem.title === 'Web' || mem.title === 'Article' || mem.title === mem.source)) {
          mem.title = analysis.title;
        }
        if (analysis.tldr) mem.tldr = analysis.tldr;
        if (analysis.author && !mem.author) mem.author = analysis.author;
        if (analysis.publication && !mem.publication) mem.publication = analysis.publication;
        if (analysis.tags) mem.tags = Array.from(new Set([...(mem.tags || ['article', 'reading']), ...analysis.tags]));
        EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
        const cardEl = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
        if (cardEl) {
          populateCardContent(cardEl, mem);
          reflowMasonry();
        }
        return mem;
      }
    }

    // 5. Notes, Quotes & Ideas
    const textToAnalyze = (mem.body ? `${mem.title}\n\n${mem.body}` : (mem.quote || mem.title || '')).trim();
    if (textToAnalyze && textToAnalyze.length > 5) {
      const analysis = await analyzeTextWithGroq(textToAnalyze, rawKey);
      if (analysis) {
        if (analysis.isQuote) {
          mem.isQuote = true;
          mem.type = 'Quote';
          mem.contentType = 'Quote';
          mem.quote = analysis.quoteText || textToAnalyze;
          if (analysis.quoteAttribution) {
            mem.attribution = analysis.quoteAttribution;
            mem.source = analysis.quoteAttribution;
          }
        }
        if (analysis.title && (!mem.title || mem.title.length > 40 || mem.title === 'Saved Item' || mem.title === 'Note' || mem.title === 'Untitled Note')) {
          mem.title = analysis.title;
        }
        if (analysis.tldr) mem.tldr = analysis.tldr;
        if (analysis.tags) {
          mem.tags = Array.from(new Set([...(mem.tags || []), ...analysis.tags]));
        }
        EXACT_CARDS_DATA[mem.id] = mem;
    await saveUserMemory(mem);
        const cardEl = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
        if (cardEl) {
          populateCardContent(cardEl, mem);
          reflowMasonry();
        }
        return mem;
      }
    }
  } catch (err) {
    console.warn('[enrichMemoryWithGroq error]', err);
  }
  return mem;
}

function processPastedImageBlob(blob, sourceName = 'Clipboard', placeholder = null, originalImgUrl = '') {
  if (!placeholder) {
    placeholder = createSavingPlaceholder();
  }
  showToast('Analyzing visual on device…');
  const reader = new FileReader();
  reader.onerror = (err) => {
    console.error('[processPastedImageBlob] FileReader error:', err);
    if (placeholder) placeholder.remove();
    showToast('Failed to read image file');
  };
  reader.onload = async (e) => {
    try {
      const dataUrl = e.target.result;
      if (!dataUrl) {
        if (placeholder) placeholder.remove();
        showToast('Empty image data');
        return;
      }

      const tempImg = new Image();
      await new Promise((res) => {
        tempImg.onload = res;
        tempImg.onerror = res;
        tempImg.src = dataUrl;
        if (tempImg.complete) res();
      });

      // 0. High-Precision Dense Vision Analysis via Groq (with instant downscaling)
      let groqData = null;
      const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
      if (groqKey) {
        showToast('Analyzing with Groq Vision (qwen/qwen3.8-27b)…');
        try {
          const downscaledUrl = downscaleImageForVision(tempImg, 1024, 0.85) || dataUrl;
          groqData = await analyzeImageWithGroq(downscaledUrl, groqKey);
          if (groqData) {
            showToast('Groq Vision complete');
          }
        } catch (groqErr) {
          console.warn('[Groq Vision] Error:', groqErr);
        }
      }

      // 1. Text Extraction: If Groq Vision already ran, trust its OCR (avoids hallucinating text from animal fur/stripes/textures)
      let recognizedText = (groqData && groqData.ocrText) ? groqData.ocrText : '';
      if (!groqData && !recognizedText && window.visualAnalyzer) {
        showToast('Analyzing image with AI…');
        try {
          const rawOcr = await window.visualAnalyzer.extractText(dataUrl);
          if (isNaturalReadableText(rawOcr)) {
            recognizedText = rawOcr;
          }
        } catch (e) {
          console.warn('Text extraction fallback:', e);
        }
      }

      // 2. Entity & Book Detection from Text & Visuals
      let entities = { isBook: false, isQuote: false, hasAnimals: false, peopleCount: 0, tags: [] };
      if (window.visualAnalyzer) {
        try {
          entities = await window.visualAnalyzer.detectEntities(tempImg, recognizedText, sourceName);
        } catch (e) {
          console.warn('detectEntities error:', e);
        }
      }

      // Merge Groq Vision AI (qwen/qwen3.8-27b) structured entities
      if (groqData) {
        if (groqData.hasAnimals) {
          entities.hasAnimals = true;
          entities.tags.push('animal', 'animals', 'wildlife', 'mammal');
          if (groqData.primarySubject) {
            const cleanSub = groqData.primarySubject.toLowerCase().trim();
            entities.animals = [cleanSub];
            entities.tags.push(cleanSub);
          }
        }
        if (groqData.isBook) {
          entities.isBook = true;
          entities.tags.push('book', 'books', 'reading', 'literature');
        }
        if (groqData.isQuote && !groqData.hasAnimals) {
          entities.isQuote = true;
          entities.tags.push('quote', 'quotes', 'saying');
        }
        if (groqData.action) {
          entities.tags.push(groqData.action.toLowerCase().trim());
        }
        if (groqData.scene) {
          entities.tags.push(groqData.scene.toLowerCase().trim());
        }
        if (groqData.author) {
          entities.tags.push(groqData.author.toLowerCase().trim());
        }
        if (Array.isArray(groqData.tags)) {
          groqData.tags.forEach(t => {
            const cleanT = String(t).toLowerCase().trim();
            if (cleanT && !entities.tags.includes(cleanT)) entities.tags.push(cleanT);
          });
        }
      }

      // Check if recognized text is a quote ONLY if natural readable text AND not an animal photo
      let qMatch = null;
      if (!entities.hasAnimals && !entities.isBook && !entities.isQuote && recognizedText && isNaturalReadableText(recognizedText)) {
        qMatch = detectQuote(recognizedText);
        if (qMatch) entities.isQuote = true;
      }

      // 3. MobileCLIP 512-dim visual embedding & zero-shot tags (WebGPU / WASM)
      let visualEmbedding = null;
      if (window.mobileClip) {
        try {
          visualEmbedding = window.mobileClip.imageEmbedding(tempImg);
          const clipTags = window.mobileClip.predictTags(visualEmbedding, 0.15);
          clipTags.forEach(ct => {
            if (!entities.tags.includes(ct.tag)) entities.tags.push(ct.tag);
            if (ct.tag === 'book' || ct.tag === 'saga') entities.isBook = true;
            if (ct.tag === 'animal') entities.hasAnimals = true;
            if (ct.tag === 'quote' && !entities.hasAnimals) entities.isQuote = true;
          });
        } catch (e) {
          console.warn('MobileCLIP analysis error:', e);
        }
      }

      // 4. Dominant Colors & Palette
      const dominantColors = (typeof extractDominantColorWords === 'function')
        ? extractDominantColorWords(tempImg)
        : ((window.extractDominantColorWords) ? window.extractDominantColorWords(tempImg) : ['dark']);
      const palette = (typeof extractPaletteSwatches === 'function')
        ? extractPaletteSwatches(tempImg)
        : ((window.extractPaletteSwatches) ? window.extractPaletteSwatches(tempImg) : ['#130F0C', '#583515', '#7F532E', '#D08B54', '#E5AB7E']);

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      const isQuoteMemory = Boolean(entities.isQuote && !entities.hasAnimals && !entities.isBook);
      const id = (isQuoteMemory ? 'quote_' : 'pasted_') + Date.now();
      const primaryColor = dominantColors[0] || 'visual';

      // Subject determination matching native Recall
      let subject = 'visual';
      if (entities.hasAnimals) subject = 'animal';
      else if (entities.peopleCount > 0 || entities.tags.includes('portrait') || entities.tags.includes('face')) subject = 'face';
      else if (entities.isBook) subject = 'book';
      else if (entities.isQuote) subject = 'quote';
      else if (entities.tags.includes('lamp') || entities.tags.includes('light')) subject = 'lamp';
      else if (entities.tags.includes('furniture')) subject = 'furniture';
      else if (entities.tags.includes('art')) subject = 'art';
      else if (entities.tags.includes('document') || entities.tags.includes('sign')) subject = 'document';
      else if (entities.tags.includes('structure')) subject = 'structure';
      else if (entities.tags.includes('clothing')) subject = 'clothing';

      // Salient sub-features for the label: "A [color] [subject] image featuring [detail]..."
      const filterOut = new Set(['pasted', 'image', 'clipboard', 'visual', primaryColor, subject, 'document']);
      const salientFeatures = (entities.tags || []).filter(t => !filterOut.has(t));
      const featureText = salientFeatures.slice(0, 2).join(', ');
      let tldr = featureText
        ? `A ${primaryColor} ${subject} image featuring ${featureText}`
        : `A ${primaryColor} ${subject} image`;

      // Title determination with accurate book / animal / quote naming
      let title = 'Visual Memory #' + id.slice(-4);
      if (entities.hasAnimals) {
        const aName = (entities.animals && entities.animals[0]) || 'Wildlife';
        const capAnimal = aName.charAt(0).toUpperCase() + aName.slice(1);
        if (entities.tags.includes('walking')) {
          title = (entities.tags.includes('savanna') || entities.tags.includes('safari'))
            ? `${capAnimal} Walking in the Savanna`
            : `${capAnimal} Walking`;
        } else if (entities.tags.includes('running')) {
          title = `${capAnimal} Running`;
        } else if (entities.tags.includes('sitting')) {
          title = `${capAnimal} Sitting`;
        } else if (entities.tags.includes('standing')) {
          title = `${capAnimal} Standing`;
        } else {
          title = capAnimal;
        }
      } else if (entities.isBook) {
        if (/saga/i.test(recognizedText)) {
          title = 'Saga — Volume Three';
        } else if (recognizedText) {
          const cleanLines = recognizedText.split('\n').map(l => l.trim()).filter(Boolean);
          if (cleanLines.length > 0) {
            title = cleanLines[0].length > 40 ? cleanLines[0].slice(0, 38) + '…' : cleanLines[0];
          } else {
            title = 'Book / Literature';
          }
        } else {
          title = 'Book / Literature';
        }
      } else if (recognizedText) {
        const cleanLines = recognizedText.split('\n').map(l => l.trim()).filter(Boolean);
        if (cleanLines.length > 0) {
          title = cleanLines[0].length > 40 ? cleanLines[0].slice(0, 38) + '…' : cleanLines[0];
        }
      } else if (sourceName && sourceName !== 'Clipboard' && !sourceName.startsWith('blob:') && !sourceName.startsWith('data:')) {
        title = sourceName;
      }

      // Exact title and dense caption from Groq Vision if available
      if (groqData) {
        if (groqData.title) title = groqData.title;
        if (groqData.tldr) tldr = groqData.tldr;
      }

      const resolvedImgUrl = (originalImgUrl && (originalImgUrl.startsWith('http://') || originalImgUrl.startsWith('https://')))
        ? upgradeImageUrlToMaxRes(originalImgUrl)
        : ((sourceName && (sourceName.startsWith('http://') || sourceName.startsWith('https://')))
          ? upgradeImageUrlToMaxRes(sourceName)
          : dataUrl);

      const resolvedSource = (originalImgUrl && originalImgUrl.startsWith('http'))
        ? originalImgUrl
        : ((sourceName && sourceName.startsWith('http'))
          ? sourceName
          : (sourceName || 'Pasted Screenshot'));

      const newMem = {
        id,
        type: entities.isBook ? 'Book' : (isQuoteMemory ? 'Quote' : 'Web image'),
        contentType: entities.isBook ? 'Book' : (isQuoteMemory ? 'Quote' : 'Image'),
        title,
        date: dateStr,
        tldr,
        ocrText: recognizedText,
        quote: isQuoteMemory ? (recognizedText || title) : undefined,
        attribution: isQuoteMemory ? (qMatch && qMatch.attribution ? qMatch.attribution : '') : undefined,
        source: resolvedSource,
        heroImg: dataUrl,
        imageUrl: resolvedImgUrl,
        url: resolvedImgUrl,
        palette,
        dominantColors,
        paletteTones: dominantColors,
        tags: Array.from(new Set([
          'pasted', 'image', 'clipboard', primaryColor, subject,
          ...dominantColors,
          ...entities.tags,
          ...(entities.isBook ? ['book', 'books', 'reading', 'literature'] : []),
          ...(entities.hasAnimals ? ['animal', 'animals', 'wildlife', 'mammal'] : []),
          ...(isQuoteMemory ? ['quote', 'inspiration'] : [])
        ])),
        peopleCount: entities.peopleCount || 0,
        hasAnimals: entities.hasAnimals || false,
        isBook: entities.isBook || false,
        isQuote: isQuoteMemory,
        visualEmbedding: visualEmbedding,
        embedding: window.mobileClip
          ? window.mobileClip.textEmbedding(`${title} ${recognizedText} ${entities.tags.join(' ')}`)
          : (window.searchEngine ? window.searchEngine.generateEmbedding(`${title} ${recognizedText} ${entities.tags.join(' ')}`) : null)
      };

      EXACT_CARDS_DATA[id] = newMem;
      saveUserMemory(newMem);

      // Reset any active search so newly added memory is immediately visible
      if (searchQuery) {
        searchQuery = '';
        if (searchInput) searchInput.value = '';
        if (searchClear) searchClear.classList.remove('visible');
      }

      morphPlaceholderToMemory(placeholder, newMem);
      showToast(entities.isQuote ? 'Quote saved from image' : 'Image saved from ' + sourceName);
    } catch (e) {
      console.error('[processPastedImageBlob error]', e);
      if (placeholder) placeholder.remove();
      showToast('Error processing image: ' + (e?.message || 'unknown error'));
    }
  };
  reader.readAsDataURL(blob);
}

/* ── Analyze an image URL with MobileCLIP & Color Palette ── */
async function analyzeImageUrlWithMobileClip(imgUrl) {
  if (!imgUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const isLocalOrData = imgUrl.startsWith('data:') || imgUrl.startsWith('blob:') || imgUrl.includes('localhost:8088');
    const proxySrc = isLocalOrData ? imgUrl : `/api/proxy-image?url=${encodeURIComponent(imgUrl)}`;

    img.onload = async () => {
      try {
        if (window.mobileClip) {
          const analysis = await window.mobileClip.analyzeVisual(img);
          resolve(analysis);
          return;
        }
      } catch (err) {
        console.warn('[analyzeImageUrlWithMobileClip failed]', err);
      }
      resolve(null);
    };

    img.onerror = () => {
      if (proxySrc !== imgUrl) {
        const directImg = new Image();
        directImg.onload = async () => {
          try {
            if (window.mobileClip) {
              const analysis = await window.mobileClip.analyzeVisual(directImg);
              resolve(analysis);
              return;
            }
          } catch (e) { }
          resolve(null);
        };
        directImg.onerror = () => resolve(null);
        directImg.src = imgUrl;
      } else {
        resolve(null);
      }
    };

    img.src = proxySrc;
  });
}

/* ── Process Pasted Direct Image URL ── */
async function processPastedImageUrl(imgUrl) {
  const maxResUrl = upgradeImageUrlToMaxRes(imgUrl);
  const placeholder = createSavingPlaceholder();
  showToast('Loading image and analyzing visual…');
  try {
    const isLocalOrData = maxResUrl.startsWith('data:') || maxResUrl.startsWith('blob:') || maxResUrl.includes('localhost:8088');
    const safeSrc = isLocalOrData ? maxResUrl : `/api/proxy-image?url=${encodeURIComponent(maxResUrl)}`;

    const res = await fetch(safeSrc);
    if (!res.ok) throw new Error('Fetch failed: ' + res.status);
    const blob = await res.blob();
    processPastedImageBlob(blob, maxResUrl, placeholder, maxResUrl);
  } catch (err) {
    console.warn('[processPastedImageUrl Error]', err);
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeStr = dateStr + ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const id = 'img_' + Date.now();
    let domain = 'Image';
    try { domain = new URL(maxResUrl).hostname.replace(/^www\./, ''); } catch (e) { }

    const newMem = {
      id,
      type: 'Web image',
      contentType: 'Image',
      title: 'Pasted Image',
      tldr: 'A visual memory from ' + domain,
      body: '',
      source: maxResUrl,
      imageUrl: maxResUrl,
      url: maxResUrl,
      heroImg: maxResUrl,
      date: dateStr,
      dateDetail: timeStr,
      palette: ['#1C1C1E', '#48484A', '#8E8E93', '#D1D1D6', '#F2F2F7'],
      paletteTones: ['gray'],
      tags: ['image', 'web', domain],
      isLiked: false,
      createdAt: Date.now()
    };

    EXACT_CARDS_DATA[id] = newMem;
    await saveUserMemory(newMem);
    morphPlaceholderToMemory(placeholder, newMem);
    showToast('Image saved from clipboard');

    const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
    if (groqKey) {
      enrichMemoryWithGroq(newMem, groqKey).catch(() => {});
    }
  }
}

/* ── Process Pasted Text or URL (Identical Feature Parity with Extension) ── */
async function processPastedText(text) {
  if (!text || !text.trim()) return;
  let clean = text.trim();

  // Strip wrapping markdown links: [Title](https://...) -> extract URL
  const mdLinkMatch = clean.match(/^\[.*?\]\((https?:\/\/[^\s\)]+)\)$/i);
  if (mdLinkMatch) clean = mdLinkMatch[1];

  // Strip wrapping brackets <https://...>
  if (clean.startsWith('<') && clean.endsWith('>') && clean.includes('://')) {
    clean = clean.slice(1, -1).trim();
  }

  // Robust URL detection (http://, https://, www., or domain.tld/path)
  const isHttpUrl = /^https?:\/\//i.test(clean);
  const isWwwUrl = /^www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/i.test(clean);
  const isBareDomain = /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?$/i.test(clean);

  const isUrl = isHttpUrl || isWwwUrl || isBareDomain;
  if (isUrl && !isHttpUrl) {
    clean = 'https://' + clean;
  }

  // Unwrap Google Images redirect URL if imgurl param exists
  if (clean.includes('google.') && clean.includes('imgres')) {
    try {
      const u = new URL(clean);
      const actualImg = u.searchParams.get('imgurl');
      if (actualImg) clean = decodeURIComponent(actualImg);
    } catch (e) {
      const m = clean.match(/[?&]imgurl=([^&]+)/i);
      if (m && m[1]) clean = decodeURIComponent(m[1]);
    }
  }

  // 1. Plain text, Quote, or Code Snippet (strictly when NOT a URL)
  if (!isUrl) {
    // 1a. Direct Code Snippet Detection (Markdown code block or multi-line programming language)
    const mdCodeMatch = clean.match(/^```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```$/);
    const isMultiLineCode = (function(str) {
      const lines = str.split('\n');
      if (lines.length >= 3) {
        const kwMatch = /^\s*(import\s|from\s.*import|def\s|class\s|function\s|const\s|let\s|var\s|fn\s|pub\sstruct|package\smain|func\s|#include|<!DOCTYPE|<html|SELECT\s.*FROM|CREATE\sTABLE)/m.test(str);
        const syntaxHeavy = lines.filter(l => /[{};()=>]/.test(l)).length >= 3;
        return kwMatch || syntaxHeavy;
      }
      return false;
    })(clean);

    if (mdCodeMatch || isMultiLineCode) {
      const rawSnippet = mdCodeMatch ? mdCodeMatch[2].trim() : clean;
      const explicitLang = mdCodeMatch && mdCodeMatch[1] ? mdCodeMatch[1].trim() : '';
      const lang = explicitLang || detectCodeLanguage(rawSnippet);
      const placeholder = createSavingPlaceholder();
      await createAndSaveCode('', rawSnippet, lang, '', '', placeholder);
      return;
    }

    const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
    const placeholder = createSavingPlaceholder();

    if (groqKey) {
      showToast('Analyzing text with Groq AI…');
      try {
        const groqAnalysis = await analyzeTextWithGroq(clean, groqKey);
        if (groqAnalysis) {
          if (groqAnalysis.isQuote) {
            createAndSaveQuote(
              groqAnalysis.quoteText || clean,
              groqAnalysis.quoteAttribution || '',
              placeholder,
              groqAnalysis.tags,
              groqAnalysis.tldr
            );
            return;
          } else {
            createAndSaveNote(
              groqAnalysis.title || 'Note',
              clean,
              placeholder,
              groqAnalysis.tags,
              groqAnalysis.tldr
            );
            return;
          }
        }
      } catch (err) {
        console.warn('Groq text analysis error:', err);
      }
    }

    const quoteData = detectQuote(clean);
    if (quoteData) {
      createAndSaveQuote(quoteData.quoteText, quoteData.attribution, placeholder);
      return;
    }
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines.length > 0 && lines[0].length <= 50 ? lines[0] : (clean.length > 36 ? clean.slice(0, 36) + '…' : clean);
    createAndSaveNote(title, clean, placeholder);
    return;
  }

  // 2. Direct Image URL (File extensions, Google Images CDN, or direct CDN thumbnails)
  const isDirectImage = /\.(jpg|jpeg|png|webp|gif|bmp|avif|tiff|svg)(\?.*)?$/i.test(clean) ||
                        /gstatic\.com\/images\?q=/i.test(clean) ||
                        /googleusercontent\.com\//i.test(clean) ||
                        /images\.unsplash\.com\//i.test(clean) ||
                        /\b(format|ext|type)=(jpg|jpeg|png|webp)/i.test(clean);
  if (isDirectImage) {
    await processPastedImageUrl(clean);
    return;
  }

  // 3. Web Page URL (E-Commerce Product, Article, Video, Quote, or Link)
  const tempMemId = 'art_' + Date.now();
  const placeholder = createSavingPlaceholder(tempMemId);
  showToast('Extracting link content & details…');

  let data = null;
  try {
    const res = await fetch('/api/scrape-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: clean })
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.data) data = json.data;
    }
  } catch (err) {
    console.warn('[processPastedText Scrape Error]', err);
  }

  // If scraped resource turns out to be a direct image
  if (data?.isDirectImage && (data?.heroImg || clean)) {
    if (placeholder) placeholder.remove();
    await processPastedImageUrl(data.heroImg || clean);
    return;
  }

  let domain = 'Web';
  try { domain = new URL(clean).hostname.replace(/^www\./, ''); } catch (e) { }

  const isCode = Boolean(data?.isCode || data?.codeSnippet || (clean.includes('github.com') && (clean.includes('/blob/') || clean.includes('gist.github.com'))));
  const docData = !isCode ? detectDocument(clean, data) : null;
  const socialData = !isCode && !docData ? detectSocialPost(clean, data) : null;
  const videoData = !isCode && !docData && !socialData ? detectVideo(clean, data) : null;
  const audioData = !isCode && !docData && !socialData && !videoData ? detectAudio(clean, data) : null;
  const isDocument = Boolean(!isCode && (docData || data?.isDocument || data?.isPDF || data?.isSpreadsheet));
  const isSocial = Boolean(!isCode && !isDocument && (socialData || data?.isSocial));
  const isVideo = Boolean(!isCode && !isDocument && !isSocial && (videoData || data?.isVideo));
  const isAudio = Boolean(!isCode && !isDocument && !isSocial && !isVideo && (audioData || data?.isAudio));
  const isBuying = !isCode && !isDocument && !isSocial && !isVideo && !isAudio && Boolean(data?.isBuying || data?.price);
  const isArticle = !isCode && !isDocument && !isSocial && !isVideo && !isAudio && !isBuying;
  const rawHeroImg = socialData?.mediaUrl || videoData?.thumbnail || audioData?.thumbnail || data?.heroImg || '';
  const heroImg = upgradeImageUrlToMaxRes(rawHeroImg);
  const price = data?.price || '';
  const title = (isCode ? (data?.title || domain) : (socialData?.authorName ? (socialData.text ? `${socialData.authorName}: "${socialData.text.slice(0, 50)}…"` : `${socialData.authorName} on ${socialData.platformLabel}`) : (data?.title || domain))).trim();
  const body = (isCode ? (data?.codeSnippet || data?.description || '') : (socialData?.text || data?.description || '')).trim();

  // Check if scraped text or title is a quote
  const quoteData = !isCode && !isDocument && !isSocial && !isVideo && !isAudio && !isArticle ? detectQuote(body || title) : null;
  const isQuote = Boolean(quoteData);

  // On-device MobileCLIP visual analysis (images and video thumbnails)
  let visualAnalysis = null;
  if (heroImg) {
    try {
      visualAnalysis = await analyzeImageUrlWithMobileClip(heroImg);
    } catch (clipErr) {
      console.warn('[MobileCLIP Link Analysis]', clipErr);
    }
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = dateStr + ' at ' + now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const memId = (isCode ? 'code_' : (isDocument ? 'doc_' : (isSocial ? 'soc_' : (isVideo ? 'vid_' : (isAudio ? 'audio_' : (isQuote ? 'quote_' : (isBuying ? 'prod_' : 'art_'))))))) + Date.now();
  if (placeholder) placeholder.dataset.id = memId;

  let caption = title;
  if (isBuying) {
    caption = title;
  } else if (isArticle) {
    caption = title;
  }

  const tags = [
    isCode ? 'code' : (isDocument ? (docData?.isResearchPaper ? 'paper' : (docData?.isSpreadsheet ? 'spreadsheet' : 'document')) : (isSocial ? 'social' : (isVideo ? 'video' : (isAudio ? 'audio' : (isQuote ? 'quote' : (isBuying ? 'buying' : (isArticle ? 'article' : 'web'))))))),
    isCode ? (data?.codeLanguage?.toLowerCase() || 'developer') : (isDocument ? (docData?.type || 'document') : (isSocial ? (socialData?.platform || 'social') : (isVideo ? (videoData?.provider || 'video') : (isAudio ? (audioData?.platform?.toLowerCase() || 'music') : (isQuote ? (visualAnalysis?.author || 'wisdom') : (isBuying ? 'product' : (isArticle ? 'reading' : 'link'))))))),
    domain
  ];
  if (isCode) {
    tags.push('code');
    if (data?.codeLanguage) tags.push(data.codeLanguage.toLowerCase());
    if (data?.codeRepo) tags.push(data.codeRepo.toLowerCase());
  }
  if (isSocial) {
    tags.push('social');
    if (socialData?.platform) tags.push(socialData.platform);
  }
  if (isAudio) {
    tags.push('music');
    if (audioData?.audioType) tags.push(audioData.audioType);
  }
  if (isDocument) {
    tags.push('document');
    if (docData?.isResearchPaper) tags.push('research', 'paper', 'academic');
    if (docData?.isSpreadsheet) tags.push('spreadsheet', 'excel', 'data');
    if (docData?.isPDF) tags.push('pdf');
  }
  if (visualAnalysis?.tags) {
    tags.push(...visualAnalysis.tags);
  }

  const newMem = {
    id: memId,
    type: isCode ? 'Code' : (isDocument ? 'Document' : (isSocial ? 'Social' : (isVideo ? 'Video' : (isAudio ? 'Audio' : (isQuote ? 'Quote' : (isBuying ? 'Product' : (isArticle ? 'Article' : 'Web image'))))))),
    contentType: isCode ? 'Code' : (isDocument ? 'Document' : (isSocial ? 'Social' : (isVideo ? 'Video' : (isAudio ? 'Audio' : (isQuote ? 'Quote' : (isBuying ? 'Product' : (isArticle ? 'Article' : 'Image'))))))),
    isCode: isCode,
    codeLanguage: data?.codeLanguage || (isCode ? detectCodeLanguage(data?.codeSnippet || body, data?.codeFilename || title) : ''),
    codeFilename: data?.codeFilename || (isCode ? (data?.title || 'code') : ''),
    codeSnippet: data?.codeSnippet || data?.codeText || (isCode ? body : ''),
    codeText: data?.codeSnippet || data?.codeText || (isCode ? body : ''),
    codeLines: data?.codeLines || ((data?.codeSnippet || data?.codeText) ? (data.codeSnippet || data.codeText).split('\n').length : (isCode && body ? body.split('\n').length : 0)),
    codeRepo: data?.codeRepo || '',
    isRepo: Boolean(data?.isRepo),
    isDocument: isDocument,
    isPDF: Boolean(docData?.isPDF || data?.isPDF),
    isSpreadsheet: Boolean(docData?.isSpreadsheet || data?.isSpreadsheet),
    isResearchPaper: Boolean(docData?.isResearchPaper || data?.isResearchPaper),
    docType: docData?.type || data?.docType || (isDocument ? 'document' : ''),
    pdfUrl: docData?.pdfUrl || data?.pdfUrl || (docData?.isPDF ? clean : ''),
    arxivId: docData?.arxivId || data?.arxivId || '',
    sheetUrl: docData?.sheetUrl || data?.sheetUrl || '',
    tableData: data?.tableData || null,
    isSocial: isSocial,
    socialPlatform: socialData?.platform || data?.socialPlatform || (isSocial ? 'social' : ''),
    socialPlatformLabel: socialData?.platformLabel || data?.socialPlatformLabel || '',
    socialAuthorName: socialData?.authorName || data?.socialAuthorName || data?.author || '',
    socialHandle: socialData?.handle || data?.socialHandle || '',
    socialAvatar: socialData?.avatar || data?.socialAvatar || '',
    socialText: socialData?.text || data?.socialText || body || title,
    socialMediaUrl: socialData?.mediaUrl || data?.socialMediaUrl || heroImg || '',
    socialLikes: socialData?.likes || data?.socialLikes || data?.likes || 0,
    socialReposts: socialData?.reposts || data?.socialReposts || data?.retweets || 0,
    socialReplies: socialData?.replies || data?.socialReplies || data?.replies || 0,
    isVideo: isVideo,
    videoId: videoData?.videoId || data?.videoId || '',
    videoEmbedUrl: videoData?.embedUrl || data?.videoEmbedUrl || '',
    videoFileUrl: videoData?.videoFileUrl || data?.videoFileUrl || '',
    isAudio: isAudio,
    audioProvider: audioData?.provider || data?.audioProvider || '',
    audioPlatform: audioData?.platform || data?.audioPlatform || (domain.includes('spotify') ? 'Spotify' : 'Audio'),
    audioType: audioData?.audioType || data?.audioType || 'track',
    audioEmbedUrl: audioData?.embedUrl || data?.audioEmbedUrl || '',
    audioFileUrl: audioData?.audioFileUrl || data?.audioFileUrl || data?.audioUrl || '',
    audioUrl: audioData?.audioFileUrl || data?.audioUrl || '',
    isQuote: isQuote,
    quote: isQuote ? quoteData.quoteText : undefined,
    attribution: isQuote ? (quoteData.attribution || domain) : undefined,
    author: socialData?.authorName || docData?.authors || audioData?.artist || videoData?.channel || data?.author || undefined,
    artist: audioData?.artist || data?.author || undefined,
    publication: docData?.publication || socialData?.platformLabel || data?.publication || data?.domain || domain,
    title: title,
    subtitle: data?.description || caption,
    tldr: caption,
    body: body,
    paragraphs: data?.paragraphs || (body ? [body] : []),
    articleBody: data?.articleBody || body || '',
    source: clean,
    url: clean,
    imageUrl: heroImg || clean,
    heroImg: heroImg,
    price: price,
    isBuying: isBuying,
    isArticle: isArticle,
    date: dateStr,
    dateDetail: timeStr,
    palette: visualAnalysis?.palette || ['#1C1C1E', '#48484A', '#8E8E93', '#D1D1D6', '#F2F2F7'],
    paletteTones: visualAnalysis?.dominantColors || [],
    tags: Array.from(new Set(tags)),
    visualEmbedding: visualAnalysis?.visualEmbedding || null,
    isLiked: false,
    createdAt: Date.now()
  };

  EXACT_CARDS_DATA[memId] = newMem;
  await saveUserMemory(newMem);

  morphPlaceholderToMemory(placeholder, newMem);

  // Asynchronous Groq AI Intelligence for all link/article/video saves (EXCEPT products, audio, and raw sheets)
  const groqKey = localStorage.getItem('recall_groq_api_key') || (typeof window !== 'undefined' && window.GROQ_API_KEY);
  if (groqKey && !isBuying && !isAudio && !docData?.isSpreadsheet) {
    enrichMemoryWithGroq(newMem, groqKey).catch(() => {});
  }

  if (isBuying) {
    const displayDomain = getDisplaySource(clean);
    showToast(`Product saved: ${displayDomain} • ${price || title}`);
  } else if (isDocument) {
    const docLabel = docData?.isResearchPaper ? 'Research paper' : (docData?.isSpreadsheet ? 'Spreadsheet' : 'Document');
    showToast(`${docLabel} saved: "${title}"`);
  } else if (isSocial) {
    showToast(`${socialData?.platformLabel || 'Social post'} saved: "${title}"`);
  } else if (isAudio) {
    showToast(`${audioData?.platform || 'Audio'} saved: "${title}"`);
  } else if (isArticle) {
    showToast(`Article saved: "${title}"`);
  } else if (isQuote) {
    showToast(`Quote saved: "${title}"`);
  } else {
    showToast('Saved link preview');
  }
}

/* Wire up Global and Menu Copy/Paste Handlers */
function setupCopyPasteHandlers() {
  // 1. Menu "Paste from Clipboard"
  const menuPaste = document.getElementById('menuPaste');
  if (menuPaste) {
    menuPaste.addEventListener('click', async () => {
      const addMenu = document.getElementById('addMenu');
      if (addMenu) addMenu.classList.remove('open');
      try {
        if (navigator.clipboard && navigator.clipboard.read) {
          const items = await navigator.clipboard.read();
          for (const item of items) {
            const imageType = item.types.find(t => t.startsWith('image/'));
            if (imageType) {
              const blob = await item.getType(imageType);
              let clipImgUrl = '';
              if (item.types.includes('text/html')) {
                try {
                  const htmlBlob = await item.getType('text/html');
                  const html = await htmlBlob.text();
                  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
                  if (m && m[1] && !m[1].startsWith('data:image/svg')) clipImgUrl = m[1];
                } catch (e) {}
              }
              processPastedImageBlob(blob, clipImgUrl || 'Clipboard', null, clipImgUrl);
              return;
            }
            if (item.types.includes('text/plain')) {
              const textBlob = await item.getType('text/plain');
              const text = await textBlob.text();
              processPastedText(text);
              return;
            }
          }
        }
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            processPastedText(text);
            return;
          }
        }
        showToast('Clipboard is empty');
      } catch (err) {
        const text = prompt('Paste URL or Note text here:');
        if (text) processPastedText(text);
      }
    });
  }

  // 2. Global Paste (Cmd+V / Ctrl+V anywhere in window)
  window.addEventListener('paste', (e) => {
    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || document.activeElement.isContentEditable) {
      return; // allow default text typing in inputs
    }

    // Extract potential source image URL or web link from clipboard HTML or plain text
    let clipImgUrl = '';
    const html = e.clipboardData ? e.clipboardData.getData('text/html') : '';
    if (html) {
      const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m && m[1] && !m[1].startsWith('data:image/svg')) {
        clipImgUrl = m[1];
      }
    }
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!clipImgUrl && text && /^(https?:\/\/.*\.(?:png|jpe?g|webp|gif|avif|bmp|tiff)(?:\?.*)?)$/i.test(text.trim())) {
      clipImgUrl = text.trim();
    }

    const items = (e.clipboardData || window.clipboardData)?.items;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          if (blob) {
            processPastedImageBlob(blob, clipImgUrl || 'Pasted Screenshot', null, clipImgUrl);
            return;
          }
        }
      }
    }

    // Check HTML for <img> tag if copied from browser (without image item)
    if (clipImgUrl) {
      e.preventDefault();
      processPastedImageUrl(clipImgUrl);
      return;
    }

    if (text && text.trim()) {
      e.preventDefault();
      processPastedText(text.trim());
    }
  });

  // 3. Global Copy (Cmd+C / Ctrl+C on active memory)
  window.addEventListener('copy', (e) => {
    const sel = window.getSelection();
    if (sel && sel.toString().trim().length > 0) return;

    const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || document.activeElement.isContentEditable) return;

    if (activeCardId && EXACT_CARDS_DATA[activeCardId]) {
      const d = EXACT_CARDS_DATA[activeCardId];
      const textToCopy = `${d.title}\nSource: ${d.source}\n${d.tldr || ''}`;
      if (e.clipboardData) {
        e.clipboardData.setData('text/plain', textToCopy);
        e.preventDefault();
        showToast(`Copied "${d.title}" to clipboard`);
      }
    }
  });

  // 4. File input (Save Images or Files...)
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length === 0) return;
      // Allow browser to dismiss the native file dialog smoothly without UI freezing
      setTimeout(() => {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            processPastedImageBlob(file, file.name);
          } else if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|webm|ogg|aac)$/i)) {
            handleAudioFileUpload(file);
          } else if (file.name.match(/\.(pdf|xlsx|xls|csv|tsv|ods|docx|pptx)$/i)) {
            handleDocumentFileUpload(file);
          } else if (file.name.match(/\.(py|js|jsx|ts|tsx|rs|go|cpp|c|h|hpp|java|kt|swift|rb|php|sql|sh|bash|zsh|yaml|yml|json|toml|css|scss|html|vue|svelte|lua|r|zig|md)$/i)) {
            handleCodeFileUpload(file);
          } else {
            const reader = new FileReader();
            reader.onload = (evt) => processPastedText(evt.target.result);
            reader.readAsText(file);
          }
        }
      }, 30);
    });
  }

  // 5. Drag and Drop images, documents, audio, and code files onto the window
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (file.type.startsWith('image/')) {
          processPastedImageBlob(file, file.name);
        } else if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|webm|ogg|aac)$/i)) {
          handleAudioFileUpload(file);
        } else if (file.name.match(/\.(pdf|xlsx|xls|csv|tsv|ods|docx|pptx)$/i)) {
          handleDocumentFileUpload(file);
        } else if (file.name.match(/\.(py|js|jsx|ts|tsx|rs|go|cpp|c|h|hpp|java|kt|swift|rb|php|sql|sh|bash|zsh|yaml|yml|json|toml|css|scss|html|vue|svelte|lua|r|zig|md)$/i)) {
          handleCodeFileUpload(file);
        }
      }
    }
  });
}

/* ── Helper: Map Hex Colors to Semantic Tones ── */
function getTonesFromHex(hexStr) {
  if (!hexStr || typeof hexStr !== 'string') return [];
  const clean = hexStr.replace('#', '').trim();
  if (clean.length !== 6 && clean.length !== 3) return [];
  const fullHex = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const num = parseInt(fullHex, 16);
  if (isNaN(num)) return [];
  const r = (num >> 16) / 255.0;
  const g = ((num >> 8) & 0xff) / 255.0;
  const b = (num & 0xff) / 255.0;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2.0;

  const tones = new Set();
  if (l < 0.22) { tones.add('dark'); tones.add('black'); }
  if (l > 0.80 && delta < 0.25) { tones.add('light'); tones.add('white'); }
  if (delta < 0.14 && l >= 0.20 && l <= 0.80) { tones.add('gray'); }

  if (delta >= 0.10 && l >= 0.08) {
    let h = 0;
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;

    if (h >= 345 || h < 15) {
      tones.add('red');
    } else if (h >= 15 && h < 45) {
      tones.add('orange');
      tones.add('red');
      if (l < 0.58) tones.add('brown');
    } else if (h >= 45 && h < 70) {
      tones.add('yellow');
      if (l < 0.45) tones.add('brown');
    } else if (h >= 70 && h < 165) {
      tones.add('green');
    } else if (h >= 165 && h < 260) {
      tones.add('blue');
      tones.add('cyan');
    } else if (h >= 260 && h < 345) {
      tones.add('purple');
    }
  }
  return Array.from(tones);
}

function getCardTones(cardData) {
  const tones = new Set();
  (cardData.palette || []).forEach(hex => {
    getTonesFromHex(hex).forEach(t => tones.add(t));
  });
  (cardData.paletteTones || []).forEach(t => tones.add(t.toLowerCase()));
  (cardData.tags || []).forEach(t => {
    const tl = String(t).toLowerCase();
    if (['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'white', 'dark', 'light', 'brown', 'gray', 'crimson', 'cyan'].includes(tl)) {
      tones.add(tl);
    }
  });
  return tones;
}

/* ── Infinite Scroll & Progressive Masonry Mounting Engine ── */
const BATCH_SIZE = 60;
let currentFilteredIds = [];
let renderedCount = 0;
let infiniteScrollObserver = null;

function renderNextBatch() {
  if (renderedCount >= currentFilteredIds.length) return;
  const nextSlice = currentFilteredIds.slice(renderedCount, renderedCount + BATCH_SIZE);
  nextSlice.forEach(id => {
    const mem = EXACT_CARDS_DATA[id];
    if (mem && !document.querySelector(`.card-item[data-id="${id}"]`)) {
      renderCardInGrid(mem, false);
    }
  });
  renderedCount += nextSlice.length;
  reflowMasonry();
}

function initInfiniteScroll() {
  const scrollContainer = document.querySelector('.gallery-scroll');
  const sentinel = document.getElementById('scrollSentinel');
  if (!sentinel) return;

  if ('IntersectionObserver' in window) {
    if (infiniteScrollObserver) infiniteScrollObserver.disconnect();
    infiniteScrollObserver = new IntersectionObserver((entries) => {
      if (entries[0] && entries[0].isIntersecting) {
        renderNextBatch();
      }
    }, {
      root: scrollContainer || null,
      rootMargin: '600px',
      threshold: 0.01
    });
    infiniteScrollObserver.observe(sentinel);
  }

  if (scrollContainer && !scrollContainer._scrollListening) {
    scrollContainer._scrollListening = true;
    scrollContainer.addEventListener('scroll', () => {
      const scrollBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      if (scrollBottom < 700) {
        renderNextBatch();
      }
    }, { passive: true });
  }
}

/* ── Live Filtering (macOS Parity: Colors, Books, Articles, Liked, Notes, Images, Full-text) ── */
function filterCards() {
  const imagesOnly = Boolean(document.getElementById('filterImages')?.classList.contains('active'));
  const notesOnly = Boolean(document.getElementById('filterNotes')?.classList.contains('active'));
  const videosOnly = Boolean(document.getElementById('filterVideos')?.classList.contains('active'));
  const articlesOnly = Boolean(document.getElementById('filterArticles')?.classList.contains('active') || currentTab === 'Articles');
  const codeOnly = Boolean(document.getElementById('filterCode')?.classList.contains('active') || currentTab === 'Code');
  const documentsOnly = Boolean(currentTab === 'Documents');
  const audioOnly = Boolean(currentTab === 'Audio');
  const socialOnly = Boolean(currentTab === 'Social');
  const likedOnly = Boolean(document.getElementById('filterLiked')?.classList.contains('active') || currentNav === 'liked');

  // Build candidate items for searchEngine directly from EXACT_CARDS_DATA
  const candidateItems = [];
  const DEMO_IDS = new Set([
    'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
    'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
    'believe', 'redbull', 'memo', 'gtavi_hero'
  ]);
  for (const id in EXACT_CARDS_DATA) {
    if (deletedCardIdsSet.has(id) || DEMO_IDS.has(id)) continue;
    const d = EXACT_CARDS_DATA[id];
    if (!d || !d.id || d.isDemo) continue;

    const fullArticleText = `${d.articleBody || ''} ${Array.isArray(d.paragraphs) ? d.paragraphs.join(' ') : ''} ${d.description || ''} ${d.subtitle || ''} ${d.source || ''}`;
    const combinedBody = `${d.body || ''} ${fullArticleText}`.trim();

    candidateItems.push({
      id,
      title: d.title || '',
      searchableText: `${d.title || ''} ${d.ocrText || ''} ${d.tldr || ''} ${combinedBody} ${d.author || ''} ${d.channel || ''} ${d.publication || ''}`,
      ocrText: d.ocrText || '',
      tldr: d.tldr || '',
      body: combinedBody,
      author: d.author || d.channel || '',
      heroImg: d.heroImg || '',
      tags: d.tags || [],
      dominantColors: d.dominantColors || d.paletteTones || [],
      paletteTones: d.paletteTones || [],
      palette: d.palette || [],
      isBook: d.isBook || d.type === 'Book' || d.contentType === 'Book' || false,
      isQuote: d.isQuote || false,
      isBuying: d.isBuying || Boolean(d.price) || false,
      price: d.price || '',
      hasAnimals: d.hasAnimals || (d.tags || []).some(t => ['animal', 'animals', 'lion', 'tiger', 'bear', 'wildlife', 'wolf', 'leopard', 'cheetah', 'elephant', 'zebra'].includes(String(t).toLowerCase())) || false,
      visualEmbedding: d.visualEmbedding || null,
      embedding: d.embedding || null,
      contentType: d.contentType || d.type || 'image',
      type: d.type || 'image',
      isFavorite: Boolean(d.isLiked) || false,
      isArticle: Boolean(d.type === 'Article' || d.type === 'article' || d.isArticle || (d.tags && d.tags.includes('article'))),
      isAudio: Boolean(!d.isDocument && (d.isAudio || d.type === 'Audio' || d.type === 'audio' || d.audioUrl || d.audioEmbedUrl || d.audioProvider || (d.tags && (d.tags.includes('audio') || d.tags.includes('music') || d.tags.includes('spotify') || d.tags.includes('voicenote'))))),
      isSocial: Boolean(d.isSocial || d.socialPlatform || d.type === 'Social' || d.type === 'social' || (d.tags && d.tags.includes('social'))),
      isCode: Boolean(d.isCode || d.type === 'Code' || d.codeSnippet || (d.tags && d.tags.includes('code'))),
      isVideo: Boolean(d.isVideo || d.type === 'Video' || d.type === 'video' || (d.tags && d.tags.includes('video')))
    });
  }

  // Run SemanticSearch if query present
  let searchScoreMap = null;
  if (searchQuery && window.searchEngine) {
    const searchResults = window.searchEngine.search(searchQuery, candidateItems);
    searchScoreMap = new Map();
    for (const res of searchResults) {
      if (res.score > 0.08) {
        searchScoreMap.set(res.item.id, res.score);
      }
    }
  }

  const matchedItems = [];
  for (const item of candidateItems) {
    const id = item.id;
    const data = EXACT_CARDS_DATA[id] || {};
    let show = true;

    // 1. Color filter dropdown (macOS RecallColorFilter matching)
    if (selectedColorFilter) {
      const filterDef = (window.RECALL_COLOR_FILTERS || []).find(f => f.name.toLowerCase() === selectedColorFilter.toLowerCase());
      const tokens = filterDef ? filterDef.tokens : [selectedColorFilter.toLowerCase()];
      const cardHaystack = [
        data.title || '',
        (data.tags || []).join(' '),
        (data.dominantColors || []).join(' '),
        (data.paletteTones || []).join(' '),
        (data.palette || []).join(' '),
        data.ocrText || '',
        data.tldr || ''
      ].join(' ').toLowerCase();

      const matchesColor = tokens.some(t => cardHaystack.includes(t));
      if (!matchesColor) show = false;
    }

    // 2. Search Query (Text, OCR, Books, Colors, Quotes)
    if (show && searchQuery) {
      if (searchScoreMap) {
        if (!searchScoreMap.has(id)) show = false;
      } else {
        const extraArticle = `${data.articleBody || ''} ${Array.isArray(data.paragraphs) ? data.paragraphs.join(' ') : ''} ${data.body || ''} ${data.author || ''} ${data.publication || ''}`;
        const hay = `${data.title || ''} ${(data.tags || []).join(' ')} ${data.tldr || ''} ${data.ocrText || ''} ${extraArticle}`.toLowerCase();
        if (!hay.includes(searchQuery.toLowerCase())) show = false;
      }
    }

    // 3. Category & View Filtering
    if (show && likedOnly) {
      if (!data.isLiked) show = false;
    }

    if (show && documentsOnly) {
      const isDoc = Boolean(data.isDocument || data.type === 'Document' || data.isPDF || data.isSpreadsheet || data.isResearchPaper || (data.tags && (data.tags.includes('document') || data.tags.includes('paper') || data.tags.includes('pdf') || data.tags.includes('spreadsheet') || data.tags.includes('excel'))));
      if (!isDoc) show = false;
    }

    if (show && audioOnly) {
      const isAudio = Boolean(!data.isDocument && (data.isAudio || data.type === 'Audio' || data.type === 'audio' || data.audioUrl || data.audioEmbedUrl || data.audioProvider || (data.tags && (data.tags.includes('audio') || data.tags.includes('music') || data.tags.includes('spotify') || data.tags.includes('voicenote')))));
      if (!isAudio) show = false;
    }

    if (show && socialOnly) {
      const isSocial = Boolean(data.isSocial || data.socialPlatform || data.type === 'Social' || data.type === 'social' || (data.tags && (data.tags.includes('social') || data.tags.includes('twitter') || data.tags.includes('x') || data.tags.includes('reddit') || data.tags.includes('linkedin') || data.tags.includes('threads') || data.tags.includes('bluesky'))));
      if (!isSocial) show = false;
    }

    if (show && codeOnly) {
      const isCode = Boolean(data.isCode || data.type === 'Code' || data.codeSnippet || (data.tags && data.tags.includes('code')));
      if (!isCode) show = false;
    }

    if (show && articlesOnly) {
      const isArticle = Boolean(data.type === 'Article' || data.type === 'article' || data.isArticle || (data.tags && data.tags.includes('article')));
      if (!isArticle) show = false;
    }

    if (show && videosOnly) {
      const isVideo = Boolean(data.isVideo || data.type === 'Video' || data.type === 'video' || (data.tags && data.tags.includes('video')));
      if (!isVideo) show = false;
    }

    if (show && notesOnly) {
      const isNote = Boolean(data.type === 'document' || data.type === 'note' || data.type === 'Note' || data.isNote);
      if (!isNote) show = false;
    }

    if (show && imagesOnly) {
      const isNote = Boolean(data.type === 'note' || data.type === 'Note' || data.isNote);
      const hasImg = Boolean(data.heroImg && (data.heroImg.startsWith('http') || data.heroImg.startsWith('data:')));
      if (isNote || !hasImg) show = false;
    }

    if (show) {
      matchedItems.push({
        id,
        score: searchScoreMap ? (searchScoreMap.get(id) || 0) : 0
      });
    }
  }

  // Sort matching items: if searching, sort by search score descending; otherwise sort chronologically
  if (searchQuery && searchScoreMap) {
    matchedItems.sort((a, b) => b.score - a.score);
  } else {
    matchedItems.sort((a, b) => getCardSortIndex(a.id) - getCardSortIndex(b.id));
  }

  currentFilteredIds = matchedItems.map(m => m.id);

  // Update subhead count
  const countEl = document.getElementById('subheadCount');
  if (countEl) {
    countEl.textContent = `${currentFilteredIds.length} memories`;
  }

  // Note Add Card visibility
  const noteAddCard = document.getElementById('noteAddCard');
  if (noteAddCard) {
    noteAddCard.style.display = (searchQuery || selectedColorFilter || imagesOnly || articlesOnly || likedOnly || videosOnly || documentsOnly || audioOnly || socialOnly || codeOnly) ? 'none' : 'flex';
  }

  // Clear existing rendered cards from grid (keeps #noteAddCard safe)
  document.querySelectorAll('.card-item[data-id]').forEach(c => c.remove());
  renderedCount = 0;

  // Render initial batch
  renderNextBatch();
}

function showToast(msg, onUndo = null) {
  toast.innerHTML = '';
  const span = document.createElement('span');
  span.className = 'toast-msg';
  span.textContent = msg;
  toast.appendChild(span);

  if (onUndo) {
    const undoBtn = document.createElement('button');
    undoBtn.className = 'toast-undo-btn';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.classList.remove('visible');
      clearTimeout(window._toastT);
      onUndo();
    });
    toast.appendChild(undoBtn);
  }

  toast.classList.add('visible');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => toast.classList.remove('visible'), onUndo ? 4500 : 2200);
}
