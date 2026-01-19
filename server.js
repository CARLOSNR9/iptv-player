import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const IPTV_SERVER = process.env.IPTV_SERVER;
const IPTV_USER = process.env.IPTV_USER;
const IPTV_PASS = process.env.IPTV_PASS;

// 🔐 Llave de protección
const APP_KEY = process.env.APP_KEY || "";

/* =========================
   CORS + MIDDLEWARE
========================= */

app.use(cors({
  origin: true,
  credentials: false,
  allowedHeaders: ["Content-Type", "X-APP-KEY"],
}));

app.use(express.json());
app.use(express.static("public"));

/* =========================
   PROTECCIÓN /api/*
   - Header: X-APP-KEY
   - Query: ?key= (HLS)
========================= */

app.use("/api", (req, res, next) => {
  if (!APP_KEY) {
    return res.status(500).json({
      error: "APP_KEY no configurada en el servidor"
    });
  }

  // Permitir llamadas internas (navegación directa / assets)
  const origin = req.get("origin");
  if (!origin) return next();

  const key =
    req.header("X-APP-KEY") ||
    req.query.key;

  if (key !== APP_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

/* =========================
   HELPERS
========================= */

function iptvURL(params) {
  const q = new URLSearchParams({
    username: IPTV_USER,
    password: IPTV_PASS,
    ...params
  });
  return `${IPTV_SERVER}/player_api.php?${q.toString()}`;
}

/* =========================
   CACHE SIMPLE (In-Memory)
   Evita baneos y acelera la carga.
   Duración: 5 minutos.
========================= */

const CACHE_DURATION = 5 * 60 * 1000;
const cache = {};

async function getCachedData(key, fetcher) {
  const now = Date.now();
  if (cache[key] && (now - cache[key].timestamp < CACHE_DURATION)) {
    console.log(`⚡ Serving from cache: ${key}`);
    return cache[key].data;
  }

  console.log(`🌐 Fetching fresh data: ${key}`);
  const data = await fetcher();
  
  if (data) {
    cache[key] = {
      timestamp: now,
      data: data
    };
  }
  
  return data;
}

/* =========================
   API IPTV (JSON)
========================= */

// Categorías
app.get("/api/categories", async (req, res) => {
  try {
    // Si el cliente pide forzar recarga (?refresh=...) ignoramos caché
    const forceRefresh = req.query.refresh;
    const key = "categories";

    if (forceRefresh) delete cache[key];

    const data = await getCachedData(key, async () => {
      const r = await fetch(iptvURL({ action: "get_live_categories" }));
      return await r.json();
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cargando categorías" });
  }
});

// Canales (global)
app.get("/api/channels", async (req, res) => {
  try {
    const data = await getCachedData("all_channels", async () => {
      const r = await fetch(iptvURL({ action: "get_live_streams" }));
      return await r.json();
    });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cargando canales" });
  }
});

// Canales por categoría
app.get("/api/channels/:categoryId", async (req, res) => {
  try {
    const catId = req.params.categoryId;
    const key = `channels_${catId}`;

    const data = await getCachedData(key, async () => {
      const r = await fetch(
        iptvURL({
          action: "get_live_streams",
          category_id: catId
        })
      );
      return await r.json();
    });

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error cargando canales por categoría" });
  }
});

/* =========================================================
   ✅ EPG — FIX UTF-8 DEFINITIVO
========================================================= */

app.get("/api/epg/:streamId", async (req, res) => {
  try {
    // EPG suele cambiar rápido, caché corta de 1 min o sin caché
    const streamId = req.params.streamId;
    const key = `epg_${streamId}`;

    // Usamos una caché más corta (1 minuto) para la guía
    if (cache[key] && (Date.now() - cache[key].timestamp < 60 * 1000)) {
       return res.json(cache[key].data);
    }

    const r = await fetch(
      iptvURL({
        action: "get_short_epg",
        stream_id: streamId,
        limit: 10
      }),
      {
        headers: {
          "Accept": "application/json; charset=utf-8"
        }
      }
    );

    // 🔥 FORZAR UTF-8 REAL
    const buffer = await r.arrayBuffer();
    const text = new TextDecoder("utf-8").decode(buffer);
    const json = JSON.parse(text);

    // Guardar en caché
    cache[key] = { timestamp: Date.now(), data: json };

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json(json);

  } catch (e) {
    console.error("EPG error:", e);
    res.status(500).json({ error: "Error cargando EPG" });
  }
});

/* =========================================================
   🔥 HLS PROXY REAL (PLAYLIST + SEGMENTOS)
========================================================= */

/* ---------- A) Playlist m3u8 con rewrite ---------- */
app.get("/api/stream/:streamId", async (req, res) => {
  try {
    const streamId = req.params.streamId;

    const upstreamUrl =
      `${IPTV_SERVER}/live/${IPTV_USER}/${IPTV_PASS}/${streamId}.m3u8`;

    const r = await fetch(upstreamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error("Upstream m3u8 failed:", r.status, txt.slice(0, 200));
      return res.status(502).send("Upstream m3u8 failed");
    }

    const m3u8 = await r.text();
    const base = new URL(upstreamUrl);

    const rewritten = m3u8
      .split("\n")
      .map(line => {
        const l = line.trim();
        if (!l || l.startsWith("#")) return line;

        const abs = new URL(l, base).toString();

        return `/api/hls?u=${encodeURIComponent(abs)}&key=${encodeURIComponent(APP_KEY)}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.setHeader("Cache-Control", "no-store");
    res.send(rewritten);

  } catch (err) {
    console.error("Error proxy playlist:", err);
    res.status(500).send("Error proxy playlist");
  }
});

/* ---------- B) Proxy genérico para segmentos / keys ---------- */
app.get("/api/hls", async (req, res) => {
  try {
    const u = req.query.u;
    if (!u) return res.status(400).send("Missing u");

    const r = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*"
      }
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error("Upstream segment failed:", r.status, txt.slice(0, 200));
      return res.status(502).send("Upstream segment failed");
    }

    const ct = r.headers.get("content-type");
    if (ct) res.setHeader("Content-Type", ct);

    res.setHeader("Cache-Control", "no-store");
    r.body.pipe(res);

  } catch (err) {
    console.error("Error proxy segment:", err);
    res.status(500).send("Error proxy segment");
  }
});

/* =========================
   START
========================= */

app.listen(PORT, () => {
  console.log(`✅ Backend IPTV activo en http://localhost:${PORT}`);
});
