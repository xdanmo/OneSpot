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
let pressTimer = null;
let isInitialRender = true;

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

// --- Google Drive Initialization ---
window.onload = function () {
  gapi.load('client', initializeGapiClient);
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error !== undefined) {
        throw (response);
      }

      // Save token to prevent logout on refresh
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

async function initializeGapiClient() {
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
  authStatus.textContent = 'Syncing with Drive...';
  btnLogin.style.display = 'none';
  authOverlay.style.display = 'flex';

  try {
    // 1. Find or create OneSpot folder
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

    // 2. Find or create data.json
    q = `name='data.json' and '${folderId}' in parents and trashed=false`;
    res = await gapi.client.drive.files.list({ q: q, spaces: 'drive' });
    if (res.result.files.length > 0) {
      dataFileId = res.result.files[0].id;
      // Fetch content
      const fileRes = await gapi.client.drive.files.get({ fileId: dataFileId, alt: 'media' });
      if (fileRes.body) {
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
    // 3. Fetch User Profile
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
      // Token expired or invalid
      localStorage.removeItem('onespot_token');
      authStatus.style.display = 'none';
      btnLogin.style.display = 'block';
      authOverlay.style.display = 'flex';
      return;
    } else {
      alert('Failed to connect to Drive. Check console.');
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

  // Make the file publicly readable so the <img> tag can display it without headers
  await gapi.client.drive.permissions.create({
    fileId: data.id,
    resource: { type: 'anyone', role: 'reader' }
  });

  authOverlay.style.display = 'none';
  return `https://lh3.googleusercontent.com/d/${data.id}`;
}


// --- Routing ---
function handleRoute() {
  const hash = window.location.hash.replace('#', '') || '/';
  Object.values(views).forEach(v => v.style.display = 'none');
  if (views[hash]) views[hash].style.display = 'block';
  else views['/'].style.display = 'block';
  updateNavIndicator(hash);
}

function updateNavIndicator(hash) {
  let activeIndex = 0;
  if (hash.startsWith('/profile')) activeIndex = 1;
  if (hash.startsWith('/add')) activeIndex = 2;

  navLinks.forEach((link, idx) => {
    if (idx === activeIndex) {
      link.style.color = 'var(--on-primary)';
      link.style.transform = 'scale(1.1)';
    } else {
      link.style.color = 'var(--outline)';
      link.style.transform = 'scale(1)';
    }
  });

  const activeLink = navLinks[activeIndex];
  if (activeLink) {
    navIndicator.style.left = activeLink.offsetLeft + 'px';
    navIndicator.style.top = activeLink.offsetTop + 'px';
    navIndicator.style.width = activeLink.offsetWidth + 'px';
    navIndicator.style.height = activeLink.offsetHeight + 'px';
    navIndicator.style.opacity = '1';

    if (isInitialRender) {
      navIndicator.style.transition = 'none';
      setTimeout(() => {
        isInitialRender = false;
        navIndicator.style.transition = 'all 0.5s ease';
      }, 50);
    }
  }
}

// --- Masonry Row Spanning ---
function setMasonrySpans() {
  const grid = feedGrid;
  const rowSize = 4; // must match grid-auto-rows in CSS
  const gap = parseInt(window.getComputedStyle(grid).columnGap) || 12;
  document.querySelectorAll('.masonry-item').forEach(item => {
    item.style.gridRowEnd = '';
    const height = item.getBoundingClientRect().height;
    const spans = Math.ceil((height + gap) / (rowSize + gap));
    item.style.gridRowEnd = `span ${spans}`;
  });
}

// --- Rendering ---
function renderFeed() {
  feedGrid.innerHTML = '';
  entries.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'masonry-item';

    // Resolve image source
    let driveId = null;
    let imgSource = item.image;
    if (item.image) {
      const ucMatch = item.image.match(/[?&]id=([^&]+)/);
      const lh3Match = item.image.match(/lh3\.googleusercontent\.com\/d\/([^/?]+)/);
      if (ucMatch) { driveId = ucMatch[1]; imgSource = `https://lh3.googleusercontent.com/d/${driveId}`; }
      else if (lh3Match) { driveId = lh3Match[1]; imgSource = item.image; }
    }

    // Build article — no selection state baked in, updated via applySelectionStyles()
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
      article.innerHTML = `
        <div class="shadow-ambient" style="position:relative;width:100%;padding-bottom:${item.aspectRatio};background-color:var(--surface-container-low);overflow:hidden;border-radius:var(--rounded-xl);transform:translateZ(0);-webkit-mask-image:-webkit-radial-gradient(white,black);">
          <img src="${imgSource}" data-drive-id="${driveId || ''}" alt="" class="img-hover" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;"
            onerror="if(this.dataset.driveId&&!this.dataset.retried){this.dataset.retried='1';fetch('https://www.googleapis.com/drive/v3/files/'+this.dataset.driveId+'?alt=media',{headers:{'Authorization':'Bearer '+gapi.client.getToken().access_token}}).then(r=>r.blob()).then(b=>{this.src=URL.createObjectURL(b)}).catch(()=>{})}" />
          <div style="position:absolute;bottom:0;left:0;width:100%;padding:32px 12px 12px;background:linear-gradient(to bottom,transparent,rgba(0,0,0,0.7));display:flex;flex-direction:column;gap:6px;z-index:2;pointer-events:none;">
            ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" style="display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.9);text-decoration:none;font-size:12px;"><span class="material-symbols-outlined" style="font-size:14px;">link</span>${item.url}</a>` : ''}
          </div>
        </div>
        <div style="padding:6px 8px 0;">
          <h2 class="font-headline-md" style="color:var(--on-background);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.2;">${item.title}</h2>
        </div>`;
    }

    // Events
    let longPressTriggered = false;
    const cancelPress = () => clearTimeout(pressTimer);

    article.addEventListener('pointerdown', () => {
      if (selectedIds.length === 0) {
        longPressTriggered = false;
        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          selectedIds = [item.id];
          if (navigator.vibrate) navigator.vibrate(50);
          updateSelectionState();
        }, 500);
      }
    });
    article.addEventListener('pointerup', cancelPress);
    article.addEventListener('pointerleave', cancelPress);
    article.addEventListener('pointercancel', cancelPress);
    article.addEventListener('click', (e) => {
      cancelPress();
      if (longPressTriggered) { e.preventDefault(); return; }
      if (selectedIds.length > 0) {
        e.preventDefault();
        if (selectedIds.includes(item.id)) selectedIds = selectedIds.filter(id => id !== item.id);
        else selectedIds.push(item.id);
        updateSelectionState();
      } else {
        openDetailSheet(item);
      }
    });

    itemDiv.appendChild(article);
    feedGrid.appendChild(itemDiv);
  });

  applySelectionStyles();

  // Apply row spans after paint so heights are known
  requestAnimationFrame(() => {
    setMasonrySpans();
    // Re-run after images load to correct spans
    feedGrid.querySelectorAll('img').forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', () => setMasonrySpans(), { once: true });
        img.addEventListener('error', () => setMasonrySpans(), { once: true });
      }
    });
  });
}

// Updates card visuals in-place — no DOM rebuild, no glitch
function applySelectionStyles() {
  const inSelectionMode = selectedIds.length > 0;
  document.querySelectorAll('article[data-id]').forEach(article => {
    const id = article.dataset.id;
    const isSelected = selectedIds.includes(id);

    article.style.transform = isSelected ? 'scale(0.95)' : 'scale(1)';
    article.style.opacity = (inSelectionMode && !isSelected) ? '0.6' : '1';

    if (inSelectionMode) article.classList.remove('card-hover');
    else article.classList.add('card-hover');

    // Manage dark overlay for selected state
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

function updateSelectionState() {
  applySelectionStyles();
  if (selectedIds.length > 0) {
    bottomNav.style.display = 'none';
    selectionBar.style.display = 'flex';
    selectionCount.textContent = `${selectedIds.length} Selected`;
    document.getElementById('btn-edit').style.display = selectedIds.length === 1 ? 'block' : 'none';
  } else {
    bottomNav.style.display = 'flex';
    selectionBar.style.display = 'none';
  }
}

// --- Detail Sheet ---
function openDetailSheet(item) {
  let imgHtml = '';
  if (item.image) {
    let sheetImgSource = item.image;
    const ucMatch = item.image.match(/[?&]id=([^&]+)/);
    if (ucMatch) sheetImgSource = `https://lh3.googleusercontent.com/d/${ucMatch[1]}`;
    imgHtml = `
      <div style="margin-bottom: 20px; width: 100%; display: flex; justify-content: center;">
        <div style="border-radius: var(--rounded-xl); overflow: hidden; transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black); display: inline-block; background-color: var(--surface-container-low); max-width: 100%;">
          <img src="${sheetImgSource}" data-drive-id="${ucMatch ? ucMatch[1] : ''}" alt="" style="display: block; max-height: 40vh; max-width: 100%; width: auto; height: auto;" onerror="if(this.dataset.driveId && !this.dataset.retried){this.dataset.retried='1';fetch('https://www.googleapis.com/drive/v3/files/'+this.dataset.driveId+'?alt=media',{headers:{'Authorization':'Bearer '+gapi.client.getToken().access_token}}).then(r=>r.blob()).then(b=>{this.src=URL.createObjectURL(b)}).catch(()=>{})}" />
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

function closeDetailSheet() {
  detailBackdrop.style.opacity = '0';
  detailSheet.style.transform = 'translateY(100%)';
  detailBackdrop.style.pointerEvents = 'none';
  setTimeout(() => { document.body.style.overflow = ''; }, 300);
}


// --- Add Entry Logic ---
const availableTags = ['Design', 'Interior', 'Art', 'Tech', 'Cooking', 'Travel', 'Minimalism', 'Architecture', 'Photography'];
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
  const text = addText.value || 'Preview';
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
    html = `
      <article style="position: relative; background-color: transparent; border-radius: var(--rounded-xl); border: none;">
        <div class="shadow-ambient" style="position: relative; width: 100%; padding-bottom: ${addImageAspectRatio}; background-color: var(--surface-container-low);">
          <img src="${addImageUrl}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--rounded-xl);" />
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 32px 12px 12px; background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.7)); display: flex; flex-direction: column; gap: 6px; z-index: 2;">
            ${link ? `<div class="font-body-md" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.9); font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size: 14px;">link</span>${link.replace(/^https?:\/\//, '')}</div>` : ''}
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
  availableTags.forEach(tag => {
    const isSelected = addTags.includes(tag);
    const el = document.createElement('div');
    el.className = 'font-label-sm';
    el.textContent = tag;
    el.style.backgroundColor = isSelected ? 'var(--tertiary)' : 'var(--surface-container)';
    el.style.color = isSelected ? 'var(--on-tertiary)' : 'var(--on-surface)';
    el.style.border = isSelected ? '1px solid var(--tertiary)' : '1px solid var(--tertiary-fixed-dim)';
    el.style.borderRadius = 'var(--rounded-full)';
    el.style.padding = '8px 16px';
    el.style.cursor = 'pointer';
    el.style.transition = 'all 0.2s';
    el.style.boxShadow = isSelected ? '0 10px 20px rgba(0,0,0,0.05)' : 'none';
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
      if (val && !availableTags.includes(val)) {
        availableTags.push(val);
        addTags.push(val);
      } else if (val && availableTags.includes(val) && !addTags.includes(val)) {
        addTags.push(val);
      }
      isAddingTag = false;
      renderTags();
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') saveTag();
      else if (e.key === 'Escape') {
        isAddingTag = false;
        renderTags();
      }
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
    btn.style.border = '1px dashed var(--outline-variant)';
    btn.style.color = 'var(--on-surface-variant)';
    btn.style.borderRadius = 'var(--rounded-full)';
    btn.style.padding = '8px 16px';
    btn.style.transition = 'all 0.2s';
    btn.style.cursor = 'pointer';
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">add</span> Add Tag`;
    btn.onmouseover = () => { btn.style.borderColor = 'var(--outline)'; btn.style.color = 'var(--on-surface)'; };
    btn.onmouseout = () => { btn.style.borderColor = 'var(--outline-variant)'; btn.style.color = 'var(--on-surface-variant)'; };
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

  let finalImageUrl = addImageUrl;

  // Upload image to Drive if one is pending
  if (pendingImageFile) {
    finalImageUrl = await uploadImageToDrive(pendingImageFile);
  }

  entries.unshift({
    id: Date.now().toString(),
    title: addText.value,
    url: addLink.value,
    image: finalImageUrl,
    aspectRatio: addImageAspectRatio,
    tags: [...addTags],
    type: addTags[0] || 'Note'
  });

  // Save to Drive
  await saveDataToDrive();

  // Reset form
  addText.value = '';
  addLink.value = '';
  addImage.value = '';
  addImageUrl = '';
  pendingImageFile = null;
  addTags = [];
  renderAddPreview();
  renderTags();

  // Go home
  window.location.hash = '#/';
  renderFeed();
});

// Initialize Add View
renderAddPreview();
renderTags();

// --- Bind Global Events ---
window.addEventListener('hashchange', handleRoute);
window.addEventListener('resize', () => {
  updateNavIndicator(window.location.hash.replace('#', '') || '/');
  setMasonrySpans();
});

btnDelete.addEventListener('click', async () => {
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Deleting from Drive...';
  authStatus.style.display = 'block';

  // 1. Physically delete images from Google Drive
  const entriesToDelete = entries.filter(e => selectedIds.includes(e.id));
  for (const item of entriesToDelete) {
    if (item.image) {
      const match = item.image.match(/id=([^&]+)/) || item.image.match(/drive_id:(.+)/);
      if (match) {
        const driveId = match[1];
        try {
          const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }
          });
          if (!delRes.ok) {
            console.error("Failed to delete image, status:", delRes.status);
          }
        } catch (e) {
          console.error("Error deleting image from Drive:", e);
        }
      }
    }
  }

  // 2. Remove from data array
  entries = entries.filter(e => !selectedIds.includes(e.id));
  selectedIds = [];

  // 3. Update the JSON file
  await saveDataToDrive();

  authOverlay.style.display = 'none';
  renderFeed();
  updateSelectionState();
});

