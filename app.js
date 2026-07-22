const CLIENT_ID = '6sxijlqtwr8h6zk'; // Replace with your App Key. NEVER put your App Secret here.

// --- Theme Initialization ---
const savedTheme = localStorage.getItem('onespot_theme') || 'light';

// --- Auth URL Normalization ---
let cleanPath = window.location.pathname;
if (cleanPath.endsWith('index.html')) {
    cleanPath = cleanPath.replace('index.html', '');
    window.history.replaceState({}, document.title, window.location.origin + cleanPath + window.location.hash);
}
const REDIRECT_URI = window.location.origin + cleanPath;
console.log('[OneSpot Auth Debug] Normalized REDIRECT_URI:', REDIRECT_URI);

let dbxAuth = null;
let dbx = null;
let dataFileRev = null; 

let entries = [];
let selectedIds = [];
let selectedTags = [];
let lastSelectionTime = 0;

// --- Utilities ---
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeUrl(url) {
  if (!url) return '';
  return url.replace(/["<>]/g, '');
}

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function showConfirm(title, message) {
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <div class="confirm-modal">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="confirm-actions">
          <button class="confirm-btn-cancel" id="conf-cancel">Cancel</button>
          <button class="confirm-btn-confirm" id="conf-ok">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const cleanup = (result) => { backdrop.remove(); resolve(result); };
    backdrop.querySelector('#conf-cancel').onclick = () => cleanup(false);
    backdrop.querySelector('#conf-ok').onclick = () => cleanup(true);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) cleanup(false); });
  });
}
let lastTagSelectionTime = 0;
let searchQuery = ''; 
let tagSearchQuery = ''; 
let selectedSearchTags = []; 
let isDetailSheetOpen = false;
let editingId = null; 
let currentDetailId = null; 
let isToastActive = false;

// DOM Elements
const authOverlay = document.getElementById('auth-overlay');
const btnLogin = document.getElementById('btn-login');
const authStatus = document.getElementById('auth-status');
const feedGrid = document.getElementById('feed-grid');
const searchTagsContainer = document.getElementById('search-tags-container'); 
const feedSearchInput = document.getElementById('feed-search-input'); 
const tagSearchInput = document.getElementById('tag-search-input'); 

const views = {
  '/': document.getElementById('view-home'),
  '/add': document.getElementById('view-add'),
  '/profile': document.getElementById('view-profile'),
  '/privacy': document.getElementById('view-privacy')
};

const navLinks = document.querySelectorAll('.nav-link');
const navIndicator = document.getElementById('nav-indicator');
const bottomNav = document.getElementById('bottom-nav');
const selectionBar = document.getElementById('selection-bar');
const selectionCount = document.getElementById('selection-count');
const btnDelete = document.getElementById('btn-delete');
const btnEdit = document.getElementById('btn-edit');
const btnCloseSelection = document.getElementById('btn-close-selection');

const tagSelectionBar = document.getElementById('tag-selection-bar');
const tagSelectionCount = document.getElementById('tag-selection-count');
const btnDeleteTag = document.getElementById('btn-delete-tag');
const btnEditTag = document.getElementById('btn-edit-tag');
const btnCloseTagSelection = document.getElementById('btn-close-tag-selection');

const detailSheet = document.getElementById('detail-sheet');
const detailBackdrop = document.getElementById('detail-backdrop');
const detailContent = document.getElementById('detail-content');
const btnSheetClose = document.getElementById('btn-sheet-close');
const btnSheetEdit = document.getElementById('btn-sheet-edit');

const tagEditBackdrop = document.getElementById('tag-edit-backdrop');
const tagEditModal = document.getElementById('tag-edit-modal');
const tagEditInput = document.getElementById('tag-edit-input');
const btnTagEditCancel = document.getElementById('btn-tag-edit-cancel');
const btnTagEditSave = document.getElementById('btn-tag-edit-save');

const btnThemeToggle = document.getElementById('btn-theme-toggle');
const themeToggleKnob = document.getElementById('theme-toggle-knob');

// --- Global Auto-Expand Function for Textareas ---
function autoExpand(field) {
  if (!field) return;
  field.style.height = 'auto'; // Reset to calculate properly when shrinking
  field.style.height = field.scrollHeight + 'px';
}

document.querySelectorAll('.auto-expand').forEach(ta => {
  ta.addEventListener('input', () => autoExpand(ta));
});

// --- Theme Logic ---
function updateThemeUI(theme) {
  if (!btnThemeToggle || !themeToggleKnob) return;
  const metaThemeColor = document.getElementById('meta-theme-color');
  
  if (theme === 'dark') {
    themeToggleKnob.style.transform = 'translateX(20px)';
    btnThemeToggle.style.background = 'var(--primary-container)';
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#121212');
  } else {
    themeToggleKnob.style.transform = 'translateX(0)';
    btnThemeToggle.style.background = 'var(--surface-container-highest)';
    if (metaThemeColor) metaThemeColor.setAttribute('content', '#f7f6f2');
  }
}

updateThemeUI(savedTheme);

if (btnThemeToggle) {
  btnThemeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('onespot_theme', newTheme);
    updateThemeUI(newTheme);
  });
}

function showToast(message) {
  const navToast = document.getElementById('nav-toast');
  const navIndicator = document.getElementById('nav-indicator');
  
  if (!navToast) return;
  
  isToastActive = true;
  navToast.textContent = message;
  navToast.style.opacity = '1';
  if (navIndicator) navIndicator.style.opacity = '0';
  navLinks.forEach(l => l.style.opacity = '0'); 
  
  setTimeout(() => {
    isToastActive = false;
    navToast.style.opacity = '0';
    if (navIndicator) navIndicator.style.opacity = '1';
    navLinks.forEach(l => l.style.opacity = '1'); 
  }, 3000);
}

let saveTimeout = null;
function scheduleSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    try {
      await saveDataToDropbox();
    } catch (err) {
      console.error('Failed to auto-save checklist state:', err);
    }
  }, 1000);
}

// --- Dropbox Initialization & PKCE Auth ---
window.onload = async function () {
  if (window.location.protocol === 'file:') {
    authStatus.style.display = 'block';
    authStatus.textContent = 'This app needs to be served over http/https, not opened directly as a file. Run it through a local server or deploy it, then reload this page.';
    btnLogin.style.display = 'none';
    authOverlay.style.display = 'flex';
    return;
  }

  // Load cached entries immediately for instant offline feed
  try {
    const cached = localStorage.getItem('onespot_cached_entries');
    if (cached) {
      entries = JSON.parse(cached);
      if (!Array.isArray(entries)) entries = [];
      if (entries.length > 0) {
        renderFeed();
      }
    }
  } catch(_) {}

  dbxAuth = new Dropbox.DropboxAuth({
    clientId: CLIENT_ID,
  });

  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');

  if (code) {
    authOverlay.style.display = 'flex';
    authStatus.style.display = 'block';
    authStatus.textContent = 'Completing login...';
    btnLogin.style.display = 'none';

    try {
      const codeVerifier = window.sessionStorage.getItem('codeVerifier');
      dbxAuth.setCodeVerifier(codeVerifier);
      
      const response = await dbxAuth.getAccessTokenFromCode(REDIRECT_URI, code);
      dbxAuth.setAccessToken(response.result.access_token);
      dbxAuth.setRefreshToken(response.result.refresh_token);
      
      localStorage.setItem('onespot_dbx_refresh', response.result.refresh_token);
      
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      
      dbx = new Dropbox.Dropbox({ auth: dbxAuth });
      await initializeDropbox();
    } catch (error) {
      const detail = (error && error.error && error.error.error_summary) || (error && error.message) || '';
      showToast(detail ? `Login failed: ${detail}` : 'Login failed. Please try again.');
      resetAuthUI();
    }
  } else {
    const savedRefreshToken = localStorage.getItem('onespot_dbx_refresh');
    if (savedRefreshToken) {
      dbxAuth.setRefreshToken(savedRefreshToken);
      dbx = new Dropbox.Dropbox({ auth: dbxAuth });
      await initializeDropbox();
    } else {
      resetAuthUI();
    }
  }

  setTimeout(() => handleRoute(true), 150);
  setTimeout(() => handleRoute(true), 500); 
};

function resetAuthUI() {
  authStatus.style.display = 'none';
  btnLogin.style.display = 'block';
  if (window.location.hash !== '#/privacy') {
    authOverlay.style.display = 'flex';
  } else {
    authOverlay.style.display = 'none';
  }
}

btnLogin.onclick = async () => {
  try {
    const authUrl = await dbxAuth.getAuthenticationUrl(REDIRECT_URI, undefined, 'code', 'offline', undefined, undefined, true);
    window.sessionStorage.setItem('codeVerifier', dbxAuth.getCodeVerifier());
    window.location.href = authUrl;
  } catch (error) {
    showToast('Failed to start login process.');
  }
};

