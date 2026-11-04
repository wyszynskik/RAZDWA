/**
 * Structured in-memory log for variant add/update/skip operations.
 * No DOM, no localStorage — safe to import in tests.
 */

export type VariantAction = "add" | "update" | "skip";

export interface VariantLogEntry {
  action: VariantAction;
  /** Empty string for skip-validation entries (key not yet determined). */
  key: string;
  categoryId: string;
  prefix: string;
  label: string;
  qty: string;
  price: number | null;
  timestamp: string;
}

const _log: VariantLogEntry[] = [];

export function logVariantOperation(entry: VariantLogEntry): void {
  _log.push(entry);
}

export function getVariantLog(): readonly VariantLogEntry[] {
  return _log;
}

export function clearVariantLog(): void {
  _log.length = 0;
}