btnCloseSelection.addEventListener('click', () => {
  selectedIds = [];
  updateSelectionState();
});

detailBackdrop.addEventListener('click', closeDetailSheet);
btnSheetClose.addEventListener('click', closeDetailSheet);

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('onespot_token');
  window.location.hash = '#/';
  window.location.reload();
});

// Init
handleRoute();
// renderFeed() is called automatically after Drive syncconst btnSheetClose = document.getElementById('btn-sheet-close');

// --- Google Drive Initialization ---
window.onload = function() {
  gapi.load('client', initializeGapiClient);
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: async (response) => {
      if (response.error !== undefined) {
        throw (response);
      }
      
      // Save token to prevent logout on refresh
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

async function initializeGapiClient() {
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
  tokenClient.requestAccessToken({prompt: 'consent'});
};

async function initializeDrive() {
  authStatus.style.display = 'block';
  authStatus.textContent = 'Syncing with Drive...';
  btnLogin.style.display = 'none';
  authOverlay.style.display = 'flex';
  
  try {
    // 1. Find or create OneSpot folder
    let q = "name='OneSpot' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    let res = await gapi.client.drive.files.list({q: q, spaces: 'drive'});
    if (res.result.files.length > 0) {
      folderId = res.result.files[0].id;
    } else {
      res = await gapi.client.drive.files.create({
        resource: { name: 'OneSpot', mimeType: 'application/vnd.google-apps.folder' },
        fields: 'id'
      });
      folderId = res.result.id;
    }

    // 2. Find or create data.json
    q = `name='data.json' and '${folderId}' in parents and trashed=false`;
    res = await gapi.client.drive.files.list({q: q, spaces: 'drive'});
    if (res.result.files.length > 0) {
      dataFileId = res.result.files[0].id;
      // Fetch content
      const fileRes = await gapi.client.drive.files.get({fileId: dataFileId, alt: 'media'});
      if (fileRes.body) {
        try { entries = JSON.parse(fileRes.body); } catch(e) { entries = []; }
      }
    } else {
      const file = new Blob(['[]'], {type: 'application/json'});
      const metadata = { name: 'data.json', parents: [folderId] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
      form.append('file', file);
      
      const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
        body: form
      });
      const data = await createRes.json();
      dataFileId = data.id;
    }
    // 3. Fetch User Profile
    const aboutRes = await gapi.client.drive.about.get({fields: 'user'});
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
      // Token expired or invalid
      localStorage.removeItem('onespot_token');
      authStatus.style.display = 'none';
      btnLogin.style.display = 'block';
      authOverlay.style.display = 'flex';
      return;
    } else {
      alert('Failed to connect to Drive. Check console.');
    }
  }
  
  authOverlay.style.display = 'none';
  renderFeed();
}

