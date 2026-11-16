import { resolveStoredPrice } from "./compat";
import { applySurcharges } from "./dynamicSurcharges";

export const SATYNA_RATE_KEY = "modifier-satyna";
export const SATYNA_RATE_DEFAULT = 0.12;
export const EXPRESS_RATE_KEY = "modifier-express";
export const EXPRESS_RATE_DEFAULT = 0.2;

export interface SatynaPriceParams {
  base: number;
  isSatin: boolean;
  categoryId: string;
  checkedSurchargeIds: string[];
  express: boolean;
}

export interface SatynaPriceResult {
  total: number;
  satynaRate: number;
  expressRate: number;
}

/**
 * Kanoniczna kolejność naliczania (zatwierdzona, D-105): baza z papierem
 * (satyna) → dopłaty globalne → EXPRESS najbardziej zewnętrznie.
 *
 * Stawka satyny czytana jest ze wspólnego klucza "modifier-satyna" (domyślnie
 * 0.12), tak jak robią to dyplomy i vouchery — koniec z zaszytym na stałe
 * mnożnikiem 1.12 w widokach ulotek i wizytówek.
 *
 * Wszystkie trzy człony to mnożniki procentowe, więc przy domyślnej stawce 0.12
 * i bez express/dopłat wynik jest identyczny jak przed refaktorem. Różnica
 * ujawnia się tylko przy stawce ≠ 0.12 albo gdy express/dopłata jest aktywna
 * (zmienia się punkt zaokrąglenia oraz podstawa, do której liczony jest
 * express) — to zamierzone.
 */
export function finalizeSatynaPrice(params: SatynaPriceParams): SatynaPriceResult {
  const satynaRate = resolveStoredPrice(SATYNA_RATE_KEY, SATYNA_RATE_DEFAULT);
  const expressRate = resolveStoredPrice(EXPRESS_RATE_KEY, EXPRESS_RATE_DEFAULT);

  let price = params.base;
  if (params.isSatin) price = price * (1 + satynaRate);
  price = applySurcharges(params.categoryId, price, params.checkedSurchargeIds);
  if (params.express) price = price * (1 + expressRate);

  return {
    total: parseFloat(price.toFixed(2)),
    satynaRate,
    expressRate,
  };
}
