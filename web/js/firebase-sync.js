/**
 * Recall Web — Real-Time Firebase Sync & Google Authentication
 * Automatically syncs memories across multiple laptops, tablets, and phones in real-time.
 */

'use strict';

const firebaseConfig = {
  apiKey: "AIzaSyAQDrSKmhPgTmknEzASz9EdQRtoAA48wH8",
  authDomain: "pyq-prep.firebaseapp.com",
  projectId: "pyq-prep",
  storageBucket: "pyq-prep.firebasestorage.app",
  messagingSenderId: "1060273710874",
  appId: "1:1060273710874:web:6ec83727f86e353429aea3",
  measurementId: "G-12DMT3JGM6"
};

class FirebaseSyncEngine {
  constructor() {
    this.app = null;
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.unsubscribeSnapshot = null;
    this.unsubscribeDeleted = null;
    this.unsubscribeUserSettings = null;
    this.isInitialSnapshotDone = false;
    this.isSyncing = false;

    this.init();
  }

  init() {
    if (typeof firebase === 'undefined') {
      console.warn('[Firebase Sync] Firebase SDK not loaded');
      return;
    }

    try {
      this.app = firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
      this.auth = firebase.auth();
      this.db = firebase.firestore();

      // Enable local offline persistence & ignore undefined properties
      try {
        this.db.settings({ ignoreUndefinedProperties: true });
        // Safari / WebKit has IndexedDB concurrency limitations; avoid multi-tab persistence lock on Safari
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        if (!isSafari) {
          this.db.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.warn('[Firebase Sync] Offline persistence note:', err.code);
          });
        } else {
          console.log('[Firebase Sync] WebKit/Safari detected: using direct WebSocket streaming for reliable real-time updates.');
        }
      } catch (e) {}

      // Auth state listener
      this.auth.onAuthStateChanged(user => this.handleAuthStateChange(user));

