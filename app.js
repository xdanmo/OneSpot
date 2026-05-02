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

// DOM Elements
const authOverlay = document.getElementById('auth-overlay');
const btnLogin = document.getElementById('btn-login');
const authStatus = document.getElementById('auth-status');
const views = {
  '/': document.getElementById('view-home'),
  '/profile': document.getElementById('view-profile'),
  '/add': document.getElementById('view-add')
};
const feedGrid = document.getElementById('feed-grid');
const navLinks = document.querySelectorAll('.nav-link');
const navIndicator = document.getElementById('nav-indicator');
const bottomNav = document.getElementById('bottom-nav');
const selectionBar = document.getElementById('selection-bar');
const selectionCount = document.getElementById('selection-count');
const btnDelete = document.getElementById('btn-delete');
const btnCloseSelection = document.getElementById('btn-close-selection');

const detailSheet = document.getElementById('detail-sheet');
const detailBackdrop = document.getElementById('detail-backdrop');
const detailContent = document.getElementById('detail-content');
const btnSheetClose = document.getElementById('btn-sheet-close');

// --- Global Error Handler for Images ---
window.handleImageError = async function(img) {
  if (img.dataset.retried === '1') return;
  img.dataset.retried = '1';

  const driveId = img.dataset.driveId;
  if (!driveId || driveId.includes('{data.id}')) {
    img.style.display = 'none'; // Hide completely if it's an old broken post
    return;
  }

  try {
    const token = gapi.client.getToken();
    if (!token) return;

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
      headers: { 'Authorization': 'Bearer ' + token.access_token }
    });

    if (res.ok) {
      const blob = await res.blob();
      img.src = URL.createObjectURL(blob);
    } else {
      img.style.display = 'none';
    }
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
        if (tokenInfo && tokenInfo.access_token) {
          gapi.client.setToken(tokenInfo);
          initializeDrive();
          return;
        }
      } catch (e) {
        localStorage.removeItem('onespot_token');
      }
    }
    authStatus.style.display = 'none';
    btnLogin.style.display = 'block';
  }
}

btnLogin.onclick = () => {
  tokenClient.requestAccessToken({ prompt: 'consent' });
};

async function initializeDrive() {
  authStatus.style.display = 'block';
  authStatus.textContent = 'Syncing...';
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
  } catch (err) {
    console.error('Drive Error:', err);
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
  const metadata = { name: file.name, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', file);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
    body: form
  });
  const data = await res.json();
  return `https://lh3.googleusercontent.com/d/${data.id}`;
}

// --- Masonry & Rendering ---
function setMasonrySpans() {
  const rowSize = 4;
  document.querySelectorAll('.masonry-item').forEach(item => {
    item.style.gridRowEnd = ''; 
    const article = item.children[0];
    if (!article) return;
    const contentHeight = article.getBoundingClientRect().height;
    const marginBottom = parseFloat(window.getComputedStyle(item).marginBottom) || 12;
    const spans = Math.ceil((contentHeight + marginBottom) / rowSize);
    item.style.gridRowEnd = `span ${spans}`;
  });
}

function renderFeed() {
  feedGrid.innerHTML = '';
  entries.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'masonry-item';

    let driveId = '';
    if (item.image) {
      const match = item.image.match(/d\/([^/?]+)/) || item.image.match(/id=([^&]+)/);
      if (match) driveId = match[1];
    }

    const article = document.createElement('article');
    article.dataset.id = item.id;
    article.className = 'card-hover';
    article.style.cssText = 'display:block;width:100%;cursor:pointer;border-radius:var(--rounded-xl);position:relative;';

    if (!item.image) {
      article.innerHTML = `
        <div class="shadow-ambient" style="background-color:var(--surface-container-low);color:var(--on-surface);padding:var(--spacing-md);border:1px solid var(--tertiary-fixed-dim);border-radius:inherit;">
          <h2 class="font-headline-md">${item.title}</h2>
          ${item.url ? `<p class="font-body-md" style="color:var(--outline);text-decoration:underline;">${item.url}</p>` : ''}
        </div>`;
    } else {
      article.innerHTML = `
        <div class="shadow-ambient" style="position:relative;width:100%;padding-bottom:${item.aspectRatio || '100%'};background-color:var(--surface-container-low);overflow:hidden;border-radius:var(--rounded-xl);">
          <img src="${item.image}" data-drive-id="${driveId}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;pointer-events:none;" onerror="window.handleImageError(this)" />
          <div style="position:absolute;bottom:0;left:0;width:100%;padding:12px;z-index:2;pointer-events:none;">
            ${item.url ? `<p style="color:white;font-size:12px;text-shadow:0 1px 4px black;">${item.url}</p>` : ''}
          </div>
        </div>
        <div style="padding:8px 4px 0;"><h2 class="font-headline-md" style="font-size:14px;">${item.title}</h2></div>`;
    }

    // --- INTERACTION LOGIC (Fixed for Android) ---
    let timer = null;
    let moved = false;

    article.addEventListener('touchstart', (e) => {
      moved = false;
      if (selectedIds.length === 0) {
        timer = setTimeout(() => {
          moved = true; // Mark as "handled by long press"
          selectedIds = [item.id];
          if (navigator.vibrate) navigator.vibrate(50);
          updateSelectionState();
        }, 600);
      }
    }, { passive: true });

    article.addEventListener('touchmove', () => { clearTimeout(timer); moved = true; }, { passive: true });

    article.addEventListener('click', (e) => {
      clearTimeout(timer);
      if (moved) return;

      if (selectedIds.length > 0) {
        e.preventDefault();
        if (selectedIds.includes(item.id)) {
          selectedIds = selectedIds.filter(id => id !== item.id);
        } else {
          selectedIds.push(item.id);
        }
        updateSelectionState();
      } else {
        openDetailSheet(item);
      }
    });

    itemDiv.appendChild(article);
    feedGrid.appendChild(itemDiv);
  });

  applySelectionStyles();
  setTimeout(setMasonrySpans, 200);
}

