# Google Apps Script — backend cennika RAZDWA

Plik `Code.gs` to backend kalkulatora RAZDWA uruchomiony w Google Apps Script. Obsługuje zapis i odczyt cennika, wariantów oraz katalogu (endpoint `doPost`/`doGet`), kontrolę rewizji, migawki katalogu i sesję PIN.

## Status: kopia, nie źródło prawdy

Ten plik jest **kopią** wdrożonego projektu Apps Script, trzymaną w repo do przeglądu i historii zmian. Do czasu wprowadzenia pełnej synchronizacji **źródłem prawdy pozostaje wdrożony projekt Apps Script**, nie ta kopia. Zmiany w repo nie trafiają automatycznie na produkcję — trzeba je wdrożyć ręcznie.

Jedyna celowa zmiana względem wersji wdrożonej to stała `SPREADSHEET_ID`, która tutaj ma wartość zastępczą `WSTAW_ID_ARKUSZA`. Prawdziwe ID arkusza wstawia właściciel przy wdrożeniu.

> **Uwaga — kodowanie.** Ta kopia powstała z wklejenia pliku i ma uszkodzone polskie znaki (np. `ZamÃ³wienia` zamiast `Zamówienia`). Wdrożony projekt Apps Script ma poprawne kodowanie. **Nie wdrażaj tej kopii verbatim** — do wdrożenia użyj wersji z poprawnymi znakami (live script albo po naprawie kodowania w osobnym PR). Szczegóły niżej.

## Jak wdrożyć zmianę ręcznie

1. Otwórz edytor Apps Script powiązany z arkuszem.
2. Wklej zawartość `Code.gs` (pamiętaj o prawdziwym `SPREADSHEET_ID`).
3. **Wdróż → Zarządzaj wdrożeniami → Nowa wersja**.
4. Zapisz nową wersję wdrożenia; adres `/exec` pozostaje bez zmian.

## Znane ryzyka (do osobnego PR)

Ta kopia jest wierna wersji wdrożonej, więc zawiera te same znane problemy. Nie poprawiamy ich w tym PR — każdy do osobnego zgłoszenia i osobnego wdrożenia GAS:

- `testWriteCennik()` zapisuje testowy klucz (`test-key`) w wierszu 2 arkusza `API_CENNIK` — uruchomiona na produkcji wstrzykuje śmieciowy wiersz do cennika.
- `setPin` bez ustawionego wcześniej PIN-u nie wymaga autoryzacji — pierwszy PIN może ustawić dowolna osoba z dostępem do endpointu.
- Pusty `catalog.save` (puste `prices`) czyści cały cennik w arkuszu.
- Uszkodzone kodowanie polskich znaków w całym pliku (artefakt transferu wklejania) — dotyczy komentarzy, komunikatu `getState`, a także **funkcjonalnych literałów**: nazw arkuszy (`ORDER_SHEET_NAME`, `CLICKS_SHEET_NAME`) i nagłówków kolumn. Wdrożenie tej kopii verbatim odwołałoby się do nieistniejących arkuszy. Wersja live ma poprawne znaki.
- `SPREADSHEET_ID` jest zaszyty w kodzie zamiast w Script Properties.

## Testy

Testy GAS wykonuj na **kopii arkusza**, nigdy na produkcji. Funkcje zapisujące (`catalog.save`, `testWriteCennik`, migawki) modyfikują dane arkusza nieodwracalnie.
