# POC plan — snapshot workflow → build/test → deploy

Status: plan, nie wykonane. Wymaga uruchomienia realnych workflow w GitHub
Actions — nie do zrobienia z lokalnego audytu. Referencja:
`adr/G-catalog-snapshot-priceupdatedat.md` sekcja 7.

## Fakt do niezakładania

**Nie zapisujemy jako ustalonego faktu, że push wykonany przez domyślny
`GITHUB_TOKEN` z workflow snapshotu automatycznie uruchomi `deploy.yml`
(`on: push branches:[main]`).** GitHub dokumentuje ograniczenie: zdarzenia
wygenerowane przez `GITHUB_TOKEN` domyślnie nie kaskadują do innych workflow
reagujących na to samo zdarzenie (`push`/`pull_request`), żeby zapobiec
nieskończonym pętlom. To jest udokumentowane zachowanie platformy, ale
**wymaga POC w tym konkretnym repo** przed uznaniem za podstawę projektu — nie
zakładamy go tylko na podstawie dokumentacji GitHub, bo mogą na to wpływać
`concurrency` group (`deploy.yml` ma `group: "pages"`), branch protection
(dziś brak — patrz niżej) czy specyfika Pages OIDC deploy.

## Stan zastany, potwierdzony czytaniem `.github/workflows/deploy.yml`

- Trigger: `on: push branches:[main]` + `workflow_dispatch`.
- `permissions: contents:read, pages:write, id-token:write`.
- Deploy **nie jest** push do brancha `gh-pages` — używa
  `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` (oficjalny
  OIDC-owy Pages deploy). To zmienia ocenę ryzyka względem starszego wzorca
  (push-do-gh-pages obserwowanego przez `on:push` na tamtym branchu) — tu
  `deploy.yml` nasłuchuje na `push` do `main`, nie na branch generowany przez
  bota.
- Pipeline pełny: `npm audit` (prod-only) → lint → format:check → typecheck →
  `npm run test` (vitest) → `npm run build` (esbuild, sekret GAS URL) →
  Playwright install → `npm run test:smoke` → upload artifact → deploy.
- **Branch protection na `main`: brak** (potwierdzone `gh api
repos/.../branches/main/protection` → `404 Branch not protected`). Direct
  push/commit do `main` jest dziś możliwy bez PR i bez review.
- **Domyślne uprawnienia workflow repo: `read`** (potwierdzone `gh api
repos/.../actions/permissions/workflow` →
  `default_workflow_permissions: "read"`). Każdy nowy workflow musi jawnie
  zadeklarować `permissions: contents: write` / `actions: write` — nic nie
  dziedziczy się automatycznie.

## Decyzja właściciela nadrzędna nad tym POC

Pierwsza iteracja snapshot workflow (PR 4) ma działać **wyłącznie manualnie
przez `workflow_dispatch`** i **tworzyć reviewowalny wynik — Pull Request, nie
automatyczny commit do `main`.** To zmienia domyślną rekomendację z
wcześniejszej wersji tego audytu (direct-push) na wariant z PR-em jako
wyjściem. Konsekwencja: workflow snapshotu nie potrzebuje w ogóle rozwiązywać
problemu "jak wywołać deploy.yml automatycznie" na tym etapie — wynikiem jest
PR do przejrzenia i zmergowania przez człowieka, a `deploy.yml` odpala się
naturalnie przez swój istniejący trigger `on: push branches:[main]` **w
momencie mergowania tego PR-a przez człowieka** (czyli zwykły push wykonany
przez GitHuba po merge, nie przez `GITHUB_TOKEN` z workflow — inny przypadek,
nieobjęty ograniczeniem opisanym wyżej).

To oznacza: **dla pierwszej manualnej iteracji (PR 4) całe pytanie A/B/C
poniżej jest niżej priorytetowe niż zakładano** — kaskadowanie workflow→workflow
staje się istotne dopiero przy włączaniu crona (PR 5), gdzie nikt nie klika
"merge" ręcznie. Porównanie zostaje poniżej, bo brief wymaga rekomendacji przed
PR 5, ale **nie blokuje PR 4**.

## Porównanie opcji (dla PR 5 — cron, decyzja odroczona)