      // Wire up UI buttons when DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.setupUI());
      } else {
        this.setupUI();
      }
    } catch (err) {
      console.error('[Firebase Sync Init Error]', err);
    }
  }

  setupUI() {
    // 1. Sidebar Sign-In Button
    const signInBtn = document.getElementById('sidebarSignInBtn');
    if (signInBtn) {
      signInBtn.addEventListener('click', () => this.signInWithGoogle());
    }

    // 2. Sidebar Sign-Out Button
    const signOutBtn = document.getElementById('sidebarSignOutBtn');
    if (signOutBtn) {
      signOutBtn.addEventListener('click', () => this.signOut());
    }

    // 4. Tab Visibility Listener (instantly resumes & verifies sync when user switches back to Safari)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.currentUser && this.db) {
        const userDoc = this.db.collection('users').doc(this.currentUser.uid);
        this.uploadLocalMemoriesToCloud(userDoc.collection('memories'), userDoc.collection('deleted_ids'));
      }
    });

    // 5. Global live sync broadcast channel (instant cross-tab sync without Firestore latency)
    try {
      this.syncChannel = new BroadcastChannel('recall_live_sync');
      this.syncChannel.onmessage = (event) => {
        const { type, memory, id } = event.data || {};
        if (type === 'NEW_MEMORY' && memory && memory.id) {
          if (typeof EXACT_CARDS_DATA !== 'undefined') {
            EXACT_CARDS_DATA[memory.id] = memory;
          }
          const existingCard = document.querySelector(`.card-item[data-id="${CSS.escape(String(memory.id))}"]`);
          if (!existingCard) {
            if (memory.isNote || memory.type === 'note' || memory.type === 'Note') {
              if (typeof renderNoteCardInGrid === 'function') renderNoteCardInGrid(memory);
            } else if (typeof renderCardInGrid === 'function') {
              renderCardInGrid(memory, true);
            }
            if (typeof reflowMasonry === 'function') reflowMasonry();
            if (typeof updateMemoryCount === 'function') updateMemoryCount();
          }
        } else if (type === 'DELETE_MEMORY' && id) {
          if (typeof deleteMemory === 'function') deleteMemory(id, false);
        }
      };
    } catch (e) {}

    // 3. Settings Sign-In & Sign-Out Buttons
    const settingsSignInBtn = document.getElementById('settingsSignInBtn');
    if (settingsSignInBtn) {
      settingsSignInBtn.addEventListener('click', () => this.signInWithGoogle());
    }
    const settingsSignOutBtn = document.getElementById('settingsSignOutBtn');
    if (settingsSignOutBtn) {
      settingsSignOutBtn.addEventListener('click', () => this.signOut());
    }

    // 4. Modal Auth Gate Sign-In Button (Mandatory Gate)
    const authGateBtn = document.getElementById('authGateGoogleSignInBtn');
    if (authGateBtn) {
      authGateBtn.addEventListener('click', () => this.signInWithGoogle());
    }
  }

  showAuthGate() {
    const gate = document.getElementById('recallAuthGate');
    if (gate) {
      gate.style.display = 'flex';
      gate.classList.remove('hidden');
      // Small tick to ensure smooth CSS transition if visible
      requestAnimationFrame(() => {
        gate.classList.add('active');
      });
    }
    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.style.filter = 'blur(20px)';
      appShell.style.pointerEvents = 'none';
      appShell.style.userSelect = 'none';
      appShell.setAttribute('aria-hidden', 'true');
    }
  }

  hideAuthGate() {
    const gate = document.getElementById('recallAuthGate');
    if (gate) {
      gate.classList.remove('active');
      gate.classList.add('hidden');
      gate.style.display = 'none';
    }
    const appShell = document.querySelector('.app-shell');
    if (appShell) {
      appShell.style.filter = '';
      appShell.style.pointerEvents = '';
      appShell.style.userSelect = '';
      appShell.removeAttribute('aria-hidden');
    }
  }

  async signInWithGoogle() {
    if (!this.auth) return;
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('profile');
      provider.addScope('email');
      provider.setCustomParameters({ prompt: 'select_account' });

      if (typeof showToast === 'function') showToast('Connecting to Google…');
      await this.auth.signInWithPopup(provider);
    } catch (err) {
      console.error('[Google Sign-In Error]', err);
      if (err.code === 'auth/popup-blocked') {
        // Fallback to redirect if popup is blocked (common in Safari on iOS/macOS)
        try {
          const provider = new firebase.auth.GoogleAuthProvider();
          await this.auth.signInWithRedirect(provider);
        } catch (redirErr) {
          alert('Please allow popups for this site to sign in with Google.');
        }
      } else if (err.code === 'auth/unauthorized-domain') {
        alert('This domain is not authorized in your Firebase Console. Please add ' + window.location.hostname + ' to Firebase Console -> Authentication -> Settings -> Authorized Domains.');
      } else if (err.code !== 'auth/popup-closed-by-user') {
        alert('Sign in failed: ' + err.message);
      }
    }
  }

  async signOut() {
    if (!this.auth) return;
    try {
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }
      if (this.unsubscribeDeleted) {
        this.unsubscribeDeleted();
        this.unsubscribeDeleted = null;
      }
      if (this.unsubscribeUserSettings) {
        this.unsubscribeUserSettings();
        this.unsubscribeUserSettings = null;
      }
      localStorage.removeItem('recall_logged_in');
      localStorage.removeItem('recall_current_user_uid');
      if (window.recallStorage) {
        await window.recallStorage.clearLocalUserCache();
      }
      if (typeof clearGridOnSignOut === 'function') {
        clearGridOnSignOut();
      }
      await this.auth.signOut();
      this.showAuthGate();
      if (typeof showToast === 'function') {
        showToast('Signed out.');
      }
    } catch (err) {
      console.error('[Sign-Out Error]', err);
    }
  }

  async handleAuthStateChange(user) {
    this.currentUser = user;
    this.updateUserUI(user);

    if (user) {
      console.log(`[Firebase Sync] Signed in as ${user.displayName} (${user.email})`);
      localStorage.setItem('recall_logged_in', 'true');
      localStorage.removeItem('recall_user_cleared_all'); // Clear any stale clear-all lock so cloud memories always stream
      this.hideAuthGate();

      // Check if switching accounts or if a new user logged in on this browser
      const lastUid = localStorage.getItem('recall_current_user_uid');
      if (lastUid && lastUid !== user.uid) {
        console.log(`[Firebase Sync] Switching accounts from ${lastUid} to ${user.uid}. Clearing local cache.`);
        if (window.recallStorage) {
          await window.recallStorage.clearLocalUserCache();
        }
        if (typeof clearGridOnSignOut === 'function') {
          clearGridOnSignOut();
        }
      }
      localStorage.setItem('recall_current_user_uid', user.uid);
      this.syncUserSettings(user);
      this.startRealtimeSync(user);
    } else {
      console.log('[Firebase Sync] Signed out. Prompting for mandatory login.');
      localStorage.removeItem('recall_logged_in');
      localStorage.removeItem('recall_current_user_uid');
      if (this.unsubscribeSnapshot) {
        this.unsubscribeSnapshot();
        this.unsubscribeSnapshot = null;
      }
      if (this.unsubscribeDeleted) {
        this.unsubscribeDeleted();
        this.unsubscribeDeleted = null;
      }
      if (this.unsubscribeUserSettings) {
        this.unsubscribeUserSettings();
        this.unsubscribeUserSettings = null;
      }
      if (window.recallStorage) {
        await window.recallStorage.clearLocalUserCache();
      }
      if (typeof clearGridOnSignOut === 'function') {
        clearGridOnSignOut();
      }
      this.showAuthGate();
    }
  }

  updateUserUI(user) {
    const signInBtn = document.getElementById('sidebarSignInBtn');
    const userProfile = document.getElementById('sidebarUserProfile');
    const userAvatar = document.getElementById('sidebarUserAvatar');
    const userName = document.getElementById('sidebarUserName');
    const syncStatus = document.getElementById('sidebarSyncStatus');

    // Settings elements
    const settingsLoggedOut = document.getElementById('settingsAuthLoggedOut');
    const settingsLoggedIn = document.getElementById('settingsAuthLoggedIn');
    const settingsUserEmail = document.getElementById('settingsUserEmail');

    if (user) {
      if (signInBtn) signInBtn.style.display = 'none';
      if (userProfile) userProfile.style.display = 'inline-flex';
      if (userAvatar) userAvatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=ff5e3a&color=fff`;
      if (userName) userName.textContent = (user.displayName || user.email.split('@')[0]).split(' ')[0];
      if (syncStatus) syncStatus.textContent = user.email ? `${user.email.split('@')[0]} • Live Sync` : 'Live Cloud Sync';

      if (settingsLoggedOut) settingsLoggedOut.style.display = 'none';
      if (settingsLoggedIn) settingsLoggedIn.style.display = 'flex';
      if (settingsUserEmail) settingsUserEmail.textContent = user.email;
    } else {
      if (signInBtn) signInBtn.style.display = 'inline-flex';
      if (userProfile) userProfile.style.display = 'none';

      if (settingsLoggedOut) settingsLoggedOut.style.display = 'flex';
      if (settingsLoggedIn) settingsLoggedIn.style.display = 'none';
    }
  }

  /**
   * Sync User Profile Settings (Groq API Key, Groq Model, Preferences)
   * Securely saves and syncs AI credentials across Chrome, Safari, and other devices.
   */
  syncUserSettings(user) {
    if (!this.db || !user) return;
    try {
      if (this.unsubscribeUserSettings) {
        this.unsubscribeUserSettings();
        this.unsubscribeUserSettings = null;
      }

      const userDocRef = this.db.collection('users').doc(user.uid);
      this.unsubscribeUserSettings = userDocRef.onSnapshot((doc) => {
        const localGroqKey = localStorage.getItem('recall_groq_api_key') || '';
        const localGroqModel = localStorage.getItem('recall_groq_model') || 'qwen/qwen3.8-27b';

        if (doc && doc.exists) {
          const data = doc.data() || {};
          if (data.groqApiKey) {
            if (data.groqApiKey !== localGroqKey || (data.groqModel && data.groqModel !== localGroqModel)) {
              console.log('[Firebase Sync] Synced Groq AI key from user cloud account.');
              localStorage.setItem('recall_groq_api_key', data.groqApiKey);
              if (data.groqModel) {
                localStorage.setItem('recall_groq_model', data.groqModel);
              }
              if (typeof window.updateGroqUIFromStorage === 'function') {
                window.updateGroqUIFromStorage();
              }
            }
          } else if (localGroqKey) {
            // Firestore has no groqApiKey yet, but local browser (e.g. Chrome) has one: upload it to cloud securely
            userDocRef.set({
              groqApiKey: localGroqKey,
              groqModel: localGroqModel,
              updatedAt: Date.now()
            }, { merge: true }).catch(err => console.warn('[Firebase Sync] Push local key error:', err));
          }
        } else if (localGroqKey) {
          userDocRef.set({
            groqApiKey: localGroqKey,
            groqModel: localGroqModel,
            updatedAt: Date.now()
          }, { merge: true }).catch(err => console.warn('[Firebase Sync] Push local key error:', err));
        }
      }, (err) => {
        console.warn('[Firebase Sync] User settings snapshot error:', err);
      });
    } catch (e) {
      console.warn('[Firebase Sync] syncUserSettings error:', e);
    }
  }

  /**
   * Save user settings (such as Groq API key) securely to Firestore user document
   */
  async saveUserSettings(settings) {
    if (!this.db) return false;
    const user = this.currentUser || (this.auth && this.auth.currentUser);
    if (!user) return false;
    try {
      const userDocRef = this.db.collection('users').doc(user.uid);
      await userDocRef.set({
        ...settings,
        updatedAt: Date.now()
      }, { merge: true });
      console.log('[Firebase Sync] User settings successfully saved to cloud account.');
      return true;
    } catch (err) {
      console.error('[Firebase Sync] Failed to save user settings to cloud:', err);
      return false;
    }
  }

  /**
   * Real-Time Firestore Sync
   * Bidirectionally merges cloud memories and cloud deletions across all devices
   */
  startRealtimeSync(user) {
    if (!this.db || !user) return;

    const userDoc = this.db.collection('users').doc(user.uid);
    const userMemoriesCol = userDoc.collection('memories');
    const userDeletedCol = userDoc.collection('deleted_ids');

    // Clean up previous listeners if any
    if (this.unsubscribeSnapshot) {
      this.unsubscribeSnapshot();
      this.unsubscribeSnapshot = null;
    }
    if (this.unsubscribeDeleted) {
      this.unsubscribeDeleted();
      this.unsubscribeDeleted = null;
    }

    const DEMO_IDS = new Set([
      'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
      'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
      'believe', 'redbull', 'memo', 'gtavi_hero'
    ]);

    // 1. Cross-Device Real-Time Deletion Sync: Listen to deleted_ids subcollection
    this.unsubscribeDeleted = userDeletedCol.onSnapshot(delSnap => {
      let hasDeletions = false;
      delSnap.docChanges().forEach(change => {
        const delId = change.doc.id;
        if (change.type === 'added' || change.type === 'modified') {
          if (typeof deletedCardIdsSet !== 'undefined') {
            if (!deletedCardIdsSet.has(delId)) {
              deletedCardIdsSet.add(delId);
              hasDeletions = true;
            }
          }
          if (typeof EXACT_CARDS_DATA !== 'undefined' && EXACT_CARDS_DATA[delId]) {
            delete EXACT_CARDS_DATA[delId];
          }
          if (window.recallStorage) {
            window.recallStorage.deleteMemory(delId).catch(() => {});
          }
          const el = document.querySelector(`.card-item[data-id="${CSS.escape(String(delId))}"]`);
          if (el) {
            el.remove();
            hasDeletions = true;
          }
          // Ensure it does not linger in user's cloud memories
          userMemoriesCol.doc(delId).delete().catch(() => {});
        } else if (change.type === 'removed') {
          // Card was restored (Undo) on another device
          if (typeof deletedCardIdsSet !== 'undefined') {
            deletedCardIdsSet.delete(delId);
            localStorage.setItem('recall_deleted_ids', JSON.stringify([...deletedCardIdsSet]));
          }
        }
      });

      if (hasDeletions) {
        if (typeof deletedCardIdsSet !== 'undefined') {
          localStorage.setItem('recall_deleted_ids', JSON.stringify([...deletedCardIdsSet]));
        }
        if (typeof reflowMasonry === 'function') reflowMasonry();
        if (typeof updateMemoryCount === 'function') updateMemoryCount();
      }
    }, err => {
      console.warn('[Firebase Sync Deleted Listener Error]', err);
    });

    // 2. Push any existing local deletions up to cloud so other devices (Safari/tablets) know
    if (typeof deletedCardIdsSet !== 'undefined' && deletedCardIdsSet.size > 0) {
      const deletedArr = Array.from(deletedCardIdsSet);
      for (let i = 0; i < deletedArr.length; i += 300) {
        const chunk = deletedArr.slice(i, i + 300);
        const batch = this.db.batch();
        chunk.forEach(dId => {
          batch.set(userDeletedCol.doc(dId), { id: dId, deletedAt: Date.now() }, { merge: true });
          batch.delete(userMemoriesCol.doc(dId));
        });
        batch.commit().catch(e => console.warn('[Firebase Sync Push Deleted Error]', e));
      }
    }

    // 3. First sync any local pre-existing memories up to Firestore
    this.uploadLocalMemoriesToCloud(userMemoriesCol, userDeletedCol);

    // 4. Background cleanup of legacy contaminated or demo memories
    this.cleanStaleCloudMemories().catch(() => {});

    // 5. Real-time snapshot listener (instantly receives edits & new memories from other laptops)
    this.unsubscribeSnapshot = userMemoriesCol.onSnapshot(snapshot => {
      let hasChanges = false;

      snapshot.docChanges().forEach(change => {
        // Ignore local optimistic writes (this tab already rendered its own save)
        if (change.doc.metadata && change.doc.metadata.hasPendingWrites) {
          return;
        }

        const mem = change.doc.data();
        if (!mem || !mem.id) return;

        // Permanently purge any demo memory that was ever pushed to user's Firestore
        const titleStr = (mem.title || '').toLowerCase();
        const bodyStr = (mem.body || '').toLowerCase();
        const quoteStr = (mem.quote || '').toLowerCase();
        const isContaminated = titleStr.includes('abhinav dumb') || bodyStr.includes('abhinav dumb') || quoteStr.includes('abhinav dumb');
        const isMismatched = Boolean(mem.userId && user.uid && mem.userId !== user.uid);

        if (DEMO_IDS.has(mem.id) || mem.isDemo || isContaminated || isMismatched) {
          userMemoriesCol.doc(change.doc.id).delete().catch(() => {});
          if (window.recallStorage) window.recallStorage.deleteMemory(mem.id).catch(() => {});
          if (typeof EXACT_CARDS_DATA !== 'undefined') delete EXACT_CARDS_DATA[mem.id];
          const card = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
          if (card) card.remove();
          return;
        }

        // If marked deleted locally or on any synced device
        if (typeof deletedCardIdsSet !== 'undefined' && deletedCardIdsSet.has(mem.id)) {
          userMemoriesCol.doc(change.doc.id).delete().catch(() => {});
          userDeletedCol.doc(change.doc.id).set({ id: mem.id, deletedAt: Date.now() }, { merge: true }).catch(() => {});
          return;
        }

        if (change.type === 'added' || change.type === 'modified') {
          const existing = typeof EXACT_CARDS_DATA !== 'undefined' ? EXACT_CARDS_DATA[mem.id] : null;
          if (typeof EXACT_CARDS_DATA !== 'undefined') {
            EXACT_CARDS_DATA[mem.id] = mem;
          }

          // Save to local IndexedDB
          if (window.recallStorage) {
            window.recallStorage.saveMemory(mem).catch(() => {});
          }

          // Update Grid UI — strictly avoid duplicate card creation
          const existingCard = document.querySelector(`.card-item[data-id="${CSS.escape(String(mem.id))}"]`);
          if (!existingCard) {
            if (mem.isNote || mem.type === 'note' || mem.type === 'Note') {
              if (typeof renderNoteCardInGrid === 'function') {
                renderNoteCardInGrid(mem);
                hasChanges = true;
              }
            } else if (typeof renderCardInGrid === 'function') {
              renderCardInGrid(mem, true);
              hasChanges = true;
            }
          } else if (existing) {
            if (typeof populateCardContent === 'function') {
              populateCardContent(existingCard, mem);
              hasChanges = true;
            }
          }
        } else if (change.type === 'removed') {
          if (typeof deleteMemory === 'function') {
            deleteMemory(change.doc.id, false);
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        if (typeof reflowMasonry === 'function') reflowMasonry();
        if (typeof updateMemoryCount === 'function') updateMemoryCount();
        if (this.isInitialSnapshotDone && typeof showToast === 'function') {
          showToast('Updated live from another device');
        }
      }
      this.isInitialSnapshotDone = true;
    }, err => {
      console.warn('[Firebase Sync Listener Error]', err);
    });
  }

  /**
   * Uploads any memories created offline or before login up to Firestore
   */
  async uploadLocalMemoriesToCloud(userMemoriesCol, userDeletedCol) {
    if (this.isSyncing) return;
    this.isSyncing = true;

    try {
      // Collect memories from BOTH IndexedDB and EXACT_CARDS_DATA to prevent anything from being missed
      const memMap = new Map();
      if (typeof EXACT_CARDS_DATA !== 'undefined') {
        Object.values(EXACT_CARDS_DATA).forEach(m => {
          if (m && m.id) memMap.set(m.id, m);
        });
      }
      if (window.recallStorage) {
        const stored = await window.recallStorage.getAllMemories();
        (stored || []).forEach(m => {
          if (m && m.id) memMap.set(m.id, m);
        });
      }
      let localList = Array.from(memMap.values());

      // Filter out any memories that belong to a different user account or are contaminated
      const currentUid = this.currentUser ? this.currentUser.uid : null;
      localList = localList.filter(mem => {
        if (!mem || !mem.id) return false;
        const title = (mem.title || '').toLowerCase();
        const body = (mem.body || '').toLowerCase();
        const quote = (mem.quote || '').toLowerCase();
        if (title.includes('abhinav dumb') || body.includes('abhinav dumb') || quote.includes('abhinav dumb')) {
          if (window.recallStorage) window.recallStorage.deleteMemory(mem.id).catch(() => {});
          return false;
        }
        if (mem.userId && currentUid && mem.userId !== currentUid) return false;
        return true;
      });

      if (localList.length === 0) {
        this.isSyncing = false;
        return;
      }

      const batch = this.db.batch();
      let batchCount = 0;

      const DEMO_IDS = new Set([
        'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
        'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
        'believe', 'redbull', 'memo', 'gtavi_hero'
      ]);

      for (const mem of localList) {
        if (!mem || !mem.id) continue;
        if (DEMO_IDS.has(mem.id) || mem.isDemo) {
          if (window.recallStorage) window.recallStorage.deleteMemory(mem.id).catch(() => {});
          if (userMemoriesCol) userMemoriesCol.doc(mem.id).delete().catch(() => {});
          continue;
        }
        if (typeof deletedCardIdsSet !== 'undefined' && deletedCardIdsSet.has(mem.id)) {
          if (userMemoriesCol) userMemoriesCol.doc(mem.id).delete().catch(() => {});
          if (userDeletedCol) userDeletedCol.doc(mem.id).set({ id: mem.id, deletedAt: Date.now() }, { merge: true }).catch(() => {});
          continue;
        }

        if (currentUid) {
          mem.userId = currentUid;
        }
        try {
          const docRef = userMemoriesCol.doc(mem.id);
          const cleanMem = this.sanitizeMemory(mem);
          batch.set(docRef, cleanMem, { merge: true });
          batchCount++;
        } catch (itemErr) {
          console.warn('[Firebase Sync Single Doc Error]', mem.id, itemErr);
        }

        if (batchCount >= 400) {
          await batch.commit();
          batchCount = 0;
        }
      }

      if (batchCount > 0) {
        await batch.commit();
      }
      console.log(`[Firebase Sync] Backed up ${localList.length} local memories to Cloud.`);
    } catch (e) {
      console.warn('[Firebase Sync Initial Upload Error]', e);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Public action to force an immediate re-upload of all local memories to Cloud
   */
  async forceSyncAllLocalMemories() {
    if (!this.db || !this.currentUser) return { success: false, reason: 'Please sign in first' };
    const userDoc = this.db.collection('users').doc(this.currentUser.uid);
    const userMemoriesCol = userDoc.collection('memories');
    const userDeletedCol = userDoc.collection('deleted_ids');
    this.isSyncing = false;
    await this.uploadLocalMemoriesToCloud(userMemoriesCol, userDeletedCol);
    return { success: true };
  }

  /**
   * Save a single memory to Firestore in real-time
   */
  async saveMemoryToFirestore(mem) {
    const user = this.currentUser || (this.auth ? this.auth.currentUser : null) || (typeof firebase !== 'undefined' && firebase.auth ? firebase.auth().currentUser : null);
    if (!this.db || !user || !mem || !mem.id) {
      console.warn('[Firebase Sync] Cannot save memory: missing db or user auth', { hasDb: Boolean(this.db), hasUser: Boolean(user) });
      return;
    }
    try {
      mem.userId = user.uid;
      const userDoc = this.db.collection('users').doc(user.uid);
      const docRef = userDoc.collection('memories').doc(mem.id);
      const cleanMem = this.sanitizeMemory(mem);
      await docRef.set(cleanMem, { merge: true });
      // If was previously in deleted_ids, remove from deleted_ids
      await userDoc.collection('deleted_ids').doc(mem.id).delete().catch(() => {});
      console.log(`[Firebase Sync] Live pushed memory "${mem.title || mem.id}" to Cloud.`);

      // Broadcast to local tabs
      if (this.syncChannel) {
        this.syncChannel.postMessage({ type: 'NEW_MEMORY', memory: cleanMem });
      }
    } catch (err) {
      console.error('[Firebase Save Memory Error]', err);
    }
  }

  /**
   * Delete a memory from Firestore and sync across all devices via deleted_ids
   */
  async deleteMemoryFromFirestore(memId) {
    if (!this.db || !this.currentUser || !memId) return;
    try {
      const userDoc = this.db.collection('users').doc(this.currentUser.uid);
      const batch = this.db.batch();
      batch.delete(userDoc.collection('memories').doc(memId));
      batch.set(userDoc.collection('deleted_ids').doc(memId), { id: memId, deletedAt: Date.now() }, { merge: true });
      await batch.commit();
    } catch (err) {
      console.error('[Firebase Delete Memory Error]', err);
    }
  }

  /**
   * Restore a memory on Undo and remove from deleted_ids
   */
  async restoreMemoryInFirestore(memId, snapshot) {
    if (!this.db || !this.currentUser || !memId) return;
    try {
      const userDoc = this.db.collection('users').doc(this.currentUser.uid);
      const batch = this.db.batch();
      batch.delete(userDoc.collection('deleted_ids').doc(memId));
      if (snapshot) {
        const cleanMem = this.sanitizeMemory(snapshot);
        batch.set(userDoc.collection('memories').doc(memId), cleanMem, { merge: true });
      }
      await batch.commit();
    } catch (err) {
      console.error('[Firebase Restore Memory Error]', err);
    }
  }

  /**
   * Clean up all stale, demo, contaminated, or cross-browser deleted cards
   */
  async cleanStaleCloudMemories() {
    if (!this.db || !this.currentUser) return;
    try {
      const userDoc = this.db.collection('users').doc(this.currentUser.uid);
      const memCol = userDoc.collection('memories');
      const delCol = userDoc.collection('deleted_ids');

      const snapshot = await memCol.get();
      if (snapshot.empty) return;

      const DEMO_IDS = new Set([
        'lion', 'lion_card', 'lion_hero', 'tables', 'youattract',
        'fran', 'tryagain', 'givingup', 'orange_silhouette', 'studio',
        'believe', 'redbull', 'memo', 'gtavi_hero'
      ]);

      const batch = this.db.batch();
      let count = 0;

      snapshot.docs.forEach(doc => {
        const d = doc.data();
        const docId = doc.id;
        const title = (d?.title || '').toLowerCase();
        const body = (d?.body || '').toLowerCase();
        const quote = (d?.quote || '').toLowerCase();
        const isContaminated = title.includes('abhinav dumb') || body.includes('abhinav dumb') || quote.includes('abhinav dumb');
        const isDeleted = typeof deletedCardIdsSet !== 'undefined' && deletedCardIdsSet.has(docId);
        const isDemo = DEMO_IDS.has(docId) || Boolean(d?.isDemo);
        const isMismatched = Boolean(d?.userId && this.currentUser.uid && d.userId !== this.currentUser.uid);

        if (isDeleted || isDemo || isContaminated || isMismatched) {
          batch.delete(doc.ref);
          if (isDeleted) {
            batch.set(delCol.doc(docId), { id: docId, deletedAt: Date.now() }, { merge: true });
          }
          if (typeof EXACT_CARDS_DATA !== 'undefined' && EXACT_CARDS_DATA[docId]) {
            delete EXACT_CARDS_DATA[docId];
          }
          if (window.recallStorage) {
            window.recallStorage.deleteMemory(docId).catch(() => {});
          }
          const el = document.querySelector(`.card-item[data-id="${CSS.escape(String(docId))}"]`);
          if (el) el.remove();
          count++;
        }
      });

      if (count > 0) {
        await batch.commit();
        console.log(`[Firebase Sync] Cleaned ${count} stale/deleted memories from cloud.`);
        if (typeof reflowMasonry === 'function') reflowMasonry();
        if (typeof updateMemoryCount === 'function') updateMemoryCount();
      }
    } catch (e) {
      console.warn('[Firebase Sync Clean Stale Cloud Memories Error]', e);
    }
  }

  /**
   * Delete ALL memories from Firestore for this user
   */
  async clearAllMemoriesFromFirestore() {
    if (!this.db || !this.currentUser) return;
    try {
      const userDoc = this.db.collection('users').doc(this.currentUser.uid);
      const colRef = userDoc.collection('memories');
      const delRef = userDoc.collection('deleted_ids');

      const snapshot = await colRef.get();
      if (!snapshot.empty) {
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const batch = this.db.batch();
          const chunk = docs.slice(i, i + 400);
          chunk.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      }

      const delSnap = await delRef.get();
      if (!delSnap.empty) {
        const delDocs = delSnap.docs;
        for (let i = 0; i < delDocs.length; i += 400) {
          const batch = this.db.batch();
          const chunk = delDocs.slice(i, i + 400);
          chunk.forEach(doc => batch.delete(doc.ref));
          await batch.commit();
        }
      }

      console.log(`[Firebase Sync] Cleared all cloud memories & deleted records`);
    } catch (err) {
      console.error('[Firebase Clear All Error]', err);
    }
  }

  /**
   * Strips undefined and invalid types (e.g. Float32Array typed arrays) for Firestore compatibility
   */
  sanitizeMemory(mem) {
    if (!mem || typeof mem !== 'object') return {};
    const clean = {};
    for (const [k, v] of Object.entries(mem)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;

      if ((k === 'visualEmbedding' || k === 'embedding') && (Array.isArray(v) || ArrayBuffer.isView(v))) {
        clean[k] = Array.from(v).slice(0, 512);
      } else if (ArrayBuffer.isView(v)) {
        clean[k] = Array.from(v);
      } else if (k === 'audioUrl' || k === 'audioFileUrl') {
        if (typeof v === 'string' && v.startsWith('data:') && v.length > 700000) {
          clean[k] = '';
        } else {
          clean[k] = v;
        }
      } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        clean[k] = this.sanitizeMemory(v);
      } else {
        clean[k] = v;
      }
    }
    try {
      return JSON.parse(JSON.stringify(clean));
    } catch (e) {
      return clean;
    }
  }
}

// Expose globally
window.firebaseSync = new FirebaseSyncEngine();
