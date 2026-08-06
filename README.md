# 運命 (un-mei) — Świątynia Przeznaczenia ⛩️

Strona-zaproszenie na randkę w klimacie japońskiej świątyni + panel administratora,
przygotowana pod **Cloudflare Pages** (frontend + Pages Functions + KV).

## Struktura

| Plik | Rola |
|---|---|
| `index.html` | strona zaproszenia (5 etapów: torii → omikuji → wróżba → ema → kalendarz) |
| `jinja-kanri.html` | panel administratora (`/jinja-kanri`) |
| `functions/api/odpowiedz.js` | POST — zapis zdarzeń ze strony do KV |
| `functions/api/admin/[[route]].js` | API admina: `login` + `zdarzenia` |
| `wrangler.toml` | konfiguracja Pages + binding KV |

## Zanim wdrożysz

1. **Wpisz swoje imię** — na górze skryptu w `index.html` jest stała `TWOJE_IMIE`.
2. Zainstaluj narzędzia: `npm install -g wrangler` (albo używaj `npx wrangler`).
3. Zaloguj się: `npx wrangler login`.

## Wdrożenie — ścieżka A: przez wrangler (CLI)

```bash
# 1. Utwórz przestrzeń KV
npx wrangler kv namespace create ZAPROSZENIE
# → skopiuj zwrócone "id" i wklej je do wrangler.toml w miejsce WSTAW_TUTAJ_ID_PRZESTRZENI_KV

# 2. Utwórz projekt Pages
npx wrangler pages project create unmei --production-branch main

# 3. Ustaw sekret z hasłem do panelu admina
npx wrangler pages secret put ADMIN_HASLO --project-name unmei
# → wpisz hasło, gdy zapyta

# 4. Deploy (z katalogu projektu)
npx wrangler pages deploy . --project-name unmei
```

Strona wyląduje pod `https://unmei.pages.dev`, panel pod `https://unmei.pages.dev/jinja-kanri`.

## Wdrożenie — ścieżka B: przez dashboard Cloudflare

1. Wypchnij projekt do repozytorium na GitHub/GitLab.
2. W dashboardzie Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, wybierz repo.
   - Build command: *(puste)*, Build output directory: `/`.
3. Utwórz przestrzeń KV: **Storage & Databases → KV → Create namespace**, nazwa np. `unmei-zaproszenie`.
4. W projekcie Pages: **Settings → Bindings → Add → KV namespace**:
   - Variable name: `ZAPROSZENIE`, namespace: ten z kroku 3.
5. **Settings → Environment variables → Add**: nazwa `ADMIN_HASLO`, typ **Secret**, wartość = Twoje hasło do panelu.
6. Zrób redeploy (Deployments → Retry deployment), żeby binding i sekret weszły w życie.

## Własna domena

1. Kup domenę (np. `unmei.pl`) i dodaj ją do Cloudflare (**Add a domain**) — zmień serwery DNS u rejestratora na te wskazane przez Cloudflare.
2. W projekcie Pages: **Custom domains → Set up a custom domain** → wpisz domenę.
3. Cloudflare sam doda rekord CNAME i wystawi certyfikat TLS; po kilku minutach strona działa pod Twoją domeną.

## Podgląd lokalny

```bash
npx wrangler pages dev .
```

Lokalne KV jest emulowane w pamięci/na dysku, `ADMIN_HASLO` dla dev możesz podać w pliku
`.dev.vars` (nie commituj go!):

```
ADMIN_HASLO=twoje-testowe-haslo
```

Sam frontend (`index.html`) działa też otwarty bezpośrednio z dysku — wysyłka zdarzeń
po prostu po cichu się nie uda, a strona przechodzi wszystkie etapy normalnie.

## Panel administratora

- adres: `/jinja-kanri`
- logowanie hasłem (`ADMIN_HASLO`), token sesyjny HMAC ważny 24 h, trzymany w `sessionStorage`
- pokazuje: status „czy już wybrała?”, oś czasu zdarzeń, statystyki (wizyty, najdalszy etap,
  liczba prób „Odrzucam los”), auto-odświeżanie co 30 s

## Checklista przed wysłaniem linku 🌸

- [ ] `TWOJE_IMIE` ustawione w `index.html`
- [ ] KV podpięte jako `ZAPROSZENIE`
- [ ] `ADMIN_HASLO` ustawione jako Secret
- [ ] przejście całości na telefonie na próbę
- [ ] logowanie do `/jinja-kanri` działa