### A — Reusable workflow (`workflow_call`)

`deploy.yml` wydzielony jako `workflow_call`, wywoływany zarówno przez trigger
`push` (dzisiejszy) jak i przez `catalog-snapshot.yml` przez `uses:`.

- Plusy: jeden workflow do utrzymania, brak potrzeby dodatkowych uprawnień
  (`workflow_call` nie wymaga `actions: write` u wołającego).
  Nie ma problemu z kaskadowaniem — `workflow_call` nie jest zdarzeniem `push`.
- Minusy: wymaga refaktoryzacji `deploy.yml` (podział na `on: [push,
workflow_call]`), więcej ruchomych części w jednym pliku, ryzyko przy
  edycji istniejącego, działającego deployu.

### B — `workflow_dispatch` deployu wywołany przez snapshot workflow

Snapshot workflow, po walidacji, woła REST API
(`POST /repos/{owner}/{repo}/actions/workflows/deploy.yml/dispatches`) z
`permissions: actions: write` we własnym pliku. `deploy.yml` już ma
`workflow_dispatch:` jako trigger, gotowy do wywołania bez zmian.

- Plusy: zero zmian w `deploy.yml`, jasny podział odpowiedzialności, nie
  wymaga PAT (GITHUB_TOKEN z `actions: write` wystarcza do wywołania
  `workflow_dispatch` w tym samym repo).
- Minusy: dwa oddzielne uruchomienia widoczne w Actions UI (mniej czytelne niż
  jeden przebieg), wymaga API call zamiast natywnego `uses:`.

### C — Snapshot workflow sam robi build/test/deploy inline

Cały pipeline z `deploy.yml` skopiowany/zduplikowany do
`catalog-snapshot.yml`.

- Plusy: jeden przebieg, brak zależności międzyworkflowowej.
- Minusy: duplikacja pipeline'u (dryf między dwoma kopiami tego samego
  build/test/deploy), najgorszy do utrzymania, wprost zakazany duch brief-u
  ("nie duplikuj logiki, którą już masz w deploy.yml").

## Rekomendacja wstępna (do potwierdzenia POC-em przed PR 5, nie fakt)

**Opcja B** dla przyszłego crona (PR 5) — najmniejsza zmiana w istniejącym,
działającym `deploy.yml`, jasny podział, nie wymaga nowego sekretu. Dla PR 4
(manualny, wynik = PR) żadna z tych trzech opcji nie jest jeszcze potrzebna —
patrz sekcja "Decyzja właściciela nadrzędna" wyżej.

## POC do wykonania w PR 4 (przed napisaniem finalnego workflow)

```
1. Utworzyć catalog-snapshot.yml z on: workflow_dispatch, permissions:
   contents: write (do utworzenia brancha + PR-a), bez permissions: actions:write
   (niepotrzebne dla wariantu "wynik = PR").
2. Workflow: checkout → GET getState (read-only) → walidacja → jeśli katalog
   różni się i przechodzi walidację, utworzyć branch + commit snapshotu +
   otworzyć PR (np. przez akcję peter-evans/create-pull-request albo gh pr
   create) — NIE commitować bezpośrednio do main.
3. Uruchomić ręcznie przez workflow_dispatch na branchu testowym (nie main).
4. Zweryfikować: PR zawiera tylko plik snapshotu, żadnych innych zmian; opis
   PR-a zawiera catalogRevision/catalogUpdatedAt źródłowe.
5. Zmergować PR ręcznie, potwierdzić że deploy.yml odpalił się przez swój
   zwykły trigger on:push (bo to już zwykły ludzki push po merge, nie push
   z GITHUB_TOKEN wewnątrz workflow).
```

## Zakazy z brief-u — zweryfikowane jako możliwe do spełnienia

- Brak `on: push` dla `catalog-snapshot.yml` — projektowany od razu jako
  `workflow_dispatch` (PR 4), `schedule` dopiero PR 5.
- Brak `git pull --rebase || true` — workflow operuje na świeżym checkout +
  jednym commicie, nie potrzebuje `pull` w ogóle.
- Brak force-push — niepotrzebny w tym flow (nowy branch + PR za każdym razem).
