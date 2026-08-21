import { CartItem, CustomerData } from "../core/types";
import type { VariantDefinition } from "./priceService";
import { normalizePhoneDigits } from "../core/customerValidation";
import { GAS_URL, APP_ENV } from "../core/env";
import { getAdminToken } from "../core/adminSession";

export const ORDER_EXPORT_CONFIG_KEY = "razdwa_order_export_config";

export interface OrderExportConfig {
  appsScriptUrl: string;
  timeoutMs: number;
  enabled: boolean;
  dryRun?: boolean;
}

const CURRENT_APPS_SCRIPT_URL = GAS_URL;

export function isValidGasUrl(url: unknown): boolean {
  const s = String(url ?? "").trim();
  return s.startsWith("https://script.google.com/") && s.endsWith("/exec");
}

export interface OrderExportPayload {
  source: "razdwa-web";
  createdAt: string;
  requestId?: string;
  customer: CustomerData & { notes?: string };
  summary: {
    itemsCount: number;
    total: number;
    hasExpress: boolean;
    adjustmentPercent?: number;
  };
  items: Array<{
    category: string;
    name: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    totalPrice: number;
    isExpress: boolean;
    optionsHint: string;
    payload: unknown;
  }>;
}

export interface OrderExportResult {
  ok: boolean;
  status?: number;
  message?: string;
  data?: unknown;
  verified?: boolean;
  /**
   * true wyłącznie w fallbacku no-cors: request wysłany, ale odpowiedź jest
   * opaque i NIE wiemy czy GAS faktycznie zapisał zamówienie. UI ma traktować
   * to jako "pending" — nie czyścić koszyka, pokazać osobny komunikat
   * z prośbą o weryfikację w arkuszu.
   */
  unverified?: boolean;
  orderId?: string | number;
  /**
   * true gdy GAS potwierdził odbiór requestu ale zapis jest jeszcze w toku
   * (stan 'pending' w PropertiesService). UI powinno poczekać ~30 s i ponowić
   * z tym samym requestId.
   */
  retryable?: boolean;
  errorType?: "timeout" | "network" | "no_cors_sent" | "gas_error" | "unknown";
  noToken?: boolean;
}

interface AppsScriptCompactRowPayload {
  Data: string;
  Godzina: string;
  Firma: string;
  "Kto dodał": string;
  Imię: string;
  Nazwisko: string;
  NIP: string;
  Telefon: string;
  Email: string;
  Materiał: string;
  "jedno/dwustronne": string;
  Produkt: string;
  "Ilosc sztuk": string;
  "Cena za sztukę": string;
  Uwagi: string;
  "Suma (PLN)": number;
  Priorytet: string;
  Ekspres: "TAK" | "NIE";
  RequestID: string;
}

type AppsScriptResponseBody = {
  ok?: boolean;
  message?: string;
  [key: string]: unknown;
};

if (!CURRENT_APPS_SCRIPT_URL) {
  console.error(
    "[orderExport] GOOGLE_APPS_SCRIPT_URL nie jest skonfigurowany — eksport zamówień wyłączony."
  );
}

const DEFAULT_CONFIG: OrderExportConfig = {
  appsScriptUrl: CURRENT_APPS_SCRIPT_URL,
  timeoutMs: 15000,
  enabled: !!CURRENT_APPS_SCRIPT_URL,
  dryRun: false,
};

function splitCustomerName(fullName: string): { firstName: string; lastName: string } {
  const normalized = String(fullName ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized) return { firstName: "", lastName: "" };

  const [firstName, ...rest] = normalized.split(" ");
  return {
    firstName: firstName ?? "",
    lastName: rest.join(" "),
  };
}

function stripQuantityPrefix(hint: string): string {
  // Usuwa np. "100 szt, " / "10.5 m2, " / "50 str., " z początku
  return hint
    .trim()
    .replace(/^\d[\d\s,.]*\s*(szt\.?|str\.?|m2?|mb)\s*[,;]?\s*/i, "")
    .trim();
}

