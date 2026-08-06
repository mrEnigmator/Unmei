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
const PLIK_GOSCI = path.join(DATA_DIR, "goscie.json");
const WAZNOSC_TOKENU_MS = 24 * 60 * 60 * 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ---------- pomocnicze ---------- */

/* dla HTML bez X-Frame DENY nie ma potrzeby robić wyjątku — strona nie ma być osadzana */
const NAGLOWKI_BEZPIECZENSTWA_HTML = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

const NAGLOWKI_BEZPIECZENSTWA = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(res, obj, status = 200) {
  const cialo = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...NAGLOWKI_BEZPIECZENSTWA,
  });
  res.end(cialo);
}

/* ---------- limit prób (anty-brute-force) ----------
   Na IP: max 10 nieudanych prób hasła w oknie 15 minut,
   po przekroczeniu — blokada do końca okna. */

const OKNO_LIMITU_MS = 15 * 60 * 1000;
const MAX_PROB = 10;
const licznikProb = new Map(); /* ip -> { liczba, resetO } */

function ipKlienta(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.socket.remoteAddress || "?";
}

function zablokowany(req) {
  const wpis = licznikProb.get(ipKlienta(req));
  if (!wpis) return false;
  if (Date.now() > wpis.resetO) { licznikProb.delete(ipKlienta(req)); return false; }
  return wpis.liczba >= MAX_PROB;
}

function zanotujNieudanaProbe(req) {
  const ip = ipKlienta(req);
  const teraz = Date.now();
  const wpis = licznikProb.get(ip);
  if (!wpis || teraz > wpis.resetO) {
    licznikProb.set(ip, { liczba: 1, resetO: teraz + OKNO_LIMITU_MS });
  } else {
    wpis.liczba++;
  }
  /* sprzątanie starych wpisów przy okazji */
  if (licznikProb.size > 5000) {
    for (const [k, w] of licznikProb) if (teraz > w.resetO) licznikProb.delete(k);
  }
}

function zaDuzoProb(res) {
  json(res, { ok: false, blad: "Za dużo prób — spróbuj za kwadrans" }, 429);
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
    gosc: dane.gosc ?? null,
    goscId: dane.goscId ?? null,
    pole: dane.pole ?? null,
    wartosc: dane.wartosc ?? null,
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
  if (zablokowany(req)) return zaDuzoProb(res);

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowy JSON" }, 400);
  }

  const haslo = typeof dane?.haslo === "string" ? dane.haslo : "";
  if (!bezpiecznePorownanie(haslo, ADMIN_HASLO)) {
    zanotujNieudanaProbe(req);
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

/* ---------- goście: profile z hasłem-kluczem i awatarem ---------- */

function zautoryzowany(req) {
  const naglowek = req.headers["authorization"] || "";
  const token = naglowek.replace(/^Bearer\s+/i, "");
  return ADMIN_HASLO && tokenWazny(token);
}

async function wczytajGosci() {
  try {
    return JSON.parse(await fsp.readFile(PLIK_GOSCI, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return [];
  }
}

async function zapiszGosci(goscie) {
  await fsp.writeFile(PLIK_GOSCI, JSON.stringify(goscie), "utf8");
}

/* --- publiczne: brama --- */

async function apiBramaStatus(url, res) {
  const goscie = await wczytajGosci();
  const id = url.searchParams.get("gosc");
  json(res, {
    ok: true,
    wymagane: goscie.length > 0,
    /* pozwala frontendowi sprawdzić, czy zapamiętany w sesji gość nadal istnieje */
    goscWazny: id ? goscie.some(g => g.id === id) : null
  });
}

async function apiBramaOtworz(req, res) {
  if (zablokowany(req)) return zaDuzoProb(res);
  const goscie = await wczytajGosci();
  if (goscie.length === 0) return json(res, { ok: true, gosc: null }); /* brama wyłączona */

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowe dane" }, 400);
  }

  const haslo = String(dane?.haslo || "").trim().toLowerCase();
  for (const g of goscie) {
    if (bezpiecznePorownanie(haslo, String(g.haslo).trim().toLowerCase())) {
      return json(res, { ok: true, gosc: { id: g.id, imie: g.imie, jezyk: g.jezyk || "pl" } });
    }
  }
  zanotujNieudanaProbe(req);
  json(res, { ok: false, blad: "Duchy nie znają tego słowa" }, 401);
}

/* --- publiczne: awatar gościa do gry --- */

async function apiAwatarPubliczny(url, res) {
  const id = url.searchParams.get("gosc") || "";
  const goscie = await wczytajGosci();
  const gosc = goscie.find(g => g.id === id);
  if (!gosc || !gosc.awatar) return json(res, { ok: false, blad: "Brak awatara" }, 404);

  const bajty = Buffer.from(gosc.awatar.b64, "base64");
  res.writeHead(200, { "Content-Type": gosc.awatar.mime, "Cache-Control": "no-cache", "Content-Length": bajty.length });
  res.end(bajty);
}

/* --- admin: zarządzanie gośćmi --- */

async function apiGoscieLista(req, res) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);
  const goscie = await wczytajGosci();
  json(res, {
    ok: true,
    goscie: goscie.map(g => ({ id: g.id, imie: g.imie, haslo: g.haslo, jezyk: g.jezyk || "pl", maAwatar: !!g.awatar, utworzono: g.utworzono }))
  });
}

