/* =========================
   APP KEY (DEBE COINCIDIR CON RENDER)
========================= */

const APP_KEY = "mi_clave_super_secreta_123";

/* =========================
   FETCH SEGURO
========================= */

function apiFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      "X-APP-KEY": APP_KEY
    }
  });
}

/* =========================
   DOM
========================= */

const categoryList = document.getElementById("categoryList");
const channelList = document.getElementById("channelList");
const video = document.getElementById("video");
const searchInput = document.getElementById("searchInput");
const epgNowNext = document.getElementById("epgNowNext");

/* ⭐ Favoritos DOM */
const favToggle = document.getElementById("favToggle");
const favList = document.getElementById("favList");

let hls = null;

/* =========================
   CANALES EN MEMORIA
========================= */

let currentChannels = [];
let allChannels = [];

/* =========================
   FAVORITOS (localStorage)
========================= */

const FAV_KEY = "iptv_favorites";

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(favs) {
  localStorage.setItem(FAV_KEY, JSON.stringify(favs));
}

function renderFavorites() {
  const favs = getFavorites();
  favList.innerHTML = '<option value="">⭐ Favoritos</option>';

  favs.forEach(ch => {
    const option = document.createElement("option");
    option.value = ch.stream_id;
    option.textContent = ch.name;
    favList.appendChild(option);
  });
}

/* =========================
   CARGAR CATEGORÍAS
========================= */

apiFetch("/api/categories")
  .then(r => r.json())
  .then(categories => {
    categories.forEach(cat => {
      const option = document.createElement("option");
      option.value = cat.category_id;
      option.textContent = cat.category_name;
      categoryList.appendChild(option);
    });
  });

/* =========================
   CARGAR TODOS LOS CANALES
========================= */

apiFetch("/api/channels")
  .then(r => r.json())
  .then(channels => {
    allChannels = channels;
    currentChannels = channels;
    renderChannels(channels);
  });

/* =========================
   CARGAR CANALES POR CATEGORÍA
========================= */

categoryList.addEventListener("change", () => {
  const categoryId = categoryList.value;

  channelList.innerHTML = '<option value="">Selecciona un canal</option>';
  searchInput.value = "";
  video.pause();

  if (!categoryId) {
    currentChannels = allChannels;
    renderChannels(allChannels);
    return;
  }

  apiFetch(`/api/channels/${categoryId}`)
    .then(r => r.json())
    .then(channels => {
      currentChannels = channels;
      renderChannels(channels);
    });
});

/* =========================
   RENDERIZAR CANALES
========================= */

function renderChannels(channels) {
  channelList.innerHTML = '<option value="">Selecciona un canal</option>';

  const MAX = 400;
  const list = channels.slice(0, MAX);

  list.forEach(ch => {
    const option = document.createElement("option");
    option.value = ch.stream_id;
    option.textContent = ch.name;
    channelList.appendChild(option);
  });

  if (channels.length > MAX) {
    const option = document.createElement("option");
    option.disabled = true;
    option.textContent = `... escribe para filtrar (${channels.length - MAX} más)`;
    channelList.appendChild(option);
  }
}

/* =========================
   EPG
========================= */

function setEpgLoading() {
  epgNowNext.textContent = "Cargando guía (EPG)...";
}

function setEpgEmpty(msg = "Este canal no tiene guía disponible (EPG).") {
  epgNowNext.textContent = msg;
}

function renderEpg(items) {
  if (!Array.isArray(items) || items.length === 0) {
    setEpgEmpty();
    return;
  }

  epgNowNext.innerHTML = items.slice(0, 5).map(it => `
    <div class="epg-item">
      <div class="epg-title">${it.title || it.name || "Sin título"}</div>
      <div class="epg-time">${new Date(it.start_timestamp * 1000).toLocaleString()}</div>
    </div>
  `).join("");
}

function loadEpgForStream(streamId) {
  setEpgLoading();
  apiFetch(`/api/epg/${streamId}`)
    .then(r => r.json())
    .then(data => renderEpg(data.epg_listings || []))
    .catch(() => setEpgEmpty());
}

/* =========================
   🎬 REPRODUCCIÓN (HLS PROXY)
========================= */

function playStreamById(streamId) {
  if (!streamId) return;

  // Favoritos
  const isFav = getFavorites().some(f => f.stream_id == streamId);
  favToggle.textContent = isFav ? "⭐ Quitar de favoritos" : "⭐ Añadir a favoritos";

  loadEpgForStream(streamId);

  const streamURL = `/api/stream/${streamId}?key=${encodeURIComponent(APP_KEY)}`;

  if (Hls.isSupported()) {
    if (hls) hls.destroy();
    hls = new Hls();
    hls.loadSource(streamURL);
    hls.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamURL;
  }

  searchInput.blur();
  video.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================
   BUSCADOR
========================= */

let searchTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchInput.value.toLowerCase();
    renderChannels(
      q ? allChannels.filter(c => c.name.toLowerCase().includes(q)) : currentChannels
    );
  }, 150);
});

/* =========================
   EVENTOS
========================= */

channelList.addEventListener("change", () => {
  playStreamById(channelList.value);
});

favToggle.addEventListener("click", () => {
  const id = channelList.value;
  if (!id) return;

  let favs = getFavorites();
  const exists = favs.some(f => f.stream_id == id);

  if (exists) {
    favs = favs.filter(f => f.stream_id != id);
  } else {
    const ch = allChannels.find(c => c.stream_id == id);
    if (ch) favs.push({ stream_id: ch.stream_id, name: ch.name });
  }

  saveFavorites(favs);
  favList.value = "";
  renderFavorites();
});

favList.addEventListener("change", () => {
  playStreamById(favList.value);
});

/* =========================
   INIT
========================= */

renderFavorites();


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js")
      .then(() => console.log("✅ PWA lista"))
      .catch(err => console.error("❌ SW error", err));
  });
}
