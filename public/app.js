/* =========================
   APP KEY
========================= */
const APP_KEY = "mi_clave_super_secreta_123";

/* =========================
   DOM ELEMENTS
========================= */
const categoryList = document.getElementById("categoryList");
const mobileCategories = document.getElementById("mobileCategories");
const channelGrid = document.getElementById("channelGrid");
const searchInput = document.getElementById("searchInput");
const categoryTitle = document.getElementById("categoryTitle");
const reloadBtn = document.getElementById("reloadBtn");

// Mobile Elements
const mobileSearchOverlay = document.getElementById("mobileSearchOverlay");
const mobileSearchInput = document.getElementById("mobileSearchInput");
const closeSearchBtn = document.getElementById("closeSearchBtn");
const mobileCastBtn = document.getElementById("mobileCastBtn");

// Video & Controls
const video = document.getElementById("video");
const videoContainer = document.getElementById("videoContainer");
const currentChannelName = document.getElementById("currentChannelName");
const currentProgram = document.getElementById("currentProgram");
const favToggle = document.getElementById("favToggle");
const pipBtn = document.getElementById("pipBtn");
const fullscreenBtn = document.getElementById("fullscreenBtn");

// State
let hls = null;
let allChannels = [];
let currentChannels = [];
const categoriesMap = {};
let currentStreamId = null;

const FAV_KEY = "iptv_favorites";
const RECENT_KEY = "iptv_recent"; // Optional: Recently watched

/* =========================
   FETCH HELPER
========================= */
function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "X-APP-KEY": APP_KEY }
  });
}

/* =========================
   CHROMECAST SETUP
========================= */
window['__onGCastApiAvailable'] = function (isAvailable) {
  if (isAvailable) {
    initializeCastApi();
  }
};

function initializeCastApi() {
  cast.framework.CastContext.getInstance().setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
  });

  const castBtn = document.getElementById("castBtn");
  if (castBtn) castBtn.hidden = false;
  if (mobileCastBtn) mobileCastBtn.hidden = false; // Show on mobile header too
}

/* =========================
   1. CATEGORIAS (Sidebar + Mobile Pills)
========================= */
function loadCategories() {
  apiFetch("/api/categories")
    .then(r => r.json())
    .then(categories => {
      // 1. Desktop Sidebar: Limpiar pero dejar "Todas"
      categoryList.innerHTML = `
        <li class="active" data-id="">
          <i class="fa-solid fa-layer-group"></i> Todas
        </li>
      `;

      // 2. Mobile Pills: Limpiar pero dejar "Todas"
      mobileCategories.innerHTML = `
        <div class="cat-pill active" data-id="">Todas</div>
      `;

      Object.keys(categoriesMap).forEach(k => delete categoriesMap[k]);

      categories.forEach(cat => {
        categoriesMap[cat.category_id] = cat.category_name;

        // Desktop Item
        const li = document.createElement("li");
        li.dataset.id = cat.category_id;
        li.textContent = cat.category_name;
        li.addEventListener("click", () => selectCategory(cat.category_id));
        categoryList.appendChild(li);

        // Mobile Pill
        const pill = document.createElement("div");
        pill.className = "cat-pill";
        pill.dataset.id = cat.category_id;
        pill.textContent = cat.category_name;
        pill.addEventListener("click", () => selectCategory(cat.category_id));
        mobileCategories.appendChild(pill);
      });
    })
    .catch(err => console.error("Error loading categories", err));
}

function selectCategory(catId) { // Removed 'liElement' param to genericize
  // UI Update (Desktop)
  document.querySelectorAll(".category-list li").forEach(el => {
    el.classList.toggle("active", el.dataset.id == (catId || ""));
  });

  // UI Update (Mobile Pills)
  document.querySelectorAll(".cat-pill").forEach(el => {
    el.classList.toggle("active", el.dataset.id == (catId || ""));
  });

  // Logic
  searchInput.value = "";
  mobileSearchInput.value = "";

  if (!catId) {
    categoryTitle.textContent = "Todos los canales";
    currentChannels = allChannels;
  } else {
    categoryTitle.textContent = categoriesMap[catId] || "Categoría";
    currentChannels = allChannels.filter(ch => ch.category_id == catId);
  }

  renderChannelGrid(currentChannels);
}

/* =========================
   2. CANALES (Grid + Performance)
========================= */
function loadChannels() {
  channelGrid.innerHTML = '<div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div>';

  apiFetch("/api/channels")
    .then(r => r.json())
    .then(channels => {
      allChannels = channels;
      currentChannels = channels;
      renderChannelGrid(channels);
    });
}

// Renderizar por chunks para no congelar la UI
function renderChannelGrid(channels) {
  channelGrid.innerHTML = "";

  if (channels.length === 0) {
    channelGrid.innerHTML = "<p style='padding:20px; color:#999'>No se encontraron canales.</p>";
    return;
  }

  const CHUNK_SIZE = 50;
  let index = 0;

  function renderChunk() {
    const chunk = channels.slice(index, index + CHUNK_SIZE);

    // Usar DocumentFragment para mejor performance
    const fragment = document.createDocumentFragment();

    chunk.forEach(ch => {
      const card = document.createElement("div");
      card.className = "channel-card";
      card.onclick = () => playStream(ch);

      // Logo handling
      let logoHtml;
      if (ch.stream_icon && ch.stream_icon.startsWith("http")) {
        logoHtml = `<img src="${ch.stream_icon}" class="channel-logo" loading="lazy" onerror="this.src='';this.className='channel-logo-placeholder fa-solid fa-tv'">`;
      } else {
        logoHtml = `<i class="channel-logo-placeholder fa-solid fa-tv"></i>`;
      }

      card.innerHTML = `
        ${logoHtml}
        <div class="channel-name">${ch.name}</div>
      `;
      fragment.appendChild(card);
    });

    channelGrid.appendChild(fragment);

    index += CHUNK_SIZE;
    if (index < channels.length) {
      if (index === CHUNK_SIZE && channels.length > 500) {
        // Si es una lista grande, damos un respiro mayor tras el primer chunk para que la UI pinte
        setTimeout(() => requestAnimationFrame(renderChunk), 50);
      } else {
        requestAnimationFrame(renderChunk);
      }
    }
  }

  renderChunk();
}

