# POC plan — offline / Service Worker dla snapshotu 12h

Status: plan, nie wykonane. Wymaga przeglądarki z DevTools (offline mode) — nie
do zrobienia z CLI/curl w ramach discovery. Referencja: `adr/G-catalog-snapshot-priceupdatedat.md` sekcja 4.

## Dwa scenariusze do rozróżnienia

**Scenariusz A** — urządzenie wcześniej otworzyło aplikację online i ma
bundle/Service Worker/cache.

**Scenariusz B** — całkowicie świeże urządzenie bez internetu, które nie może
nawet pobrać pierwszego bundle.

Nie wolno zakładać, że `fetch('/catalogSnapshot.json')` rozwiązuje oba — to
rozwiązuje wyłącznie Scenariusz A, i to tylko po pierwszym udanym fetchu.

## Stan zastany (potwierdzony czytaniem kodu, nie założony)

- **Bundler:** `scripts/build.mjs`, esbuild, bundluje `src/ui/main.ts` →
  `docs/assets/app.js`. Dane cenowe domyślne (`DEFAULT_PRICES` /
  `src/config/prices.json` przez `priceService`) **już są bundlowane** tym
  mechanizmem. Snapshot 12h ma naturalne miejsce do wpięcia się w ten sam
  wzorzec.
- **Service Worker (`docs/sw.js`):** `.html`/`.json` → network-first, fallback
  do cache przy offline (linie 110-132). JS/CSS/obrazy/fonty → cache-first.
  Żądania do `script.google.com` lub z `getPrices` w query → zawsze `fetch`,
  nigdy cache (linie 46-49) — GAS nigdy nie jest serwowany z cache SW, poprawne
  i bez zmian.
- **Cache-buster:** `docs/cache-buster.js` + `scripts/inject-cache-version.js`
  wstrzykuje timestamp do `CACHE_VERSION` (sw.js) i `APP_VERSION`
  (cache-buster.js) przy każdym buildzie. Przy zmianie wersji, `cache-buster.js`
  unregisteruje SW, kasuje wszystkie cache'e i robi `location.reload(true)`.
  Każdy nowy deploy już dziś unieważnia stary SW cache na każdym urządzeniu.

## Wniosek — rekomendacja (do potwierdzenia POC-em, nie ustalony fakt)

**Scenariusz A jest już częściowo pokryty** przez istniejącą, ogólną regułę
`.json` w `sw.js` — jeśli aplikacja kiedykolwiek pobrała dowolny plik `.json`
online, trafia on do cache bez pisania nowej logiki SW.

**Scenariusz B nie da się rozwiązać przez SW w żadnej konfiguracji** — SW nie
ma czego cache'ować przed pierwszym udanym fetchem. Jedyne rozwiązanie:
**Opcja 1 — import snapshotu do bundle**, zgodnie z istniejącym wzorcem
`DEFAULT_PRICES`. Rekomendacja wstępna, nie POC-owana jeszcze end-to-end.

**Opcja 2 — jawny SW precache JSON** pozostaje opcją uzupełniającą dla
Scenariusza A (dziś już częściowo działa opportunistycznie), nie zastępuje
Opcji 1 dla Scenariusza B.

## Testy do wykonania w PR 3/4 (nie wykonane w tym discovery)

### Test 1 — pierwsza wizyta online, potem offline

```
czysty profil przeglądarki
→ pierwsza wizyta online (DevTools otwarte)
→ sprawdzić w Application/Cache Storage czy snapshot/prices.json jest w cache
→ zamknięcie aplikacji
→ DevTools → Network → Offline
→ ponowne uruchomienie aplikacji
→ sprawdzić poprawne ceny: CAD (formatowy + mb), A4/A3 (cz/b + kolor), skan,
  co najmniej 1 dynamic variant (np. plakaty ekonomiczne A4)
```

Kryterium sukcesu: żadna cena nie jest `0`/`NaN`/`undefined`, dynamic variant
z `getState.variants[]` jest widoczny w UI.

### Test 2 — nowy deploy snapshotu nie usuwa dirty/unsynced/conflict

```
urządzenie ma lokalne niezapisane zmiany cennika (razdwa_config_dirty_at)
→ nowy deploy aplikacji z nowym snapshotem trafia na to urządzenie
  (cache-buster wymusza reload)
→ po reloadzie: lokalne niezapisane zmiany MUSZĄ nadal być widoczne
  w panelu Ustawień, nie zastąpione przez nowy snapshot
```

Kryterium sukcesu: `isConfigDirty()` po reloadzie nadal zwraca `true` dla tych
samych zmian, żadna wartość wpisana przez użytkownika nie zniknęła.

Oba testy wymagają realnej przeglądarki (Playwright albo ręcznie) — nie da się
ich zasymulować w czystym Node/vitest bez emulacji Cache Storage + Service
Worker lifecycle.
