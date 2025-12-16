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

// ✅ Llave simple para proteger /api
const APP_KEY = process.env.APP_KEY || "";

// CORS (incluye header personalizado)
app.use(cors({
  origin: true,
  credentials: false,
  allowedHeaders: ["Content-Type", "X-APP-KEY"],
}));

app.use(express.json());
app.use(express.static("public"));

/* =========================
   MIDDLEWARE: PROTEGER /api/*
   - Acepta header: X-APP-KEY
   - o query: ?key= (para HLS.js)
========================= */

app.use("/api", (req, res, next) => {
  // Si no hay APP_KEY configurada → bloquear
  if (!APP_KEY) {
    return res.status(500).json({
      error: "APP_KEY no configurada en el servidor"
    });
  }

  // 🔓 Permitir llamadas internas (frontend servido por Express)
  const origin = req.get("origin");
  if (!origin) {
    return next();
  }

  const keyFromHeader = req.header("X-APP-KEY");
  const keyFromQuery = req.query.key; // para HLS
  const key = keyFromHeader || keyFromQuery;

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
   API ROUTES
========================= */

// Categorías
app.get("/api/categories", async (req, res) => {
  try {
    const r = await fetch(iptvURL({ action: "get_live_categories" }));
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: "Error cargando categorías" });
  }
});

// Canales (global)
app.get("/api/channels", async (req, res) => {
  try {
    const r = await fetch(iptvURL({ action: "get_live_streams" }));
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: "Error cargando canales" });
  }
});

// Canales por categoría
app.get("/api/channels/:categoryId", async (req, res) => {
  try {
    const r = await fetch(
      iptvURL({
        action: "get_live_streams",
        category_id: req.params.categoryId
      })
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: "Error cargando canales por categoría" });
  }
});

// EPG
app.get("/api/epg/:streamId", async (req, res) => {
  try {
    const r = await fetch(
      iptvURL({
        action: "get_short_epg",
        stream_id: req.params.streamId,
        limit: 10
      })
    );
    res.json(await r.json());
  } catch (e) {
    res.status(500).json({ error: "Error cargando EPG" });
  }
});

// Stream proxy (redirect)
app.get("/api/stream/:streamId", (req, res) => {
  const streamURL = `${IPTV_SERVER}/live/${IPTV_USER}/${IPTV_PASS}/${req.params.streamId}.m3u8`;
  res.redirect(streamURL);
});

app.listen(PORT, () => {
  console.log(`✅ Backend IPTV activo en http://localhost:${PORT}`);
});
