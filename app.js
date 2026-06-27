const CLIENT_ID = '6sxijlqtwr8h6zk'; // Replace with your App Key. NEVER put your App Secret here.

// --- Auth URL Normalization ---
// Fixes the "index.html" vs "/" mismatch problem for Dropbox Console.
// It forces the app to always use the clean, root directory URL.
let cleanPath = window.location.pathname;
if (cleanPath.endsWith('index.html')) {
    cleanPath = cleanPath.replace('index.html', '');
    // Instantly clean up the browser's address bar to match
    window.history.replaceState({}, document.title, window.location.origin + cleanPath + window.location.hash);
}
const REDIRECT_URI = window.location.origin + cleanPath;

// --- Auth debugging ---
console.log('[OneSpot Auth Debug] Normalized REDIRECT_URI:', REDIRECT_URI);

let dbxAuth = null;
let dbx = null;
let dataFileRev = null; 

let entries = [];
let selectedIds = [];
let selectedTags = [];
let isInitialRender = true;
let lastSelectionTime = 0;
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
  '/profile': document.getElementById('view-profile')
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

// --- Dropbox Initialization & PKCE Auth ---
window.onload = async function () {
  // Dropbox OAuth requires a real http(s) origin. Opening this file directly
  // (double-clicking index.html, file://...) produces an invalid redirect_uri
  // and Dropbox will reject login with a generic "bad request" error.
  if (window.location.protocol === 'file:') {
    console.error('[OneSpot Auth Debug] Blocked: page loaded via file:// — Dropbox OAuth cannot work here. Serve this folder through a local server (e.g. "npx serve" or VS Code Live Server) or deploy it, then reload.');
    authStatus.style.display = 'block';
    authStatus.textContent = 'This app needs to be served over http/https, not opened directly as a file. Run it through a local server or deploy it, then reload this page.';
    btnLogin.style.display = 'none';
    authOverlay.style.display = 'flex';
    return;
  }

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
      
      // Save refresh token securely in localStorage for persistent sessions
      localStorage.setItem('onespot_dbx_refresh', response.result.refresh_token);
      
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
      
      dbx = new Dropbox.Dropbox({ auth: dbxAuth });
      await initializeDropbox();
    } catch (error) {
      console.error('Auth error:', error);
      const detail = (error && error.error && error.error.error_summary) || (error && error.message) || '';
      console.error('[OneSpot Auth Debug] Failure detail:', detail || '(no extra detail returned)');
      showToast(detail ? `Login failed: ${detail}` : 'Login failed. Please try again.');
      resetAuthUI();
    }
  } else {
    // Check if we have a saved refresh token
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
  authOverlay.style.display = 'flex';
}

btnLogin.onclick = async () => {
  try {
    const authUrl = await dbxAuth.getAuthenticationUrl(REDIRECT_URI, undefined, 'code', 'offline', undefined, undefined, true);
    window.sessionStorage.setItem('codeVerifier', dbxAuth.getCodeVerifier());
    console.log('[OneSpot Auth Debug] Navigating to Dropbox authorize URL:', authUrl);
    window.location.href = authUrl;
  } catch (error) {
    console.error('Error generating auth URL:', error);
    showToast('Failed to start login process.');
  }
};

