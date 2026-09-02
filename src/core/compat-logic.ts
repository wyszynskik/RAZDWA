import {
  PRICE,
  CAD_PRICE,
  CAD_BASE,
  FORMAT_TOLERANCE_MM,
  FOLD_PRICE,
  WF_SCAN_PRICE_PER_CM,
  BIZ,
  pickTier,
  resolveStoredPrice,
  money,
  mergeStoredQuantityTable,
} from "./compat";

/** Returns a storage-range suffix: "1-5" or "5000+" (sentinel to > 50000). */
function tierRange(from: number, to: number): string {
  return to > 50000 ? `${from}+` : `${from}-${to}`;
}

/**
 * Resolves price: stored value wins over hard-coded default.
 * Delegates to resolveStoredPrice so IDB-cached overrides (the primary
 * storage since the price-cache migration) are honored, not just the
 * legacy localStorage fallback.
 */
function storedPrice(key: string, defaultUnit: number): number {
  return resolveStoredPrice(key, defaultUnit);
}

/** A4/A3 Print calculation logic */
export function calculateSimplePrint(options: {
  mode: "bw" | "color";
  format: "A4" | "A3";
  pages: number;
  email: boolean;
  ink25: boolean;
  ink25Qty: number;
}) {
  if (options.pages <= 0) {
    return {
      unitPrice: 0,
      printTotal: 0,
      emailTotal: options.email ? PRICE.email_price : 0,
      inkTotal: 0,
      grandTotal: options.email ? PRICE.email_price : 0,
    };
  }
  const tiers = (PRICE.print as any)[options.mode][options.format];
  const tier = pickTier(tiers, options.pages);
  if (!tier) throw new Error("Brak progu cenowego dla druku.");

  // Map to storage key: druk-{bw|kolor}-{a4|a3}-{range}
  const modeKey = options.mode === "bw" ? "bw" : "kolor";
  const fmtKey = options.format.toLowerCase();
  const printStorageKey = `druk-${modeKey}-${fmtKey}-${tierRange(tier.from, tier.to)}`;
  const unitPrice = storedPrice(printStorageKey, tier.unit);
  const surchargeFactor = storedPrice("modifier-druk-zadruk25", 0.5);

  const requestedSurchargeQty = Number.isFinite(options.ink25Qty)
    ? Math.max(0, options.ink25Qty)
    : 0;
  const surchargeQty = options.ink25 ? Math.min(options.pages, requestedSurchargeQty) : 0;
  const normalQty = Math.max(0, options.pages - surchargeQty);

  const surchargeUnitPrice = unitPrice * (1 + surchargeFactor);
  const normalTotal = normalQty * unitPrice;
  const surchargePagesTotal = surchargeQty * surchargeUnitPrice;
  const total = normalTotal + surchargePagesTotal;

  let emailItemTotal = 0;
  if (options.email) {
    emailItemTotal = storedPrice("druk-email", PRICE.email_price);
  }

  let inkItemTotal = 0;
  if (options.ink25) {
    inkItemTotal = surchargeQty * (surchargeUnitPrice - unitPrice);
  }

  return {
    unitPrice,
    printTotal: total,
    emailTotal: emailItemTotal,
    inkTotal: inkItemTotal,
    grandTotal: total + emailItemTotal,
  };
}

/** A4/A3 Scan calculation logic */
export function calculateSimpleScan(options: { type: "auto" | "manual"; pages: number }) {
  if (options.pages <= 0) return { unitPrice: 0, total: 0 };
  const tiers = (PRICE.scan as any)[options.type];
  const tier = pickTier(tiers, options.pages);
  if (!tier) throw new Error("Brak progu cenowego dla skanowania.");

  // Map to storage key: skan-{auto|reczne}-{range}
  const scanTypeKey = options.type === "auto" ? "auto" : "reczne";
  const scanStorageKey = `skan-${scanTypeKey}-${tierRange(tier.from, tier.to)}`;
  const unitPrice = storedPrice(scanStorageKey, tier.unit);
  return {
    unitPrice,
    total: options.pages * unitPrice,
  };
}