function extractMaterialFromItem(item: OrderExportPayload["items"][number]): string {
  const hint = String(item.optionsHint ?? "").trim();
  return stripQuantityPrefix(hint) || String(item.name ?? "") || "-";
}

function extractFormatFromItem(item: OrderExportPayload["items"][number]): string {
  const payload = item.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    const val = String(p.format ?? "").trim();
    if (val) return val.toUpperCase();
  }

  const hint = String(item.optionsHint ?? "");
  const match = hint.match(/\b(A0\+?|A1\+?|A2|A3|A4|A5|A6|DL)\b/i);
  return match ? match[1].toUpperCase() : "";
}

function extractSidesFromItem(item: OrderExportPayload["items"][number]): string {
  const payload = item.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    const sidesRaw = String(p.sides ?? "").toLowerCase();
    if (sidesRaw.includes("dwu")) return "Dwustronne";
    if (sidesRaw.includes("jedno")) return "Jednostronne";
  }

  const hint = String(item.optionsHint ?? "").toLowerCase();
  if (hint.includes("dwustron")) return "Dwustronne";
  if (hint.includes("jednostron")) return "Jednostronne";
  return "";
}

function buildOrderExportProductLabel(item: OrderExportPayload["items"][number]): string {
  const category = String(item.category ?? "").trim();
  const name = String(item.name ?? "").trim();
  const format = extractFormatFromItem(item);

  if (/ulotk/i.test(category) || /ulotk/i.test(name)) {
    const base = "Ulotka";
    return [base, format].filter(Boolean).join(" ").trim();
  }

  return name || category || "Produkt";
}

