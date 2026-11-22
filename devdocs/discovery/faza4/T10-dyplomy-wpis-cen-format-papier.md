# T10 — Dyplomy: wpis cen per format i papier

## Stan obecny (fakty: plik:linia, nazwa funkcji)

- Klientka może wejść w jeden standardowy kalkulator Dyplomów z wyborem formatu A4/A5 i papieru Kreda/Satyna/Modigliani (`docs/categories/dyplomy.html:35-50`, `src/ui/views/dyplomy.ts:100-129`).
- Model ceny per papier rozpoznaje tabele podkategorii po `materialSizeOptions: {material: "250g", size: "a4"}` i wyklucza je z osobnych kart (`src/core/dyplomyPaperTables.ts:1-15`, `src/core/dyplomyPaperTables.ts:31-57`, `src/core/dyplomyPaperTables.ts:80-105`).
- `getDyplomySubgroupPaperTables(format)` gromadzi punkty ilościowe po gramaturze i zwraca odczyt tabel A4/A5 (`src/core/dyplomyPaperTables.ts:85-105`).
- `calculateDyplomy()` czyta stawkę Satyny, Modigliani i EXPRESS (`src/categories/dyplomy.ts:192-194`), wybiera cenę Kredy nowego modelu dla danego formatu/gramatury albo fallback starej tabeli (`src/categories/dyplomy.ts:196-220`).
- Modigliani liczy się od Kredy 350g; zwykły papier liczy się od ceny Kredy tej gramatury; Satyna dodaje `modifier-satyna`, a Express jest liczone poza tymi modyfikatorami (`src/categories/dyplomy.ts:207-220`, `src/categories/dyplomy.ts:240-245`).
- Interpolacja gramatury jest realizowana w `resolveDyplomyKredaPrice()` i ma być niezależna od ilości (`src/categories/dyplomy.ts:400-421` w samych miejscach do odczytu pełnego; testy potwierdzają zakresy i dwa modele: `tests/dyplomy.test.ts:476-548`). W D-201 kresy to: poniżej 250g minimum, 250–350g interpolacja, Modigliani 350g (`devdocs/DECYZJE.md:116-121`).
- `src/ui/views/dyplomy.ts:129-207` buduje wynik, breakdown i wyświetla Satynę/Modigliani/EXPRESS; `src/ui/views/dyplomy.ts:269-295` robi osobne cenniki Dyplomów Ekonomicznych.
- W Ustawieniach istnieje standardowy formularz „Dodaj wariant”: pola to kategoria, prefiks/podgrupa, ilość, nazwa wariantu, tryb ceny, wariant bazowy i procent/zł, cena i legenda (`src/ui/views/ustawienia.ts:4182-4276`). Odpowiadające handlery na końcu zapisują nowy klucz i `VariantDefinition` (`src/ui/views/ustawienia.ts:4648-4899`, `src/ui/views/ustawienia.ts:4963-5239`).
- Wpis pojedynczego Dyplomu per ilość/papier może wymagać osobnego wariantu/podgrupy i osobnego wiersza dla każdego progu ilości; lista kroków jest rozbudowana przez dodatkowy wybór trybu relatywnego i bazy (`src/ui/views/ustawienia.ts:4182-4276`, `src/ui/views/ustawienia.ts:4240-4257`).
- Ustawienia mają osobny formularz hurtowego dodania papieru: nazwa papieru, wybór wielu kategorii i osobne bloki z polami ilość/cena dla każdej kategorii (`src/ui/views/ustawienia.ts:4475-4504`, `src/ui/views/ustawienia.ts:6073-6124`).
- Form "hurtowy" dodaje dla każdej zaznaczonej kategorii własny prefiks i po jednym `VariantDefinition` na próg; zapisuje też ceny i cennik podgrupy (`src/ui/views/ustawienia.ts:6162-6245`, `src/ui/views/ustawienia.ts:6230-6264`).
- Dla Dyplomów A4/A5 hurtowy/mechanizm pojedynczego materiału wymusza nazwę materiału dokładnie w formacie `kreda-250`/`kreda-350` i blokuje inne nazwy (`src/ui/views/ustawienia.ts:5467-5478`).
- Istniejący PR-17 nie ma własnego dokumentu ADR-H w repo: list_dir i grep pokazują, że istnieje tylko ADR-I oraz jest w nim zastrzeżone, że litera H jest zarezerwowana na ADR gramatury Dyplomów (`devdocs/adr/I-category-form-composition.md:6`). Nie znaleziono pliku `H-*.md`, decyzji PR-17 ani kodu zatwierdzającego bramkę ADR-H.
- D-201 potwierdza dwa modele cenowe A4/A5, ceny Kreda 250g i 350g, interpolację gramatury, Satynę 12% i Modigliani 20%, ale mówi jednocześnie, że ceny A4/A5 nie są jeszcze wszystkie wprowadzone i stara tabela działa do uzupełnienia (`devdocs/DECYZJE.md:116-121`).

