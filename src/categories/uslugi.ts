import { CategoryModule } from "../ui/router";
import { getDefaultPricesMap, getStoredPriceLabel } from "../core/compat";
import { resolveStoredPrice } from "../core/compat";
import { getPriceSubgroups } from "../services/priceService";
import uslugiData from "../../data/normalized/uslugi.json";

const uslugiCategoryData: any = uslugiData as any;
export const CUSTOM_SERVICE_PREFIX = "uslugi-";
export const BASE_SERVICE_IDS = new Set<string>(
  (uslugiCategoryData.categories ?? []).flatMap((category: any) =>
    (category.items ?? []).map((item: any) => item.id)
  )
);
const BASE_SERVICE_IDS_NORMALIZED = new Set<string>(
  [...BASE_SERVICE_IDS].map((id) => normalizeServiceToken(id))
);

type RenderedServiceItem = {
  id: string;
  name: string;
  price: number | null;
  isCustom?: boolean;
  note?: string;
  priceMin?: number;
};

type RenderedServiceCategory = {
  name: string;
  items: RenderedServiceItem[];
};

function repairMojibake(value: string): string {
  const withCommonFixes = String(value ?? "")
    .replace(/Ä…/g, "ą")
    .replace(/Ä‡/g, "ć")
    .replace(/Ä™/g, "ę")
    .replace(/Å‚/g, "ł")
    .replace(/Å„/g, "ń")
    .replace(/Ã³/g, "ó")
    .replace(/Å›/g, "ś")
    .replace(/Åº/g, "ź")
    .replace(/Å¼/g, "ż")
    .replace(/Ĺ‚/g, "ł")
    .replace(/Ĺ„/g, "ń")
    .replace(/Ĺ›/g, "ś")
    .replace(/Ĺş/g, "ź")
    .replace(/ĹĽ/g, "ż");

  try {
    return decodeURIComponent(escape(withCommonFixes));
  } catch {
    return withCommonFixes;
  }
}