/** CAD calculation logic */
export function calculateCad(options: {
  mode: "bw" | "color";
  format: string;
  lengthMm: number;
  qty: number;
}) {
  const base = CAD_BASE[options.format];
  if (!base) throw new Error("Nieznany format CAD.");

  const isFormatowe = Math.abs(options.lengthMm - base.l) <= FORMAT_TOLERANCE_MM;
  const detectedType = isFormatowe ? "formatowe" : "mb";

  const rate = CAD_PRICE[options.mode][detectedType][options.format];
  if (rate == null) throw new Error("Brak stawki w cenniku dla CAD.");

  // Map to storage key: druk-cad-{bw|kolor}-{fmt|mb}-{format}
  const cadModeKey = options.mode === "bw" ? "bw" : "kolor";
  const cadTypeKey = detectedType === "formatowe" ? "fmt" : "mb";
  const cadFmtKey = options.format
    .toLowerCase()
    .replace("0p", "0plus")
    .replace("1p", "1plus")
    .replace("r1067", "mb1067");
  const cadStorageKey = `druk-cad-${cadModeKey}-${cadTypeKey}-${cadFmtKey}`;
  const resolvedRate = storedPrice(cadStorageKey, rate);

  let total = 0;
  if (detectedType === "formatowe") {
    total = options.qty * resolvedRate;
  } else {
    const meters = options.lengthMm / 1000;
    total = options.qty * meters * resolvedRate;
  }

  return {
    detectedType,
    rate: resolvedRate,
    total: parseFloat(money(total)),
  };
}

/** Mapping from format key to defaultPrices storage key for folding. */
const FOLD_STORAGE_KEY: Record<string, string> = {
  A0p: "cad-fold-a0plus",
  A0: "cad-fold-a0",
  A1p: "cad-fold-a1plus",
  A1: "cad-fold-a1",
  A2: "cad-fold-a2",
  A3: "cad-fold-a3",
  A3L: "cad-fold-a3l",
};

/** CAD Folding logic */
export function calculateCadFold(options: { format: string; qty: number }) {
  const defaultUnit = FOLD_PRICE[options.format];
  if (defaultUnit == null) throw new Error("Brak stawki składania.");
  const storageKey = FOLD_STORAGE_KEY[options.format];
  const unit = storageKey ? resolveStoredPrice(storageKey, defaultUnit) : defaultUnit;
  return {
    unit,
    total: Math.round(options.qty * unit * 100) / 100,
  };
}

/** WF Scan logic */
export function calculateWfScan(options: { lengthMm: number; qty: number }) {
  const cmRounded = Math.round(options.lengthMm / 10);
  const unitPrice = cmRounded * WF_SCAN_PRICE_PER_CM;
  return {
    cmRounded,
    unitPrice,
    total: Math.round(options.qty * unitPrice * 100) / 100,
  };
}

/** Business Cards logic */
export function calculateBusinessCards(options: {
  family: "standard" | "deluxe";
  finish?: "mat" | "blysk" | "softtouch";
  size?: "85x55" | "90x50";
  lam?: "noLam" | "lam";
  deluxeOpt?: "uv3d_softtouch" | "uv3d_gold_softtouch";
  qty: number;
}) {
  let table: any;
  if (options.family === "deluxe") {
    if (!options.deluxeOpt) {
      throw new Error("Wybierz opcję dla wizytówek DELUXE");
    }
    const optObj = BIZ?.cyfrowe?.deluxe?.options?.[options.deluxeOpt];
    if (!optObj) {
      throw new Error("Błąd: brak danych cenowych dla wybranej opcji DELUXE");
    }
    table = optObj.prices;
  } else {
    const tablesByFinish =
      options.finish === "softtouch" ? BIZ?.cyfrowe?.softtouchPrices : BIZ?.cyfrowe?.standardPrices;
    if (!tablesByFinish || !options.size || !options.lam) {
      throw new Error("Błąd: brak danych cenowych dla wybranej konfiguracji");
    }
    table = tablesByFinish[options.size]?.[options.lam];
  }

  if (!table) {
    throw new Error("Błąd: brak tabeli cenowej");
  }

  if (options.family !== "deluxe" && options.size) {
    const foliaKey = options.lam === "noLam" ? "none" : "matt_gloss";
    const storagePrefix = `wizytowki-${options.size}-${foliaKey}-`;
    table = mergeStoredQuantityTable(storagePrefix, table, (key) => {
      const match = key.match(/^(?:.*-)?(\d+)szt$/i);
      return match ? Number.parseInt(match[1], 10) : null;
    });
  }

  const keys = Object.keys(table)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!keys.length) throw new Error("Brak progu cenowego dla takiej ilości.");

  const qty = options.qty;

  if (qty <= keys[0]) {
    return { qtyBilled: keys[0], total: Number(table[keys[0]]) };
  }

  const lastKey = keys[keys.length - 1];

  if (qty >= lastKey) {
    const lastPrice = Number(table[lastKey]);
    return { qtyBilled: qty, total: Math.round(qty * (lastPrice / lastKey) * 100) / 100 };
  }

  for (let i = 0; i < keys.length - 1; i++) {
    const lo = keys[i],
      hi = keys[i + 1];
    if (qty <= hi) {
      const loPrice = Number(table[lo]);
      const hiPrice = Number(table[hi]);
      const t = (qty - lo) / (hi - lo);
      return { qtyBilled: qty, total: Math.round((loPrice + t * (hiPrice - loPrice)) * 100) / 100 };
    }
  }

  return { qtyBilled: lastKey, total: Number(table[lastKey]) };
}
