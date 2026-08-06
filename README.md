# 運命 (un-mei) — Świątynia Przeznaczenia ⛩️

Strona-zaproszenie na randkę w klimacie japońskiej świątyni + panel administratora.
Frontend to czysty HTML/CSS/JS, backend to pojedynczy serwer Node **bez żadnych zależności** —
przygotowany pod **Railway**.

## Struktura

| Plik | Rola |
|---|---|
| `index.html` | strona zaproszenia (5 etapów: torii → omikuji → wróżba → ema → kalendarz) |
| `jinja-kanri.html` | panel administratora (`/jinja-kanri`) |
| `server.js` | serwer: statyki + API (`/api/odpowiedz`, `/api/admin/login`, `/api/admin/zdarzenia`) |
| `package.json` | `npm start` → `node server.js` |

Zdarzenia zapisywane są do pliku `zdarzenia.ndjson` w katalogu `DATA_DIR` (domyślnie `./dane`).

## Zanim wdrożysz

1. **Wpisz swoje imię** — na górze skryptu w `index.html` jest stała `TWOJE_IMIE`.
2. Wypchnij repo na GitHub (Railway deployuje z gita).

## Wdrożenie na Railway

1. Na [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** → wybierz to repo.
   Railway sam wykryje Node (`npm start`) i wystawi aplikację na porcie z env `PORT`.
2. **Zmienne środowiskowe** (zakładka *Variables* w serwisie):
   - `ADMIN_HASLO` = Twoje hasło do panelu admina (wymagane!)
3. **Wolumen na dane** (żeby zdarzenia przeżyły redeploy):
   - w serwisie: prawy przycisk / **Attach Volume**, mount path np. `/dane`
   - dodaj zmienną `DATA_DIR=/dane`
   - bez wolumenu wszystko działa, ale historia zdarzeń znika przy każdym deployu
4. **Publiczny adres**: *Settings → Networking → Generate Domain* — dostaniesz
   `https://<nazwa>.up.railway.app`.

Każdy push na `main` = automatyczny redeploy.

## Własna domena (np. unmei.pl)

1. W serwisie: **Settings → Networking → Custom Domain** → wpisz domenę.
2. Railway pokaże rekord CNAME — dodaj go w panelu DNS u rejestratora domeny.
3. Po propagacji DNS certyfikat TLS wystawia się automatycznie.

## Uruchomienie lokalne

```bash
ADMIN_HASLO=twoje-testowe-haslo node server.js
# → http://localhost:3000        (zaproszenie)
# → http://localhost:3000/jinja-kanri   (panel admina)
```

Sam frontend (`index.html`) działa też otwarty bezpośrednio z dysku — wysyłka zdarzeń
po prostu po cichu się nie uda, a strona przechodzi wszystkie etapy normalnie.

## Panel administratora

- adres: `/jinja-kanri`
- logowanie hasłem (`ADMIN_HASLO`), token sesyjny HMAC ważny 24 h, trzymany w `sessionStorage`
- pokazuje: status „czy już wybrała?", oś czasu zdarzeń, statystyki (wizyty, najdalszy etap,
  liczba prób „Odrzucam los"), auto-odświeżanie co 30 s

## Checklista przed wysłaniem linku 🌸

- [ ] `TWOJE_IMIE` ustawione w `index.html`
- [ ] `ADMIN_HASLO` ustawione w Variables na Railway
- [ ] wolumen podpięty + `DATA_DIR` ustawione
- [ ] przejście całości na telefonie na próbę
- [ ] logowanie do `/jinja-kanri` działa