## Punkty zmiany (dokładne miejsca, co i dlaczego, bez kodu)

- Zastąpić liczenie „po jednym wariancie na podgrupę i jednym progu na klucz” prostszym wpisem macierzy format × papier × ilość dla Dyplomów; dziś sam formularz i tabela cen są rozproszone po `VariantDefinition`, `prices.json` i custom subgroup registry (`src/ui/views/ustawienia.ts:4182-4276`, `src/services/priceService.ts:564-573`).
- Odtworzyć jeden układ włączający Kreda 250/350 i satyna/modigliani jako formuły od Kredy, zamiast trzymania satyny jako osobnego szeregu ręcznych cen. Repo już ma `priceFormula` dla wariantu relatywnego (`src/services/priceService.ts:618-640`) i testy Satyny 12%/Modigliani 20%, ale klientka musi dziś samodzielnie utworzyć wariant bazowy i pochodny (`e2e/config-persistence.spec.ts:893-979`).
- Ujednolicić natywny ekran wejścia dla A4/A5 i papiery; dziś standardowy UI ma formaty w wyborze papieru (`docs/categories/dyplomy.html:35-50`, `src/ui/views/dyplomy.ts:100-129`) i oddzielny wybór kluczy/podgrup w panelu (`src/ui/views/ustawienia.ts:4182-4276`).
- Utrzymać interpolację ilości i gramatury jako dwa osobne kroki, ale nie wymagać ręcznego klucza: `D-110` i D-201 wymagają ilości jako punktów oraz gramatury 250–350 jako interpolacji (`devdocs/DECYZJE.md:88-94`, `devdocs/DECYZJE.md:116-121`).
- Uzupełnić D-201 i bramkę ADR-H przed produkcyjnie pełnym wpisem hurtowym; bez dokumentu/ADR nie wiadomo, czy macierz ma zastąpić dynamiczne podgrupy, czy tylko uprościć ich tworzenie.
- Utrzymać D-105 jako wspólne źródło stawki Satyny/Modigliani/EXPRESS (`src/categories/dyplomy.ts:192-194`) i nie wpisywać nowych stałych ani 12/20/1.12 w widoku.

## Zależności i ryzyka

- Dwa modele przechodzą przez ten sam wynik: stary fallback i nowa tabela papierów; `calculateDyplomy()` wybiera fallback, gdy nowy klucz nie istnieje (`src/categories/dyplomy.ts:196-220`), więc błędny wpis może cicho wrócić do starego cennika.
- Nazwa podgrupy i klucz mają rygorystyczny format dla Dyplomów: parser liczy tylko `{material: 250g, size:a4/a5}` i parser materiału wymaga `kreda-250/350` (`src/core/dyplomyPaperTables.ts:31-57`, `src/ui/views/ustawienia.ts:5467-5478`).
- Relatywny `priceFormula` jest live od bazy, ale wymaga unikalnej podgrupy i tego samego ilościowego progu (`src/services/priceService.ts:618-640`, `e2e/config-persistence.spec.ts:927-979`).
- Hurtowy formularz operuje na wielu kategoriach i własnych prefiksach; błąd jednej kategorii może zablokować cały zapis albo zostawić częściowy wariant (`src/ui/views/ustawienia.ts:6162-6245`).
- Interpolacja gramatury działa poza normalnymi tabelami cen; testy potwierdzają fallback dla jednej/zero/bardziej niż dwóch gramatur (`tests/dyplomy.test.ts:504-548`), więc nowy UI nie może bezcłonie zakładać, że 250 i 350 są zawsze kompletne.
- Model satyny i Modigliani może rozjechać się z old order: D-201 mówi Satyna od Kredy tej gramatury i Modigliani od Kredy 350g, podczas gdy stara ścieżka nadal stackowała Satynę i Modigliani (`src/categories/dyplomy.ts:207-220`, `devdocs/DECYZJE.md:116-121`).

## Testy (istniejące do aktualizacji, brakujące do dopisania, ścieżki)