async function initializeDropbox() {
  authStatus.style.display = 'block';
  authStatus.textContent = 'Syncing with Dropbox...';
  btnLogin.style.display = 'none';
  authOverlay.style.display = 'flex';

  try {
    try {
      const response = await dbx.filesDownload({ path: '/data.json' });
      dataFileRev = response.result.rev;
      
      const text = await response.result.fileBlob.text();
      entries = JSON.parse(text);
      if (!Array.isArray(entries)) entries = [];
      
    } catch (err) {
      if (err.status === 409 && err.error && err.error.error_summary.includes('not_found')) {
        entries = [];
        const fileContent = new Blob(['[]'], { type: 'application/json' });
        const uploadRes = await dbx.filesUpload({
            path: '/data.json',
            contents: fileContent,
            mode: {'.tag': 'add'}
        });
        dataFileRev = uploadRes.result.rev;
      } else {
         throw err;
      }
    }

    const accountRes = await dbx.usersGetCurrentAccount();
    const user = accountRes.result;
    document.getElementById('profile-name').textContent = user.name.display_name || 'User';
    document.getElementById('profile-email').textContent = user.email || '';
    if (user.profile_photo_url) {
      const img = document.getElementById('profile-image');
      img.src = user.profile_photo_url;
      img.style.display = 'block';
      document.getElementById('profile-placeholder').style.display = 'none';
    }

  } catch (err) {
    if (err.status === 401) {
      localStorage.removeItem('onespot_dbx_refresh');
      resetAuthUI();
      return;
    } else {
      showToast('Failed to connect to Dropbox. Please try again.');
    }
  }

  authOverlay.style.display = 'none';
  // Cache entries for offline viewing
  try { localStorage.setItem('onespot_cached_entries', JSON.stringify(entries)); } catch(_) {}
  renderFeed();
}

async function saveDataToDropbox(retrying = false) {
  await dbxAuth.checkAndRefreshAccessToken();
  const fileContent = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  try {
    // Use 'update' mode with rev to detect multi-device conflicts
    const mode = dataFileRev
      ? { '.tag': 'update', 'update': dataFileRev }
      : { '.tag': 'overwrite' };
    const response = await dbx.filesUpload({ path: '/data.json', contents: fileContent, mode });
    dataFileRev = response.result.rev;
  } catch(e) {
    // 409 = conflict: another device saved since we last loaded
    if (e.status === 409 && !retrying) {
      try {
        const freshRes = await dbx.filesDownload({ path: '/data.json' });
        dataFileRev = freshRes.result.rev;
        const freshText = await freshRes.result.fileBlob.text();
        const freshEntries = JSON.parse(freshText);
        if (Array.isArray(freshEntries)) {
          const localIds = new Set(entries.map(en => en.id));
          freshEntries.forEach(re => { if (!localIds.has(re.id)) entries.push(re); });
          entries.sort((a, b) => b.id.localeCompare(a.id));
          showToast('Synced with another device.');
          return saveDataToDropbox(true);
        }
      } catch (_) { /* fall through */ }
    }
    // Offline fallback: save locally and retry when online
    if (!navigator.onLine) {
      try { localStorage.setItem('onespot_cached_entries', JSON.stringify(entries)); } catch(_) {}
      showToast('Saved offline — will sync when back online.');
      return; // don't throw, the data is safe locally
    }
    showToast('Failed to save data.');
    throw e;
  }
  // Update offline cache on successful save
  try { localStorage.setItem('onespot_cached_entries', JSON.stringify(entries)); } catch(_) {}
}

async function uploadImageToDropbox(file) {
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Uploading image...';
  authStatus.style.display = 'block';
  await dbxAuth.checkAndRefreshAccessToken();

  const ext = file.name.split('.').pop();
  const filePath = `/images/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
  let response;

  try {
    const fileBuffer = await file.arrayBuffer();
    response = await dbx.filesUpload({ path: filePath, contents: fileBuffer });
  } catch (uploadError) {
    authOverlay.style.display = 'none';
    throw uploadError;
  }
    
  try {
    const linkRes = await dbx.sharingCreateSharedLinkWithSettings({
      path: response.result.path_display,
      settings: { requested_visibility: { '.tag': 'public' } }
    });
    authOverlay.style.display = 'none';
    // Return both the public URL and the internal Dropbox path for future cleanup
    return {
      url: linkRes.result.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', ''),
      path: filePath
    };
  } catch (linkError) {
    authOverlay.style.display = 'none';
    throw linkError;
  }
}

// --- Routing & UI Orchestrated Animations ---
function handleRoute(noAnimate = false) {
  if (typeof noAnimate !== 'boolean') noAnimate = false;
  
  const hash = window.location.hash.replace('#', '') || '/';
  const hasCode = window.location.search.includes('code=');

  if (!dbx && !hasCode) {
    if (bottomNav) bottomNav.style.display = 'none';
  } else {
    if (bottomNav) bottomNav.style.display = 'flex';
  }

  if (hash === '/privacy') {
      authOverlay.style.display = 'none';
  } else if (!dbx && !hasCode) {
      resetAuthUI();
  }

  if (hash !== '/add' && editingId) {
    editingId = null;
    btnSaveEntry.textContent = 'Save Post';
    addTitle.value = ''; addDescription.value = ''; addLink.value = ''; addImage.value = ''; 
    addImageUrl = ''; addThumbUrl = ''; addTags = [];
    addAnchor.value = '';
    btnShowAnchor.style.display = 'flex';
    anchorContainer.style.display = 'none';
    
    isListMode = false;
    currentListItems = [''];
    updateListButtonUI();
    
    renderAddPreview(); renderTags();
  }

  if (hash !== '/add' && selectedTags.length > 0) {
    selectedTags = [];
    updateTagSelectionState(true);
  }

  window.scrollTo({ top: 0, behavior: 'instant' });

  Object.values(views).forEach(v => {
    if (v) {
      v.style.display = 'none';
      v.style.animation = 'none'; 
    }
  });

  const activeView = views[hash] || views['/'];

  if (hash === '/') {
    if (activeView) activeView.style.display = 'block';
    renderSearchTags();
    renderSearchFeed(); 
  } else {
    if (activeView) {
      activeView.style.display = 'block';
      void activeView.offsetWidth;
      if (!noAnimate) {
        activeView.style.animation = 'fade-in-up 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
      }
    }
    if (hash === '/add') {
      document.querySelectorAll('.auto-expand').forEach(ta => ta.style.height = 'auto');
      const counter = document.getElementById('title-counter');
      if (counter) counter.textContent = `${addTitle.value.length}/100`;
    }
  }

  updateNavIndicator(hash, noAnimate);
  setMasonrySpans(); 
  setTimeout(setMasonrySpans, 50);
}

function updateNavIndicator(hash, noAnimate = false) {
  let activeIndex = -1; 
  if (hash === '/' || hash === '') activeIndex = 0;
  if (hash.startsWith('/add')) activeIndex = 1;
  if (hash.startsWith('/profile') || hash.startsWith('/privacy')) activeIndex = 2; // Privacy keeps Profile focused

  navLinks.forEach((link, idx) => {
    const icon = link.querySelector('.material-symbols-outlined');
    if (idx === activeIndex) {
      link.style.color = 'var(--on-primary)';
      link.style.transform = 'scale(1.1)';
      if (icon) icon.style.fontVariationSettings = "'FILL' 1"; 
    } else {
      link.style.color = 'var(--outline)';
      link.style.transform = 'scale(1)';
      if (icon) icon.style.fontVariationSettings = "'FILL' 0"; 
    }
  });

  if (activeIndex !== -1) {
    const activeLink = navLinks[activeIndex];
    if (activeLink && navIndicator) {
      if (noAnimate) navIndicator.style.transition = 'none';

      navIndicator.style.left = activeLink.offsetLeft + 'px';
      navIndicator.style.top = activeLink.offsetTop + 'px';
      navIndicator.style.width = activeLink.offsetWidth + 'px';
      navIndicator.style.height = activeLink.offsetHeight + 'px';
      
      if (!isToastActive) {
        navIndicator.style.opacity = '1';
      }

      if (noAnimate) {
        void navIndicator.offsetWidth; 
        navIndicator.style.transition = 'all 0.5s ease';
      }
    }
  } else {
      if (navIndicator) navIndicator.style.opacity = '0';
  }
}

const _masonryHeights = new WeakMap();
let _masonryRafPending = false;

function setMasonrySpans() {
  if (_masonryRafPending) return;
  _masonryRafPending = true;
  requestAnimationFrame(() => {
    _masonryRafPending = false;
    const rowSize = 4;
    const updates = [];
    document.querySelectorAll('.masonry-item').forEach(item => {
      const article = item.children[0];
      if (!article) return;
      const contentHeight = article.getBoundingClientRect().height;
      if (contentHeight > 0 && _masonryHeights.get(item) !== contentHeight) {
        _masonryHeights.set(item, contentHeight);
        const marginBottom = 12;
        const spans = Math.ceil((contentHeight + marginBottom) / rowSize);
        updates.push({ item, spans });
      }
    });
    updates.forEach(({ item, spans }) => item.style.gridRowEnd = `span ${spans}`);
  });
}

let masonryTimeout = null;
function scheduleMasonryUpdate() {
  clearTimeout(masonryTimeout);
  masonryTimeout = setTimeout(setMasonrySpans, 80);
}

let availableTags = [];
function updateAvailableTags() {
  const tags = new Set();
  entries.forEach(e => {
    if (e.tags) e.tags.forEach(t => tags.add(t));
  });
  availableTags = Array.from(tags).sort();
}

function renderSearchTags() {
  if (!searchTagsContainer) return;
  searchTagsContainer.innerHTML = '';
  
  let filteredTags = availableTags;
  
  if (tagSearchQuery) {
    filteredTags = availableTags.filter(tag => tag.toLowerCase().includes(tagSearchQuery));
  }
  
  const tagsToRender = Array.from(new Set([...filteredTags, ...selectedSearchTags]));
  
  let sortedTags = tagsToRender.sort((a, b) => {
    const aSel = selectedSearchTags.includes(a);
    const bSel = selectedSearchTags.includes(b);
    if (aSel && !bSel) return -1;
    if (!aSel && bSel) return 1;
    return a.localeCompare(b);
  });
  
  sortedTags.forEach(tag => {
    const btn = document.createElement('button');
    const isSelected = selectedSearchTags.includes(tag);
    
    btn.className = 'font-label-sm';
    btn.textContent = tag;
    btn.style.cssText = `
      background-color: ${isSelected ? 'var(--primary)' : 'var(--background)'}; 
      color: ${isSelected ? 'var(--on-primary)' : 'var(--on-surface)'}; 
      border: 1px solid ${isSelected ? 'var(--primary)' : 'var(--outline-variant)'}; 
      border-radius: var(--rounded-full); 
      padding: 10px 16px; 
      cursor: pointer; 
      transition: all 0.2s;
      flex-shrink: 0;
    `;
    
    btn.onclick = () => {
      if (isSelected) {
        selectedSearchTags = selectedSearchTags.filter(t => t !== tag);
      } else {
        selectedSearchTags.push(tag);
      }
      renderSearchTags(); 
      renderSearchFeed(); 
    };
    
    searchTagsContainer.appendChild(btn);
  });
}

if (feedSearchInput) {
  feedSearchInput.addEventListener('input', debounce((e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderSearchFeed();
  }, 220));
}

if (tagSearchInput) {
  tagSearchInput.addEventListener('input', (e) => {
    tagSearchQuery = e.target.value.toLowerCase().trim();
    renderSearchTags();
  });
}

function normalizeDropboxUrl(url) {
  if (!url) return url;
  return url.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
            .replace('?raw=1', '').replace('?dl=0', '').replace(/[?&]_retry=\d+/, '');
}

function createCardElement(item) {
  const itemDiv = document.createElement('div');
  itemDiv.className = 'masonry-item';

  let imgSource = sanitizeUrl(normalizeDropboxUrl(item.thumb || item.image));
  let fullSource = sanitizeUrl(normalizeDropboxUrl(item.image));

  const article = document.createElement('article');
  article.dataset.id = item.id;
  article.className = 'card-hover';
  article.style.cssText = 'display:block;width:100%;cursor:pointer;border-radius:var(--rounded-xl);transform:scale(1);opacity:1;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s, background-color 0.3s ease, border-color 0.3s ease;position:relative;';

  const safeTitle = escapeHtml(item.title);
  const safeLink = item.url ? 'https://' + item.url.replace(/^https?:\/\//, '') : '';
  const safeLinkText = escapeHtml(item.anchorText || item.url);

  if (!item.image) {
    article.classList.add('shadow-ambient');
    article.style.backgroundColor = 'var(--surface-container-low)';
    article.style.color = 'var(--on-surface)';
    article.style.padding = 'var(--spacing-md)';
    article.style.border = '1px solid var(--tertiary-fixed-dim)';
    article.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:var(--spacing-md);">
        <h2 class="font-headline-md" style="line-height:1.3; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; word-break:break-word; font-size:clamp(14px,4.5vw,24px);">${safeTitle}</h2>
        ${safeLink ? `<a href="${safeLink}" target="_blank" class="font-body-md" style="display:block;margin-top:var(--spacing-sm);color:var(--outline);text-decoration:underline;">${safeLinkText}</a>` : ''}
      </div>`;
  } else {
    article.style.backgroundColor = 'transparent';
    const safeRatio = (item.aspectRatio && item.aspectRatio !== 'NaN%') ? item.aspectRatio : '100%';
    
    // Use data-src for lazy loading — src is set by IntersectionObserver when near viewport
    article.innerHTML = `
      <div class="shadow-ambient" style="position:relative;width:100%;padding-bottom:${safeRatio};background-color:var(--surface-container-highest);overflow:hidden;border-radius:var(--rounded-xl);transform:translateZ(0);-webkit-mask-image:-webkit-radial-gradient(white,black);">
        <div class="skeleton-img" style="position:absolute;inset:0;"></div>
        <img data-src="${imgSource}" alt="" crossorigin="anonymous" class="img-hover" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;transition:opacity 0.4s;opacity:0;"/>
        <div style="position:absolute;bottom:0;left:0;width:100%;padding:32px 12px 12px;display:flex;flex-direction:column;gap:6px;z-index:2;pointer-events:none;">
          ${safeLink ? `<a href="${safeLink}" target="_blank" style="display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.95);text-decoration:none;font-size:12px;text-shadow:0 1px 4px rgba(0,0,0,0.8),0 0 10px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size:14px;">link</span>${safeLinkText}</a>` : ''}
        </div>
      </div>
      <div style="padding:6px 8px 0;">
        <h2 class="font-headline-md" style="color:var(--on-background);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-overflow:ellipsis;word-break:break-word;font-size:14px;line-height:1.2;">${safeTitle}</h2>
      </div>`;

      // Preload is still per-card but uses { once: true } so they self-remove
      const preloadHighRes = () => {
        if (!fullSource || imgSource === fullSource) return;
        if (!article.dataset.preloaded) {
          article.dataset.preloaded = 'true';
          const preloader = new Image();
          preloader.src = fullSource;
        }
      };
      article.addEventListener('mouseenter', preloadHighRes, { once: true });
      article.addEventListener('touchstart', preloadHighRes, { once: true, passive: true });
  }

  itemDiv.appendChild(article);
  
  return itemDiv;
}

