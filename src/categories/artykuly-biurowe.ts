import { CategoryModule } from "../ui/router";
import { getDefaultPricesMap, getStoredPriceLabel } from "../core/compat";
import { resolveStoredPrice } from "../core/compat";
import { getPriceSubgroups } from "../services/priceService";
import artykulyData from "../../data/normalized/artykuly-biurowe.json";

const artykulyBiuroweData: any = artykulyData as any;
const ENVELOPE_LETTERS = ["a", "b", "c", "d", "e", "f", "g"] as const;
export const CUSTOM_ARTYKULY_PREFIX = "artykuly-";
export const BASE_ARTYKULY_IDS = new Set<string>([
  ...(artykulyBiuroweData.categories ?? []).flatMap((category: any) =>
    (category.items ?? []).map((item: any) => item.id)
  ),
  ...ENVELOPE_LETTERS.map((letter) => `koperty-${letter}`),
]);
const BASE_ARTYKULY_IDS_NORMALIZED = new Set<string>(
  [...BASE_ARTYKULY_IDS].map((id) => normalizeArticleToken(id))
);

type RenderedArticleItem = {
  id: string;
  name: string;
  price: number | null;
  isCustom?: boolean;
};

type RenderedArticleCategory = {
  name: string;
  items: RenderedArticleItem[];
};

function repairMojibake(value: string): string {
  try {
    return decodeURIComponent(escape(value));
  } catch {
    return value;
  }
}

