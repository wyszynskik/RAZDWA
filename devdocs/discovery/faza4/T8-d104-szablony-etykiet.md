# T8 — D-104 i szablony etykiet z cennika

## Stan obecny (fakty: plik:linia, nazwa funkcja)

- D-104 stanowi, że żadna widoczna etykieta nie może mieć na stałe wpisanej kwoty/procentu i że wartość ma pochodzić z tego samego klucza co cena (`devdocs/DECYZJE.md:44-48`).
- `src/core/rateLabels.ts:36-52` `hydrateRateLabels()` dla `data-rate-key` czyta `resolveStoredPrice(key, def)` i zapisuje procent, a dla `data-rate-fixed` czyta format kwoty (`src/core/rateLabels.ts:38-50`). Router uruchamia go po montażu widoku i po `prices-updated` (`src/ui/router.ts:392-395`, `src/ui/router.ts:270-272`).
- Osiem wystąpień szablonu o braku klucza (`D-104`/audit D-104):
  1. `docs/categories/plakaty.html:77-78` — `W tym dopłata EXPRESS +20%` powinno być `modifier-express` (domyślnie 0.20), którego liczy `src/categories/plakaty.ts:159-160`, `src/categories/plakaty.ts:285-286`, `src/categories/plakaty.ts:508-509`.
  2. `docs/categories/druk-a4-a3-skan.html:240-241` — `TRYB EXPRESS +20%` powinien być `modifier-express` (0.20); tę samą wartość liczy `src/categories/druk-a4-a3-skan.ts:56-57`.
  3. `docs/categories/ulotki-cyfrowe.html:71` — `Optgroup „Satyna (+12%)”` powinien być `modifier-satyna` (0.12); klucz wykorzystuje `src/core/satynaPricing.ts:3-8`, `src/core/satynaPricing.ts:37-50` i klasy `src/categories/ulotki-cyfrowe-jednostronne.ts:49-59` oraz `src/categories/ulotki-cyfrowe-dwustronne.ts:49-59`.
  4. `docs/categories/druk-cad.html:524` — `Zawiera dopłatę EXPRESS +20%` powinien być `modifier-express`; źródło liczące to `src/categories/druk-cad.ts:31-32` i `src/categories/druk-cad.ts:258-285`.
  5. `docs/categories/dyplomy.html:113` — `Optgroup „Satyna (+7%)”` powinien być `modifier-satyna-eko` (0.07); używa go `src/categories/dyplomy.ts:315-316` i `src/ui/views/dyplomy.ts:294-295`.
  6. `docs/categories/vouchery.html:101-102` — `EXPRESS +20%` powinien być `modifier-express`; stawka jest pobierana w `src/categories/vouchery.ts:118-145` i `src/categories/vouchery.ts:229-230`.
  7. `docs/categories/vouchery.html:105` — `SATYNA +12%` powinien być `modifier-satyna`; klucz jest pobierany w `src/categories/vouchery.ts:118-145`.
  8. `docs/categories/vouchery.html:107-108` — `MODIGLIANI +20% od ceny satyny` powinien być `modifier-modigliani`; klucz jest pobierany w `src/categories/vouchery.ts:118-145`.
- Etokiety już poprawione mechanizmem są przykładowo `docs/categories/dyplomy.html:63-65`, `docs/categories/dyplomy.html:130-131`, `docs/categories/banner.html:34` i `docs/categories/wlepki-naklejki.html:108-119`; te szablony mają `data-rate-key` albo `data-rate-fixed` i dzięki temu podlegają `hydrateRateLabels()`.
- Z-06 nie znaleziono w repo: nie ma dokumentu ani identyfikatora Z-06 w `devdocs/`, `src/`, `tests/`, `e2e/` ani `docs/`; dlatego nie da się przypisać brakującego Z-06 do konkretnej decyzji bez źródła.

## Punkty zmiany (dokładne miejsca, co i dlaczego, bez kodu)

- Zastąpić literalne wartości w każdym z ośmiu miejsc atrybutami `data-rate-key` lub `data-rate-fixed` z właściwym kluczem i defaultem; każda korekta ma być lokalna dla danego szablonu (`src/core/rateLabels.ts:36-52`, `devdocs/DECYZJE.md:44-48`).
- Nie zmieniać już zaimplementowanych miejsc z atrybutami bez potrzeby; punkt zmian obejmuje tylko ośmiu literałów wymienionych wyżej i ewentualnie inne literalne wartości znalezione przez pełne przeszukanie wszystkich `docs/categories/*.html`.
- Po podmianie pozostawić wywołanie centralnego routera jako gwarancję aktualizacji: `src/ui/router.ts:392-395` odświeża po zmianie cen, a `src/ui/router.ts:270-272` odświeża po mount.
- Jeśli Z-06 ma oznaczać inną listę szablonów niż osiem D-104, lista Z-06 musi zostać dostarczona lub odnaleziona w źródłach — obecny repo nie zawiera tego identyfikatora.