// --- Lazy Image Loading via IntersectionObserver ---
let _cardObserver = null;
function getCardObserver() {
  if (_cardObserver) return _cardObserver;
  _cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const img = entry.target.querySelector('img[data-src]');
      const skeleton = entry.target.querySelector('.skeleton-img');
      if (!img) { _cardObserver.unobserve(entry.target); return; }

      let retryCount = 0;
      const maxRetries = 3;
      img.onload = function() {
        this.style.opacity = '1';
        if (skeleton) skeleton.style.display = 'none';
        scheduleMasonryUpdate();
      };
      img.onerror = function() {
        if (retryCount < maxRetries) {
          retryCount++;
          if (retryCount === 1) this.removeAttribute('crossorigin');
          const delay = retryCount * 800;
          const src = this.src || this.dataset.src;
          setTimeout(() => {
            const sep = src.includes('?') ? '&' : '?';
            this.src = src.replace(/[?&]_retry=\d+/, '') + sep + '_retry=' + retryCount;
          }, delay);
        } else {
          this.style.opacity = '0';
          if (skeleton) skeleton.style.display = 'none';
        }
      };
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
      if (img.complete && img.naturalWidth > 0) {
        img.style.opacity = '1';
        if (skeleton) skeleton.style.display = 'none';
      }
      _cardObserver.unobserve(entry.target);
    });
  }, { rootMargin: '200px 0px', threshold: 0 });
  return _cardObserver;
}

function renderFeed() {
  // Disconnect old observer to prevent memory leaks from orphaned DOM refs
  if (_cardObserver) { _cardObserver.disconnect(); }
  feedGrid.innerHTML = '';
  updateAvailableTags();
  
  if (entries.length === 0) {
    feedGrid.innerHTML = `
      <div class="empty-state">
        <span class="material-symbols-outlined empty-state-icon">interests</span>
        <h3>Nothing here yet</h3>
        <p>Tap the <strong>+</strong> button below to save your first link, note, or image.</p>
      </div>
    `;
    renderTags();
    renderSearchTags();
    return;
  }

  const fragment = document.createDocumentFragment();
  const observer = getCardObserver();
  entries.forEach(item => {
    const el = createCardElement(item);
    fragment.appendChild(el);
    if (item.image) observer.observe(el);
  });
  feedGrid.appendChild(fragment);

  renderTags(); 
  renderSearchTags(); 
  renderSearchFeed();
  applySelectionStyles();
  setMasonrySpans();
}