async function apiGoscDodaj(req, res) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowe dane" }, 400);
  }

  const imie = String(dane?.imie || "").trim().slice(0, 40);
  const haslo = String(dane?.haslo || "").trim().slice(0, 60);
  if (!imie || !haslo) return json(res, { ok: false, blad: "Podaj imię i słowo-klucz" }, 400);

  const goscie = await wczytajGosci();
  if (goscie.some(g => String(g.haslo).trim().toLowerCase() === haslo.toLowerCase())) {
    return json(res, { ok: false, blad: "To słowo-klucz jest już zajęte" }, 400);
  }

  const jezyk = dane.jezyk === "en" ? "en" : "pl";
  const gosc = { id: crypto.randomUUID().slice(0, 8), imie, haslo, jezyk, awatar: null, utworzono: new Date().toISOString() };
  goscie.push(gosc);
  await zapiszGosci(goscie);
  json(res, { ok: true, gosc: { id: gosc.id, imie: gosc.imie } });
}

async function apiGoscUsun(req, res, url) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);
  const id = url.searchParams.get("id") || "";
  const goscie = await wczytajGosci();
  const po = goscie.filter(g => g.id !== id);
  if (po.length === goscie.length) return json(res, { ok: false, blad: "Nie ma takiego gościa" }, 404);
  await zapiszGosci(po);
  json(res, { ok: true });
}

async function apiGoscJezyk(req, res, url) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowe dane" }, 400);
  }

  const id = url.searchParams.get("id") || "";
  const goscie = await wczytajGosci();
  const gosc = goscie.find(g => g.id === id);
  if (!gosc) return json(res, { ok: false, blad: "Nie ma takiego gościa" }, 404);

  gosc.jezyk = dane.jezyk === "en" ? "en" : "pl";
  await zapiszGosci(goscie);
  json(res, { ok: true, jezyk: gosc.jezyk });
}

async function apiAwatarZapisz(req, res, url) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req, 800 * 1024));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowe dane" }, 400);
  }

  const dopasowanie = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dane?.dataUrl || "");
  if (!dopasowanie) return json(res, { ok: false, blad: "Oczekiwano obrazka PNG/JPEG/WebP" }, 400);
  if (dopasowanie[2].length > 700 * 1024) return json(res, { ok: false, blad: "Obrazek za duży" }, 400);

  const id = url.searchParams.get("gosc") || "";
  const goscie = await wczytajGosci();
  const gosc = goscie.find(g => g.id === id);
  if (!gosc) return json(res, { ok: false, blad: "Nie ma takiego gościa" }, 404);

  gosc.awatar = { mime: "image/" + dopasowanie[1], b64: dopasowanie[2] };
  await zapiszGosci(goscie);
  json(res, { ok: true });
}

async function apiAwatarUsun(req, res, url) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);
  const id = url.searchParams.get("gosc") || "";
  const goscie = await wczytajGosci();
  const gosc = goscie.find(g => g.id === id);
  if (!gosc) return json(res, { ok: false, blad: "Nie ma takiego gościa" }, 404);
  gosc.awatar = null;
  await zapiszGosci(goscie);
  json(res, { ok: true });
}