function normalizeArticleToken(value: string): string {
  return repairMojibake(String(value ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
}

function findEquivalentStoredArticleKey(
  itemId: string,
  storedPrices: Record<string, number | null>
): string | null {
  const directKey = `${CUSTOM_ARTYKULY_PREFIX}${itemId}`;
  if (typeof storedPrices[directKey] === "number") return directKey;

  const target = normalizeArticleToken(itemId);
  for (const [key, value] of Object.entries(storedPrices)) {
    if (!key.startsWith(CUSTOM_ARTYKULY_PREFIX) || typeof value !== "number") continue;
    const candidateId = key.slice(CUSTOM_ARTYKULY_PREFIX.length);
    if (normalizeArticleToken(candidateId) === target) return key;
  }

  return null;
}

function resolveArticlePrice(itemId: string, defaultValue: number): number {
  const storedPrices = getDefaultPricesMap();
  const canonicalKey = `${CUSTOM_ARTYKULY_PREFIX}${itemId}`;

  if (typeof storedPrices[canonicalKey] === "number") {
    return resolveStoredPrice(canonicalKey, defaultValue);
  }

  const aliasKey = findEquivalentStoredArticleKey(itemId, storedPrices);
  if (aliasKey && typeof storedPrices[aliasKey] === "number") {
    return Number(storedPrices[aliasKey]);
  }

  return resolveStoredPrice(canonicalKey, defaultValue);
}

function getEnvelopeArticleCategory(): RenderedArticleCategory {
  return {
    name: "KOPERTY (A–G)",
    items: ENVELOPE_LETTERS.map((letter) => ({
      id: `koperty-${letter}`,
      name: `Koperta ${letter.toUpperCase()}`,
      price: resolveStoredPrice(`koperty-${letter}`, 0),
    })),
  };
}

function getMatchingArticleGroupTitle(key: string): string | null {
  const subgroupMap = getPriceSubgroups()["artykuly"] ?? Object.create(null);
  const matches = Object.entries(subgroupMap)
    .filter(([prefix]) => key.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length);

  return matches[0]?.[1] ?? null;
}

function getCustomArticleCategories(): RenderedArticleCategory[] {
  const storedPrices = getDefaultPricesMap();
  const groups = new Map<string, RenderedArticleItem[]>();
  const groupOrder: string[] = [];

  for (const [key, value] of Object.entries(storedPrices)) {
    if (!key.startsWith(CUSTOM_ARTYKULY_PREFIX)) continue;
    const itemId = key.slice(CUSTOM_ARTYKULY_PREFIX.length);
    if (!itemId || BASE_ARTYKULY_IDS.has(itemId)) continue;

    // Hide duplicated entries added with mojibake/variant keys when they map
    // to existing base products (e.g. "artykuly-teczka-biaĹ‚a-gumka").
    if (BASE_ARTYKULY_IDS_NORMALIZED.has(normalizeArticleToken(itemId))) continue;

    const groupTitle = getMatchingArticleGroupTitle(key) ?? "DODANE RĘCZNIE";
    if (!groups.has(groupTitle)) {
      groups.set(groupTitle, []);
      groupOrder.push(groupTitle);
    }

    groups.get(groupTitle)!.push({
      id: itemId,
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

export function getRenderedArtykulyBiuroweCategories(): RenderedArticleCategory[] {
  return [
    ...(artykulyBiuroweData.categories ?? []).map((category: any) => ({
      name: category.name,
      items: (category.items ?? []).map((item: any) => ({
        id: item.id,
        name: item.name,
        price: resolveArticlePrice(item.id, item.price || (item.prices ? item.prices[0] : 0)),
      })),
    })),
    getEnvelopeArticleCategory(),
    ...getCustomArticleCategories(),
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

function renderArticleItem(item: RenderedArticleItem): string {
  const itemPrice = typeof item.price === "number" ? item.price : 0;
  const priceDisplay = typeof item.price === "number" ? `${itemPrice.toFixed(2)} zł` : "—";
  const priceColor = typeof item.price === "number" ? "#0066cc" : "#9aa7b2";
  const addDisabled = !(typeof item.price === "number" && item.price > 0);

  return `
    <div style="display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; column-gap: 8px; padding: 5px 8px; background-color: #ffffff; border: 1px solid #e7edf5; border-radius: 6px;">
      <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0; min-width: 0;">
        <span style="font-size: 0.93em; line-height: 1.2;">${escapeHtml(item.name)}</span>
      </label>
      <input type="number" data-qty-for="${item.id}" value="1" min="1" max="999" style="width: 54px; padding: 4px; font-size: 0.9em;" class="item-quantity">
      <span class="item-price" data-item-id="${item.id}" data-base-price="${itemPrice}" data-has-price="${typeof item.price === "number" ? "1" : "0"}" style="font-weight: bold; color: ${priceColor}; min-width: 68px; text-align: right; font-size: 0.9em;">${priceDisplay}</span>
      <button type="button" data-add-item-id="${item.id}" data-item-name="${escapeHtml(item.name)}" data-price="${itemPrice}" class="btn btn-success item-add-btn add-pill-btn" aria-label="Dodaj artykuł ${escapeHtml(item.name)} do koszyka" ${addDisabled ? "disabled" : ""}>+</button>
    </div>
  `;
}

function isEnvelopeLetterItem(itemId: string): boolean {
  return /^koperty-[a-g]$/i.test(itemId);
}

export interface ArtykulyBiuroweOptions {
  selectedItems: Array<{
    categoryName: string;
    itemId: string;
    itemName: string;
    quantity: number;
    price: number;
  }>;
}

export function quoteArtykulyBiurowe(options: ArtykulyBiuroweOptions): any {
  let totalPrice = 0;
  let totalQuantity = 0;

  for (const item of options.selectedItems) {
    const storageKey = isEnvelopeLetterItem(item.itemId)
      ? item.itemId.toLowerCase()
      : `artykuly-${item.itemId}`;
    const price = resolveStoredPrice(storageKey, item.price);
    const itemTotal = price * item.quantity;
    totalPrice += itemTotal;
    totalQuantity += item.quantity;
  }

  return {
    itemsCount: options.selectedItems.length,
    totalQuantity,
    totalPrice: parseFloat(totalPrice.toFixed(2)),
  };
}

let _artykulyCleanup: (() => void) | null = null;

export const artykulyBiuroweCategory: CategoryModule = {
  id: "artykuly-biurowe",
  name: "📎 Artykuły Biurowe",
  unmount() {
    _artykulyCleanup?.();
    _artykulyCleanup = null;
  },
  mount: (container, ctx) => {
    _artykulyCleanup?.();
    container.innerHTML = `
      <div class="category-form">
        <h2>Artykuły Biurowe</h2>
        <p style="color: #999; margin-bottom: 10px; font-size: 0.92em;">
          Artykuły biurowe i akcesoria. Cena za sztukę.
        </p>

        <div style="margin-bottom: 10px;">
          <input
            id="artykuly-search"
            type="search"
            placeholder="Szukaj artykułu..."
            autocomplete="off"
            style="width:100%;box-sizing:border-box;padding:7px 10px;font-size:0.9em;border:1px solid #d0d7e2;border-radius:6px;background:#fff;"
          >
        </div>

        <div id="items-list" style="margin-bottom: 14px;"></div>
      </div>
    `;

    const itemsList = container.querySelector("#items-list") as HTMLElement;
    const searchInput = container.querySelector("#artykuly-search") as HTMLInputElement;
    let searchQuery = "";

    const renderItems = () => {
      itemsList.innerHTML = "";

      const q = searchQuery.trim().toLowerCase();
      const displayCategories = getRenderedArtykulyBiuroweCategories();

      for (const category of displayCategories) {
        const filteredItems = q
          ? category.items.filter((item) => item.name.toLowerCase().includes(q))
          : category.items;

        if (!filteredItems.length) continue;

        const categoryDiv = document.createElement("div");
        categoryDiv.style.marginBottom = "10px";
        categoryDiv.style.padding = "8px 10px";
        categoryDiv.style.backgroundColor = "#f7f9fb";
        categoryDiv.style.border = "1px solid #e3e8ef";
        categoryDiv.style.borderRadius = "8px";
        categoryDiv.innerHTML = `<h3 style="color: #2d3a4a; margin: 0 0 6px 0; font-size: 0.95rem;">${escapeHtml(category.name)}</h3>`;

        const itemsDiv = document.createElement("div");
        itemsDiv.style.display = "grid";
        itemsDiv.style.gap = "5px";

        for (const item of filteredItems) {
          const itemDiv = document.createElement("div");
          itemDiv.innerHTML = renderArticleItem(item);
          itemsDiv.appendChild(itemDiv.firstElementChild as HTMLElement);
        }

        categoryDiv.appendChild(itemsDiv);
        itemsList.appendChild(categoryDiv);
      }

      if (q && !itemsList.children.length) {
        itemsList.innerHTML = `<p style="color:#999;font-size:0.9em;padding:8px 0;">Brak wyników dla „${escapeHtml(q)}"</p>`;
      }
    };

    renderItems();

    searchInput.addEventListener("input", () => {
      searchQuery = searchInput.value;
      renderItems();
    });

    ctx?.on?.("prices-updated", () => {
      renderItems();
    });

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const addButton = target?.closest(".item-add-btn") as HTMLButtonElement | null;
      if (!addButton) return;

      const itemId = addButton.getAttribute("data-add-item-id") || "";
      const itemName = addButton.getAttribute("data-item-name") || "";
      const basePrice = parseFloat(addButton.getAttribute("data-price") || "0");
      const storageKey = isEnvelopeLetterItem(itemId) ? itemId.toLowerCase() : `artykuly-${itemId}`;
      const price = resolveStoredPrice(storageKey, basePrice);
      const qtyInput = container.querySelector(
        `input[data-qty-for="${itemId}"]`
      ) as HTMLInputElement | null;
      const quantity = Math.max(1, parseInt(qtyInput?.value || "1", 10) || 1);

      const selectedItems: ArtykulyBiuroweOptions["selectedItems"] = [
        {
          categoryName: "",
          itemId,
          itemName,
          quantity,
          price,
        },
      ];

      const result = quoteArtykulyBiurowe({ selectedItems });

      ctx.updateLastCalculated(result.totalPrice, `Artykuły biurowe - ${itemName}`);
      ctx?.emit?.("price-calculated", {
        categoryId: "artykuly-biurowe",
        totalPrice: result.totalPrice,
        details: result,
      });

      ctx.addToBasket({
        category: "Artykuły biurowe",
        price: result.totalPrice,
        description: `${itemName} × ${quantity}`,
      });

      if (qtyInput) qtyInput.value = "1";
    };

    container.addEventListener("click", handleClick);
    _artykulyCleanup = () => container.removeEventListener("click", handleClick);
  },
};