// --- Event Delegation on Feed Grid ---
(function() {
  let pressTimer = null;
  let startY = 0;
  let startX = 0;

  feedGrid.addEventListener('contextmenu', e => {
    if (e.target.closest('article[data-id]')) e.preventDefault();
  });

  feedGrid.addEventListener('pointerdown', e => {
    const article = e.target.closest('article[data-id]');
    if (!article) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startY = e.clientY;
    startX = e.clientX;
    
    if (selectedIds.length === 0) {
      const itemId = article.dataset.id;
      pressTimer = setTimeout(() => {
        selectedIds = [itemId];
        lastSelectionTime = Date.now();
        if (navigator.vibrate) navigator.vibrate(50);
        updateSelectionState();
      }, 500);
    }
  });

  feedGrid.addEventListener('pointermove', e => {
    if (Math.abs(e.clientY - startY) > 10 || Math.abs(e.clientX - startX) > 10) clearTimeout(pressTimer);
  });

  feedGrid.addEventListener('pointerup', () => clearTimeout(pressTimer));
  feedGrid.addEventListener('pointercancel', () => clearTimeout(pressTimer));

  feedGrid.addEventListener('click', e => {
    const article = e.target.closest('article[data-id]');
    if (!article) return;
    e.preventDefault();
    const itemId = article.dataset.id;
    
    if (selectedIds.length > 0) {
      if (Date.now() - lastSelectionTime < 300) return;
      if (selectedIds.includes(itemId)) selectedIds = selectedIds.filter(id => id !== itemId);
      else selectedIds.push(itemId);
      updateSelectionState();
    } else {
      const link = e.target.closest('a');
      if (link) {
        window.open(link.href, link.target || '_blank');
        return;
      }
      const item = entries.find(en => en.id === itemId);
      if (item) {
        const imgSource = sanitizeUrl(normalizeDropboxUrl(item.thumb || item.image));
        openDetailSheet(item, imgSource);
      }
    }
  });
})();

function renderSearchFeed() {
  const query = searchQuery.toLowerCase();
  const items = feedGrid.querySelectorAll('.masonry-item');
  let visibleCount = 0;

  items.forEach(itemDiv => {
    const article = itemDiv.querySelector('article');
    if (!article) return;
    const entry = entries.find(e => e.id === article.dataset.id);
    if (!entry) return;

    let matchesQuery = true;
    if (query) {
      let matchesChecklist = false;
      if (entry.checklist) {
          matchesChecklist = entry.checklist.some(c => c.text.toLowerCase().includes(query));
      }
        
      matchesQuery = (entry.title && entry.title.toLowerCase().includes(query)) || 
                     (entry.description && entry.description.toLowerCase().includes(query)) ||
                     (entry.url && entry.url.toLowerCase().includes(query)) ||
                     (entry.anchorText && entry.anchorText.toLowerCase().includes(query)) ||
                     matchesChecklist;
    }
    
    let matchesTag = true;
    if (selectedSearchTags.length > 0) {
      matchesTag = entry.tags && selectedSearchTags.every(t => entry.tags.includes(t));
    }
    
    if (matchesQuery && matchesTag) {
      itemDiv.style.display = 'block';
      visibleCount++;
    } else {
      itemDiv.style.display = 'none';
    }
  });

  const noResultsMsg = feedGrid.querySelector('.no-results-msg');
  if (noResultsMsg) noResultsMsg.remove();

  applySelectionStyles();
  scheduleMasonryUpdate();
}

function applySelectionStyles() {
  const inSelectionMode = selectedIds.length > 0;
  document.querySelectorAll('article[data-id]').forEach(article => {
    const isSelected = selectedIds.includes(article.dataset.id);
    article.style.transform = isSelected ? 'scale(0.95)' : 'scale(1)';
    article.style.opacity = (inSelectionMode && !isSelected) ? '0.6' : '1';
    
    if (inSelectionMode) article.classList.remove('card-hover');
    else article.classList.add('card-hover');

    const isImagePost = article.style.backgroundColor === 'transparent';
    const targetElement = isImagePost ? article.querySelector('.shadow-ambient') : article;

    let overlay = targetElement.querySelector('.sel-overlay');
    if (isSelected && !overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sel-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;z-index:30;background:rgba(0,0,0,0.4);border-radius:inherit;pointer-events:none;';
      targetElement.prepend(overlay);
    } else if (!isSelected) {
      article.querySelectorAll('.sel-overlay').forEach(o => o.remove());
    }
  });
}

function updateSelectionState(instant = false) {
  applySelectionStyles();

  if (selectedIds.length > 0) {
    bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    bottomNav.style.transform = 'translateY(200%)'; 
    selectionBar.style.display = 'flex';
    selectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    
    setTimeout(() => {
      selectionBar.style.transform = 'translateY(0)'; 
    }, 50);

    selectionCount.textContent = `${selectedIds.length} Selected`;
    if (btnEdit) btnEdit.style.display = selectedIds.length === 1 ? 'block' : 'none';
  } else {
    if (instant) {
      selectionBar.style.transition = 'none';
      selectionBar.style.transform = 'translateY(200%)'; 
      selectionBar.style.display = 'none';
      
      bottomNav.style.transition = 'none';
      bottomNav.style.transform = 'translateY(0)'; 
      
      void bottomNav.offsetWidth;
      void selectionBar.offsetWidth;
      
      bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      selectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      
      updateNavIndicator(window.location.hash.replace('#', '') || '/', true);
    } else {
      selectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      selectionBar.style.transform = 'translateY(200%)'; 
      
      setTimeout(() => {
        selectionBar.style.display = 'none';
        bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        bottomNav.style.transform = 'translateY(0)'; 
        updateNavIndicator(window.location.hash.replace('#', '') || '/', true);
      }, 400);
    }
  }
}

function updateTagSelectionState(instant = false) {
  renderTags(); 

  if (selectedTags.length > 0) {
    bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
    bottomNav.style.transform = 'translateY(200%)'; 
    if (tagSelectionBar) {
        tagSelectionBar.style.display = 'flex';
        tagSelectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        setTimeout(() => {
          tagSelectionBar.style.transform = 'translateY(0)'; 
        }, 50);
        if (tagSelectionCount) tagSelectionCount.textContent = `${selectedTags.length} Selected`;
    }
    if (btnEditTag) btnEditTag.style.display = selectedTags.length === 1 ? 'block' : 'none';
  } else {
    if (instant) {
      if (tagSelectionBar) {
          tagSelectionBar.style.transition = 'none';
          tagSelectionBar.style.transform = 'translateY(200%)'; 
          tagSelectionBar.style.display = 'none';
      }
      
      bottomNav.style.transition = 'none';
      bottomNav.style.transform = 'translateY(0)'; 
      
      void bottomNav.offsetWidth;
      if (tagSelectionBar) void tagSelectionBar.offsetWidth;
      
      bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      if (tagSelectionBar) tagSelectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      
      updateNavIndicator(window.location.hash.replace('#', '') || '/', true);
    } else {
      if (tagSelectionBar) {
          tagSelectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
          tagSelectionBar.style.transform = 'translateY(200%)'; 
          
          setTimeout(() => {
            tagSelectionBar.style.display = 'none';
            bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
            bottomNav.style.transform = 'translateY(0)'; 
            updateNavIndicator(window.location.hash.replace('#', '') || '/', true);
          }, 400);
      }
    }
  }
}

// --- Detail Sheet & Progressive Image Loading ---
window.addEventListener('popstate', (e) => {
  if (isDetailSheetOpen) {
    closeDetailSheet(true); 
  } else {
    handleRoute();
  }
});

