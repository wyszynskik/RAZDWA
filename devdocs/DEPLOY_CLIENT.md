# Wdrożenie kopii dla klientki

Deliverable dla klientki to wyłącznie zawartość `docs/` po zbudowaniu —
nigdy repo, `src/`, `tests/` ani `devdocs/`.

## Wymagania

- Lokalny `.env` z `GOOGLE_APPS_SCRIPT_URL` (już ustawiony — GAS na koncie
  klientki, zostaje bez zmian).
- Docelowy adres u klientki (subdomena albo podkatalog).

## Komenda

```
npm run package:client -- --site-url=https://ADRES-KLIENTKI/
```

Opcje:

- `--client-id=<slug>` — domyślnie `raz-dwa`.
- `--include-handover` — dołącza `DOKUMENT_ODBIOROWY_KARTA.html` (domyślnie
  pominięty — to protokół odbioru, nie część kalkulatora).
- `--allow-indexing` — usuwa blokadę w `robots.txt` (domyślnie zablokowane).
- `--out=<folder>` — domyślnie `dist-client/<client-id>-<data>`.

## Co robi

1. Buduje `app.js` z `RAZDWA_ENV=client` i podanym `client-id`, biorąc
   `GOOGLE_APPS_SCRIPT_URL` z `.env`.
2. Kopiuje `docs/` do osobnego folderu — nie rusza wersji używanej do
   testów na GitHub Pages.
3. W kopii podmienia `og:url` / `og:image` / `twitter:image` na adres
   klientki.
4. Domyślnie pomija dokument odbiorowy.

## Efekt uboczny buildu

Krok `prebuild` bumpuje znacznik wersji cache w `docs/index.html` i
`docs/sw.js` (pliki commitowane w repo). To normalne przy każdym buildzie —
albo zacommituj tę zmianę, albo cofnij, jeśli akurat nie chcesz jej w tej
chwili:

```
git checkout -- docs/index.html docs/sw.js docs/cache-buster.js
```

## Po wgraniu na serwer klientki

- strona ładuje się pod nowym adresem,
- 2–3 kategorie liczą poprawnie,
- testowe zamówienie realnie ląduje w arkuszu Google klientki,
- eksport PDF działa,
- service worker rejestruje się poprawnie (DevTools → Application →
  Service Workers).

## Otwarte decyzje przed pierwszym realnym wgraniem

- Build z czystego `main` czy poczekać na dokończenie WIP (`dyplomy`,
  `ustawienia`)?
- `robots.txt`: blokować indeksowanie czy nie?
- Dokument odbiorowy: na serwer klientki czy dostarczyć osobno?
