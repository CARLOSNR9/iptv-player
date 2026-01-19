/* =========================
   APP KEY
========================= */
const APP_KEY = "mi_clave_super_secreta_123";

/* =========================
   DOM ELEMENTS
========================= */
const categoryList = document.getElementById("categoryList");
const channelGrid = document.getElementById("channelGrid");
const searchInput = document.getElementById("searchInput");
const categoryTitle = document.getElementById("categoryTitle");
const reloadBtn = document.getElementById("reloadBtn");

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
}

/* =========================
   1. CATEGORIAS (Sidebar)
========================= */
function loadCategories() {
  apiFetch("/api/categories")
    .then(r => r.json())
    .then(categories => {
      // Limpiar pero dejar "Todas"
      categoryList.innerHTML = `
        <li class="active" data-id="">
          <i class="fa-solid fa-layer-group"></i> Todas
        </li>
      `;

      Object.keys(categoriesMap).forEach(k => delete categoriesMap[k]);

      categories.forEach(cat => {
        categoriesMap[cat.category_id] = cat.category_name;

        const li = document.createElement("li");
        li.dataset.id = cat.category_id;
        li.textContent = cat.category_name; // Icono opcional segun nombre?

        li.addEventListener("click", () => selectCategory(li, cat.category_id));
        categoryList.appendChild(li);
      });
    })
    .catch(err => console.error("Error loading categories", err));
}

function selectCategory(liElement, catId) {
  // UI Update
  document.querySelectorAll(".category-list li").forEach(el => el.classList.remove("active"));
  liElement.classList.add("active");

  // Logic
  searchInput.value = "";

  if (!catId) {
    categoryTitle.textContent = "Todos los canales";
    currentChannels = allChannels;
  } else {
    categoryTitle.textContent = categoriesMap[catId] || "Categoría";
    // Filtrar de la lista global (si ya la tenemos) o pedir a API si es evento
    // Por simplicidad, usamos la lista global cargada
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

// Renderizar por chunks para no congelar la UI con 5000 elementos
function renderChannelGrid(channels) {
  channelGrid.innerHTML = "";

  if (channels.length === 0) {
    channelGrid.innerHTML = "<p style='padding:20px'>No se encontraron canales.</p>";
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
      // Programar siguiente chunk
      requestAnimationFrame(renderChunk);
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

  // Favoritos UI Check
  updateFavButtonState();

  // Highlight active card
  document.querySelectorAll(".channel-card").forEach(c => c.style.border = "none");

  // Load EPG
  loadEpg(channel.stream_id);

  // Play Video
  const streamURL = `/api/stream/${channel.stream_id}?key=${encodeURIComponent(APP_KEY)}`;

  if (Hls.isSupported()) {
    if (hls) hls.destroy();
    hls = new Hls();
    hls.loadSource(streamURL);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      video.play().catch(e => console.log("User interaction needed for audio", e));
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamURL;
    video.play();
  }

  // Scroll to top mobile
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadEpg(streamId) {
  apiFetch(`/api/epg/${streamId}`)
    .then(r => r.json())
    .then(data => {
      if (data.epg_listings && data.epg_listings.length > 0) {
        const now = data.epg_listings[0];
        // Decode title
        let title = now.title || now.name || "";
        try { title = atob(title); } catch { } // Simple try decode if base64

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
    // Buscar info del canal actual
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
   5. CONTROLES PLAYER (PiP, Fullscreen)
========================= */
fullscreenBtn.addEventListener("click", () => {
  if (!document.fullscreenElement) {
    videoContainer.requestFullscreen().catch(err => console.log(err));
  } else {
    document.exitFullscreen();
  }
});

pipBtn.addEventListener("click", async () => {
  if (document.pictureInPictureElement) {
    await document.exitPictureInPicture();
  } else if (video.requestPictureInPicture) {
    await video.requestPictureInPicture();
  }
});

/* =========================
   SEARCH
========================= */
let searchTimer = null;
searchInput.addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();

  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    if (!q) {
      renderChannelGrid(currentChannels);
      return;
    }

    // Buscar en TODOS los canales, no solo la categoría actual
    const hits = allChannels.filter(c => c.name.toLowerCase().includes(q));
    renderChannelGrid(hits);
  }, 300);
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