function updateSelectionState() {
  applySelectionStyles();
  if (selectedIds.length > 0) {
    bottomNav.style.display = 'none';
    selectionBar.style.display = 'flex';
    selectionCount.textContent = `${selectedIds.length} Selected`;
  } else {
    bottomNav.style.display = 'flex';
    selectionBar.style.display = 'none';
  }
}

function applySelectionStyles() {
  const inMode = selectedIds.length > 0;
  document.querySelectorAll('article[data-id]').forEach(art => {
    const id = art.dataset.id;
    const isSel = selectedIds.includes(id);
    art.style.transform = isSel ? 'scale(0.95)' : 'scale(1)';
    art.style.opacity = (inMode && !isSel) ? '0.6' : '1';
    let ov = art.querySelector('.sel-overlay');
    if (isSel && !ov) {
      ov = document.createElement('div');
      ov.className = 'sel-overlay';
      ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.3);border-radius:inherit;z-index:10;pointer-events:none;';
      art.appendChild(ov);
    } else if (!isSel && ov) ov.remove();
  });
}

// --- Navigation & Routing ---
function handleRoute() {
  const hash = window.location.hash.replace('#', '') || '/';
  Object.values(views).forEach(v => v.style.display = 'none');
  if (views[hash]) views[hash].style.display = 'block';
  updateNavIndicator(hash);
}

function updateNavIndicator(hash) {
  let activeIndex = 0;
  if (hash.startsWith('/profile')) activeIndex = 1;
  if (hash.startsWith('/add')) activeIndex = 2;
  const activeLink = navLinks[activeIndex];
  if (activeLink) {
    navIndicator.style.left = activeLink.offsetLeft + 'px';
    navIndicator.style.width = activeLink.offsetWidth + 'px';
    navIndicator.style.height = activeLink.offsetHeight + 'px';
    navIndicator.style.opacity = '1';
  }
}

function openDetailSheet(item) {
  detailContent.innerHTML = `
    <h1 style="font-size:22px;margin-bottom:12px;">${item.title}</h1>
    ${item.url ? `<a href="${item.url}" target="_blank" style="color:var(--outline);">${item.url}</a>` : ''}
  `;
  detailBackdrop.style.opacity = '1';
  detailBackdrop.style.pointerEvents = 'auto';
  detailSheet.style.transform = 'translateY(0)';
  document.body.style.overflow = 'hidden';
}

function closeDetailSheet() {
  detailBackdrop.style.opacity = '0';
  detailBackdrop.style.pointerEvents = 'none';
  detailSheet.style.transform = 'translateY(100%)';
  document.body.style.overflow = '';
}

// --- Form Logic ---
const btnSaveEntry = document.getElementById('btn-save-entry');
const addText = document.getElementById('add-text');
const addLink = document.getElementById('add-link');
const addImageFile = document.getElementById('add-image-file');

btnSaveEntry.addEventListener('click', async () => {
  if (!addText.value.trim()) return;
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Saving...';
  
  let imgUrl = '';
  if (addImageFile.files[0]) {
    imgUrl = await uploadImageToDrive(addImageFile.files[0]);
  }

  entries.unshift({
    id: Date.now().toString(),
    title: addText.value,
    url: addLink.value,
    image: imgUrl,
    type: 'Note'
  });

  await saveDataToDrive();
  window.location.hash = '#/';
  location.reload();
});

window.addEventListener('hashchange', handleRoute);
detailBackdrop.addEventListener('click', closeDetailSheet);
btnSheetClose.addEventListener('click', closeDetailSheet);
btnCloseSelection.addEventListener('click', () => { selectedIds = []; updateSelectionState(); });

handleRoute();
