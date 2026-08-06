/**
 * POST /api/odpowiedz
 * Zapisuje zdarzenie ze strony zaproszenia w Cloudflare KV (binding: ZAPROSZENIE).
 * Klucz: zdarzenie:{timestamp}:{losowy-id}
 */

export async function onRequestPost(context) {
  const { request, env } = context;

  let dane;
  try {
    dane = await request.json();
  } catch (e) {
    return json({ ok: false, blad: "Nieprawidłowy JSON" }, 400);
  }

  if (!dane || typeof dane.typ !== "string") {
    return json({ ok: false, blad: "Brak pola 'typ'" }, 400);
  }

  const zdarzenie = {
    typ: dane.typ,
    etap: dane.etap ?? null,
    ema: dane.ema ?? null,
    data: dane.data ?? null,
    dataSlownie: dane.dataSlownie ?? null,
    pora: dane.pora ?? null,
    probyOdmowy: dane.probyOdmowy ?? null,
    timestamp: dane.timestamp || new Date().toISOString(),
    userAgent: (dane.userAgent || "").slice(0, 400),
    zapisano: new Date().toISOString(),
  };

  const losowyId = crypto.randomUUID().slice(0, 8);
  const klucz = `zdarzenie:${Date.now()}:${losowyId}`;

  await env.ZAPROSZENIE.put(klucz, JSON.stringify(zdarzenie));

  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
