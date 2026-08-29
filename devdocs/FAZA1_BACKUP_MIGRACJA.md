# Faza 1 — kopia konfiguracji, backfill kolejności podgrup, migracja na nowy hosting

Notatka techniczna dla developera. To **nie jest** instrukcja dla klientki — pełna
instrukcja powstaje w Fazie 5.

## Model danych (przypomnienie)

| Warstwa                    | Rola                                 | Trwałość          |
| -------------------------- | ------------------------------------ | ----------------- |
| Google Sheets + GAS        | wspólne, trwałe źródło konfiguracji  | trwałe            |
| `src/config/prices.json`   | dane startowe / fallback offline     | w bundlu          |
| `localStorage`/IndexedDB   | lokalny cache offline                | ginie z originem  |
| plik JSON (eksport/import) | backup awaryjny, przenoszony ręcznie | poza przeglądarką |

Kluczowa konsekwencja: `razdwa_price_subgroups` (rejestr podgrup wraz z ich
kolejnością) **nigdy nie trafia do arkusza**. Kolejność podgrup jeździ do Sheets
wyłącznie jako `VariantDefinition.subgroupSortOrder`, zdenormalizowane na każdym
progu podgrupy — tak samo jak `subgroupLabel`. Dlatego backfill jest obowiązkowy
przed przeprowadzką: bez niego dane sprzed Fazy 1 nie mają tego pola i po zmianie
domeny kolejność odtworzy się z kolejności tablicy wariantów, a nie z decyzji
użytkowniczki.

## Znaczenie dwóch pól sortujących

- `VariantDefinition.sortOrder` — kolejność **progów wewnątrz jednej podgrupy**.
  Nietykana przez backfill i przez zmianę nazwy.
- `VariantDefinition.subgroupSortOrder` — kolejność **całej podgrupy w kategorii**.
  Uzupełniana przez backfill, ustawiana automatycznie przy tworzeniu nowej podgrupy.

## Model zapisu

Każda lokalna zmiana konfiguracji (cena, wariant, podgrupa, nazwa, kolejność,
etykieta, import, backfill) natychmiast:

1. aktualizuje UI,
2. zapisuje stan w `localStorage`,
3. ustawia trwały znacznik `razdwa_config_dirty_at`.

Trwała synchronizacja następuje **wyłącznie** po jawnym kliknięciu
**„Zapisz cennik”**. Znacznik `razdwa_config_dirty_at` jest czyszczony dopiero po
sukcesie **obu** zapisów do GAS (ceny **oraz** warianty). Częściowy sukces zostawia
znacznik i dane lokalne nietknięte, a UI pokazuje:

> Zmiany zapisano lokalnie, ale nie zostały zsynchronizowane z arkuszem.
> Sprawdź połączenie i użyj „Zapisz cennik” ponownie.

Brak internetu nie blokuje kalkulatora i nie kasuje zmian lokalnych.

## Kolejność kroków migracji (obowiązkowa)

Wykonać **na starej instancji GitHub Pages**, zanim klientka przejdzie na nową domenę:

1. Otwórz starą instancję i zaloguj się do panelu **Ustawienia**.
2. Kliknij **„Pobierz kopię konfiguracji”** — zapisz plik
   `razdwa-konfiguracja-RRRR-MM-DD.json` poza przeglądarką.
3. Kliknij **„Uzupełnij kolejność podgrup”**.
4. Sprawdź podsumowanie: liczba kategorii, podgrup, wariantów do aktualizacji
   i wariantów pominiętych. Zatwierdź.
5. Kliknij **„Zapisz cennik”**.
6. Potwierdź komunikat:
   `✓ Konfiguracja została zapisana i zsynchronizowana z arkuszem. Kolejność podgrup została zapisana w arkuszu.`
   Bez tego komunikatu **nie przechodź dalej** — backfill nie dotarł do Sheets.
7. Dopiero teraz otwórz aplikację pod nową domeną / hostingiem klientki.
8. Zweryfikuj nazwy i kolejność podgrup oraz kolejność progów.

Eksport JSON **nie zastępuje** kroku 5. Plik to backup awaryjny; źródłem prawdy
przy starcie na nowym originie jest arkusz.

## Import awaryjny (tylko gdy dane z GAS nie odtworzą się poprawnie)

