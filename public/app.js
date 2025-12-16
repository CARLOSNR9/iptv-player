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
   EVENTOS — CATEGORÍAS DINÁMICAS
========================= */

const EVENT_CATEGORY_KEYWORDS = [
  "EVENTOS",
  "PPV",
  "DISNEY",
  "UFC",
  "BOX",
  "WWE",
  "NAVIDAD"
];

function isEventCategory(name = "") {
  const n = name.toUpperCase();
  return EVENT_CATEGORY_KEYWORDS.some(k => n.includes(k));
}

const categoriesMap = {}; // category_id -> category_name

/* =========================
   DOM
========================= */

const categoryList = document.getElementById("categoryList");
const channelList = document.getElementById("channelList");
const reloadCategoriesBtn = document.getElementById("reloadCategoriesBtn");

const video = document.getElementById("video");
const searchInput = document.getElementById("searchInput");
const epgNowNext = document.getElementById("epgNowNext");

/* ⭐ Favoritos */
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
   CARGAR CATEGORÍAS (INICIAL)
========================= */

function loadCategories() {
  apiFetch("/api/categories")
    .then(r => r.json())
    .then(categories => {
      categoryList.innerHTML = '<option value="">Todas las categorías</option>';
      Object.keys(categoriesMap).forEach(k => delete categoriesMap[k]);

      categories.forEach(cat => {
        categoriesMap[cat.category_id] = cat.category_name;

        const option = document.createElement("option");
        option.value = cat.category_id;
        option.textContent = cat.category_name;
        categoryList.appendChild(option);
      });
    })
    .catch(err => console.error("Error cargando categorías", err));
}

loadCategories();

/* =========================
   🔄 RECARGAR SOLO CATEGORÍAS
========================= */

function reloadCategories() {
  const previousCategory = categoryList.value;

  categoryList.innerHTML =
    '<option value="">Recargando categorías...</option>';

  apiFetch(`/api/categories?refresh=${Date.now()}`)
    .then(res => res.json())
    .then(categories => {
      categoryList.innerHTML =
        '<option value="">Todas las categorías</option>';

      Object.keys(categoriesMap).forEach(k => delete categoriesMap[k]);

      categories.forEach(cat => {
        categoriesMap[cat.category_id] = cat.category_name;

        const option = document.createElement("option");
        option.value = cat.category_id;
        option.textContent = cat.category_name;
        categoryList.appendChild(option);
      });

      if (previousCategory && categoriesMap[previousCategory]) {
        categoryList.value = previousCategory;
      }
    })
    .catch(err => {
      console.error("Error recargando categorías", err);
      alert("No se pudieron recargar las categorías");
    });
}

reloadCategoriesBtn.addEventListener("click", reloadCategories);

/* =========================
   CARGAR TODOS LOS CANALES (CACHE GLOBAL)
========================= */

apiFetch("/api/channels")
  .then(r => r.json())
  .then(channels => {
    allChannels = channels;
    currentChannels = channels;
    renderChannels(channels);
  });

/* =========================
   CARGA POR CATEGORÍA (EVENTOS PRO)
========================= */

categoryList.addEventListener("change", () => {
  const categoryId = categoryList.value;
  const categoryName = categoriesMap[categoryId] || "";

  channelList.innerHTML = '<option value="">Selecciona un canal</option>';
  searchInput.value = "";
  video.pause();

  if (!categoryId) {
    currentChannels = allChannels;
    renderChannels(allChannels);
    return;
  }

  const isEvent = isEventCategory(categoryName);

  if (isEvent) {
    apiFetch(`/api/channels/${categoryId}?t=${Date.now()}`)
      .then(r => r.json())
      .then(channels => {
        currentChannels = channels;
        renderChannels(channels);
      });
  } else {
    const cached = allChannels.filter(
      ch => ch.category_id == categoryId
    );
    currentChannels = cached;
    renderChannels(cached);
  }
});

/* =========================
   RENDERIZAR CANALES
========================= */

function renderChannels(channels) {
  channelList.innerHTML = '<option value="">Selecciona un canal</option>';

  const MAX = 400;
  channels.slice(0, MAX).forEach(ch => {
    const option = document.createElement("option");
    option.value = ch.stream_id;
    option.textContent = ch.name;
    channelList.appendChild(option);
  });
}

/* =========================
   EPG — DECODER IPTV PRO
========================= */

function decodeEPG(text) {
  if (!text || typeof text !== "string") return "";

  let result = text.trim();

  try {
    const base64 = result.replace(/-/g, "+").replace(/_/g, "/");
    if (/^[A-Za-z0-9+/=]+$/.test(base64)) {
      const binary = atob(base64);
      result = decodeURIComponent(
        Array.prototype.map.call(binary, c =>
          "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2)
        ).join("")
      );
    }
  } catch {}

  return result.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}

function fmtTime(epoch) {
  if (!epoch) return "";
  const d = new Date(epoch * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function renderEpg(items) {
  if (!Array.isArray(items) || items.length === 0) {
    epgNowNext.textContent = "Este canal no tiene guía disponible (EPG).";
    return;
  }

  epgNowNext.innerHTML = items.slice(0, 5).map(it => {
    const title = decodeEPG(it.title || it.name || "");
    const start = fmtTime(it.start_timestamp);
    const end = fmtTime(it.stop_timestamp);

    return `
      <div class="epg-item">
        <div class="epg-title">${title}</div>
        <div class="epg-time">${start}${end ? " – " + end : ""}</div>
      </div>
    `;
  }).join("");
}

function loadEpgForStream(streamId) {
  epgNowNext.textContent = "Cargando guía (EPG)...";
  apiFetch(`/api/epg/${streamId}`)
    .then(r => r.json())
    .then(data => renderEpg(data.epg_listings || []))
    .catch(() => {
      epgNowNext.textContent = "No se pudo cargar la guía (EPG).";
    });
}

/* =========================
   🎬 REPRODUCCIÓN (HLS PROXY)
========================= */

function playStreamById(streamId) {
  if (!streamId) return;

  const isFav = getFavorites().some(f => f.stream_id == streamId);
  favToggle.textContent = isFav
    ? "⭐ Quitar de favoritos"
    : "⭐ Añadir a favoritos";

  loadEpgForStream(streamId);

  const streamURL =
    `/api/stream/${streamId}?key=${encodeURIComponent(APP_KEY)}`;

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
   BUSCADOR GLOBAL
========================= */

let searchTimer = null;

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = searchInput.value.toLowerCase();
    renderChannels(
      q
        ? allChannels.filter(c =>
            c.name.toLowerCase().includes(q)
          )
        : currentChannels
    );
  }, 150);
});

/* =========================
   EVENTOS UI
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