function normalizeServiceToken(value: string): string {
  return repairMojibake(String(value ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

function findEquivalentStoredServiceKey(
  serviceId: string,
  storedPrices: Record<string, number | null>
): string | null {
  const directKey = `${CUSTOM_SERVICE_PREFIX}${serviceId}`;
  if (typeof storedPrices[directKey] === "number") return directKey;

  const target = normalizeServiceToken(serviceId);
  for (const [key, value] of Object.entries(storedPrices)) {
    if (!key.startsWith(CUSTOM_SERVICE_PREFIX) || typeof value !== "number") continue;
    const candidateId = key.slice(CUSTOM_SERVICE_PREFIX.length);
    if (normalizeServiceToken(candidateId) === target) return key;
  }

  return null;
}

function resolveServicePrice(serviceId: string, defaultValue: number): number {
  const storedPrices = getDefaultPricesMap();
  const canonicalKey = `${CUSTOM_SERVICE_PREFIX}${serviceId}`;

  if (typeof storedPrices[canonicalKey] === "number") {
    return resolveStoredPrice(canonicalKey, defaultValue);
  }

  const aliasKey = findEquivalentStoredServiceKey(serviceId, storedPrices);
  if (aliasKey && typeof storedPrices[aliasKey] === "number") {
    return Number(storedPrices[aliasKey]);
  }

  return resolveStoredPrice(canonicalKey, defaultValue);
}

function getMatchingServiceGroupTitle(key: string): string | null {
  const subgroupMap = getPriceSubgroups()["uslugi"] ?? Object.create(null);
  const matches = Object.entries(subgroupMap)
    .filter(([prefix]) => key.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length);

  return matches[0]?.[1] ?? null;
}

function getCustomServiceCategories(): RenderedServiceCategory[] {
  const storedPrices = getDefaultPricesMap();
  const groups = new Map<string, RenderedServiceItem[]>();
  const groupOrder: string[] = [];
  const seenNormalizedCustomIds = new Set<string>();

  for (const [key, value] of Object.entries(storedPrices)) {
    if (!key.startsWith(CUSTOM_SERVICE_PREFIX)) continue;
    const serviceId = key.slice(CUSTOM_SERVICE_PREFIX.length);
    if (!serviceId || BASE_SERVICE_IDS.has(serviceId)) continue;
    const normalizedServiceId = normalizeServiceToken(serviceId);

    // Hide duplicated entries added with mojibake/variant keys when they map
    // to existing base services (e.g. "uslugi-pakiet-zÅ‚oÅ¼ony").
    if (BASE_SERVICE_IDS_NORMALIZED.has(normalizedServiceId)) continue;
    if (seenNormalizedCustomIds.has(normalizedServiceId)) continue;
    seenNormalizedCustomIds.add(normalizedServiceId);

    const groupTitle = getMatchingServiceGroupTitle(key) ?? "DODANE RĘCZNIE";
    if (!groups.has(groupTitle)) {
      groups.set(groupTitle, []);
      groupOrder.push(groupTitle);
    }

    groups.get(groupTitle)!.push({
      id: serviceId,
      name: getStoredPriceLabel(key),
      price: typeof value === "number" ? value : null,
      isCustom: true,
    });
  }

  return groupOrder.map((name) => ({
    name,
    items: groups.get(name) ?? [],
  }));
}

export function getRenderedUslugiCategories(): RenderedServiceCategory[] {
  return [
    ...(uslugiCategoryData.categories ?? []).map((category: any) => ({
      name: category.name,
      items: (category.items ?? []).map((service: any) => ({
        id: service.id,
        name: service.name,
        price: resolveServicePrice(service.id, service.price || service.priceMin || 0),
        note: service.note,
        priceMin: service.priceMin,
      })),
    })),
    ...getCustomServiceCategories(),
  ];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderServiceItem(service: RenderedServiceItem, isTimeBased: boolean): string {
  const servicePrice = typeof service.price === "number" ? service.price : 0;
  const priceDisplay = typeof service.price === "number" ? `${servicePrice.toFixed(2)} zł` : "—";
  const priceTextColor = typeof service.price === "number" ? "#0066cc" : "#9aa7b2";
  const addDisabled = !(typeof service.price === "number" && service.price > 0);

  return `
    <div>
      <div style="display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; column-gap: 6px; padding: 5px 8px; background-color: #ffffff; border: 1px solid #e7edf5; border-radius: 6px;">
        <label style="cursor: pointer; margin: 0; font-size: 0.93em; line-height: 1.2;">${escapeHtml(service.name)}${isTimeBased ? ' <span style="font-size:0.78em; color:#e07b00; font-weight:600;">(czas)</span>' : ""}</label>
        <div style="display:flex; flex-direction:column; align-items:center; gap:2px;">
          <span style="font-size:0.7em; color:#7a8a9a;">ilość szt.</span>
          <input type="number" data-qty-for="${service.id}" value="1" min="1" max="99" style="width: 48px; padding: 4px; font-size: 0.9em;" class="service-quantity" aria-label="Ilość sztuk">
        </div>
        ${isTimeBased ? `<div style="display:flex; flex-direction:column; align-items:center; gap:2px; width:96px;"><span style="font-size:0.7em; color:#e07b00; font-weight:700;">⏱ wpisz czas (godz.)</span><input type="number" data-hours-for="${service.id}" value="1" min="0.25" step="0.25" max="24" placeholder="np. 1.5" title="Wpisz czas pracy w godzinach" style="width:100%; padding: 4px; font-size: 0.9em;" class="service-hours" aria-label="Wpisz czas pracy w godzinach"><span style="font-size:0.66em; color:#8b97a3;">np. 0.5, 1, 1.5</span></div>` : '<span style="width: 96px;"></span>'}
        <span class="service-price" data-service-id="${service.id}" data-base-price="${servicePrice}" data-has-price="${typeof service.price === "number" ? "1" : "0"}" style="font-weight: bold; color: ${priceTextColor}; min-width: 64px; text-align: right; font-size: 0.9em;">${priceDisplay}</span>
        <button type="button" data-add-service-id="${service.id}" data-service-name="${escapeHtml(service.name)}" data-price="${servicePrice}" class="btn btn-success service-add-btn add-pill-btn" aria-label="Dodaj usługę ${escapeHtml(service.name)} do koszyka" ${addDisabled ? "disabled" : ""}>+</button>
      </div>
      ${addDisabled ? '<small style="display:block; margin-top:3px; padding-left:4px; font-size:0.78em; color:#9aa7b2;">Brak ceny — wycena indywidualna.</small>' : ""}
    </div>
  `;
}

export interface UslugiOptions {
  selectedServices: Array<{
    serviceId: string;
    serviceName: string;
    price: number;
    quantity?: number;
    hours?: number;
  }>;
}

export function quoteUslugi(options: UslugiOptions): any {
  let totalPrice = 0;

  for (const service of options.selectedServices) {
    const price = resolveServicePrice(service.serviceId, service.price);
    const qty = service.quantity || 1;
    const hours = service.hours || 1;
    totalPrice += price * qty * hours;
  }

  return {
    servicesCount: options.selectedServices.length,
    totalPrice: parseFloat(totalPrice.toFixed(2)),
  };
}

let _uslugiCleanup: (() => void) | null = null;

export const uslugiCategory: CategoryModule = {
  id: "uslugi",
  name: "🛠️ Usługi",
  unmount() {
    _uslugiCleanup?.();
    _uslugiCleanup = null;
  },
  mount: (container, ctx) => {
    _uslugiCleanup?.();
    const isTimeBasedService = (serviceId: string): boolean => {
      return serviceId === "formatowanie" || serviceId === "poprawki-graficzne";
    };

    const getTimeBasedHint = (serviceName: string): string => {
      return `${serviceName}: podaj czas pracy w godzinach (rozliczenie godzinowe).`;
    };

    container.innerHTML = `
      <div class="category-form">
        <h2>Usługi Dodatkowe</h2>
        <p style="color: #999; margin-bottom: 10px; font-size: 0.92em;">
          Formatowanie, grafika, archiwizacja, obróbka plików.
        </p>

        <div style="margin-bottom: 10px;">
          <input
            id="uslugi-search"
            type="search"
            placeholder="Szukaj usługi..."
            autocomplete="off"
            style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:0.9em;border:1px solid #d0d7e2;border-radius:6px;background:#fff;"
          >
        </div>

        <div id="services-list" style="margin-bottom: 14px;"></div>
      </div>
    `;

    const servicesList = container.querySelector("#services-list") as HTMLElement;
    const searchInput = container.querySelector("#uslugi-search") as HTMLInputElement;
    let searchQuery = "";

    const renderServices = () => {
      servicesList.innerHTML = "";

      const q = searchQuery.trim().toLowerCase();
      const renderedCategories = getRenderedUslugiCategories();

      for (const category of renderedCategories) {
        const filteredItems = q
          ? category.items.filter((s) => s.name.toLowerCase().includes(q))
          : category.items;

        if (!filteredItems.length) continue;

        const categoryDiv = document.createElement("div");
        categoryDiv.style.marginBottom = "8px";
        categoryDiv.style.padding = "8px";
        categoryDiv.style.backgroundColor = "#f7f9fb";
        categoryDiv.style.border = "1px solid #e3e8ef";
        categoryDiv.style.borderRadius = "8px";
        categoryDiv.innerHTML = `<h3 style="color: #2d3a4a; margin: 0 0 6px 0; font-size: 0.95rem;">${escapeHtml(category.name)}</h3>`;

        const servicesDiv = document.createElement("div");
        servicesDiv.style.display = "grid";
        servicesDiv.style.gap = "6px";

        for (const service of filteredItems) {
          const isTimeBased = isTimeBasedService(service.id);
          const serviceDiv = document.createElement("div");
          serviceDiv.innerHTML = renderServiceItem(service, isTimeBased);
          servicesDiv.appendChild(serviceDiv.firstElementChild as HTMLElement);

          if (isTimeBased) {
            const noteDiv = document.createElement("div");
            noteDiv.style.cssText =
              "font-size:0.78em; color:#7a8a9a; padding:2px 8px 4px 12px; font-style:italic;";
            const noteParts = [getTimeBasedHint(service.name)];
            if (service.note) noteParts.push(service.note);
            noteDiv.innerHTML = `ℹ️ ${escapeHtml(noteParts.join(" "))}`;
            servicesDiv.appendChild(noteDiv);
          }
        }

        categoryDiv.appendChild(servicesDiv);
        servicesList.appendChild(categoryDiv);
      }

      if (q && !servicesList.children.length) {
        servicesList.innerHTML = `<p style="color:#999;font-size:0.9em;padding:8px 0;">Brak wyników dla „${escapeHtml(q)}"</p>`;
      }
    };

    renderServices();

    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      renderServices();
    });

    ctx?.on?.("prices-updated", () => {
      renderServices();
    });

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const addButton = target?.closest(".service-add-btn") as HTMLButtonElement | null;
      if (!addButton) return;

      const serviceId = addButton.getAttribute("data-add-service-id") || "";
      const serviceName = addButton.getAttribute("data-service-name") || "";
      const price = parseFloat(addButton.getAttribute("data-price") || "0");
      const qtyInput = container.querySelector(
        `input[data-qty-for="${serviceId}"]`
      ) as HTMLInputElement | null;
      const hoursInput = container.querySelector(
        `input[data-hours-for="${serviceId}"]`
      ) as HTMLInputElement | null;

      const quantity = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);
      const hours = Math.max(0.25, parseFloat((hoursInput?.value || "1").replace(",", ".")) || 1);

      const selectedService = {
        serviceId,
        serviceName,
        price,
        quantity,
        hours,
      };

      const result = quoteUslugi({ selectedServices: [selectedService] });

      ctx.updateLastCalculated(result.totalPrice, `Usługi - ${serviceName}`);
      ctx?.emit?.("price-calculated", {
        categoryId: "uslugi",
        totalPrice: result.totalPrice,
        details: result,
      });

      ctx.addToBasket({
        category: "Usługi",
        price: result.totalPrice,
        description:
          hours !== 1 ? `${serviceName} × ${quantity} (${hours}h)` : `${serviceName} × ${quantity}`,
      });

      if (qtyInput) qtyInput.value = "1";
      if (hoursInput) hoursInput.value = "1";
    };

    container.addEventListener("click", handleClick);
    _uslugiCleanup = () => container.removeEventListener("click", handleClick);
  },
};