1. W panelu Ustawień kliknij **„Wczytaj kopię konfiguracji”** i wskaż plik.
2. Przed nadpisaniem aplikacja pobiera automatyczną kopię obecnego stanu
   (`razdwa-konfiguracja-RRRR-MM-DD-przed-importem.json`).
3. Import zapisuje dane **wyłącznie lokalnie** i oznacza konfigurację jako
   oczekującą na zapis. Nic nie leci do arkusza automatycznie — to celowa ochrona
   przed nadpisaniem nowszych danych starszym backupem.
4. Zweryfikuj nazwy i kolejność, dopiero potem kliknij **„Zapisz cennik”**.

## Ostrzeżenie: import starszej kopii

Import kopii konfiguracji zastępuje lokalną konfigurację w całości.
Przed importem sprawdź datę pliku backupu i upewnij się, że po jego utworzeniu
nie zapisano nowszych cen, wariantów ani podgrup w arkuszu Google.

Nie używaj starego backupu do nadpisania aktualnej konfiguracji bez świadomego
porównania zmian. Po imporcie dane trafią do arkusza dopiero po ręcznym
kliknięciu „Zapisz cennik”.

Import nie dotyczy zamówień, PIN-u ani konfiguracji połączenia z GAS. Eksport nie
zawiera PIN-u, tokenów sesji, URL-a Apps Script, `razdwa_order_export_config` ani
danych osobowych.

## Test z prawdziwym GAS — NIEZWERYFIKOWANE

Nie został wykonany: repo nie ma `.env` z produkcyjnym `GOOGLE_APPS_SCRIPT_URL`.
Procedura do wykonania ręcznie po uzupełnieniu `.env`:

1. `GOOGLE_APPS_SCRIPT_URL=<prawdziwy .../exec> RAZDWA_ENV=client npm run build`
2. Serwuj `docs/` lokalnie w **podkatalogu**, np. `http://localhost:8080/kalkulator/`
   — inny origin niż GitHub Pages.
3. Świeży profil przeglądarki albo DevTools → Application → **Clear site data**
   (`localStorage` **i** IndexedDB).
4. Otwórz aplikację. Zweryfikuj, że z arkusza pobrały się: ceny, warianty,
   ręcznie dodana podgrupa klientki, jej nazwa i kolejność, kolejność progów.
5. Dodaj wariant testowy w podgrupie o nazwie zaczynającej się od `ZZZ-TEST-`
   i kliknij „Zapisz cennik”. Potwierdź komunikat sukcesu.
6. Otwórz arkusz `variants`, komórka **A1**. Sprawdź obecność wpisu `ZZZ-TEST-`
   **oraz długość zawartości komórki** — limit Google Sheets to 50 000 znaków
   (patrz ryzyko niżej).
7. Ponownie wyczyść `localStorage`/IndexedDB i przeładuj. Potwierdź, że zmiana
   testowa odtworzyła się z backendu wraz z nazwą i pozycją.
8. Usuń **wyłącznie** dane `ZZZ-TEST-*` i ponownie kliknij „Zapisz cennik”.

## Otwarte ryzyka

- **Limit komórki A1 arkusza `variants`.** `writeVariants()` zapisuje całą tablicę
  wariantów jako jeden JSON w jednej komórce (limit 50 000 znaków).
  `subgroupSortOrder` dokłada ~25 B na wariant. Do zmierzenia w kroku 6 powyżej.
  Ewentualne chunkowanie wymaga zmiany `Code.gs` — poza zakresem Fazy 1.
- **Brak kolejki synchronizacji offline.** Zmiana wykonana bez internetu czeka
  w `localStorage` do najbliższego udanego „Zapisz cennik”. Znacznik
  `razdwa_config_dirty_at` sprawia, że stan jest widoczny po każdym reloadzie,
  ale wyczyszczenie danych przeglądarki przed synchronizacją nadal oznacza utratę.
  Temat na osobną fazę.
- **Brak walidacji schematu danych przychodzących z GAS.**
  `fetchStateFromAppsScript()` filtruje tylko po `typeof key === "string"`.
  Walidacja Zod została dodana dla importu z pliku; ścieżka sieciowa nie była
  zmieniana w tej fazie.
