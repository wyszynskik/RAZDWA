/**
 * Jednolity wzorzec etykiet i nagłówków wizytówek — jedno źródło prawdy dla
 * panelu Ustawień (wiersze cen + nagłówki podgrup), legend kalkulatora i opisu
 * pozycji w koszyku. Wszystkie grupy (standard / foliowane / Soft touch) mają
 * tę samą kolejność członów, tę samą interpunkcję i ten sam styl, żeby klientka
 * nie widziała raz „z laminatem mat/błysk", raz „SoftTouch". Kolejne kategorie
 * mogą sięgnąć po te same funkcje zamiast powielać formatowanie u siebie.
 */

export type WizytowkiFolia = "none" | "matt_gloss" | "softtouch";

/** Nazwa typu widoczna dla klientki. „Soft touch" pisany ze spacją (D-104). */
export const WIZYTOWKI_TYPE_LABEL: Record<WizytowkiFolia, string> = {
  none: "standard",
  matt_gloss: "foliowane",
  softtouch: "Soft touch",
};

export interface WizytowkiKeyParts {
  size: string;
  folia: WizytowkiFolia;
  qty: number;
}

/** Kształt natywnego klucza wizytówek: format × laminat × ilość. */
const NATIVE_KEY_RE = /^wizytowki-(85x55|90x50)-(none|matt_gloss|softtouch)-(\d+)szt$/;

/** Rozmiar z klucza ("85x55") na postać wyświetlaną ("85×55 mm"). */
export function formatWizytowkiSize(size: string): string {
  return `${size.replace("x", "×")} mm`;
}

/**
 * Czy klucz to natywna pozycja wizytówek (jeden z 6 kształtów format×laminat).
 * Freeform klucze custom-podgrup klientki (np. własny wariant Soft touch z
 * nietypowym rozmiarem) NIE pasują i są świadomie pomijane przez ten regex.
 */
export function isWizytowkiNativeKey(key: string): boolean {
  return NATIVE_KEY_RE.test(key);
}

/** Rozbija natywny klucz na części; null dla kluczy custom/freeform. */
export function parseWizytowkiNativeKey(key: string): WizytowkiKeyParts | null {
  const m = key.match(NATIVE_KEY_RE);
  if (!m) return null;
  return { size: m[1], folia: m[2] as WizytowkiFolia, qty: Number.parseInt(m[3], 10) };
}

/** Nagłówek grupy: „Wizytówki {typ} {rozmiar}". */
export function formatWizytowkiGroupLabel(size: string, folia: WizytowkiFolia): string {
  return `Wizytówki ${WIZYTOWKI_TYPE_LABEL[folia]} ${formatWizytowkiSize(size)}`;
}

/** Etykieta pozycji: „Wizytówki {typ} {rozmiar} – {ilość} szt." */
export function formatWizytowkiItemLabel(size: string, folia: WizytowkiFolia, qty: number): string {
  return `${formatWizytowkiGroupLabel(size, folia)} – ${qty} szt.`;
}

/** Nagłówek grupy prosto z klucza; null dla kluczy custom/freeform. */
export function wizytowkiGroupLabelFromKey(key: string): string | null {
  const parts = parseWizytowkiNativeKey(key);
  return parts ? formatWizytowkiGroupLabel(parts.size, parts.folia) : null;
}

/** Etykieta pozycji prosto z klucza; null dla kluczy custom/freeform. */
export function wizytowkiItemLabelFromKey(key: string): string | null {
  const parts = parseWizytowkiNativeKey(key);
  return parts ? formatWizytowkiItemLabel(parts.size, parts.folia, parts.qty) : null;
}