- Istnieją testy A4/A5 i ilości, stawki Satyny/Modigliani/EXPRESS: `tests/dyplomy.test.ts:92-184`, `tests/dyplomy.test.ts:476-548`.
- Istnieją testy D-110 i interpolacji ilościowej dla Dyplomów: `tests/dyplomy.test.ts:46-89`, `tests/dyplomy.test.ts:276-312`.
- Istnieją E2E dla hurtowego papieru i relatywnego wariantu: `e2e/config-persistence.spec.ts:815-879`, `e2e/config-persistence.spec.ts:893-979`.
- Aktualizować testy klienckiego wyboru papieru: `e2e/price-placeholder-d102.spec.ts:41-54` blokuje zero i nie sprawdza pełnego modelu papieru.
- Brakujące: jedna próba wpisu macierzy A4 250/350 i A5 250/350 z ilościami, sprawdzająca wszystkie kombinacje i brak fallbacku na starą tabelę.
- Brakujące: wpis Satyny 12% i Modigliani 20% jako relatywnych formuł od Kredy w jednym kroku; istniejące testy E2E sprawdzają tylko Satynę, nie pełny Modigliani i gramaturę (`e2e/config-persistence.spec.ts:893-979`).
- Brakujące: interpolacja gramatury 130/300/350/500 oraz ilości 1/10/100 z jedną bramką ADR-H i bezcowym blokowaniem koszyka przy pustej bazie.
- Brakujące: przypadek częściowej konfiguracji hurtowego papieru i odtwarzanie stanu po syncu; `e2e/config-persistence.spec.ts:862-879` testuje niekompletny wpis.

## Pytania otwarte (czego nie da się ustalić z kodu)

- Czy dla każdej kombinacji format/papier/ilość klientka wpisuje wszystkie ceny ręcznie, czy Satyna i Modigliani są jedynie formułą od Kreda — D-201 opisuje formuły, ale panel nadal oferuje oba sposoby (`src/ui/views/ustawienia.ts:4240-4257`, `src/categories/dyplomy.ts:192-220`).
- Czy 250g i 350g mają być jedynymi wariantami bazowymi, czy dopuszczane będą inne gramatury 130/170/200/300/500 — model parsera pozwala dowolną liczbę 2–4 cyfr, ale D-201 mówi o zakresie 250–350 (`src/core/dyplomyPaperTables.ts:31-57`, `devdocs/DECYZJE.md:116-121`).
- Czy hurtowy wpis jest docelowym modelem PR-17, czy przejściowym narzędziem; repo nie ma statusu PR-17 ani ADR-H (`devdocs/adr/I-category-form-composition.md:6`).
- Czy ceny A4 i A5 są zależne, czy każdą tabelę trzeba wypełnić osobno — kod ma dwie osobne pule (`src/categories/dyplomy.ts:400-421`, test `tests/dyplomy.test.ts:546-548`).
- Czy stara tabela ma być usunięta po pełnym wpisie, czy zawsze pozostawać fallbackiem — D-201 mówi „do uzupełnienia działa stara tabela” i nie ustala momentu bramki usunięcia fallbacku (`devdocs/DECYZJE.md:116-121`).

## Szacunek (pliki, liczba PR-ów, kolejność)

- Wymagane 2–3 PR-y: najpierw ADR-H i bramka stanu, potem uproszczenie panelu/macierzy, na końcu usunięcie starego fallbacku i testy migracji.
- Szacunkowo 10–15 plików: `ustawienia.ts`, `dyplomy.ts` w core i category, `dyplomy.ts` view, `dyplomyPaperTables.ts`, `dynamicMaterials.ts`, `productModel.ts`, HTML Dyplomów, testy i E2E.
- Dziś wpis per format/papier odbywa się w kilku krokach: osobno wybór kategorii i podgrupy, osobno ilość i cena dla każdego poziomu, osobno tryb relatywny/baza/procent lub zł, osobno zapis — przy pełnej macierzy to kilka rund tego formularza plus ponowny zapis dla każdego papieru. Hurtowy formularz redukuje część powtarzania do jednej nazwy, bloków kategorii i listy progów, lecz nadal wymaga ręcznego podania każdego progu/ceny.
- Kolejność: zatwierdzić ADR-H i zakres formuł, sfinalizować hurtowy wpis macierzy, podpiąć go do formatu/papieru, potem wyłączyć stary fallback po pełnym pokryciu danych i dodać pełne testy.