## Zależności i ryzyka

- `hydrateRateLabels()` zmienia tylko tekst (`src/core/rateLabels.ts:28-34`), więc szablon może być formatowo zgodny, ale kalkulator nadal liczyć inną stawkę; etykieta i cena muszą używać tego samego klucza.
- Stała w szablonie `20`/`12`/`7` ma być wyłączona tylko, jeśli nie jest nazwą gramatury lub innego produktu — D-104 dotyczy wartości ceny, nie liczby gramów (`devdocs/DECYZJE.md:44-48`).
- Domyślna wartość `data-rate-*` musi odpowiadać fallbackowi ścieżki liczenia (`src/core/rateLabels.ts:38-50`).
- Ryzyko nieaktualnego defaulta po zmianach D-105: poszczególne widoki często mają własne fallbacki 0.20/0.12/0.07 (`src/ui/views/dyplomy.ts:129-130`, `src/ui/views/dyplomy.ts:294-295`, `src/ui/views/wizytowki-druk-cyfrowy.ts:366-367`), ale centralny klucz jest źródłem prawdy.

## Testy (istniejące do aktualizacji, brakujące do dopisania, ścieżki)

- Istnieją `tests/rateLabels.test.ts:92-126` dla zmian kluczy `modifier-express` i `modifier-satyna-eko`; testują zarówno domyślny, jak i zmieniony odczyt.
- Istnieje test `e2e/edit-variant-label.spec.ts`, ale dotyczy nazwy wariantu, nie etykiet stawki.
- Aktualizować testy, które dziś zakładają rozstaw +20% w odpowiednich kalkulatorach: `tests/plakaty.test.ts:381-424`, `tests/druk.test.ts:177-188`, `tests/druk.test.ts:331-337`, `tests/vouchery.test.ts:41-85`.
- Brakujące: test DOM każdego z ośmiu szablonów po zmianie `modifier-*` w storage, z oczekiwanym procentem i tekstem bez starej wartości; test po zmianie `banner-oczkowanie`/fixed keys dla kwoty; test, że `prices-updated` odświeża wszystkie obecne instancje.
- Ścieżki E2E: panel zmienia wartość klucza → przejście na widok → odczyt textu etykiety i kosztu pozycji dla `plakaty`, `druk-a4-a3-skan`, `ulotki-cyfrowe`, `druk-cad`, `dyplomy`, `vouchery`.

## Pytania otwarte (czego nie da się ustalić z kodu)

- Które dokładnie osiem miejsc jest kanoniczne dla Z-06; identyfikator nie występuje w repo, więc lista powyżej opiera się na D-104 i pełnym wyszukaniu literałów.
- Czy D-104 ma obejmować także literalne kwoty zł poza ośmioma procentami, np. `1 zł`, `1,60 zł`, `0,80 zł/szt.` i `0,00 zł` (`docs/categories/druk-a4-a3-skan.html:201-211`, `docs/categories/cad-upload.html:852`, `docs/categories/laminowanie.html:545`), czy tylko dopłaty oznaczone jako EXPRESS/SATYNA/MODIGLIANI? Decyzja mówi ogólnie o wszystkich etykietach (`devdocs/DECYZJE.md:44-48`) i nie rozstrzyga tej granicy.
- Czy literły „Satyna (+12%)” i „Satyna (+7%)” mają być interaktywnie dynamiczne, czy zostawić jako opis wyboru i ukryć procent? Repo nie ma ich źródła w `data-rate-*` (`docs/categories/ulotki-cyfrowe.html:71`, `docs/categories/dyplomy.html:113`).

## Szacunek (pliki, liczba PR-ów, kolejność)

- Jeden mały PR dla ośmiu literałów, ponieważ zmiana dotyczy głównie szablonów HTML i istniejącego mechanizmu `hydrateRateLabels()`.
- Szacunkowo 5–6 plików HTML dla wymienionych wystąpień; korekta może objąć dodatkowe 3–4 pliki fixed-lable w ramach pełnej interpretacji D-104.
- Kolejność: najpierw zatwierdzić zakres Z-06 i granicę kwot, potem dopisać `data-rate-*`, na końcu test DOM wszystkich szablonów.