function openDetailSheet(item, preloadedSrc = null) {
  isDetailSheetOpen = true;
  currentDetailId = item.id; 
  history.pushState({ modal: true }, ''); 

  let imgHtml = '';
  if (item.image) {
    let sheetImgSource = sanitizeUrl(normalizeDropboxUrl(item.image));
    let sheetThumbSource = sanitizeUrl(normalizeDropboxUrl(item.thumb || preloadedSrc || item.image));
    
    const isManualUrl = sheetThumbSource === sheetImgSource;
    const applyBlur = item.thumb && !isManualUrl;
    
    imgHtml = `
      <div style="margin-bottom: 20px; width: 100%; display: flex; justify-content: center;">
        <div style="position: relative; border-radius: var(--rounded-xl); overflow: hidden; transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black); display: inline-block; background-color: var(--surface-container-low); max-width: 100%;">
          
          <img data-role="sheet-thumb" src="${sheetThumbSource}" alt="" crossorigin="anonymous" decoding="sync" style="display: block; max-height: 40vh; max-width: 100%; width: auto; height: auto; filter: ${applyBlur ? 'blur(10px)' : 'none'}; transform: ${applyBlur ? 'scale(1.05)' : 'none'}; transition: filter 0.4s, transform 0.4s, opacity 0.4s;" />
          
          ${applyBlur ? `<img data-role="sheet-full" src="${sheetImgSource}" alt="" crossorigin="anonymous" fetchpriority="high" decoding="async" style="position: absolute; top: 0; left: 0; display: block; width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity 0.5s ease-in-out;" />` : ''}
          
        </div>
      </div>
    `;
  }
  
  const displayLinkText = escapeHtml(item.anchorText || item.url);
  const safeSheetLink = item.url ? 'https://' + item.url.replace(/^https?:\/\//, '') : '';
  
  let sheetChecklistHtml = '';
  if (item.isList && item.checklist && item.checklist.length > 0) {
    sheetChecklistHtml = '<div style="margin-top: 16px; margin-bottom: 24px; display: flex; flex-direction: column; gap: 12px;">';
    item.checklist.forEach((task, index) => {
      sheetChecklistHtml += `
        <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;" class="detail-checkbox-label">
          <input type="checkbox" data-entry-id="${item.id}" data-index="${index}" class="detail-checkbox" ${task.checked ? 'checked' : ''} style="margin-top: 3px; width: 20px; height: 20px; accent-color: var(--primary); cursor: pointer; flex-shrink: 0;">
          <span class="font-body-lg" style="font-size: 16px; line-height: 1.5; color: ${task.checked ? 'var(--outline)' : 'var(--on-surface)'}; text-decoration: ${task.checked ? 'line-through' : 'none'}; transition: all 0.2s; word-break: break-word;">${escapeHtml(task.text)}</span>
        </label>
      `;
    });
    sheetChecklistHtml += '</div>';
  }

  detailContent.innerHTML = `
    ${imgHtml}
    <h1 style="font-family: var(--font-family); font-size: 22px; font-weight: 600; line-height: 1.3; color: var(--on-surface); margin-bottom: 8px; word-break: break-word; white-space: pre-wrap;">${escapeHtml(item.title)}</h1>
    ${item.description ? `<p style="font-family: var(--font-family); font-size: 16px; font-weight: 400; line-height: 1.5; color: var(--on-surface-variant); margin-bottom: 16px; word-break: break-word; white-space: pre-wrap;">${escapeHtml(item.description)}</p>` : ''}
    ${sheetChecklistHtml}
    ${safeSheetLink ? `<a href="${safeSheetLink}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; color: var(--outline); text-decoration: none; font-size: 14px; margin-bottom: 20px;"><span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span>${displayLinkText}</a>` : ''}
    ${item.tags ? `<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;">${item.tags.map(tag => `<span class="font-label-sm" style="background-color: var(--surface-container-high); color: var(--on-surface-variant); padding: 6px 14px; border-radius: 9999px; font-size: 13px;">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
  `;

  // --- Robust image loading for detail sheet with retry ---
  function setupSheetImgRetry(img, maxRetries) {
    if (!img) return;
    let retries = 0;
    img.addEventListener('load', function() {
      // Thumbnail loaded: reveal it
      if (img.dataset.role === 'sheet-thumb') {
        img.style.opacity = '1';
      }
      // Full-res loaded: crossfade and unblur thumb
      if (img.dataset.role === 'sheet-full') {
        img.style.opacity = '1';
        const thumb = img.previousElementSibling;
        if (thumb) {
          thumb.style.filter = 'none';
          thumb.style.transform = 'none';
        }
      }
    });
    img.addEventListener('error', function() {
      if (retries < maxRetries) {
        retries++;
        if (retries === 1) img.removeAttribute('crossorigin');
        const delay = retries * 800;
        setTimeout(() => {
          const separator = img.src.includes('?') ? '&' : '?';
          const cleanSrc = img.src.replace(/[?&]_retry=\d+/, '');
          img.src = cleanSrc + separator + '_retry=' + retries;
        }, delay);
      } else {
        // Exhausted retries: gracefully handle
        if (img.dataset.role === 'sheet-thumb') {
          img.style.display = 'none';
        }
        if (img.dataset.role === 'sheet-full') {
          const thumb = img.previousElementSibling;
          if (thumb) { thumb.style.filter = 'none'; thumb.style.transform = 'none'; }
          img.style.display = 'none';
        }
      }
    });
    // Handle already-cached images
    if (img.complete && img.naturalWidth > 0) {
      img.dispatchEvent(new Event('load'));
    }
  }

  const sheetThumb = detailContent.querySelector('[data-role="sheet-thumb"]');
  const sheetFull = detailContent.querySelector('[data-role="sheet-full"]');
  setupSheetImgRetry(sheetThumb, 3);
  setupSheetImgRetry(sheetFull, 3);

  const detailLabels = detailContent.querySelectorAll('.detail-checkbox-label');
  detailLabels.forEach(label => {
    label.addEventListener('click', e => e.stopPropagation());
  });

  const detailCheckboxes = detailContent.querySelectorAll('.detail-checkbox');
  detailCheckboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const entryId = e.target.dataset.entryId;
      const idx = parseInt(e.target.dataset.index);
      const entry = entries.find(en => en.id === entryId);
      
      if (entry && entry.checklist) {
        entry.checklist[idx].checked = e.target.checked;
        
        const span = e.target.nextElementSibling;
        if (e.target.checked) {
          span.style.textDecoration = 'line-through';
          span.style.color = 'var(--outline)';
        } else {
          span.style.textDecoration = 'none';
          span.style.color = 'var(--on-surface)';
        }
        
        scheduleSave();
      }
    });
  });

  document.body.style.overflow = 'hidden';
  detailBackdrop.style.pointerEvents = 'auto';
  detailBackdrop.style.opacity = '1';
  detailSheet.style.transform = 'translateY(0)';
}

function closeDetailSheet(fromHistory = false) {
  isDetailSheetOpen = false;
  currentDetailId = null;
  detailBackdrop.style.opacity = '0';
  detailSheet.style.transform = 'translateY(100%)';
  detailBackdrop.style.pointerEvents = 'none';
  setTimeout(() => { document.body.style.overflow = ''; }, 300);
  
  if (!fromHistory) history.back(); 
}

detailBackdrop.addEventListener('click', () => closeDetailSheet(false));
btnSheetClose.addEventListener('click', () => closeDetailSheet(false));

function openEditTagModal(oldTag) {
  return new Promise((resolve) => {
    tagEditInput.value = oldTag;
    tagEditBackdrop.style.pointerEvents = 'auto';
    tagEditBackdrop.style.opacity = '1';
    tagEditModal.style.transform = 'scale(1)';
    tagEditModal.style.opacity = '1';
    
    setTimeout(() => { 
      tagEditInput.focus(); 
      tagEditInput.select(); 
    }, 100);

    const cleanup = () => {
      tagEditBackdrop.style.opacity = '0';
      tagEditModal.style.transform = 'scale(0.95)';
      tagEditModal.style.opacity = '0';
      tagEditBackdrop.style.pointerEvents = 'none';
      btnTagEditCancel.removeEventListener('click', onCancel);
      btnTagEditSave.removeEventListener('click', onSave);
      tagEditInput.removeEventListener('keydown', onKeyDown);
    };

    const onCancel = () => { cleanup(); resolve(null); };
    const onSave = () => { cleanup(); resolve(tagEditInput.value); };
    const onKeyDown = (e) => {
      if (e.key === 'Enter') onSave();
      if (e.key === 'Escape') onCancel();
    };

    btnTagEditCancel.addEventListener('click', onCancel);
    btnTagEditSave.addEventListener('click', onSave);
    tagEditInput.addEventListener('keydown', onKeyDown);
  });
}

function startEditMode(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  editingId = id;
  addTitle.value = entry.title || '';
  
  if (entry.isList) {
    isListMode = true;
    currentListItems = entry.checklist && entry.checklist.length > 0 ? entry.checklist.map(c => c.text) : [''];
    addDescription.value = '';
  } else {
    isListMode = false;
    addDescription.value = entry.description || '';
    currentListItems = [''];
  }
  updateListButtonUI();
  
  addLink.value = entry.url || '';
  addAnchor.value = entry.anchorText || '';
  addImageUrl = entry.image || '';
  addThumbUrl = entry.thumb || '';
  addImageAspectRatio = entry.aspectRatio || '100%';
  addTags = entry.tags ? [...entry.tags] : [];
  
  if (entry.anchorText) {
    btnShowAnchor.style.display = 'none';
    anchorContainer.style.display = 'block';
  } else {
    btnShowAnchor.style.display = 'flex';
    anchorContainer.style.display = 'none';
  }
  
  pendingImageFile = null;
  pendingThumbFile = null;
  addImage.value = ''; 

  btnSaveEntry.textContent = 'Update Post';
  
  if (isDetailSheetOpen) {
    closeDetailSheet(true); 
    history.replaceState(null, '', '#/add'); 
    handleRoute();
  } else {
    window.location.hash = '#/add';
  }

  if (selectedIds.length > 0) {
    selectedIds = [];
    updateSelectionState(true);
  }

  setTimeout(() => {
    document.querySelectorAll('.auto-expand').forEach(autoExpand);
    document.getElementById('title-counter').textContent = `${addTitle.value.length}/100`;
  }, 10);
  
  renderAddPreview();
  renderTags();
}

btnEdit.addEventListener('click', () => {
  if (selectedIds.length === 1) startEditMode(selectedIds[0]);
});

btnSheetEdit.addEventListener('click', () => {
  if (currentDetailId) startEditMode(currentDetailId);
});

// --- Add Entry & Dual-Tier Compression Logic ---
let addTags = [];
let addImageUrl = '';
let addThumbUrl = ''; 
let addImageAspectRatio = '100%';
let pendingImageFile = null;
let pendingThumbFile = null; 
let isListMode = false;

const addTitle = document.getElementById('add-title');
const addDescription = document.getElementById('add-description');
const addListContainer = document.getElementById('add-list-container');
let currentListItems = [''];

const addLink = document.getElementById('add-link');
const addAnchor = document.getElementById('add-anchor');
const btnShowAnchor = document.getElementById('btn-show-anchor');
const btnCloseAnchor = document.getElementById('btn-close-anchor');
const anchorContainer = document.getElementById('anchor-container');
const addImage = document.getElementById('add-image');
const addImageFile = document.getElementById('add-image-file');
const addPreviewContainer = document.getElementById('add-preview-container');
const tagsContainer = document.getElementById('tags-container');
const btnSaveEntry = document.getElementById('btn-save-entry');
const btnDiscardEntry = document.getElementById('btn-discard-entry');
const btnToggleList = document.getElementById('btn-toggle-list');

if (btnDiscardEntry) {
  btnDiscardEntry.addEventListener('click', () => {
    addTitle.value = ''; 
    addDescription.value = ''; 
    addLink.value = ''; 
    addImage.value = ''; 
    addImageUrl = ''; 
    addThumbUrl = ''; 
    addAnchor.value = ''; 
    
    btnShowAnchor.style.display = 'flex'; 
    anchorContainer.style.display = 'none';
    
    pendingImageFile = null; 
    pendingThumbFile = null; 
    addTags = []; 
    editingId = null;
    
    isListMode = false;
    currentListItems = [''];
    updateListButtonUI();
    
    btnSaveEntry.textContent = 'Save Post';
    
    document.querySelectorAll('.auto-expand').forEach(ta => ta.style.height = 'auto');
    const counter = document.getElementById('title-counter');
    if (counter) counter.textContent = '0/100';

    renderAddPreview();
    renderTags();
    
    window.location.hash = '#/';
  });
}

if (btnToggleList) {
  btnToggleList.addEventListener('click', () => {
    isListMode = !isListMode;
    updateListButtonUI();
  });
}

function renderListBuilder() {
  if (!addListContainer) return;
  addListContainer.innerHTML = '';
  
  currentListItems.forEach((itemText, index) => {
    const row = document.createElement('div');
    row.style.cssText = 'position: relative; width: 100%;';
    
    const input = document.createElement('textarea');
    input.rows = 1;
    input.value = itemText;
    input.placeholder = 'List item...';
    input.className = 'font-body-md auto-expand';
    input.style.cssText = 'width: 100%; background-color: var(--surface-container-highest); border: 1px solid transparent; border-radius: var(--rounded-lg); padding: 16px 48px 16px 16px; color: var(--on-surface); outline: none; transition: all 0.2s; resize: none; overflow: hidden; word-break: break-word;';
    input.onfocus = () => input.style.borderColor = 'var(--primary)';
    input.onblur = () => input.style.borderColor = 'transparent';
    
    input.addEventListener('input', (e) => {
      currentListItems[index] = e.target.value;
      autoExpand(e.target);
      renderAddPreview();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (index === currentListItems.length - 1) {
          row.querySelector('button').click();
        } else {
          const allInputs = addListContainer.querySelectorAll('textarea');
          if (allInputs[index + 1]) allInputs[index + 1].focus();
        }
      }
    });

    row.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'font-label-sm';
    btn.style.cssText = 'position: absolute; right: 8px; top: 10px; display: flex; align-items: center; justify-content: center; background: transparent; border-radius: var(--rounded-md); width: 36px; height: 36px; color: var(--on-surface-variant); cursor: pointer; transition: all 0.2s; border: none; z-index: 2;';
    btn.onmouseover = () => {
      btn.style.backgroundColor = 'var(--surface-variant)';
      btn.style.color = 'var(--on-surface)';
    };
    btn.onmouseout = () => {
      btn.style.backgroundColor = 'transparent';
      btn.style.color = 'var(--on-surface-variant)';
    };
    
    if (index === currentListItems.length - 1) {
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 20px;">add</span>';
      btn.title = 'Add List Item';
      btn.onclick = () => {
        currentListItems.push('');
        renderListBuilder();
        setTimeout(() => {
          const inputs = addListContainer.querySelectorAll('textarea');
          if (inputs.length > 0) {
            const lastInput = inputs[inputs.length - 1];
            lastInput.focus();
            lastInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 50);
      };
    } else {
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size: 20px;">remove</span>';
      btn.title = 'Remove List Item';
      btn.onclick = () => {
        currentListItems.splice(index, 1);
        renderListBuilder();
        renderAddPreview();
      };
    }
    
    row.appendChild(btn);
    addListContainer.appendChild(row);
    setTimeout(() => autoExpand(input), 10);
  });
}

function updateListButtonUI() {
  if (!btnToggleList) return;
  if (isListMode) {
    btnToggleList.style.backgroundColor = 'var(--primary)';
    btnToggleList.style.color = 'var(--on-primary)';
    btnToggleList.style.borderColor = 'var(--primary)';
    if (addDescription) addDescription.style.display = 'none';
    if (addListContainer) {
        addListContainer.style.display = 'flex';
        if (currentListItems.length === 0) currentListItems = [''];
        renderListBuilder();
    }
  } else {
    btnToggleList.style.backgroundColor = 'var(--surface-container-low)';
    btnToggleList.style.color = 'var(--on-surface-variant)';
    btnToggleList.style.borderColor = 'var(--outline-variant)';
    if (addDescription) {
        addDescription.style.display = 'block';
        addDescription.placeholder = "Description (optional)...";
    }
    if (addListContainer) addListContainer.style.display = 'none';
  }
}

if (btnShowAnchor) {
  btnShowAnchor.addEventListener('click', () => {
    btnShowAnchor.style.display = 'none';
    anchorContainer.style.display = 'block'; 
    addAnchor.focus();
    autoExpand(addAnchor);
  });
}

if (btnCloseAnchor) {
  btnCloseAnchor.addEventListener('click', () => {
    anchorContainer.style.display = 'none';
    btnShowAnchor.style.display = 'flex';
    addAnchor.value = '';
    renderAddPreview();
  });
}

function renderAddPreview() {
  const text = addTitle.value || (editingId ? 'Edit Preview' : 'Preview');
  const link = addLink.value;
  const displayLinkText = addAnchor.value.trim() || link;
  const safeText = escapeHtml(text);
  const safeLinkText = escapeHtml(displayLinkText);
  let html = '';

  let previewImgSource = sanitizeUrl(addThumbUrl || addImageUrl);

  if (!previewImgSource) {
    html = `
      <div style="max-width: 240px; margin: 0 auto;">
        <article class="shadow-ambient" style="position: relative; background-color: var(--surface-container-low); color: var(--on-surface); border-radius: var(--rounded-xl); padding: var(--spacing-md); border: 1px solid var(--tertiary-fixed-dim); transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black);">
          <div>
            <h2 class="font-headline-md" style="line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; font-size: clamp(14px, 4.5vw, 24px);">${safeText}</h2>
            ${link ? `<a href="https://${link.replace(/^https?:\/\//, '')}" target="_blank" class="font-body-md" style="display: block; margin-top: var(--spacing-sm); color: var(--outline); word-break: break-all; text-decoration: underline; pointer-events: none;">${safeLinkText}</a>` : ''}
          </div>
        </article>
      </div>
    `;
  } else {
    if (previewImgSource.includes('dropbox.com')) {
      previewImgSource = previewImgSource.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
                                         .replace('?raw=1', '')
                                         .replace('?dl=0', '');
    }
      
    html = `
      <div style="max-width: 240px; margin: 0 auto;">
        <article style="position: relative; background-color: transparent; border-radius: var(--rounded-xl); border: none;">
          <div class="shadow-ambient" style="position: relative; width: 100%; padding-bottom: ${addImageAspectRatio}; background-color: var(--surface-container-highest); overflow: hidden; border-radius: var(--rounded-xl);">
            <img src="${previewImgSource}" crossorigin="anonymous" onload="this.style.opacity='1'" onerror="if(!this.dataset.retried){this.dataset.retried='1';this.removeAttribute('crossorigin');this.src=this.src}else{this.style.opacity='0'}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--rounded-xl); transition: opacity 0.3s; opacity: 0;" />
            <div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 32px 12px 12px; display: flex; flex-direction: column; gap: 6px; z-index: 2;">
              ${link ? `<div class="font-body-md" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.95); font-size: 12px; text-shadow: 0 1px 4px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size: 14px;">link</span>${safeLinkText.replace(/^https?:\/\//, '')}</div>` : ''}
            </div>
          </div>
          <div style="padding: 6px 8px 0; display: flex; flex-direction: column;">
            <h2 class="font-headline-md" style="color: var(--on-background); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; font-size: 14px; line-height: 1.2;">${safeText}</h2>
          </div>
        </article>
      </div>
    `;
  }
  addPreviewContainer.innerHTML = html;
}

let isAddingTag = false;

function renderTags() {
  tagsContainer.innerHTML = '';
  const combinedTags = Array.from(new Set([...availableTags, ...addTags]));

  combinedTags.forEach(tag => {
    const isSelected = addTags.includes(tag);
    const isTagSelected = selectedTags.includes(tag);
    
    const el = document.createElement('div');
    el.className = 'font-label-sm';
    el.textContent = tag;
    
    if (selectedTags.length > 0) {
        el.style.backgroundColor = isSelected ? 'var(--tertiary)' : 'var(--surface-container)';
        el.style.color = isSelected ? 'var(--on-tertiary)' : 'var(--on-surface)';
        el.style.border = isTagSelected ? '2px solid var(--primary)' : (isSelected ? '1px solid var(--tertiary)' : '1px solid transparent');
        el.style.transform = isTagSelected ? 'scale(0.95)' : 'scale(1)';
        el.style.opacity = isTagSelected ? '1' : '0.5';
        el.style.padding = isTagSelected ? '7px 15px' : '8px 16px'; 
    } else {
        el.style.backgroundColor = isSelected ? 'var(--tertiary)' : 'var(--surface-container)';
        el.style.color = isSelected ? 'var(--on-tertiary)' : 'var(--on-surface)';
        el.style.border = isSelected ? '1px solid var(--tertiary)' : '1px solid transparent';
        el.style.transform = 'scale(1)';
        el.style.opacity = '1';
        el.style.padding = '8px 16px';
    }
    
    el.style.borderRadius = 'var(--rounded-full)';
    el.style.cursor = 'pointer';
    el.style.transition = 'all 0.2s';
    el.style.userSelect = 'none';
    el.style.WebkitUserSelect = 'none';

    el.oncontextmenu = (e) => e.preventDefault();
  
    let pressTimer = null;
    let startY = 0;
    let startX = 0;
    
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startY = e.clientY;
      startX = e.clientX;
      
      if (selectedTags.length === 0) {
        pressTimer = setTimeout(() => {
          selectedTags = [tag];
          lastTagSelectionTime = Date.now();
          if (navigator.vibrate) navigator.vibrate(50);
          updateTagSelectionState();
        }, 500);
      }
    });
    
    el.addEventListener('pointermove', (e) => {
      if (Math.abs(e.clientY - startY) > 10 || Math.abs(e.clientX - startX) > 10) clearTimeout(pressTimer);
    });
    
    el.addEventListener('pointerup', () => clearTimeout(pressTimer));
    el.addEventListener('pointercancel', () => clearTimeout(pressTimer));

    el.addEventListener('click', (e) => {
      if (selectedTags.length > 0) {
        if (Date.now() - lastTagSelectionTime < 300) return;
        if (selectedTags.includes(tag)) selectedTags = selectedTags.filter(t => t !== tag);
        else selectedTags.push(tag);
        updateTagSelectionState();
      } else {
        if (isSelected) addTags = addTags.filter(t => t !== tag);
        else addTags.push(tag);
        renderTags();
      }
    });
    
    tagsContainer.appendChild(el);
  });

  if (selectedTags.length === 0) {
    if (isAddingTag) {
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Tag name...';
      input.className = 'font-label-sm';
      input.style.backgroundColor = 'var(--surface-container-highest)';
      input.style.border = '1px solid var(--primary)';
      input.style.color = 'var(--on-surface)';
      input.style.borderRadius = 'var(--rounded-full)';
      input.style.padding = '8px 16px';
      input.style.outline = 'none';
      input.style.width = '120px';
      input.style.maxWidth = 'calc(100vw - 64px)'; 

      const saveTag = () => {
        const val = input.value.trim();
        if (val && !addTags.includes(val)) addTags.push(val);
        isAddingTag = false;
        renderTags();
      };

      input.onkeydown = (e) => {
        if (e.key === 'Enter') saveTag();
        else if (e.key === 'Escape') { isAddingTag = false; renderTags(); }
      };
      input.onblur = saveTag;
      tagsContainer.appendChild(input);
      input.focus();
    } else {
      const btn = document.createElement('button');
      btn.className = 'font-label-sm';
      btn.style.display = 'flex';
      btn.style.alignItems = 'center';
      btn.style.gap = 'var(--spacing-unit)';
      btn.style.backgroundColor = 'var(--surface-container-low)';
      btn.style.border = '1px solid transparent';
      btn.style.color = 'var(--on-surface-variant)';
      btn.style.borderRadius = 'var(--rounded-full)';
      btn.style.padding = '8px 16px';
      btn.style.transition = 'all 0.2s';
      btn.style.cursor = 'pointer';
      btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">add</span> Add Tag`;
      btn.onmouseover = () => { btn.style.backgroundColor = 'var(--surface-container-highest)'; };
      btn.onmouseout = () => { btn.style.backgroundColor = 'var(--surface-container-low)'; };
      btn.onclick = () => { isAddingTag = true; renderTags(); };
      tagsContainer.appendChild(btn);
    }
  }
}

