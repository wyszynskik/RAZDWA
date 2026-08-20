/**
 * Single centralized generator for every customer/admin-facing composite
 * product label — pure segment-joining, no data access. Callers resolve
 * whatever domain objects they hold (VariantDefinition, MaterialSizeOption,
 * RenderableProduct, ...) into plain strings before calling this.
 */

export type LabelContext = "admin" | "customer";

export interface ProductLabelParts {
  /** Only rendered in "admin" context — omitted in "customer" (see doc). */
  categoryLabel?: string;
  /** Only rendered in "admin" context — omitted in "customer" (see doc). */
  subgroupLabel?: string;
  /**
   * The product's own distinct name, when subgroup + material/size + qty
   * alone would NOT uniquely identify it — e.g. two independently named
   * flat-per-unit products sharing one subgroup. Omitted when the subgroup
   * label already fully names the product (the common case, e.g. an
   * interpolated quantity ladder — see productModel.ts calcType doc).
   */
  variantLabel?: string;
  material?: string;
  size?: string;
  /** Reserved for future use (e.g. "jednostronny") — empty today, always omitted. */
  extraParams?: string[];
  /** Precomputed by the caller, e.g. "10–100 szt." */
  qtyRangeLabel?: string;
}

/**
 * Builds one composite label from whichever parts are present, in a fixed
 * attribute order, joined by " — ", never leaving a double separator when a
 * segment is empty:
 *   Kategoria — Podgrupa — Nazwa wariantu — Materiał/Papier — Rozmiar — Parametry — Zakres ilości
 *
 * context "admin": every segment above is eligible — full, unambiguous
 * label regardless of surrounding layout.
 *
 * context "customer": categoryLabel/subgroupLabel are dropped even when
 * supplied — the customer already sees the category page and the
 * subgroup's own heading, so repeating them in every product card would
 * duplicate what's already on screen.
 *
 * Missing/blank segments (undefined, "", whitespace-only, or an empty
 * extraParams array) are skipped entirely. Works unchanged for historical
 * data that has no material/size/qty range at all.
 */
export function buildProductLabel(
  parts: ProductLabelParts,
  context: LabelContext
): string {
  const segments: string[] = [];

  if (context === "admin") {
    pushIfNotBlank(segments, parts.categoryLabel);
    pushIfNotBlank(segments, parts.subgroupLabel);
  }

  pushIfNotBlank(segments, parts.variantLabel);
  pushIfNotBlank(segments, parts.material);
  pushIfNotBlank(segments, parts.size);

  for (const param of parts.extraParams ?? []) {
    pushIfNotBlank(segments, param);
  }

  pushIfNotBlank(segments, parts.qtyRangeLabel);

  return segments.join(" — ");
}

function pushIfNotBlank(segments: string[], value: string | undefined): void {
  const trimmed = (value ?? "").trim();
  if (trimmed) segments.push(trimmed);
}
