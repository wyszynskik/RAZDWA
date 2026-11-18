# Discovery — analiza Faza 3

- [T1 — Dopłaty w jednym wierszu](T1-dopłaty-w-jednym-wierszu.md) — Wlepki są jedyną kategorią używającą `data-region="options"`; pozostałe 17 kategorii i call-site dyplomy/laminowanie nadal polegają na kotwiczeniu przy przycisku lub osobnym boxie.
- [T2 — Introligatornia i foliowanie](T2-introligatornia-foliowanie.md) — Introligatornia ma dziś płaskie usługi jednostkowe i statyczne zakładki, a dodanie Foliowania jako podkategorii z progami wymaga zmian w dynamicznych materiałach, widoku i adminie.
- [T3 — Wizytówki foliowane](T3-wizytowki-foliowane.md) — Obecne „Foliowane” to jeden wariant `matt_gloss`, a osobne ceny mat/błysk wymagają rozdzielenia prefiksów, tabel, Ustawień i legend.
- [T4 — Ulotki: dropdown na input](T4-ulotki-dropdown-na-input.md) — Ilość jest dziś selectem opartym na exact pointach, a `getInterpolatedPrice` jest używany przez dynamiczne podgrupy, nie przez bezpośredni formularz Ulotek.
- [T5 — Broszury: papier i okładka](T5-broszury-papier-okladka.md) — Broszury mają dziś tylko format, strony i ilość oraz zero-jedynkę cennika bez modelu papierów i okładki.
- [T6 — Zera i duplikaty punktów](T6-zera-i-duplikaty-punktow.md) — Ceny 0 mają częściowe ostrzeganie i sentinele, lecz brak domkniętej walidacji D-106 dla nakładających się progów i duplikatów wariantów.