addTitle.addEventListener('input', (e) => {
  document.getElementById('title-counter').textContent = `${e.target.value.length}/100`;
  renderAddPreview();
});

addDescription.addEventListener('input', renderAddPreview);
addLink.addEventListener('input', renderAddPreview);
if (addAnchor) addAnchor.addEventListener('input', renderAddPreview);

addImage.addEventListener('input', (e) => {
  addImageUrl = e.target.value;
  addThumbUrl = addImageUrl; 
  pendingImageFile = null;
  pendingThumbFile = null;
  if (addImageUrl) {
    const img = new Image();
    img.onload = () => {
      addImageAspectRatio = ((img.height / img.width) * 100).toFixed(2) + '%';
      renderAddPreview();
    };
    img.src = addImageUrl;
  } else {
    renderAddPreview();
  }
});

function compressImage(file, maxWidth = 1200, quality = 0.8, prefix = "img") {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Canvas is empty'));
          const newFileName = file.name.replace(/\.[^/.]+$/, "") + `_${prefix}.webp`;
          const newFile = new File([blob], newFileName, {
            type: 'image/webp',
            lastModified: Date.now(),
          });
          
          resolve({
            file: newFile,
            dataUrl: canvas.toDataURL('image/webp', quality),
            width: width,
            height: height
          });
        }, 'image/webp', quality);
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
}

addImageFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    authOverlay.style.display = 'flex';
    authStatus.textContent = 'Optimizing images...';
    authStatus.style.display = 'block';

    try {
      const full = await compressImage(file, 1600, 0.85, "full");
      const thumb = await compressImage(file, 400, 0.6, "thumb");
      
      pendingImageFile = full.file;
      pendingThumbFile = thumb.file;
      
      addImageUrl = full.dataUrl;
      addThumbUrl = thumb.dataUrl;
      addImage.value = full.file.name;
      addImageAspectRatio = ((full.height / full.width) * 100).toFixed(2) + '%';
      
      renderAddPreview();
    } catch (err) {
      console.error("Compression failed:", err);
      showToast("Failed to optimize image.");
    } finally {
      authOverlay.style.display = 'none';
    }
  }
});

btnSaveEntry.addEventListener('click', async () => {
  if (!addTitle.value.trim()) {
    showToast('Please provide a post title.');
    addTitle.focus();
    return;
  }

  const originalText = btnSaveEntry.textContent;
  btnSaveEntry.textContent = 'Saving...';
  btnSaveEntry.style.pointerEvents = 'none';

  let finalImageUrl = addImageUrl;
  let finalThumbUrl = addThumbUrl;
  let successMessage = ''; 
  
  let finalChecklist = [];
  let oldChecklist = [];
  
  if (editingId) {
    const oldEntry = entries.find(e => e.id === editingId);
    if (oldEntry && oldEntry.checklist) {
      oldChecklist = oldEntry.checklist;
    }
  }
  
  if (isListMode) {
    const lines = currentListItems.filter(l => l.trim() !== '');
    finalChecklist = lines.map(line => {
      const text = line.trim();
      const existing = oldChecklist.find(c => c.text === text);
      return { text: text, checked: existing ? existing.checked : false };
    });
  } else if (addDescription.value.trim()) {
    const lines = addDescription.value.split('\n').filter(l => l.trim() !== '');
    finalChecklist = lines.map(line => {
      const text = line.trim();
      const existing = oldChecklist.find(c => c.text === text);
      return { text: text, checked: existing ? existing.checked : false };
    });
  }

  try {
    if (pendingImageFile && pendingThumbFile) {
      const [fullRes, thumbRes] = await Promise.all([
        uploadImageToDropbox(pendingImageFile),
        uploadImageToDropbox(pendingThumbFile)
      ]);
      finalImageUrl = fullRes.url;
      finalThumbUrl = thumbRes.url;
    } else if (pendingImageFile) {
      const res = await uploadImageToDropbox(pendingImageFile);
      finalImageUrl = res.url;
      finalThumbUrl = res.url;
    }

    if (editingId) {
      const index = entries.findIndex(e => e.id === editingId);
      if (index !== -1) {
        entries[index].title = addTitle.value;
        entries[index].description = isListMode ? '' : addDescription.value;
        entries[index].isList = isListMode;
        entries[index].checklist = finalChecklist;
        entries[index].url = addLink.value;
        entries[index].anchorText = addAnchor.value.trim();
        entries[index].image = finalImageUrl;
        entries[index].thumb = finalThumbUrl;
        entries[index].aspectRatio = addImageAspectRatio;
        entries[index].tags = [...addTags];
        entries[index].type = addTags[0] || 'Note';
      }
      successMessage = 'Post updated!'; 
    } else {
      entries.unshift({
        id: Date.now().toString(),
        title: addTitle.value,
        description: isListMode ? '' : addDescription.value,
        isList: isListMode,
        checklist: finalChecklist,
        url: addLink.value,
        anchorText: addAnchor.value.trim(),
        image: finalImageUrl,
        thumb: finalThumbUrl,
        aspectRatio: addImageAspectRatio,
        tags: [...addTags],
        type: addTags[0] || 'Note'
      });
      successMessage = 'Post saved!'; 
    }

    await saveDataToDropbox();

    addTitle.value = ''; addDescription.value = ''; addLink.value = ''; addImage.value = ''; 
    addImageUrl = ''; addThumbUrl = ''; addAnchor.value = ''; 
    btnShowAnchor.style.display = 'flex'; anchorContainer.style.display = 'none';
    pendingImageFile = null; pendingThumbFile = null; 
    addTags = []; editingId = null;
    isListMode = false;
    currentListItems = [''];
    updateListButtonUI();
    btnSaveEntry.textContent = 'Save Post';
    
    updateAvailableTags(); 
    renderAddPreview();
    renderTags();

    window.location.hash = '#/';
    handleRoute();
    renderFeed();
    
    showToast(successMessage); 
  } catch (err) {
    showToast('Failed to save. Try again.');
  } finally {
    btnSaveEntry.textContent = originalText;
    btnSaveEntry.style.pointerEvents = 'auto';
  }
});