async function saveDataToDrive() {
  const file = new Blob([JSON.stringify(entries, null, 2)], {type: 'application/json'});
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
  form.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
  form.append('file', file);
  
  const createRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token },
    body: form
  });
  const data = await createRes.json();
  
  // Make the file publicly readable so the <img> tag can display it without headers
  await gapi.client.drive.permissions.create({
    fileId: data.id,
    resource: { type: 'anyone', role: 'reader' }
  });
  
  authOverlay.style.display = 'none';
  return `https://lh3.googleusercontent.com/d/${data.id}`;
}


// --- Routing ---
function handleRoute() {
  const hash = window.location.hash.replace('#', '') || '/';
  Object.values(views).forEach(v => v.style.display = 'none');
  if (views[hash]) views[hash].style.display = 'block';
  else views['/'].style.display = 'block';
  updateNavIndicator(hash);
}

function updateNavIndicator(hash) {
  let activeIndex = 0;
  if (hash.startsWith('/profile')) activeIndex = 1;
  if (hash.startsWith('/add')) activeIndex = 2;

  navLinks.forEach((link, idx) => {
    if (idx === activeIndex) {
      link.style.color = 'var(--on-primary)';
      link.style.transform = 'scale(1.1)';
    } else {
      link.style.color = 'var(--outline)';
      link.style.transform = 'scale(1)';
    }
  });

  const activeLink = navLinks[activeIndex];
  if (activeLink) {
    navIndicator.style.left = activeLink.offsetLeft + 'px';
    navIndicator.style.top = activeLink.offsetTop + 'px';
    navIndicator.style.width = activeLink.offsetWidth + 'px';
    navIndicator.style.height = activeLink.offsetHeight + 'px';
    navIndicator.style.opacity = '1';
    
    if (isInitialRender) {
      navIndicator.style.transition = 'none';
      setTimeout(() => {
        isInitialRender = false;
        navIndicator.style.transition = 'all 0.5s ease';
      }, 50);
    }
  }
}

