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

  // Margines na zaokrąglenia: każda pozycja jest przesyłana z dokładnością do
  // grosza ("Cena za sztukę" toFixed(2)), więc przy wielu pozycjach błędy się
  // kumulują. 1 zł minimum LUB 2% oczekiwanej sumy (co więcej) — dostatecznie
  // ciasne, żeby złapać realny błąd/manipulację, dostatecznie luźne, żeby nie
  // odrzucać prawdziwych zamówień przez zaokrąglenia.
  const tolerance = Math.max(1, Math.abs(expectedSum) * 0.02);

  return Math.abs(claimedSum - expectedSum) <= tolerance;
}
