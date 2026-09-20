/**
 * Kontrola spójności "Suma (PLN)" vs "Cena za sztukę" × "Ilosc sztuk" dla
 * zamówienia wysyłanego do arkusza.
 *
 * To NIE jest przeliczenie z żywego cennika — sprawdza wyłącznie, czy liczby
 * w PRZESŁANYM payloadzie są ze sobą wewnętrznie spójne (łapie błąd klienta
 * lub zmanipulowany request), nie czy cena zgadza się z aktualnym cennikiem.
 *
 * Executable spec dla Code.gs (`_validateOrderPayload`) — ten plik nie jest
 * uruchamiany w Apps Script (Code.gs nie jest częścią tego repo), więc to
 * jedyny sposób pokrycia tej logiki testami jednostkowymi przed ręcznym
 * wklejeniem. Zmiana logiki w jednym miejscu bez zmiany drugiego musi zostać
 * wychwycona przy review jako niespójny diff dwóch plików obok siebie (ten
 * sam wzorzec co src/services/catalogSnapshot.ts).
 */

/**
 * `quantities`/`unitPrices` to już SPARSOWANE, zwalidowane liczby (Code.gs
 * parsuje je z pipe-delimited stringów "Ilosc sztuk"/"Cena za sztukę" PRZED
 * wywołaniem tej funkcji, w ramach istniejących kontroli ≥1/≥0 — ta funkcja
 * nie parsuje nic sama, żeby nie zdublować tamtej logiki i nie ryzykować
 * rozjazdu między dwoma niezależnymi parserami tego samego stringa).
 *
 * `adjustmentPercent`: dodatni = narzut, ujemny = rabat, 0 = brak (patrz
 * `payload.summary.adjustmentPercent` w orderExportService.ts — `surcharge% - discount%`).
 *
 * Fail-open (zwraca true = "spójne, nie blokuj") gdy tablice są puste albo
 * różnej długości — to sygnał anomalii W PARSOWANIU WCZEŚNIEJSZEGO KROKU
 * (który już powinien był to złapać), nie coś, co ta funkcja ma oceniać.
 * Blokowanie zamówienia z powodu wewnętrznej niespójności w INNYM kroku
 * byłoby gorszym błędem niż przepuszczenie go tutaj.
 */
export function isOrderSumConsistent(
  quantities: number[],
  unitPrices: number[],
  adjustmentPercent: number,
  claimedSum: number
): boolean {
  if (quantities.length === 0 || quantities.length !== unitPrices.length) return true;

  let rawSum = 0;
  for (let i = 0; i < quantities.length; i++) {
    rawSum += quantities[i] * unitPrices[i];
  }

  const expectedSum = rawSum * (1 + adjustmentPercent / 100);

  // Margines na zaokrąglenia, dwie składowe:
  // 1) 1 zł minimum LUB 2% oczekiwanej sumy (co więcej) — łapie realny
  //    błąd/manipulację niezależną od wolumenu.
  // 2) Precyzyjny epsilon na zaokrąglenie JEDNOSTKOWE: "Cena za sztukę" leci
  //    do GAS z dokładnością do grosza (toFixed(2)), więc każda pozycja może
  //    być przesunięta o maksymalnie 0.005 zł względem realnej ceny. Przy
  //    dużych ilościach (kategorie ilościowe: ulotki, wizytówki, dyplomy —
  //    tysiące sztuk) i niskiej cenie jednostkowej (typowe dla priceFormula/
  //    cen relatywnych) ten błąd kumuluje się i realnie przekracza 2% —
  //    zweryfikowane empirycznie (Q=10000, unitPrice≈0.095 zł, rabat 10% →
  //    różnica 44 zł przy tolerancji 16 zł bez tego członu). Bez tej składowej
  //    walidacja fałszywie odrzuca prawdziwe, poprawne zamówienia.
  let qtySum = 0;
  for (let i = 0; i < quantities.length; i++) {
    qtySum += quantities[i];
  }
  const unitRoundingMargin = Math.abs(0.005 * qtySum * (1 + adjustmentPercent / 100));
  const tolerance = Math.max(1, Math.abs(expectedSum) * 0.02) + unitRoundingMargin;

  return Math.abs(claimedSum - expectedSum) <= tolerance;
}
