const CLIENT_ID = '1057081070342-4feaisjviq7n4skffb7upg3us7bigjkf.apps.googleusercontent.com';
const DISCOVERY_DOCS = ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'];
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient;
let gapiInited = false;
let gisInited = false;
let folderId = null;
let dataFileId = null;

let entries = [];
let selectedIds = [];
let isInitialRender = true;
let lastSelectionTime = 0;
let searchQuery = ''; 
let selectedSearchTag = null; 
let isDetailSheetOpen = false;
let editingId = null; 
let currentDetailId = null; 
let isToastActive = false; // Prevents nav indicator from reappearing during toasts

// DOM Elements
const authOverlay = document.getElementById('auth-overlay');
const btnLogin = document.getElementById('btn-login');
const authStatus = document.getElementById('auth-status');
const feedGrid = document.getElementById('feed-grid');
const searchTagsContainer = document.getElementById('search-tags-container'); 
const searchInput = document.getElementById('search-input'); 

const views = {
  '/': document.getElementById('view-home'),
  '/search': document.getElementById('view-home'), 
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

const detailSheet = document.getElementById('detail-sheet');
const detailBackdrop = document.getElementById('detail-backdrop');
const detailContent = document.getElementById('detail-content');
const btnSheetClose = document.getElementById('btn-sheet-close');
const btnSheetEdit = document.getElementById('btn-sheet-edit');

// --- Helper: Extract Drive ID robustly and clean up artificial zeros ---
function extractDriveId(url) {
  if (!url) return null;
  let id = null;

  const thumbnailMatch = url.match(/thumbnail\?id=([^&]+)/);
  const ucMatch = url.match(/[?&]id=([^&]+)/);
  const lh3Match = url.match(/lh3\.googleusercontent\.com\/d\/([^/?]+)/);
  const profileMatch = url.match(/profile\/picture\/([^/?]+)/);
  const driveIdMatch = url.match(/drive_id:(.+)/);

  if (thumbnailMatch) id = thumbnailMatch[1];
  else if (ucMatch) id = ucMatch[1];
  else if (lh3Match) id = lh3Match[1];
  else if (profileMatch) id = profileMatch[1];
  else if (driveIdMatch) id = driveIdMatch[1];
  else if (url.includes('googleusercontent') && url.includes('/0')) {
    const parts = url.split('/0');
    if (parts.length > 1) id = parts[1];
  }

  // FIX: Strip the artificial '0' that was prepended in the very first version of the app.
  // Real Drive IDs are 33 characters. If it's 34 and starts with 0, the 0 is fake.
  if (id && id.length === 34 && id.startsWith('0')) {
    id = id.substring(1);
  }

  return id;
}

// --- Dynamic Island Toast Notification ---
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

// --- Global Error Handler for Images ---
window.handleImageError = async function(img) {
  if (img.dataset.retried === '1') return;
  img.dataset.retried = '1';

  const driveId = img.dataset.driveId;

  if (!driveId || driveId.includes('{data.id}')) {
    img.style.display = 'none'; 
    return;
  }

  try {
    const token = gapi.client.getToken();
    if (!token || !token.access_token) throw new Error("No token");

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + token.access_token }
    });

    if (!res.ok) throw new Error('Fetch failed');

    const blob = await res.blob();
    img.src = URL.createObjectURL(blob);
    img.style.display = 'block';
  } catch (e) {
    img.style.display = 'none';
  }
};

// --- Google Drive Initialization ---
window.onload = function () {
  gapi.load('client', initGoogleDriveClient);
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error !== undefined) throw (response);
      const tokenInfo = Object.assign({}, response, {
        expires_at: Date.now() + (response.expires_in * 1000)
      });
      localStorage.setItem('onespot_token', JSON.stringify(tokenInfo));
      authOverlay.style.display = 'none';
      await initializeDrive();
    },
  });
  gisInited = true;
  maybeEnableButtons();

  setTimeout(() => handleRoute(true), 150);
  setTimeout(() => handleRoute(true), 500); 
};

async function initGoogleDriveClient() {
  await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
  gapiInited = true;
  maybeEnableButtons();
}