async function initializeDropbox() {
  authStatus.style.display = 'block';
  authStatus.textContent = 'Syncing with Dropbox...';
  btnLogin.style.display = 'none';
  authOverlay.style.display = 'flex';

  try {
    // Attempt to download the data.json file from the root of the App Folder
    try {
      const response = await dbx.filesDownload({ path: '/data.json' });
      dataFileRev = response.result.rev;
      
      const text = await response.result.fileBlob.text();
      entries = JSON.parse(text);
      if (!Array.isArray(entries)) entries = [];
      
    } catch (err) {
      if (err.status === 409 && err.error && err.error.error_summary.includes('not_found')) {
        // File doesn't exist, create an empty one
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
    console.error('Dropbox API Error:', err);
    if (err.status === 401) {
      localStorage.removeItem('onespot_dbx_refresh');
      resetAuthUI();
      return;
    } else {
      showToast('Failed to connect to Dropbox. Please try again.');
    }
  }

  authOverlay.style.display = 'none';
  renderFeed();
}

async function saveDataToDropbox() {
  const fileContent = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  try {
      const response = await dbx.filesUpload({
        path: '/data.json',
        contents: fileContent,
        mode: {'.tag': 'overwrite'}
      });
      dataFileRev = response.result.rev;
  } catch(e) {
      console.error("Failed to save data.json", e);
      showToast('Failed to save data.');
      throw e;
  }
}

async function uploadImageToDropbox(file) {
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Uploading image...';
  authStatus.style.display = 'block';

  // Generate a unique filename to prevent collisions in the App Folder
  const ext = file.name.split('.').pop();
  const filename = `/images/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
  let response;

  try {
    // Convert File object to ArrayBuffer to prevent browser serialization bugs that cause 400 Bad Request
    const fileBuffer = await file.arrayBuffer();
    response = await dbx.filesUpload({
      path: filename,
      contents: fileBuffer
    });
  } catch (uploadError) {
    console.error("Image upload failed (filesUpload step):", uploadError.error || uploadError);
    authOverlay.style.display = 'none';
    throw uploadError;
  }
    
  try {
    // Create a shared link so the image can be displayed in the browser
    const linkRes = await dbx.sharingCreateSharedLinkWithSettings({
        path: response.result.path_display,
        settings: { requested_visibility: { '.tag': 'public' } }
    });
    
    authOverlay.style.display = 'none';
    
    // Transform standard dropbox URLs into direct CDN links to avoid browser tracking blocks
    return linkRes.result.url.replace('www.dropbox.com', 'dl.dropboxusercontent.com').replace('?dl=0', '');
  } catch (linkError) {
      console.error("Shared link creation failed (sharingCreateSharedLink step):", linkError.error || linkError);
      authOverlay.style.display = 'none';
      throw linkError;
  }
}

// --- Routing & UI Orchestrated Animations ---
function handleRoute(noAnimate = false) {
  if (typeof noAnimate !== 'boolean') noAnimate = false;
  
  const hash = window.location.hash.replace('#', '') || '/';

  if (hash !== '/add' && editingId) {
    editingId = null;
    btnSaveEntry.textContent = 'Save Post';
    addTitle.value = ''; addDescription.value = ''; addLink.value = ''; addImage.value = ''; 
    addImageUrl = ''; addThumbUrl = ''; addTags = [];
    addAnchor.value = '';
    btnShowAnchor.style.display = 'flex';
    anchorContainer.style.display = 'none';
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
  }

  updateNavIndicator(hash, noAnimate);
  setMasonrySpans(); 
  setTimeout(setMasonrySpans, 50);
}

function updateNavIndicator(hash, noAnimate = false) {
  let activeIndex = 0; // Default to Home
  if (hash.startsWith('/add')) activeIndex = 1;
  if (hash.startsWith('/profile')) activeIndex = 2;

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
}

function setMasonrySpans() {
  const rowSize = 4;
  const updates = [];
  
  document.querySelectorAll('.masonry-item').forEach(item => {
    const article = item.children[0];
    if (!article) return;
    
    const contentHeight = article.getBoundingClientRect().height;
    const marginBottom = parseFloat(window.getComputedStyle(item).marginBottom) || 12;
    
    if (contentHeight > 0) {
      const spans = Math.ceil((contentHeight + marginBottom) / rowSize);
      updates.push({ item, spans });
    }
  });

  updates.forEach(({ item, spans }) => {
    item.style.gridRowEnd = `span ${spans}`;
  });
}

let masonryTimeout = null;
function scheduleMasonryUpdate() {
  clearTimeout(masonryTimeout);
  masonryTimeout = setTimeout(setMasonrySpans, 100);
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
  
  // Combine to ensure selected tags are always visible even if they don't match the search query
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
  feedSearchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderSearchFeed();
  });
}

if (tagSearchInput) {
  tagSearchInput.addEventListener('input', (e) => {
    tagSearchQuery = e.target.value.toLowerCase().trim();
    renderSearchTags();
  });
}

function createCardElement(item) {
  const itemDiv = document.createElement('div');
  itemDiv.className = 'masonry-item';

  // Use the ultra-fast thumbnail for the feed if available, fallback to full image
  let imgSource = item.thumb || item.image;
  
  // Automatically fix existing Dropbox links to prevent Safari/strict browser breakage
  if (imgSource && imgSource.includes('dropbox.com')) {
    imgSource = imgSource.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
                         .replace('?raw=1', '')
                         .replace('?dl=0', '');
  }

  const article = document.createElement('article');
  article.dataset.id = item.id;
  article.className = 'card-hover';
  article.style.cssText = 'display:block;width:100%;cursor:pointer;border-radius:var(--rounded-xl);transform:scale(1);opacity:1;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s;position:relative;';

  const displayLinkText = item.anchorText || item.url;

  if (!item.image) {
    article.classList.add('shadow-ambient');
    article.style.backgroundColor = 'var(--surface-container-low)';
    article.style.color = 'var(--on-surface)';
    article.style.padding = 'var(--spacing-md)';
    article.style.border = '1px solid var(--tertiary-fixed-dim)';
    article.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:var(--spacing-md);">
        <h2 class="font-headline-md" style="line-height:1.3; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; word-break:break-word; font-size:clamp(14px,4.5vw,24px);">${item.title}</h2>
        ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" class="font-body-md" style="display:block;margin-top:var(--spacing-sm);color:var(--outline);text-decoration:underline;">${displayLinkText}</a>` : ''}
      </div>`;
  } else {
    article.style.backgroundColor = 'transparent';
    const safeRatio = (item.aspectRatio && item.aspectRatio !== 'NaN%') ? item.aspectRatio : '100%';
    
    // Added loading="lazy" to the feed <img> tag to save bandwidth
    article.innerHTML = `
      <div class="shadow-ambient" style="position:relative;width:100%;padding-bottom:${safeRatio};background-color:var(--surface-container-highest);overflow:hidden;border-radius:var(--rounded-xl);transform:translateZ(0);-webkit-mask-image:-webkit-radial-gradient(white,black);">
        <img src="${imgSource}" loading="lazy" alt="" class="img-hover" onerror="this.style.opacity='0'" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover; pointer-events:none; transition: opacity 0.3s;"/>
        <div style="position:absolute;bottom:0;left:0;width:100%;padding:32px 12px 12px;display:flex;flex-direction:column;gap:6px;z-index:2;pointer-events:none;">
          ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" style="display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.95);text-decoration:none;font-size:12px;text-shadow:0 1px 4px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size:14px;">link</span>${displayLinkText}</a>` : ''}
        </div>
      </div>
      <div style="padding:6px 8px 0;">
        <h2 class="font-headline-md" style="color:var(--on-background); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; text-overflow:ellipsis; word-break:break-word; font-size:14px; line-height:1.2;">${item.title}</h2>
      </div>`;
  }

  let pressTimer = null;
  let startY = 0;
  let startX = 0;

  article.addEventListener('contextmenu', (e) => e.preventDefault());

  article.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startY = e.clientY;
    startX = e.clientX;
    
    if (selectedIds.length === 0) {
      pressTimer = setTimeout(() => {
        selectedIds = [item.id];
        lastSelectionTime = Date.now();
        if (navigator.vibrate) navigator.vibrate(50);
        updateSelectionState();
      }, 500);
    }
  });

  article.addEventListener('pointermove', (e) => {
    if (Math.abs(e.clientY - startY) > 10 || Math.abs(e.clientX - startX) > 10) clearTimeout(pressTimer);
  });

  article.addEventListener('pointerup', () => clearTimeout(pressTimer));
  article.addEventListener('pointercancel', () => clearTimeout(pressTimer));

  article.addEventListener('click', (e) => {
    e.preventDefault(); 
    if (selectedIds.length > 0) {
      if (Date.now() - lastSelectionTime < 300) return;
      if (selectedIds.includes(item.id)) selectedIds = selectedIds.filter(id => id !== item.id);
      else selectedIds.push(item.id);
      updateSelectionState();
    } else {
      const link = e.target.closest('a');
      if (link) {
        window.open(link.href, link.target || '_blank');
        return;
      }
      openDetailSheet(item, imgSource);
    }
  });

  itemDiv.appendChild(article);
  return itemDiv;
}

function renderFeed() {
  feedGrid.innerHTML = '';
  updateAvailableTags();
  entries.forEach(item => feedGrid.appendChild(createCardElement(item)));

  renderTags(); 
  renderSearchTags(); 
  renderSearchFeed();
  applySelectionStyles();

  requestAnimationFrame(() => {
    setMasonrySpans();
    document.querySelectorAll('img').forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', scheduleMasonryUpdate, { once: true });
        img.addEventListener('error', scheduleMasonryUpdate, { once: true });
      }
    });
  });
}

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
      matchesQuery = (entry.title && entry.title.toLowerCase().includes(query)) || 
                     (entry.description && entry.description.toLowerCase().includes(query)) ||
                     (entry.url && entry.url.toLowerCase().includes(query)) ||
                     (entry.anchorText && entry.anchorText.toLowerCase().includes(query));
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

  let noResultsMsg = feedGrid.querySelector('.no-results-msg');
  if (visibleCount === 0) {
    if (!noResultsMsg) {
      noResultsMsg = document.createElement('p');
      noResultsMsg.className = 'no-results-msg font-body-md';
      noResultsMsg.style.cssText = 'grid-column: 1 / -1; text-align: center; color: var(--outline); margin-top: 40px;';
      noResultsMsg.textContent = 'No posts found.';
      feedGrid.appendChild(noResultsMsg);
    }
    noResultsMsg.style.display = 'block';
  } else if (noResultsMsg) {
    noResultsMsg.style.display = 'none';
  }

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
    let sheetImgSource = item.image;
    let sheetThumbSource = item.thumb || preloadedSrc || sheetImgSource;
    
    // Fix existing Dropbox links
    if (sheetImgSource && sheetImgSource.includes('dropbox.com')) {
      sheetImgSource = sheetImgSource.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
                                     .replace('?raw=1', '')
                                     .replace('?dl=0', '');
    }
    if (sheetThumbSource && sheetThumbSource.includes('dropbox.com')) {
      sheetThumbSource = sheetThumbSource.replace('www.dropbox.com', 'dl.dropboxusercontent.com')
                                         .replace('?raw=1', '')
                                         .replace('?dl=0', '');
    }
    
    // Progressive Loading UI (Blurry thumbnail instantly loads, High-Res fades in smoothly)
    imgHtml = `
      <div style="margin-bottom: 20px; width: 100%; display: flex; justify-content: center;">
        <div style="position: relative; border-radius: var(--rounded-xl); overflow: hidden; transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black); display: inline-block; background-color: var(--surface-container-low); max-width: 100%;">
          
          <img src="${sheetThumbSource}" alt="" onerror="this.style.display='none'" style="display: block; max-height: 40vh; max-width: 100%; width: auto; height: auto; filter: ${item.thumb ? 'blur(10px)' : 'none'}; transform: ${item.thumb ? 'scale(1.05)' : 'none'};" />
          
          ${item.thumb ? `<img src="${sheetImgSource}" alt="" onload="this.style.opacity='1'" style="position: absolute; top: 0; left: 0; display: block; width: 100%; height: 100%; object-fit: inherit; opacity: 0; transition: opacity 0.5s ease-in-out;" />` : ''}
          
        </div>
      </div>
    `;
  }
  
  const displayLinkText = item.anchorText || item.url;

  detailContent.innerHTML = `
    ${imgHtml}
    <h1 style="font-family: var(--font-family); font-size: 22px; font-weight: 600; line-height: 1.3; color: var(--on-surface); margin-bottom: 8px; word-break: break-word; white-space: pre-wrap;">${item.title}</h1>
    ${item.description ? `<p style="font-family: var(--font-family); font-size: 16px; font-weight: 400; line-height: 1.5; color: var(--on-surface-variant); margin-bottom: 16px; word-break: break-word; white-space: pre-wrap;">${item.description}</p>` : ''}
    ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; color: var(--outline); text-decoration: none; font-size: 14px; margin-bottom: 20px;"><span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span>${displayLinkText}</a>` : ''}
    ${item.tags ? `<div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px;">${item.tags.map(tag => `<span class="font-label-sm" style="background-color: var(--surface-container-high); color: var(--on-surface-variant); padding: 6px 14px; border-radius: 9999px; font-size: 13px;">${tag}</span>`).join('')}</div>` : ''}
  `;

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
  addDescription.value = entry.description || '';
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

const addTitle = document.getElementById('add-title');
const addDescription = document.getElementById('add-description');
const addLink = document.getElementById('add-link');
const addAnchor = document.getElementById('add-anchor');
const btnShowAnchor = document.getElementById('btn-show-anchor');
const anchorContainer = document.getElementById('anchor-container');
const addImage = document.getElementById('add-image');
const addImageFile = document.getElementById('add-image-file');
const addPreviewContainer = document.getElementById('add-preview-container');
const tagsContainer = document.getElementById('tags-container');
const btnSaveEntry = document.getElementById('btn-save-entry');

if (btnShowAnchor) {
  btnShowAnchor.addEventListener('click', () => {
    btnShowAnchor.style.display = 'none';
    anchorContainer.style.display = 'block';
    addAnchor.focus();
  });
}

function renderAddPreview() {
  const text = addTitle.value || (editingId ? 'Edit Preview' : 'Preview');
  const link = addLink.value;
  const displayLinkText = addAnchor.value.trim() || link;
  let html = '';

  // Use the ultra-fast thumb URL for the add preview to save memory
  let previewImgSource = addThumbUrl || addImageUrl;

  if (!previewImgSource) {
    html = `
      <div style="max-width: 240px; margin: 0 auto;">
        <article class="shadow-ambient" style="position: relative; background-color: var(--surface-container-low); color: var(--on-surface); border-radius: var(--rounded-xl); padding: var(--spacing-md); border: 1px solid var(--tertiary-fixed-dim); transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black);">
          <div>
            <h2 class="font-headline-md" style="line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; font-size: clamp(14px, 4.5vw, 24px);">${text}</h2>
            ${link ? `<a href="https://${link.replace(/^https?:\/\//, '')}" target="_blank" class="font-body-md" style="display: block; margin-top: var(--spacing-sm); color: var(--outline); word-break: break-all; text-decoration: underline; pointer-events: none;">${displayLinkText}</a>` : ''}
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
            <img src="${previewImgSource}" onerror="this.style.opacity='0'" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--rounded-xl); transition: opacity 0.3s;" />
            <div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 32px 12px 12px; display: flex; flex-direction: column; gap: 6px; z-index: 2;">
              ${link ? `<div class="font-body-md" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.95); font-size: 12px; text-shadow: 0 1px 4px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size: 14px;">link</span>${displayLinkText.replace(/^https?:\/\//, '')}</div>` : ''}
            </div>
          </div>
          <div style="padding: 6px 8px 0; display: flex; flex-direction: column;">
            <h2 class="font-headline-md" style="color: var(--on-background); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; word-break: break-word; font-size: 14px; line-height: 1.2;">${text}</h2>
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