/* =========================
   3. PLAYER & EPG
========================= */
function playStream(channel) {
  currentStreamId = channel.stream_id;
  currentChannelName.textContent = channel.name;
  currentProgram.textContent = "Cargando EPG...";

  updateFavButtonState();

  // Highlight active UI
  document.querySelectorAll(".channel-card").forEach(c => c.style.border = "none");

  loadEpg(channel.stream_id);

  const streamURL = `/api/stream/${channel.stream_id}?key=${encodeURIComponent(APP_KEY)}`;

  if (Hls.isSupported()) {
    if (hls) hls.destroy();
    hls = new Hls();
    hls.loadSource(streamURL);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(e => console.log("User interaction needed", e));
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamURL;
    video.play();
  }

  // Mobile: Scroll to player
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Mobile Search: Close if open
  closeMobileSearch();
}

function loadEpg(streamId) {
  apiFetch(`/api/epg/${streamId}`)
    .then(r => r.json())
    .then(data => {
      if (data.epg_listings && data.epg_listings.length > 0) {
        const now = data.epg_listings[0];
        let title = now.title || now.name || "";
        try { title = atob(title); } catch { }
        currentProgram.textContent = title || "Programa actual desconocido";
      } else {
        currentProgram.textContent = "Sin información EPG";
      }
    })
    .catch(() => currentProgram.textContent = "EPG no disponible");
}

/* =========================
   4. FAVORITOS
========================= */
function getFavorites() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch { return []; }
}

function updateFavButtonState() {
  const favs = getFavorites();
  const isFav = favs.some(f => f.stream_id == currentStreamId);

  if (isFav) {
    favToggle.innerHTML = '<i class="fa-solid fa-star" style="color:gold"></i>';
  } else {
    favToggle.innerHTML = '<i class="fa-regular fa-star"></i>';
  }
}

favToggle.addEventListener("click", () => {
  if (!currentStreamId) return;

  let favs = getFavorites();
  const index = favs.findIndex(f => f.stream_id == currentStreamId);
  if (index >= 0) {
    favs.splice(index, 1);
  } else {
    const ch = allChannels.find(c => c.stream_id == currentStreamId);
    if (ch) favs.push({ stream_id: ch.stream_id, name: ch.name, stream_icon: ch.stream_icon });
  }
  saveFavorites(favs);
  updateFavButtonState();
});

function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

/* =========================
   5. SEARCH
========================= */
let searchTimer = null;

function performSearch(q) {
  if (!q) {
    if (currentChannels.length > 0) renderChannelGrid(currentChannels);
    return;
  }
  const hits = allChannels.filter(c => c.name.toLowerCase().includes(q));
  renderChannelGrid(hits);
}

searchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performSearch(e.target.value.toLowerCase()), 300);
});

mobileSearchInput.addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => performSearch(e.target.value.toLowerCase()), 300);
});


/* =========================
   6. MOBILE NAVIGATION
========================= */
const navItems = document.querySelectorAll(".nav-item");

navItems.forEach(item => {
  item.addEventListener("click", () => {
    // 1. Activate UI
    navItems.forEach(n => n.classList.remove("active"));
    item.classList.add("active");

    const tab = item.dataset.tab;

    if (tab === "home") {
      closeMobileSearch();
      selectCategory(""); // Show all or default
    } else if (tab === "search") {
      openMobileSearch();
    } else if (tab === "favs") {
      closeMobileSearch();
      // Show only favorites
      const favs = getFavorites();

      // Map favs back to real channel objects if possible to keep data consistent
      const detailedFavs = favs.map(f => {
        const found = allChannels.find(c => c.stream_id == f.stream_id);
        return found || f;
      });

      categoryTitle.textContent = "⭐ Favoritos";
      renderChannelGrid(detailedFavs);
    }
  });
});

function openMobileSearch() {
  document.body.classList.add("mobile-search-visible");
  mobileSearchInput.focus();
}

function closeMobileSearch() {
  document.body.classList.remove("mobile-search-visible");
  mobileSearchInput.value = "";
  // Reset active tab to home if we closed search?
  // Optional usability choice. keeping as is.
}

closeSearchBtn.addEventListener("click", () => {
  closeMobileSearch();
  // Go back to home tab visually
  navItems.forEach(n => n.classList.remove("active"));
  document.querySelector('.nav-item[data-tab="home"]').classList.add("active");
  selectCategory("");
});


/* =========================
   CONTROLES PLAYER
========================= */
fullscreenBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (document.webkitFullscreenElement) {
    document.webkitExitFullscreen();
  } else if (videoContainer.requestFullscreen) {
    videoContainer.requestFullscreen();
  } else if (video.webkitEnterFullscreen) {
    // iOS Safari Specific
    video.webkitEnterFullscreen();
  } else {
    // Fallback for older browsers
    if (videoContainer.webkitRequestFullscreen) {
      videoContainer.webkitRequestFullscreen();
    }
  }
});

pipBtn.addEventListener("click", async () => {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
  } else if (video.requestPictureInPicture) {
    await video.requestPictureInPicture();
  }
});

reloadBtn.addEventListener("click", () => {
  loadCategories();
  loadChannels();
});

/* =========================
   INIT
========================= */
loadCategories();
loadChannels();
