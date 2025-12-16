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

let currentChannels = []; // por categoría
let allChannels = [];     // GLOBAL

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

fetch("/api/categories")
  .then(res => res.json())
  .then(categories => {
    categories.forEach(cat => {
      const option = document.createElement("option");
      option.value = cat.category_id;
      option.textContent = cat.category_name;
      categoryList.appendChild(option);
    });
  })
  .catch(err => console.error("Error cargando categorías", err));

/* =========================
   CARGAR TODOS LOS CANALES
========================= */

fetch("/api/channels")
  .then(res => res.json())
  .then(channels => {
    allChannels = channels;
    currentChannels = channels;
    renderChannels(channels);
  })
  .catch(err => console.error("Error cargando canales globales", err));

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

  fetch(`/api/channels/${categoryId}`)
    .then(res => res.json())
    .then(channels => {
      currentChannels = channels;
      renderChannels(channels);
    })
    .catch(err => console.error("Error cargando canales", err));
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
   EPG (GUÍA)
========================= */

function setEpgLoading() {
  if (epgNowNext) epgNowNext.textContent = "Cargando guía (EPG)...";
}

function setEpgEmpty(msg = "Este canal no tiene guía disponible (EPG).") {
  if (epgNowNext) epgNowNext.textContent = msg;
}

function maybeDecodeBase64(text) {
  if (!text || typeof text !== "string") return "";
  try {
    if (/^[A-Za-z0-9+/=]+$/.test(text) && text.length % 4 === 0) {
      return decodeURIComponent(escape(atob(text)));
    }
  } catch (_) {}
  return text;
}

function fmtTime(epochSeconds) {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * 1000);
  return d.toLocaleString();
}

function renderEpg(items) {
  if (!Array.isArray(items) || items.length === 0) {
    setEpgEmpty();
    return;
  }

  epgNowNext.innerHTML = items.slice(0, 5).map(it => {
    const title = maybeDecodeBase64(it.title || it.name || "");
    const desc  = maybeDecodeBase64(it.description || "");
    const start = fmtTime(it.start_timestamp || it.start || it.start_time);
    const end   = fmtTime(it.stop_timestamp || it.end || it.end_time);

    return `
      <div class="epg-item">
        <div class="epg-title">${title || "Sin título"}</div>
        <div class="epg-time">${start}${end ? " — " + end : ""}</div>
        ${desc ? `<div class="epg-desc">${desc}</div>` : ""}
      </div>
    `;
  }).join("");
}

function loadEpgForStream(streamId) {
  setEpgLoading();

  fetch(`/api/epg/${streamId}`)
    .then(r => r.json())
    .then(data => {
      const items =
        data?.epg_listings ||
        data?.epg_list ||
        data?.listings ||
        (Array.isArray(data) ? data : []);
      renderEpg(items);
    })
    .catch(err => {
      console.error("Error cargando EPG:", err);
      setEpgEmpty("No se pudo cargar la guía (EPG).");
    });
}

/* =========================
   FUNCIÓN CENTRAL DE REPRODUCCIÓN ⭐
========================= */

function playStreamById(streamId) {
  if (!streamId) return;

  // Favoritos
  const favs = getFavorites();
  const isFav = favs.some(f => f.stream_id == streamId);
  favToggle.textContent = isFav ? "⭐ Quitar de favoritos" : "⭐ Añadir a favoritos";

  // EPG
  loadEpgForStream(streamId);

  // Stream
  const streamURL = `/api/stream/${streamId}`;

  if (Hls.isSupported()) {
    if (hls) hls.destroy();
    hls = new Hls();
    hls.loadSource(streamURL);
    hls.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = streamURL;
  }

  // UX móvil
  searchInput.blur();
  video.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* =========================
   BUSCADOR GLOBAL
========================= */

let searchTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
      renderChannels(currentChannels);
      return;
    }

    const filtered = allChannels.filter(ch =>
      (ch.name || "").toLowerCase().includes(query)
    );

    renderChannels(filtered);
  }, 150);
});

/* =========================
   EVENTOS SIMPLIFICADOS
========================= */

channelList.addEventListener("change", () => {
  playStreamById(channelList.value);
});

favToggle.addEventListener("click", () => {
  const streamId = channelList.value;
  if (!streamId) return;

  const channel =
    allChannels.find(ch => ch.stream_id == streamId) ||
    currentChannels.find(ch => ch.stream_id == streamId);

  if (!channel) return;

  let favs = getFavorites();
  const exists = favs.some(f => f.stream_id == streamId);

  if (exists) {
    favs = favs.filter(f => f.stream_id != streamId);
    favToggle.textContent = "⭐ Añadir a favoritos";

    // limpiar selección si coincide
    if (favList.value == streamId) {
      favList.value = "";
    }
  } else {
    favs.push({ stream_id: channel.stream_id, name: channel.name });
    favToggle.textContent = "⭐ Quitar de favoritos";
  }

  saveFavorites(favs);

  // 🔥 CLAVE: resetear select antes de render
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