function maybeEnableButtons() {
  if (gapiInited && gisInited) {
    const saved = localStorage.getItem('onespot_token');
    if (saved) {
      try {
        const tokenInfo = JSON.parse(saved);
        
        // FIX: If token is expired, clear it and force physical button click to prevent popup block
        if (Date.now() > tokenInfo.expires_at) {
           console.log("Token expired, requiring manual re-auth.");
           localStorage.removeItem('onespot_token');
           authStatus.style.display = 'none';
           btnLogin.style.display = 'block';
           return;
        }
        
        gapi.client.setToken(tokenInfo);
        initializeDrive();
        return;
      } catch (e) {
        localStorage.removeItem('onespot_token');
      }
    }
    authStatus.style.display = 'none';
    btnLogin.style.display = 'block';
  }
}

btnLogin.onclick = () => {
  // FIX: This physical click event guarantees the popup won't be blocked
  tokenClient.requestAccessToken({ prompt: 'consent' });
};

async function initializeDrive() {
  authStatus.style.display = 'block';
  authStatus.textContent = 'Syncing with Drive...';
  btnLogin.style.display = 'none';
  authOverlay.style.display = 'flex';

  try {
    let q = "name='OneSpot' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    let res = await gapi.client.drive.files.list({ q: q, spaces: 'drive' });
    if (res.result.files.length > 0) {
      folderId = res.result.files[0].id;
    } else {
      res = await gapi.client.drive.files.create({
        resource: { name: 'OneSpot', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      folderId = res.result.id;
    }

    q = `name='data.json' and '${folderId}' in parents and trashed=false`;
    res = await gapi.client.drive.files.list({ q: q, spaces: 'drive' });
    if (res.result.files.length > 0) {
      dataFileId = res.result.files[0].id;
      const fileRes = await gapi.client.drive.files.get({ fileId: dataFileId, alt: 'media' });
      
      if (fileRes.result && typeof fileRes.result === 'object') {
        entries = Array.isArray(fileRes.result) ? fileRes.result : [];
      } else if (fileRes.body) {
        try { entries = JSON.parse(fileRes.body); } catch (e) { entries = []; }
      }
    } else {
      const file = new Blob(['[]'], { type: 'application/json' });
      const metadata = { name: 'data.json', parents: [folderId] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', file);

      const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
        body: form
      });
      const data = await createRes.json();
      dataFileId = data.id;
    }

    const aboutRes = await gapi.client.drive.about.get({ fields: 'user' });
    if (aboutRes.result.user) {
      const user = aboutRes.result.user;
      document.getElementById('profile-name').textContent = user.displayName || 'User';
      document.getElementById('profile-email').textContent = user.emailAddress || '';
      if (user.photoLink) {
        let photoUrl = user.photoLink;
        if (photoUrl.startsWith('//')) photoUrl = 'https:' + photoUrl;
        const img = document.getElementById('profile-image');
        img.src = photoUrl;
        img.style.display = 'block';
        document.getElementById('profile-placeholder').style.display = 'none';
      }
    }

  } catch (err) {
    console.error('Drive API Error:', err);
    if (err.status === 401 || (err.result && err.result.error && err.result.error.code === 401)) {
      // FIX: Force manual logout on 401 to prevent popup blocks
      localStorage.removeItem('onespot_token');
      authStatus.style.display = 'none';
      btnLogin.style.display = 'block';
      return;
    } else {
      showToast('Failed to connect to Drive. Please try again.');
    }
  }

  authOverlay.style.display = 'none';
  renderFeed();
}

async function saveDataToDrive() {
  const file = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
  await fetch(`https://www.googleapis.com/upload/drive/v3/files/${dataFileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
    body: file
  });
}

async function uploadImageToDrive(file) {
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Uploading image...';
  authStatus.style.display = 'block';

  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
    body: form
  });
  const data = await createRes.json();

  await gapi.client.drive.permissions.create({
    fileId: data.id,
    resource: { type: 'anyone', role: 'reader' }
  });

  authOverlay.style.display = 'none';
  // Safari friendly stable thumbnail URL
  return `https://drive.google.com/thumbnail?id=${data.id}&sz=w1000`;
}


// --- Routing & UI Orchestrated Animations ---
function handleRoute(noAnimate = false) {
  if (typeof noAnimate !== 'boolean') noAnimate = false;
  
  const hash = window.location.hash.replace('#', '') || '/';
  const searchHeader = document.getElementById('search-header');

  if (hash !== '/add' && editingId) {
    editingId = null;
    btnSaveEntry.textContent = 'Save Entry';
    addText.value = ''; addLink.value = ''; addImage.value = ''; addImageUrl = ''; addTags = [];
    renderAddPreview(); renderTags();
  }

  window.scrollTo({ top: 0, behavior: 'instant' });

  Object.values(views).forEach(v => {
    if (v) {
      v.style.display = 'none';
      v.style.animation = 'none'; 
    }
  });

  const activeView = views[hash] || views['/'];

  if (hash === '/' || hash === '/search') {
    if (activeView) activeView.style.display = 'block';

    if (hash === '/') {
      if (searchHeader) {
        searchHeader.classList.remove('search-header-expanded');
        searchHeader.classList.add('search-header-collapsed');
      }
      searchQuery = '';
      selectedSearchTag = null;
      if (searchInput) searchInput.value = '';
      renderSearchTags();
      renderSearchFeed(); 
    } else if (hash === '/search') {
      if (searchHeader) {
        searchHeader.classList.remove('search-header-collapsed');
        searchHeader.classList.add('search-header-expanded');
      }
    }
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
  
  // Instantly apply masonry fix to avoid visual layout thrashing bounce, 
  // with a brief delayed backup in case of image rendering.
  setMasonrySpans(); 
  setTimeout(setMasonrySpans, 50);
}

function updateNavIndicator(hash, noAnimate = false) {
  let activeIndex = 0;
  if (hash.startsWith('/search')) activeIndex = 1;
  if (hash.startsWith('/add')) activeIndex = 2;
  if (hash.startsWith('/profile')) activeIndex = 3;

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
    
    // Only reveal the indicator if a toast is NOT currently hiding it
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
  
  // Phase 1: Read Layout Metrics (avoids layout thrashing)
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

  // Phase 2: Batch Write DOM changes
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
  
  availableTags.forEach(tag => {
    const btn = document.createElement('button');
    const isSelected = tag === selectedSearchTag;
    
    btn.className = 'font-label-sm shadow-ambient';
    btn.textContent = tag;
    btn.style.cssText = `
      background-color: ${isSelected ? 'var(--primary)' : 'var(--surface-container-low)'}; 
      color: ${isSelected ? 'var(--on-primary)' : 'var(--on-surface)'}; 
      border: 1px solid transparent; 
      border-radius: var(--rounded-full); 
      padding: 8px 16px; 
      cursor: pointer; 
      transition: all 0.2s;
      flex-shrink: 0;
    `;
    
    btn.onclick = () => {
      selectedSearchTag = (selectedSearchTag === tag) ? null : tag;
      renderSearchTags();
      renderSearchFeed();
    };
    
    searchTagsContainer.appendChild(btn);
  });
}

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderSearchFeed();
  });
}

function createCardElement(item) {
  const itemDiv = document.createElement('div');
  itemDiv.className = 'masonry-item';

  let driveId = extractDriveId(item.image);
  let imgSource = driveId ? `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000` : item.image;

  const article = document.createElement('article');
  article.dataset.id = item.id;
  article.className = 'card-hover';
  article.style.cssText = 'display:block;width:100%;cursor:pointer;border-radius:var(--rounded-xl);transform:scale(1);opacity:1;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1),opacity 0.3s;position:relative;';

  if (!item.image) {
    article.classList.add('shadow-ambient');
    article.style.backgroundColor = 'var(--surface-container-low)';
    article.style.color = 'var(--on-surface)';
    article.style.padding = 'var(--spacing-md)';
    article.style.border = '1px solid var(--tertiary-fixed-dim)';
    article.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:var(--spacing-md);">
        <h2 class="font-headline-md" style="line-height:1.3;word-break:break-word;font-size:clamp(14px,4.5vw,24px);">${item.title}</h2>
        ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" class="font-body-md" style="display:block;margin-top:var(--spacing-sm);color:var(--outline);text-decoration:underline;">${item.url}</a>` : ''}
      </div>`;
  } else {
    article.style.backgroundColor = 'transparent';
    const safeRatio = (item.aspectRatio && item.aspectRatio !== 'NaN%') ? item.aspectRatio : '100%';
    article.innerHTML = `
      <div class="shadow-ambient" style="position:relative;width:100%;padding-bottom:${safeRatio};background-color:var(--surface-container-low);overflow:hidden;border-radius:var(--rounded-xl);transform:translateZ(0);-webkit-mask-image:-webkit-radial-gradient(white,black);">
        <img src="${imgSource}" data-drive-id="${driveId || ''}" alt="" class="img-hover" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover; pointer-events:none;"
          onerror="window.handleImageError(this)" />
        <div style="position:absolute;bottom:0;left:0;width:100%;padding:32px 12px 12px;display:flex;flex-direction:column;gap:6px;z-index:2;pointer-events:none;">
          ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" style="display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.95);text-decoration:none;font-size:12px;text-shadow:0 1px 4px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size:14px;">link</span>${item.url}</a>` : ''}
        </div>
      </div>
      <div style="padding:6px 8px 0;">
        <h2 class="font-headline-md" style="color:var(--on-background);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.2;">${item.title}</h2>
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
      
      const clickedImg = article.querySelector('img');
      const loadedSrc = clickedImg ? clickedImg.src : null;
      openDetailSheet(item, loadedSrc);
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
                     (entry.url && entry.url.toLowerCase().includes(query));
    }
    
    let matchesTag = true;
    if (selectedSearchTag) {
      matchesTag = entry.tags && entry.tags.includes(selectedSearchTag);
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
      noResultsMsg.textContent = 'No entries found.';
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

    let overlay = article.querySelector('.sel-overlay');
    if (isSelected && !overlay) {
      overlay = document.createElement('div');
      overlay.className = 'sel-overlay';
      overlay.style.cssText = 'position:absolute;inset:0;z-index:30;background:rgba(0,0,0,0.4);border-radius:inherit;pointer-events:none;';
      article.prepend(overlay);
    } else if (!isSelected && overlay) {
      overlay.remove();
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
      // Instant hide selection bar, instant show bottom nav
      selectionBar.style.transition = 'none';
      selectionBar.style.transform = 'translateY(200%)'; 
      selectionBar.style.display = 'none';
      
      bottomNav.style.transition = 'none';
      bottomNav.style.transform = 'translateY(0)'; 
      
      // Force layout recalculation so the 'none' transitions apply immediately
      void bottomNav.offsetWidth;
      void selectionBar.offsetWidth;
      
      // Restore the smooth transitions for future use
      bottomNav.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      selectionBar.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      
      updateNavIndicator(window.location.hash.replace('#', '') || '/', true);
    } else {
      // Animated hide/show
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

// --- Detail Sheet & History API ---
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
    let sheetImgSource = preloadedSrc || item.image;
    let driveId = '';
    
    if (!preloadedSrc) {
      driveId = extractDriveId(item.image) || '';
      if (driveId) {
        sheetImgSource = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
      }
    } else {
      driveId = extractDriveId(item.image) || '';
    }

    imgHtml = `
      <div style="margin-bottom: 20px; width: 100%; display: flex; justify-content: center;">
        <div style="border-radius: var(--rounded-xl); overflow: hidden; transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black); display: inline-block; background-color: var(--surface-container-low); max-width: 100%;">
          <img src="${sheetImgSource}" data-drive-id="${driveId}" alt="" style="display: block; max-height: 40vh; max-width: 100%; width: auto; height: auto;" onerror="window.handleImageError(this)" />
        </div>
      </div>
    `;
  }

  detailContent.innerHTML = `
    ${imgHtml}
    <h1 style="font-family: var(--font-family); font-size: 22px; font-weight: 600; line-height: 1.3; color: var(--on-surface); margin-bottom: 12px; word-break: break-word;">${item.title}</h1>
    ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" style="display: inline-flex; align-items: center; gap: 6px; color: var(--outline); text-decoration: none; font-size: 14px; margin-bottom: 20px;"><span class="material-symbols-outlined" style="font-size: 16px;">open_in_new</span>${item.url}</a>` : ''}
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


// --- Edit Entry Logic ---
function startEditMode(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  editingId = id;
  addText.value = entry.title || '';
  addLink.value = entry.url || '';
  addImageUrl = entry.image || '';
  addImageAspectRatio = entry.aspectRatio || '100%';
  addTags = entry.tags ? [...entry.tags] : [];
  
  pendingImageFile = null;
  addImage.value = ''; 

  btnSaveEntry.textContent = 'Update Entry';
  
  if (isDetailSheetOpen) closeDetailSheet(false);
  if (selectedIds.length > 0) {
    selectedIds = [];
    updateSelectionState(true); // <--- Instantly replace with nav bar
  }
  
  window.location.hash = '#/add';
  renderAddPreview();
  renderTags();
}

btnEdit.addEventListener('click', () => {
  if (selectedIds.length === 1) startEditMode(selectedIds[0]);
});

btnSheetEdit.addEventListener('click', () => {
  if (currentDetailId) startEditMode(currentDetailId);
});


// --- Add Entry Logic ---
let addTags = [];
let addImageUrl = '';
let addImageAspectRatio = '100%';
let pendingImageFile = null;

const addText = document.getElementById('add-text');
const addLink = document.getElementById('add-link');
const addImage = document.getElementById('add-image');
const addImageFile = document.getElementById('add-image-file');
const addPreviewContainer = document.getElementById('add-preview-container');
const tagsContainer = document.getElementById('tags-container');
const btnSaveEntry = document.getElementById('btn-save-entry');

function renderAddPreview() {
  const text = addText.value || (editingId ? 'Edit Preview' : 'Preview');
  const link = addLink.value;
  let html = '';

  if (!addImageUrl) {
    html = `
      <article class="shadow-ambient" style="position: relative; background-color: var(--surface-container-low); color: var(--on-surface); border-radius: var(--rounded-xl); padding: var(--spacing-md); border: 1px solid var(--tertiary-fixed-dim); transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black);">
        <div>
          <h2 class="font-headline-md" style="line-height: 1.3; word-break: break-word; font-size: clamp(14px, 4.5vw, 24px);">${text}</h2>
          ${link ? `<a href="https://${link.replace(/^https?:\/\//, '')}" target="_blank" class="font-body-md" style="display: block; margin-top: var(--spacing-sm); color: var(--outline); word-break: break-all; text-decoration: underline; pointer-events: none;">${link}</a>` : ''}
        </div>
      </article>
    `;
  } else {
    let previewSrc = addImageUrl;
    let driveId = extractDriveId(addImageUrl) || '';
    
    if (driveId) {
      previewSrc = `https://drive.google.com/thumbnail?id=${driveId}&sz=w1000`;
    }

    html = `
      <article style="position: relative; background-color: transparent; border-radius: var(--rounded-xl); border: none;">
        <div class="shadow-ambient" style="position: relative; width: 100%; padding-bottom: ${addImageAspectRatio}; background-color: var(--surface-container-low); overflow: hidden; border-radius: var(--rounded-xl);">
          <img src="${previewSrc}" data-drive-id="${driveId}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--rounded-xl);" onerror="window.handleImageError(this)" />
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 32px 12px 12px; display: flex; flex-direction: column; gap: 6px; z-index: 2;">
            ${link ? `<div class="font-body-md" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.95); font-size: 12px; text-shadow: 0 1px 4px rgba(0,0,0,0.8), 0 0 10px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size: 14px;">link</span>${link.replace(/^https?:\/\//, '')}</div>` : ''}
          </div>
        </div>
        <div style="padding: 6px 8px 0; display: flex; flex-direction: column;">
          <h2 class="font-headline-md" style="color: var(--on-background); display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; font-size: 14px; line-height: 1.2;">${text}</h2>
        </div>
      </article>
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
    const el = document.createElement('div');
    el.className = 'font-label-sm';
    el.textContent = tag;
    el.style.backgroundColor = isSelected ? 'var(--tertiary)' : 'var(--surface-container)';
    el.style.color = isSelected ? 'var(--on-tertiary)' : 'var(--on-surface)';
    el.style.border = isSelected ? '1px solid var(--tertiary)' : '1px solid transparent';
    el.style.borderRadius = 'var(--rounded-full)';
    el.style.padding = '8px 16px';
    el.style.cursor = 'pointer';
    el.style.transition = 'all 0.2s';
    el.onclick = () => {
      if (isSelected) addTags = addTags.filter(t => t !== tag);
      else addTags.push(tag);
      renderTags();
    };
    tagsContainer.appendChild(el);
  });

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

