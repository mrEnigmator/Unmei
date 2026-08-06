/**
 * API panelu administratora:
 *   POST /api/admin/login      — logowanie hasłem (sekret środowiskowy ADMIN_HASLO),
 *                                zwraca token sesyjny podpisany HMAC, ważny 24 h
 *   GET  /api/admin/zdarzenia  — lista wszystkich zdarzeń z KV,
 *                                wymaga tokenu w nagłówku Authorization: Bearer <token>
 */

const WAZNOSC_TOKENU_MS = 24 * 60 * 60 * 1000;

export async function onRequest(context) {
  const { request, env, params } = context;
  const sciezka = Array.isArray(params.route) ? params.route.join("/") : (params.route || "");

  if (!env.ADMIN_HASLO) {
    return json({ ok: false, blad: "Brak skonfigurowanego sekretu ADMIN_HASLO" }, 500);
  }

  if (sciezka === "login" && request.method === "POST") {
    return login(request, env);
  }

  if (sciezka === "zdarzenia" && request.method === "GET") {
    return zdarzenia(request, env);
  }

  return json({ ok: false, blad: "Nie znaleziono" }, 404);
}

/* ---------- logowanie ---------- */

async function login(request, env) {
  let dane;
  try {
    dane = await request.json();
  } catch (e) {
    return json({ ok: false, blad: "Nieprawidłowy JSON" }, 400);
  }

  const haslo = typeof dane?.haslo === "string" ? dane.haslo : "";

  if (!(await bezpiecznePorownanie(haslo, env.ADMIN_HASLO))) {
    return json({ ok: false, blad: "Nieprawidłowe hasło" }, 401);
  }

  const wygasa = Date.now() + WAZNOSC_TOKENU_MS;
  const podpis = await hmac(String(wygasa), env.ADMIN_HASLO);
  return json({ ok: true, token: `${wygasa}.${podpis}` });
}

/* ---------- zdarzenia ---------- */

async function zdarzenia(request, env) {
  const naglowek = request.headers.get("Authorization") || "";
  const token = naglowek.replace(/^Bearer\s+/i, "");

  if (!(await tokenWazny(token, env.ADMIN_HASLO))) {
    return json({ ok: false, blad: "Brak autoryzacji" }, 401);
  }

  const wyniki = [];
  let kursor;
  do {
    const strona = await env.ZAPROSZENIE.list({ prefix: "zdarzenie:", cursor: kursor });
    for (const klucz of strona.keys) {
      const wartosc = await env.ZAPROSZENIE.get(klucz.name);
      if (wartosc) {
        try {
          wyniki.push({ klucz: klucz.name, ...JSON.parse(wartosc) });
        } catch (e) { /* pomijamy uszkodzone wpisy */ }
      }
    }
    kursor = strona.list_complete ? undefined : strona.cursor;
  } while (kursor);

  // od najnowszych — klucze zawierają Date.now(), więc sortujemy po nich malejąco
  wyniki.sort((a, b) => (a.klucz < b.klucz ? 1 : -1));

  return json({ ok: true, zdarzenia: wyniki });
}

/* ---------- kryptografia ---------- */

async function hmac(wiadomosc, sekret) {
  const enc = new TextEncoder();
  const klucz = await crypto.subtle.importKey(
    "raw", enc.encode(sekret),
    { name: "HMAC", hash: "SHA-256" },
    false, ["sign"]
  );
  const podpis = await crypto.subtle.sign("HMAC", klucz, enc.encode(wiadomosc));
  return [...new Uint8Array(podpis)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function tokenWazny(token, sekret) {
  const [wygasaStr, podpis] = String(token).split(".");
  if (!wygasaStr || !podpis) return false;

  const wygasa = Number(wygasaStr);
  if (!Number.isFinite(wygasa) || Date.now() > wygasa) return false;

  const oczekiwany = await hmac(wygasaStr, sekret);
  return bezpiecznePorownanie(podpis, oczekiwany);
}

/* porównanie w stałym czasie — obie strony przepuszczamy przez HMAC z losowym kluczem */
async function bezpiecznePorownanie(a, b) {
  const enc = new TextEncoder();
  const losowy = crypto.getRandomValues(new Uint8Array(32));
  const klucz = await crypto.subtle.importKey(
    "raw", losowy, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const ha = new Uint8Array(await crypto.subtle.sign("HMAC", klucz, enc.encode(String(a))));
  const hb = new Uint8Array(await crypto.subtle.sign("HMAC", klucz, enc.encode(String(b))));
  let rozne = 0;
  for (let i = 0; i < ha.length; i++) rozne |= ha[i] ^ hb[i];
  return rozne === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