// --- Rendering ---
function renderFeed() {
  feedGrid.innerHTML = '';
  entries.forEach(item => {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'masonry-item';

    // Resolve image source
    let driveId = null;
    let imgSource = item.image;
    if (item.image) {
      const ucMatch = item.image.match(/[?&]id=([^&]+)/);
      const lh3Match = item.image.match(/lh3\.googleusercontent\.com\/d\/([^/?]+)/);
      if (ucMatch) { driveId = ucMatch[1]; imgSource = `https://lh3.googleusercontent.com/d/${driveId}`; }
      else if (lh3Match) { driveId = lh3Match[1]; imgSource = item.image; }
    }

    // Build article — no selection state baked in, updated via applySelectionStyles()
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
      article.innerHTML = `
        <div class="shadow-ambient" style="position:relative;width:100%;padding-bottom:${item.aspectRatio};background-color:var(--surface-container-low);overflow:hidden;border-radius:var(--rounded-xl);transform:translateZ(0);-webkit-mask-image:-webkit-radial-gradient(white,black);">
          <img src="${imgSource}" data-drive-id="${driveId||''}" alt="" class="img-hover" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;"
            onerror="if(this.dataset.driveId&&!this.dataset.retried){this.dataset.retried='1';fetch('https://www.googleapis.com/drive/v3/files/'+this.dataset.driveId+'?alt=media',{headers:{'Authorization':'Bearer '+gapi.client.getToken().access_token}}).then(r=>r.blob()).then(b=>{this.src=URL.createObjectURL(b)}).catch(()=>{})}" />
          <div style="position:absolute;bottom:0;left:0;width:100%;padding:32px 12px 12px;background:linear-gradient(to bottom,transparent,rgba(0,0,0,0.7));display:flex;flex-direction:column;gap:6px;z-index:2;pointer-events:none;">
            ${item.url ? `<a href="https://${item.url.replace(/^https?:\/\//, '')}" target="_blank" style="display:flex;align-items:center;gap:4px;color:rgba(255,255,255,0.9);text-decoration:none;font-size:12px;"><span class="material-symbols-outlined" style="font-size:14px;">link</span>${item.url}</a>` : ''}
          </div>
        </div>
        <div style="padding:6px 8px 0;">
          <h2 class="font-headline-md" style="color:var(--on-background);display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.2;">${item.title}</h2>
        </div>`;
    }

    // Events
    let longPressTriggered = false;
    const cancelPress = () => clearTimeout(pressTimer);

    article.addEventListener('pointerdown', () => {
      if (selectedIds.length === 0) {
        longPressTriggered = false;
        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          selectedIds = [item.id];
          if (navigator.vibrate) navigator.vibrate(50);
          updateSelectionState();
        }, 500);
      }
    });
    article.addEventListener('pointerup', cancelPress);
    article.addEventListener('pointerleave', cancelPress);
    article.addEventListener('pointercancel', cancelPress);
    article.addEventListener('click', (e) => {
      cancelPress();
      if (longPressTriggered) { e.preventDefault(); return; }
      if (selectedIds.length > 0) {
        e.preventDefault();
        if (selectedIds.includes(item.id)) selectedIds = selectedIds.filter(id => id !== item.id);
        else selectedIds.push(item.id);
        updateSelectionState();
      } else {
        openDetailSheet(item);
      }
    });

    itemDiv.appendChild(article);
    feedGrid.appendChild(itemDiv);
  });

  applySelectionStyles();
}