renderAddPreview();
renderTags();
renderListBuilder();

// --- Bind Global Events ---
window.addEventListener('hashchange', () => handleRoute());

let lastWindowWidth = window.innerWidth;
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    updateNavIndicator(window.location.hash.replace('#', '') || '/', true); 
    if (window.innerWidth !== lastWindowWidth) {
      lastWindowWidth = window.innerWidth;
      setMasonrySpans();
    }
  }, 150);
});

btnDelete.addEventListener('click', async () => {
  const count = selectedIds.length;
  const noun = count === 1 ? 'post' : 'posts';
  const confirmed = await showConfirm(
    `Delete ${count} ${noun}?`,
    'This cannot be undone.'
  );
  if (!confirmed) return;

  // Collect Dropbox paths of images to clean up
  const pathsToDelete = [];
  entries.forEach(en => {
    if (selectedIds.includes(en.id)) {
      if (en.imagePath) pathsToDelete.push(en.imagePath);
      if (en.thumbPath && en.thumbPath !== en.imagePath) pathsToDelete.push(en.thumbPath);
    }
  });

  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Deleting...';
  authStatus.style.display = 'block';

  entries = entries.filter(e => !selectedIds.includes(e.id));
  selectedIds = [];

  try {
    await saveDataToDropbox();
    // Cleanup orphaned images in background (don't block UI)
    if (pathsToDelete.length > 0) {
      Promise.allSettled(pathsToDelete.map(p => dbx.filesDeleteV2({ path: p })))
        .catch(() => {}); // silent — best-effort cleanup
    }
    showToast(`${count} ${noun} deleted`);
  } catch(e) {
    showToast('Failed to delete posts.');
  }

  authOverlay.style.display = 'none';
  renderFeed();
  updateSelectionState(true); 
});

btnCloseSelection.addEventListener('click', () => {
  selectedIds = [];
  updateSelectionState(); 
});

if (btnDeleteTag) {
  btnDeleteTag.addEventListener('click', async () => {
    authOverlay.style.display = 'flex';
    authStatus.textContent = 'Deleting tags...';
    authStatus.style.display = 'block';

    entries.forEach(entry => {
      if (entry.tags) {
        entry.tags = entry.tags.filter(t => !selectedTags.includes(t));
      }
    });
    
    selectedSearchTags = selectedSearchTags.filter(t => !selectedTags.includes(t));
    addTags = addTags.filter(t => !selectedTags.includes(t));

    const count = selectedTags.length;
    selectedTags = [];

    try {
        await saveDataToDropbox();
        updateAvailableTags();
        showToast(`${count} tag(s) deleted`);
    } catch(e) {
        showToast("Failed to delete tags.");
    }
    
    authOverlay.style.display = 'none';
    updateTagSelectionState(true);
    renderSearchTags(); 
    renderSearchFeed();
  });
}

if (btnEditTag) {
  btnEditTag.addEventListener('click', async () => {
    if (selectedTags.length !== 1) return;
    const oldTag = selectedTags[0];
    
    const newTag = await openEditTagModal(oldTag);
    
    if (!newTag || newTag.trim() === '' || newTag === oldTag) {
      selectedTags = [];
      updateTagSelectionState();
      return;
    }
    
    const trimmedNewTag = newTag.trim();

    authOverlay.style.display = 'flex';
    authStatus.textContent = 'Updating tag...';
    authStatus.style.display = 'block';

    entries.forEach(entry => {
      if (entry.tags && entry.tags.includes(oldTag)) {
        entry.tags = Array.from(new Set(entry.tags.map(t => t === oldTag ? trimmedNewTag : t)));
      }
    });
    
    if (selectedSearchTags.includes(oldTag)) {
      selectedSearchTags = Array.from(new Set(selectedSearchTags.map(t => t === oldTag ? trimmedNewTag : t)));
    }
    
    if (addTags.includes(oldTag)) {
      addTags = Array.from(new Set(addTags.map(t => t === oldTag ? trimmedNewTag : t)));
    }

    selectedTags = [];

    try {
        await saveDataToDropbox();
        updateAvailableTags();
        showToast(`Tag updated!`);
    } catch(e) {
        showToast('Failed to update tag.');
    }
    
    authOverlay.style.display = 'none';
    updateTagSelectionState(true);
    renderSearchTags(); 
    renderSearchFeed();
  });
}

if (btnCloseTagSelection) {
  btnCloseTagSelection.addEventListener('click', () => {
    selectedTags = [];
    updateTagSelectionState(); 
  });
}

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('onespot_dbx_refresh');
  window.location.hash = '#/';
  window.location.reload();
});

// ─── Swipe-to-Dismiss Detail Sheet ────────────────────────────────────────────
(function() {
  let touchStartY = 0;
  let touchCurrentY = 0;
  let isDragging = false;

  detailSheet.addEventListener('touchstart', e => {
    touchStartY = e.touches[0].clientY;
    isDragging = true;
  }, { passive: true });

  detailSheet.addEventListener('touchmove', e => {
    if (!isDragging) return;
    touchCurrentY = e.touches[0].clientY;
    const delta = touchCurrentY - touchStartY;
    if (delta > 0) {
      detailSheet.style.transition = 'none';
      detailSheet.style.transform = `translateY(${delta}px)`;
    }
  }, { passive: true });

  detailSheet.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    const delta = touchCurrentY - touchStartY;
    detailSheet.style.transition = '';
    if (delta > 100) {
      closeDetailSheet();
    } else {
      detailSheet.style.transform = 'translateY(0)';
    }
    touchStartY = 0;
    touchCurrentY = 0;
  });
})();

// ─── Refresh Feed & Pull-to-Refresh ──────────────────────────────────────────
async function triggerFeedRefresh() {
  const pullIndicator = document.getElementById('pull-indicator');
  const pullArrow = pullIndicator ? pullIndicator.querySelector('.pull-arrow') : null;
  const btnRefreshFeed = document.getElementById('btn-refresh-feed');
  const refreshIcon = btnRefreshFeed ? btnRefreshFeed.querySelector('.material-symbols-outlined') : null;

  if (btnRefreshFeed) btnRefreshFeed.blur();
  if (refreshIcon) refreshIcon.classList.add('spin-icon');

  if (pullIndicator) {
    pullIndicator.classList.add('active');
    if (pullArrow) pullArrow.style.display = 'none';

    let spinner = pullIndicator.querySelector('.pull-spinner');
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.className = 'pull-spinner';
      pullIndicator.insertBefore(spinner, pullIndicator.children[1] || null);
    }
    const textSpan = pullIndicator.querySelector('span');
    if (textSpan) textSpan.textContent = 'Refreshing...';
  }

  try {
    if (dbx) {
      await initializeDropbox();
    } else {
      renderFeed();
    }
    showToast('Feed refreshed');
  } catch(e) {
    showToast('Failed to refresh feed');
  } finally {
    if (refreshIcon) refreshIcon.classList.remove('spin-icon');
    if (pullIndicator) {
      setTimeout(() => {
        pullIndicator.classList.remove('active');
        if (pullArrow) { pullArrow.style.display = ''; pullArrow.style.transform = ''; }
        const textSpan = pullIndicator.querySelector('span');
        if (textSpan) textSpan.textContent = 'Pull to refresh';
        const spinner = pullIndicator.querySelector('.pull-spinner');
        if (spinner) spinner.remove();
      }, 400);
    }
  }
}

// ─── Refresh Button & Nav Home Tap-to-Refresh ────────────────────────────────
(function() {
  const btnRefreshFeed = document.getElementById('btn-refresh-feed');
  const navHomeLink = document.querySelector('.nav-link[data-index="0"]');

  // Desktop / Mobile: explicit refresh button in search bar
  if (btnRefreshFeed) {
    btnRefreshFeed.addEventListener('click', () => {
      btnRefreshFeed.blur();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      triggerFeedRefresh();
    });
  }

  // Tap home nav icon when already on home → scroll to top and refresh
  if (navHomeLink) {
    navHomeLink.addEventListener('click', () => {
      const currentHash = window.location.hash.replace('#', '') || '/';
      if (currentHash === '/') {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        triggerFeedRefresh();
      }
    });
  }
})();

// ─── Offline Post Queue: Auto-sync when back online ─────────────────────────
 window.addEventListener('online', async () => {
  if (!dbx) return;
  try {
    await saveDataToDropbox();
    showToast('Synced offline changes!');
  } catch(_) { /* will retry next time */ }
});