addText.addEventListener('input', renderAddPreview);
addLink.addEventListener('input', renderAddPreview);

addImage.addEventListener('input', (e) => {
  addImageUrl = e.target.value;
  pendingImageFile = null;
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

addImageFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    pendingImageFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      addImageUrl = reader.result;
      addImage.value = file.name;
      const img = new Image();
      img.onload = () => {
        addImageAspectRatio = ((img.height / img.width) * 100).toFixed(2) + '%';
        renderAddPreview();
      };
      img.src = addImageUrl;
    };
    reader.readAsDataURL(file);
  }
});

btnSaveEntry.addEventListener('click', async () => {
  if (!addText.value.trim()) return;

  const originalText = btnSaveEntry.textContent;
  btnSaveEntry.textContent = 'Saving...';
  btnSaveEntry.style.pointerEvents = 'none';

  let finalImageUrl = addImageUrl;
  let successMessage = ''; // Added to store the message

  try {
    if (pendingImageFile) finalImageUrl = await uploadImageToDrive(pendingImageFile);

    if (editingId) {
      const index = entries.findIndex(e => e.id === editingId);
      if (index !== -1) {
        entries[index].title = addText.value;
        entries[index].url = addLink.value;
        entries[index].image = finalImageUrl;
        entries[index].aspectRatio = addImageAspectRatio;
        entries[index].tags = [...addTags];
        entries[index].type = addTags[0] || 'Note';
      }
      successMessage = 'Entry updated!'; // Store instead of showing
    } else {
      entries.unshift({
        id: Date.now().toString(),
        title: addText.value,
        url: addLink.value,
        image: finalImageUrl,
        aspectRatio: addImageAspectRatio,
        tags: [...addTags],
        type: addTags[0] || 'Note'
      });
      successMessage = 'Entry saved!'; // Store instead of showing
    }

    await saveDataToDrive();

    addText.value = ''; addLink.value = ''; addImage.value = ''; addImageUrl = ''; 
    pendingImageFile = null; addTags = []; editingId = null;
    btnSaveEntry.textContent = 'Save Entry';
    
    updateAvailableTags(); 
    renderAddPreview();
    renderTags();

    window.location.hash = '#/';
    handleRoute();
    renderFeed();
    
    showToast(successMessage); // Show the toast AFTER redirecting and rendering
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
  authStatus.textContent = 'Deleting from Drive...';
  authStatus.style.display = 'block';

  const entriesToDelete = entries.filter(e => selectedIds.includes(e.id));
  for (const item of entriesToDelete) {
    const driveId = extractDriveId(item.image);
    if (driveId) {
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }
        });
      } catch (e) {
        console.error("Error deleting image from Drive:", e);
      }
    }
  }

  const count = selectedIds.length;
  entries = entries.filter(e => !selectedIds.includes(e.id));
  selectedIds = [];

  await saveDataToDrive();

  authOverlay.style.display = 'none';
  showToast(`${count} item(s) deleted`);
  renderFeed();
  updateSelectionState(true); // <--- Instantly replace with nav bar after overlay disappears
});

btnCloseSelection.addEventListener('click', () => {
  selectedIds = [];
  updateSelectionState(); // <--- Uses default (animated) fallback
});

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('onespot_token');
  window.location.hash = '#/';
  window.location.reload();
});

// --- PWA Service Worker Registration ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      })
      .catch((error) => {
        console.log('ServiceWorker registration failed: ', error);
      });
  });
}