// Updates card visuals in-place — no DOM rebuild, no glitch
function applySelectionStyles() {
  const inSelectionMode = selectedIds.length > 0;
  document.querySelectorAll('article[data-id]').forEach(article => {
    const id = article.dataset.id;
    const isSelected = selectedIds.includes(id);

    article.style.transform = isSelected ? 'scale(0.95)' : 'scale(1)';
    article.style.opacity = (inSelectionMode && !isSelected) ? '0.6' : '1';

    if (inSelectionMode) article.classList.remove('card-hover');
    else article.classList.add('card-hover');

    // Manage dark overlay for selected state
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

function updateSelectionState() {
  applySelectionStyles();
  if (selectedIds.length > 0) {
    bottomNav.style.display = 'none';
    selectionBar.style.display = 'flex';
    selectionCount.textContent = `${selectedIds.length} Selected`;
    document.getElementById('btn-edit').style.display = selectedIds.length === 1 ? 'block' : 'none';
  } else {
    bottomNav.style.display = 'flex';
    selectionBar.style.display = 'none';
  }
}

// --- Detail Sheet ---
function openDetailSheet(item) {
  let imgHtml = '';
  if (item.image) {
    let sheetImgSource = item.image;
    const ucMatch = item.image.match(/[?&]id=([^&]+)/);
    if (ucMatch) sheetImgSource = `https://lh3.googleusercontent.com/d/${ucMatch[1]}`;
    imgHtml = `
      <div style="margin-bottom: 20px; width: 100%; display: flex; justify-content: center;">
        <div style="border-radius: var(--rounded-xl); overflow: hidden; transform: translateZ(0); -webkit-mask-image: -webkit-radial-gradient(white, black); display: inline-block; background-color: var(--surface-container-low); max-width: 100%;">
          <img src="${sheetImgSource}" data-drive-id="${ucMatch ? ucMatch[1] : ''}" alt="" style="display: block; max-height: 40vh; max-width: 100%; width: auto; height: auto;" onerror="if(this.dataset.driveId && !this.dataset.retried){this.dataset.retried='1';fetch('https://www.googleapis.com/drive/v3/files/'+this.dataset.driveId+'?alt=media',{headers:{'Authorization':'Bearer '+gapi.client.getToken().access_token}}).then(r=>r.blob()).then(b=>{this.src=URL.createObjectURL(b)}).catch(()=>{})}" />
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

function closeDetailSheet() {
  detailBackdrop.style.opacity = '0';
  detailSheet.style.transform = 'translateY(100%)';
  detailBackdrop.style.pointerEvents = 'none';
  setTimeout(() => { document.body.style.overflow = ''; }, 300);
}


// --- Add Entry Logic ---
const availableTags = ['Design', 'Interior', 'Art', 'Tech', 'Cooking', 'Travel', 'Minimalism', 'Architecture', 'Photography'];
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
  const text = addText.value || 'Preview';
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
    html = `
      <article style="position: relative; background-color: transparent; border-radius: var(--rounded-xl); border: none;">
        <div class="shadow-ambient" style="position: relative; width: 100%; padding-bottom: ${addImageAspectRatio}; background-color: var(--surface-container-low);">
          <img src="${addImageUrl}" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover; border-radius: var(--rounded-xl);" />
          <div style="position: absolute; bottom: 0; left: 0; width: 100%; padding: 32px 12px 12px; background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.7)); display: flex; flex-direction: column; gap: 6px; z-index: 2;">
            ${link ? `<div class="font-body-md" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.9); font-size: 12px; text-shadow: 0 1px 2px rgba(0,0,0,0.5);"><span class="material-symbols-outlined" style="font-size: 14px;">link</span>${link.replace(/^https?:\/\//, '')}</div>` : ''}
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
  availableTags.forEach(tag => {
    const isSelected = addTags.includes(tag);
    const el = document.createElement('div');
    el.className = 'font-label-sm';
    el.textContent = tag;
    el.style.backgroundColor = isSelected ? 'var(--tertiary)' : 'var(--surface-container)';
    el.style.color = isSelected ? 'var(--on-tertiary)' : 'var(--on-surface)';
    el.style.border = isSelected ? '1px solid var(--tertiary)' : '1px solid var(--tertiary-fixed-dim)';
    el.style.borderRadius = 'var(--rounded-full)';
    el.style.padding = '8px 16px';
    el.style.cursor = 'pointer';
    el.style.transition = 'all 0.2s';
    el.style.boxShadow = isSelected ? '0 10px 20px rgba(0,0,0,0.05)' : 'none';
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
      if (val && !availableTags.includes(val)) {
        availableTags.push(val);
        addTags.push(val);
      } else if (val && availableTags.includes(val) && !addTags.includes(val)) {
        addTags.push(val);
      }
      isAddingTag = false;
      renderTags();
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') saveTag();
      else if (e.key === 'Escape') {
        isAddingTag = false;
        renderTags();
      }
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
    btn.style.border = '1px dashed var(--outline-variant)';
    btn.style.color = 'var(--on-surface-variant)';
    btn.style.borderRadius = 'var(--rounded-full)';
    btn.style.padding = '8px 16px';
    btn.style.transition = 'all 0.2s';
    btn.style.cursor = 'pointer';
    btn.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px;">add</span> Add Tag`;
    btn.onmouseover = () => { btn.style.borderColor = 'var(--outline)'; btn.style.color = 'var(--on-surface)'; };
    btn.onmouseout = () => { btn.style.borderColor = 'var(--outline-variant)'; btn.style.color = 'var(--on-surface-variant)'; };
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
  
  let finalImageUrl = addImageUrl;

  // Upload image to Drive if one is pending
  if (pendingImageFile) {
    finalImageUrl = await uploadImageToDrive(pendingImageFile);
  }

  entries.unshift({
    id: Date.now().toString(),
    title: addText.value,
    url: addLink.value,
    image: finalImageUrl,
    aspectRatio: addImageAspectRatio,
    tags: [...addTags],
    type: addTags[0] || 'Note'
  });
  
  // Save to Drive
  await saveDataToDrive();
  
  // Reset form
  addText.value = '';
  addLink.value = '';
  addImage.value = '';
  addImageUrl = '';
  pendingImageFile = null;
  addTags = [];
  renderAddPreview();
  renderTags();
  
  // Go home
  window.location.hash = '#/';
  renderFeed();
});

// Initialize Add View
renderAddPreview();
renderTags();

// --- Bind Global Events ---
window.addEventListener('hashchange', handleRoute);
window.addEventListener('resize', () => updateNavIndicator(window.location.hash.replace('#', '') || '/'));

btnDelete.addEventListener('click', async () => {
  authOverlay.style.display = 'flex';
  authStatus.textContent = 'Deleting from Drive...';
  authStatus.style.display = 'block';

  // 1. Physically delete images from Google Drive
  const entriesToDelete = entries.filter(e => selectedIds.includes(e.id));
  for (const item of entriesToDelete) {
    if (item.image) {
      const match = item.image.match(/id=([^&]+)/) || item.image.match(/drive_id:(.+)/);
      if (match) {
        const driveId = match[1];
        try {
          const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}`, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }
          });
          if (!delRes.ok) {
            console.error("Failed to delete image, status:", delRes.status);
          }
        } catch (e) {
          console.error("Error deleting image from Drive:", e);
        }
      }
    }
  }

  // 2. Remove from data array
  entries = entries.filter(e => !selectedIds.includes(e.id));
  selectedIds = [];

  // 3. Update the JSON file
  await saveDataToDrive();

  authOverlay.style.display = 'none';
  renderFeed();
  updateSelectionState();
});

btnCloseSelection.addEventListener('click', () => {
  selectedIds = [];
  updateSelectionState();
});

detailBackdrop.addEventListener('click', closeDetailSheet);
btnSheetClose.addEventListener('click', closeDetailSheet);

document.getElementById('btn-logout').addEventListener('click', () => {
  localStorage.removeItem('onespot_token');
  window.location.hash = '#/';
  window.location.reload();
});

// Init
handleRoute();
// renderFeed() is called automatically after Drive sync