function buildAppsScriptCompactRow(payload: OrderExportPayload): AppsScriptCompactRowPayload {
  const createdAt = payload.createdAt ? new Date(payload.createdAt) : new Date();
  const safeDate = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
  const { firstName, lastName } = splitCustomerName(payload.customer.name);

  const date = new Intl.DateTimeFormat("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(safeDate);

  const time = new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(safeDate);

  type ExportLine = {
    product: string;
    material: string;
    sides: string;
    quantity: number;
    unitPrice: number;
  };
  const grouped = new Map<string, ExportLine>();

  payload.items.forEach((item) => {
    const product = buildOrderExportProductLabel(item);
    const material = extractMaterialFromItem(item);
    const sides = extractSidesFromItem(item);
    const quantity = Math.max(0, Number(item.quantity || 0));
    const unitPrice = Number(item.unitPrice || 0);

    const key = `${product}|${material}|${unitPrice.toFixed(2)}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.quantity += quantity;
      return;
    }

    grouped.set(key, { product, material, sides, quantity, unitPrice });
  });

  const packedLines = Array.from(grouped.values());
  const totalSum = parseFloat(Number(payload.summary.total || 0).toFixed(2));

  const products = packedLines.map((line) => line.product).join(" | ");
  const materials = packedLines.map((line) => line.material).join(" | ");

  // jedno/dwustronne: unikalne, niepuste wartości
  const uniqueSides = [...new Set(packedLines.map((l) => l.sides).filter(Boolean))];
  const sidesStr = uniqueSides.join(", ");

  // Ilosc sztuk: wartości każdego produktu rozdzielone separatorem " | "
  const qtyStr = packedLines.map((l) => l.quantity).join(" | ");
  // Cena za sztukę: wartości każdego produktu rozdzielone separatorem " | "
  const unitPriceStr = packedLines.map((l) => l.unitPrice.toFixed(2)).join(" | ");

  const notes = String(payload.customer.notes ?? "").trim();
  const addedBy = String(payload.customer.addedBy ?? "").trim();

  return {
    Data: date,
    Godzina: time,
    Firma: String(payload.customer.company ?? ""),
    "Kto dodał": addedBy,
    Imię: firstName,
    Nazwisko: lastName,
    NIP: String(payload.customer.nip ?? ""),
    Telefon: normalizePhoneDigits(String(payload.customer.phone ?? "")),
    Email: String(payload.customer.email ?? ""),
    Materiał: materials,
    "jedno/dwustronne": sidesStr,
    Produkt: products,
    "Ilosc sztuk": qtyStr,
    "Cena za sztukę": unitPriceStr,
    Uwagi: notes,
    "Suma (PLN)": Number(totalSum),
    Priorytet: String(payload.customer.priority ?? ""),
    Ekspres: payload.summary.hasExpress ? "TAK" : "NIE",
    RequestID: payload.requestId ?? "",
  };
}

export function getOrderExportConfig(): OrderExportConfig {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CONFIG;
    const raw = localStorage.getItem(ORDER_EXPORT_CONFIG_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<OrderExportConfig>;
    const parsedUrl = String(parsed.appsScriptUrl ?? "").trim();
    // client: build-time URL zawsze wygrywa — override z localStorage zignorowany.
    // dev/staging: override akceptowany gdy poprawny; inaczej fallback do build-time.
    const migratedUrl =
      APP_ENV === "client" || !isValidGasUrl(parsedUrl) ? CURRENT_APPS_SCRIPT_URL : parsedUrl;

    return {
      appsScriptUrl: migratedUrl,
      timeoutMs: Number(parsed.timeoutMs) > 0 ? Number(parsed.timeoutMs) : DEFAULT_CONFIG.timeoutMs,
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_CONFIG.enabled,
      dryRun: typeof parsed.dryRun === "boolean" ? parsed.dryRun : false,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function setOrderExportConfig(config: Partial<OrderExportConfig>): OrderExportConfig {
  const current = getOrderExportConfig();
  const requestedUrl =
    config.appsScriptUrl !== undefined
      ? String(config.appsScriptUrl ?? "").trim()
      : current.appsScriptUrl;
  // Override URL akceptujemy tylko gdy poprawny; w innym wypadku trzymamy build-time / poprzedni.
  const nextUrl = isValidGasUrl(requestedUrl) ? requestedUrl : current.appsScriptUrl;
  if (config.appsScriptUrl !== undefined && requestedUrl && !isValidGasUrl(requestedUrl)) {
    console.error(
      `[orderExport] Odrzucono niepoprawny appsScriptUrl="${requestedUrl}" — wymagany https://script.google.com/.../exec.`
    );
  }

  const merged: OrderExportConfig = {
    ...current,
    ...config,
    appsScriptUrl: nextUrl,
  };

  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ORDER_EXPORT_CONFIG_KEY, JSON.stringify(merged));
    }
  } catch {
    // ignore storage errors
  }

  return merged;
}

export function buildOrderExportPayload(
  cartItems: CartItem[],
  customer: CustomerData & { notes?: string }
): OrderExportPayload {
  const itemsCount = cartItems.length;
  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);
  const hasExpress = cartItems.some((i) => !!i.isExpress);

  return {
    source: "razdwa-web",
    createdAt: new Date().toISOString(),
    customer,
    summary: {
      itemsCount,
      total,
      hasExpress,
    },
    items: cartItems.map((item) => ({
      category: item.category,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice,
      isExpress: !!item.isExpress,
      optionsHint: item.optionsHint,
      payload: item.payload,
    })),
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  input: string,
  init: RequestInit,
  retries = 1,
  baseDelayMs = 800
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(input, init);
    if (response.status < 500 || attempt === retries) return response;
    await sleep(baseDelayMs * (attempt + 1));
  }
  throw new Error("fetchWithRetry: unreachable");
}