/* --- admin: czyszczenie danych gościa (wymaga PONOWNEGO podania hasła admina) --- */

async function apiWyczyscDaneGoscia(req, res, url) {
  if (!zautoryzowany(req)) return json(res, { ok: false, blad: "Brak autoryzacji" }, 401);

  let dane;
  try {
    dane = JSON.parse(await wczytajCialo(req));
  } catch (e) {
    return json(res, { ok: false, blad: "Nieprawidłowe dane" }, 400);
  }

  /* dodatkowe potwierdzenie: hasło administratora wpisane jeszcze raz */
  const haslo = typeof dane?.haslo === "string" ? dane.haslo : "";
  if (zablokowany(req)) return zaDuzoProb(res);
  if (!(await bezpiecznePorownanie(haslo, ADMIN_HASLO))) {
    zanotujNieudanaProbe(req);
    return json(res, { ok: false, blad: "Nieprawidłowe hasło administratora" }, 401);
  }

  const id = url.searchParams.get("gosc") || "";
  if (!id) return json(res, { ok: false, blad: "Brak identyfikatora gościa" }, 400);

  /* "__anonim" = zdarzenia bez przypisanego profilu (stare testy sprzed włączenia bramy) */
  const czyscAnonimowe = id === "__anonim";

  const goscie = await wczytajGosci();
  const gosc = goscie.find(g => g.id === id);
  const imie = gosc ? gosc.imie : null;

  let tresc = "";
  try {
    tresc = await fsp.readFile(PLIK_ZDARZEN, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }

  const linie = tresc.split("\n").filter(Boolean);
  const zostaja = [];
  let usuniete = 0;
  for (const linia of linie) {
    try {
      const z = JSON.parse(linia);
      const pasuje = czyscAnonimowe
        ? (!z.goscId && !z.gosc)
        : (z.goscId === id || (imie && z.gosc === imie));
      if (pasuje) { usuniete++; continue; }
      zostaja.push(linia);
    } catch (e) {
      zostaja.push(linia); /* uszkodzonych wpisów nie ruszamy */
    }
  }

  await fsp.writeFile(PLIK_ZDARZEN, zostaja.length ? zostaja.join("\n") + "\n" : "", "utf8");
  json(res, { ok: true, usuniete });
}

/* ---------- pliki statyczne ---------- */

const STATYCZNE = {
  "/": { plik: "index.html", typ: "text/html; charset=utf-8" },
  "/index.html": { plik: "index.html", typ: "text/html; charset=utf-8" },
  "/jinja-kanri": { plik: "jinja-kanri.html", typ: "text/html; charset=utf-8" },
  "/jinja-kanri.html": { plik: "jinja-kanri.html", typ: "text/html; charset=utf-8" },
  "/adminjinja": { plik: "jinja-kanri.html", typ: "text/html; charset=utf-8" },
};

async function serwujStatyczny(res, wpis) {
  const tresc = await fsp.readFile(path.join(__dirname, wpis.plik));
  res.writeHead(200, { "Content-Type": wpis.typ, ...NAGLOWKI_BEZPIECZENSTWA_HTML });
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
    if (sciezka === "/api/brama" && req.method === "GET") return await apiBramaStatus(url, res);
    if (sciezka === "/api/brama" && req.method === "POST") return await apiBramaOtworz(req, res);
    if (sciezka === "/api/awatar" && req.method === "GET") return await apiAwatarPubliczny(url, res);
    if (sciezka === "/api/admin/goscie" && req.method === "GET") return await apiGoscieLista(req, res);
    if (sciezka === "/api/admin/goscie" && req.method === "POST") return await apiGoscDodaj(req, res);
    if (sciezka === "/api/admin/goscie" && req.method === "DELETE") return await apiGoscUsun(req, res, url);
    if (sciezka === "/api/admin/gosc-jezyk" && req.method === "POST") return await apiGoscJezyk(req, res, url);
    if (sciezka === "/api/admin/wyczysc" && req.method === "POST") return await apiWyczyscDaneGoscia(req, res, url);
    if (sciezka === "/api/admin/awatar" && req.method === "POST") return await apiAwatarZapisz(req, res, url);
    if (sciezka === "/api/admin/awatar" && req.method === "DELETE") return await apiAwatarUsun(req, res, url);

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