addTitle.addEventListener('input', renderAddPreview);
addDescription.addEventListener('input', renderAddPreview);
addLink.addEventListener('input', renderAddPreview);
if (addAnchor) addAnchor.addEventListener('input', renderAddPreview);

addImage.addEventListener('input', (e) => {
  addImageUrl = e.target.value;
  addThumbUrl = addImageUrl; // Fallback to same URL if typed manually
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

// Helper function to dynamically compress images
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
      // 1. Generate High-Res version for Detail Sheet
      const full = await compressImage(file, 1600, 0.85, "full");
      // 2. Generate Ultra-Fast Thumbnail for Home Feed
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
  if (!addTitle.value.trim()) return;

  const originalText = btnSaveEntry.textContent;
  btnSaveEntry.textContent = 'Saving...';
  btnSaveEntry.style.pointerEvents = 'none';

  let finalImageUrl = addImageUrl;
  let finalThumbUrl = addThumbUrl;
  let successMessage = ''; 

  try {
    // Concurrently upload both images to Dropbox to save time
    if (pendingImageFile && pendingThumbFile) {
      const [fullUrlRes, thumbUrlRes] = await Promise.all([
        uploadImageToDropbox(pendingImageFile),
        uploadImageToDropbox(pendingThumbFile)
      ]);
      finalImageUrl = fullUrlRes;
      finalThumbUrl = thumbUrlRes;
    } else if (pendingImageFile) {
      finalImageUrl = await uploadImageToDropbox(pendingImageFile);
      finalThumbUrl = finalImageUrl;
    }

    if (editingId) {
      const index = entries.findIndex(e => e.id === editingId);
      if (index !== -1) {
        entries[index].title = addTitle.value;
        entries[index].description = addDescription.value;
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
        description: addDescription.value,
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

// --- Bind Global Events ---
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
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Deleting from Dropbox...';
  authStatus.style.display = 'block';

  const count = selectedIds.length;
  entries = entries.filter(e => !selectedIds.includes(e.id));
  selectedIds = [];

  try {
     await saveDataToDropbox();
     showToast(`${count} item(s) deleted`);
  } catch(e) {
     showToast("Failed to delete items.");
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