async function readAppsScriptBody(response: Response): Promise<AppsScriptResponseBody | null> {
  try {
    const contentType = response.headers?.get?.("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("application/json")) {
      return (await response.json()) as AppsScriptResponseBody;
    }
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text) as AppsScriptResponseBody;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

function evaluateGasResult(
  body: AppsScriptResponseBody | null,
  httpStatus: number,
  httpOk: boolean,
  fallbackMessage: string
): OrderExportResult {
  const bodyMessage =
    body && typeof body === "object" && "message" in body ? String(body.message ?? "") : "";

  if (!httpOk) {
    return {
      ok: false,
      status: httpStatus,
      message: bodyMessage || fallbackMessage,
      data: body,
      verified: false,
      errorType: "gas_error",
    };
  }

  if (body && typeof body === "object" && "ok" in body) {
    if (body.ok === false) {
      const d = body as Record<string, unknown>;
      const retryable = d.retryable === true ? true : undefined;
      return {
        ok: false,
        status: httpStatus,
        message: bodyMessage || fallbackMessage,
        data: body,
        verified: true,
        retryable,
        errorType: "gas_error",
      };
    }
    if (body.ok === true) {
      const d = body as Record<string, unknown>;
      const rawId = d.orderId ?? d.orderNumber ?? d.rowNumber ?? d.id ?? d.numer ?? d.nr;
      const orderId =
        rawId != null ? (typeof rawId === "number" ? rawId : String(rawId)) : undefined;
      return {
        ok: true,
        status: httpStatus,
        message: bodyMessage || fallbackMessage,
        data: body,
        verified: true,
        orderId,
      };
    }
  }

  // HTTP 200 + brak parsowalnego body → najpewniej HTML błędu z catch po stronie GAS.
  // Nie udajemy sukcesu — koszyk nie powinien się wyczyścić.
  if (body === null) {
    return {
      ok: false,
      status: httpStatus,
      verified: false,
      message:
        "GAS odpowiedział nie-JSONem (prawdopodobnie HTML błędu z catch po stronie Apps Script).",
      data: null,
      errorType: "gas_error",
    };
  }
  // HTTP 200 + parsowalne body bez pola ok — wynik niezweryfikowany, NIE jest sukcesem
  return {
    ok: false,
    status: httpStatus,
    message:
      "GAS odpowiedział HTTP 200 bez pola 'ok' — zapis niezweryfikowany. Sprawdź arkusz Sheets.",
    data: body,
    verified: false,
    unverified: true,
    errorType: "gas_error",
  };
}

export async function sendOrderToAppsScript(
  payload: OrderExportPayload,
  config: OrderExportConfig = getOrderExportConfig()
): Promise<OrderExportResult> {
  if (!config.enabled) {
    return { ok: false, message: "Wysyłka do Apps Script jest wyłączona." };
  }

  if (!config.appsScriptUrl) {
    return { ok: false, message: "Brak URL Apps Script Web App." };
  }

  if (config.dryRun) {
    return { ok: true, verified: true, message: "dry-run: zamówienie nie zostało wysłane." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const compactPayload = buildAppsScriptCompactRow(payload);

  try {
    const response = await fetchWithRetry(
      config.appsScriptUrl,
      {
        method: "POST",
        mode: "cors",
        headers: {
          "Content-Type": "text/plain",
        },
        body: JSON.stringify(compactPayload),
        signal: controller.signal,
      },
      0
    );

    const responseBody = await readAppsScriptBody(response);
    return evaluateGasResult(
      responseBody,
      response.status,
      response.ok,
      "Zamówienie zapisane w arkuszu."
    );
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "";
    const errorMessage = err instanceof Error ? err.message : "";
    const normalizedError = `${errorName} ${errorMessage}`.toLowerCase();
    const isCorsOrNetworkFailure =
      errorName !== "AbortError" &&
      (normalizedError.includes("failed to fetch") ||
        normalizedError.includes("networkerror") ||
        normalizedError.includes("load failed"));

    if (isCorsOrNetworkFailure) {
      let noCorsAlsoFailed = false;
      try {
        await fetch(config.appsScriptUrl, {
          method: "POST",
          mode: "no-cors",
          headers: {
            "Content-Type": "text/plain",
          },
          body: JSON.stringify(compactPayload),
          signal: controller.signal,
        });

        return {
          ok: false,
          status: 0,
          verified: false,
          unverified: true,
          errorType: "no_cors_sent",
          message:
            "Wysłano bez potwierdzenia odpowiedzi (fallback no-cors). Sprawdź arkusz Sheets — jeśli zamówienia nie ma, wyślij ponownie.",
        };
      } catch {
        noCorsAlsoFailed = true;
      }

      if (noCorsAlsoFailed) {
        return {
          ok: false,
          verified: false,
          errorType: "network",
          message: "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.",
        };
      }
    }

    const isTimeout = err instanceof Error && err.name === "AbortError";
    const msg = isTimeout
      ? "Przekroczono limit czasu połączenia (15 s). Sprawdź internet i spróbuj ponownie."
      : `Nie udało się wysłać danych: ${(err as Error)?.message ?? "nieznany błąd"}. Sprawdź URL Web App i uprawnienia wdrożenia.`;

    return {
      ok: false,
      message: msg,
      verified: false,
      errorType: isTimeout ? "timeout" : "unknown",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function savePricesToAppsScript(
  prices: Record<string, number | null>,
  config: OrderExportConfig = getOrderExportConfig()
): Promise<OrderExportResult> {
  if (!config.enabled) {
    return { ok: false, message: "Wysyłka do Apps Script jest wyłączona." };
  }

  if (!config.appsScriptUrl) {
    return { ok: false, message: "Brak URL Apps Script Web App." };
  }

  if (config.dryRun) {
    return { ok: true, verified: true, message: "dry-run: cennik nie został wysłany." };
  }

  const token = getAdminToken();
  if (!token) {
    return {
      ok: false,
      noToken: true,
      message: "Brak tokenu sesji. Zaloguj się ponownie do panelu ustawień.",
    };
  }
  const body = JSON.stringify({
    type: "prices_update",
    token,
    prices,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchWithRetry(config.appsScriptUrl, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },
      body,
      signal: controller.signal,
    });

    const responseBody = await readAppsScriptBody(response);
    return evaluateGasResult(
      responseBody,
      response.status,
      response.ok,
      "Cennik wysłany do Apps Script."
    );
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "";
    const errorMessage = err instanceof Error ? err.message : "";
    const isCorsOrNetworkFailure =
      errorName !== "AbortError" &&
      (`${errorName} ${errorMessage}`.toLowerCase().includes("failed to fetch") ||
        `${errorName} ${errorMessage}`.toLowerCase().includes("networkerror") ||
        `${errorName} ${errorMessage}`.toLowerCase().includes("load failed"));

    if (isCorsOrNetworkFailure) {
      try {
        await fetch(config.appsScriptUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain" },
          body,
          signal: controller.signal,
        });
        return {
          ok: false,
          status: 0,
          verified: false,
          unverified: true,
          message:
            "Cennik wysłany bez potwierdzenia (CORS/sieć). Sprawdź arkusz Sheets — jeśli zmiany nie ma, wyślij ponownie.",
        };
      } catch {
        // continue to final error
      }
    }

    const msg =
      errorName === "AbortError"
        ? "Przekroczono limit czasu wysyłki cennika."
        : `Nie udało się wysłać cennika: ${(err as Error)?.message ?? "nieznany błąd"}.`;

    return { ok: false, message: msg, verified: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveVariantsToAppsScript(
  variants: VariantDefinition[],
  config: OrderExportConfig = getOrderExportConfig()
): Promise<OrderExportResult> {
  if (!config.enabled) {
    return { ok: false, message: "Wysyłka do Apps Script jest wyłączona." };
  }
  if (!config.appsScriptUrl) {
    return { ok: false, message: "Brak URL Apps Script Web App." };
  }

  if (config.dryRun) {
    return { ok: true, verified: true, message: "dry-run: warianty nie zostały wysłane." };
  }

  const token = getAdminToken();
  if (!token) {
    return {
      ok: false,
      noToken: true,
      message: "Brak tokenu sesji. Zaloguj się ponownie do panelu ustawień.",
    };
  }
  const body = JSON.stringify({ type: "variants_update", token, variants });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetchWithRetry(config.appsScriptUrl, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },
      body,
      signal: controller.signal,
    });

    const responseBody = await readAppsScriptBody(response);
    return evaluateGasResult(
      responseBody,
      response.status,
      response.ok,
      "Warianty wysłane do Apps Script."
    );
  } catch (err) {
    const errorName = err instanceof Error ? err.name : "";
    const errorMessage = err instanceof Error ? err.message : "";
    const isCorsOrNetworkFailure =
      errorName !== "AbortError" &&
      (`${errorName} ${errorMessage}`.toLowerCase().includes("failed to fetch") ||
        `${errorName} ${errorMessage}`.toLowerCase().includes("networkerror") ||
        `${errorName} ${errorMessage}`.toLowerCase().includes("load failed"));

    if (isCorsOrNetworkFailure) {
      try {
        await fetch(config.appsScriptUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "text/plain" },
          body,
          signal: controller.signal,
        });
        return {
          ok: false,
          status: 0,
          verified: false,
          unverified: true,
          errorType: "no_cors_sent",
          message:
            "Wysłano bez potwierdzenia odpowiedzi (fallback no-cors). Sprawdź arkusz Sheets — jeśli wariantów nie ma, wyślij ponownie.",
        };
      } catch {
        // continue
      }
    }

    const msg =
      errorName === "AbortError"
        ? "Przekroczono limit czasu wysyłki wariantów."
        : `Nie udało się wysłać wariantów: ${(err as Error)?.message ?? "nieznany błąd"}.`;

    return { ok: false, message: msg, verified: false };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchStateFromAppsScript(
  config: OrderExportConfig = getOrderExportConfig()
): Promise<{ prices: Record<string, number | null>; variants: VariantDefinition[] } | null> {
  if (!config.enabled || !config.appsScriptUrl) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const url = `${config.appsScriptUrl}?action=getState&t=${Date.now()}`;
    const response = await fetchWithRetry(url, {
      method: "GET",
      mode: "cors",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { prices?: unknown; variants?: unknown };

    const prices: Record<string, number | null> =
      data.prices && typeof data.prices === "object" && !Array.isArray(data.prices)
        ? (data.prices as Record<string, number | null>)
        : {};

    const variants: VariantDefinition[] = Array.isArray(data.variants)
      ? (data.variants as unknown[]).filter(
          (v): v is VariantDefinition =>
            !!v && typeof v === "object" && typeof (v as VariantDefinition).key === "string"
        )
      : [];

    return { prices, variants };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ── PIN ───────────────────────────────────────────────────────────────────────

export interface PinVerifyResult {
  ok: boolean;
  firstRun?: boolean;
  token?: string;
  error?: "wrong_pin" | "rate_limited" | "offline" | "server_error";
}

export interface PinSetResult {
  ok: boolean;
  error?: "wrong_current" | "invalid_pin" | "offline" | "server_error";
}

async function pinPost(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const config = getOrderExportConfig();
  if (!config.enabled || !config.appsScriptUrl) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(config.appsScriptUrl, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await readAppsScriptBody(response);
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

export async function verifyPinOnServer(pin?: string): Promise<PinVerifyResult> {
  const body: Record<string, unknown> = { action: "verifyPin" };
  if (pin && pin.length > 0) body.pin = pin;
  const data = await pinPost(body);
  if (!data) return { ok: false, error: "offline" };
  return data as unknown as PinVerifyResult;
}

export async function setPinOnServer(newPin: string, currentPin?: string): Promise<PinSetResult> {
  const body: Record<string, unknown> = { action: "setPin", newPin };
  if (currentPin) body.currentPin = currentPin;
  const data = await pinPost(body);
  if (!data) return { ok: false, error: "offline" };
  return data as unknown as PinSetResult;
}

export async function removePinOnServer(currentPin: string): Promise<PinSetResult> {
  const data = await pinPost({ action: "removePin", currentPin });
  if (!data) return { ok: false, error: "offline" };
  return data as unknown as PinSetResult;
}
