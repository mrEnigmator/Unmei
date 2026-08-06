/**
 * Świątynia Przeznaczenia — serwer pod Railway (czysty Node, zero zależności).
 *
 * Serwuje frontend (index.html, jinja-kanri.html) i API:
 *   POST /api/odpowiedz        — zapis zdarzenia ze strony zaproszenia
 *   POST /api/admin/login      — logowanie hasłem (env ADMIN_HASLO), token HMAC ważny 24 h
 *   GET  /api/admin/zdarzenia  — lista zdarzeń, wymaga tokenu w Authorization
 *
 * Zdarzenia trafiają do pliku NDJSON w katalogu DATA_DIR (domyślnie ./dane).
 * Na Railway podepnij wolumen i ustaw DATA_DIR na jego ścieżkę montowania,
 * inaczej dane znikną przy każdym redeployu.
 */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_HASLO = process.env.ADMIN_HASLO || "";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "dane");
const PLIK_ZDARZEN = path.join(DATA_DIR, "zdarzenia.ndjson");
const WAZNOSC_TOKENU_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- pomocnicze ---------- */

function json(res, obj, status = 200) {
  const cialo = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(cialo);
}

function wczytajCialo(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let rozmiar = 0;
    const kawalki = [];
    req.on("data", (k) => {
      rozmiar += k.length;
      if (rozmiar > limit) { reject(new Error("Za duże ciało żądania")); req.destroy(); return; }
      kawalki.push(k);
    });
    req.on("end", () => resolve(Buffer.concat(kawalki).toString("utf8")));
    req.on("error", reject);
  });
}

function hmac(wiadomosc, sekret) {
  return crypto.createHmac("sha256", sekret).update(wiadomosc).digest("hex");
}

function bezpiecznePorownanie(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function tokenWazny(token) {
  const [wygasaStr, podpis] = String(token).split(".");
  if (!wygasaStr || !podpis) return false;
  const wygasa = Number(wygasaStr);
  if (!Number.isFinite(wygasa) || Date.now() > wygasa) return false;
  return bezpiecznePorownanie(podpis, hmac(wygasaStr, ADMIN_HASLO));
}

/* ---------- API ---------- */

async function apiOdpowiedz(req, res) {
  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowy JSON" }, 400);
  }

  if (!dane || typeof dane.typ !== "string") {
    return json(res, { ok: false, blad: "Brak pola 'typ'" }, 400);
  }

  const zdarzenie = {
    id: `${Date.now()}:${crypto.randomUUID().slice(0, 8)}`,
    typ: dane.typ,
    etap: dane.etap ?? null,
    ema: dane.ema ?? null,
    data: dane.data ?? null,
    dataSlownie: dane.dataSlownie ?? null,
    pora: dane.pora ?? null,
    probyOdmowy: dane.probyOdmowy ?? null,
    czasGrySekundy: dane.czasGrySekundy ?? null,
    trafieniaWLampiony: dane.trafieniaWLampiony ?? null,
    pominieta: dane.pominieta ?? null,
    timestamp: dane.timestamp || new Date().toISOString(),
    userAgent: String(dane.userAgent || "").slice(0, 400),
    zapisano: new Date().toISOString(),
  };

  await fsp.appendFile(PLIK_ZDARZEN, JSON.stringify(zdarzenie) + "\n", "utf8");
  json(res, { ok: true });
}

async function apiLogin(req, res) {
  if (!ADMIN_HASLO) {
    return json(res, { ok: false, blad: "Brak skonfigurowanego sekretu ADMIN_HASLO" }, 500);
  }

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowy JSON" }, 400);
  }

  const haslo = typeof dane?.haslo === "string" ? dane.haslo : "";
  if (!bezpiecznePorownanie(haslo, ADMIN_HASLO)) {
    return json(res, { ok: false, blad: "Nieprawidłowe hasło" }, 401);
  }

  const wygasa = Date.now() + WAZNOSC_TOKENU_MS;
  json(res, { ok: true, token: `${wygasa}.${hmac(String(wygasa), ADMIN_HASLO)}` });
}

async function apiZdarzenia(req, res) {
  if (!ADMIN_HASLO) {
    return json(res, { ok: false, blad: "Brak skonfigurowanego sekretu ADMIN_HASLO" }, 500);
  }

  const naglowek = req.headers["authorization"] || "";
  const token = naglowek.replace(/^Bearer\s+/i, "");
  if (!tokenWazny(token)) {
    return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);
  }

  let tresc = "";
  try {
    tresc = await fsp.readFile(PLIK_ZDARZEN, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e; /* brak pliku = brak zdarzeń */
  }

  const zdarzenia = tresc
    .split("\n")
    .filter(Boolean)
    .map((linia) => { try { return JSON.parse(linia); } catch (e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.id < b.id ? 1 : -1)); /* od najnowszych */

  json(res, { ok: true, zdarzenia });
}

/* ---------- pliki statyczne ---------- */

const STATYCZNE = {
  "/": { plik: "index.html", typ: "text/html; charset=utf-8" },
  "/index.html": { plik: "index.html", typ: "text/html; charset=utf-8" },
  "/jinja-kanri": { plik: "jinja-kanri.html", typ: "text/html; charset=utf-8" },
  "/jinja-kanri.html": { plik: "jinja-kanri.html", typ: "text/html; charset=utf-8" },
};

async function serwujStatyczny(res, wpis) {
  const tresc = await fsp.readFile(path.join(__dirname, wpis.plik));
  res.writeHead(200, { "Content-Type": wpis.typ });
  res.end(tresc);
}

/* ---------- router ---------- */

const serwer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const sciezka = url.pathname;

  try {
    if (sciezka === "/api/odpowiedz" && req.method === "POST") return await apiOdpowiedz(req, res);
    if (sciezka === "/api/admin/login" && req.method === "POST") return await apiLogin(req, res);
    if (sciezka === "/api/admin/zdarzenia" && req.method === "GET") return await apiZdarzenia(req, res);

    const wpis = STATYCZNE[sciezka];
    if (wpis && (req.method === "GET" || req.method === "HEAD")) return await serwujStatyczny(res, wpis);

    json(res, { ok: false, blad: "Nie znaleziono" }, 404);
  } catch (e) {
    console.error(e);
    json(res, { ok: false, blad: "Błąd serwera" }, 500);
  }
});

serwer.listen(PORT, () => {
  console.log(`⛩️  Świątynia Przeznaczenia nasłuchuje na porcie ${PORT}`);
  console.log(`   zdarzenia: ${PLIK_ZDARZEN}`);
  if (!ADMIN_HASLO) console.warn("⚠️  ADMIN_HASLO nie jest ustawione — panel admina nie zadziała!");
});
