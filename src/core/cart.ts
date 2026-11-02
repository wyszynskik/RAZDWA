import { CartItem } from "./types";
import { EXPRESS_RATE, getExpressRate } from "./modifiers";
import { cartStorageKey } from "./draftSession";

const MAX_CART_AGE_MS = 48 * 60 * 60 * 1000;

export class Cart {
  private items: CartItem[] = [];
  private storageKey = cartStorageKey();
  private savedAt: number = 0;

  constructor() {
    this.load();
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const isValidItem = (item: unknown): item is CartItem => {
        const i = item as CartItem;
        return (
          i != null &&
          Number.isFinite(i.unitPrice) &&
          i.unitPrice > 0 &&
          Number.isFinite(i.totalPrice) &&
          i.totalPrice > 0
        );
      };
      if (Array.isArray(parsed)) {
        // backward compat: old format without timestamp
        if (this.savedAt === 0) {
          this.items = (parsed as unknown[]).filter(isValidItem);
        }
      } else if (parsed && typeof parsed === "object") {
        const data = parsed as { items?: unknown; savedAt?: unknown };
        const storedAt = typeof data.savedAt === "number" ? data.savedAt : 0;
        if (storedAt > 0 && Date.now() - storedAt > MAX_CART_AGE_MS) {
          localStorage.removeItem(this.storageKey);
          return;
        }
        if (storedAt >= this.savedAt && Array.isArray(data.items)) {
          this.items = (data.items as unknown[]).filter(isValidItem);
          this.savedAt = storedAt;
        }
      }
    } catch {
      this.items = [];
    }
  }

  private save() {
    try {
      this.savedAt = Date.now();
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({ items: this.items, savedAt: this.savedAt })
      );
    } catch {
      // storage write failed — cart state is still in memory
    }
  }

  addItem(item: CartItem) {
    this.items.push(item);
    this.save();
  }

  removeItem(index: number): CartItem | null {
    if (index >= 0 && index < this.items.length) {
      const [removed] = this.items.splice(index, 1);
      this.save();
      return removed ?? null;
    }
    return null;
  }

  insertItem(index: number, item: CartItem) {
    const clamped = Math.max(0, Math.min(index, this.items.length));
    this.items.splice(clamped, 0, item);
    this.save();
  }

  clear() {
    this.items = [];
    this.save();
  }

  getItems(): CartItem[] {
    return [...this.items];
  }

  getGrandTotal(): number {
    const cents = this.items.reduce((sum, item) => sum + Math.round(item.totalPrice * 100), 0);
    return cents / 100;
  }

  setExpressForAll(enabled: boolean) {
    this.items = this.items.map((item) => {
      const shouldBeExpress = !!enabled;
      const isCurrentlyExpress = !!item.isExpress;

      if (shouldBeExpress === isCurrentlyExpress) {
        if (
          shouldBeExpress &&
          (!Number.isFinite(item.expressRate) || !Number.isFinite(item.baseUnitPrice))
        ) {
          const rate = getExpressRate();
          return {
            ...item,
            expressRate: Number.isFinite(item.expressRate) ? (item.expressRate as number) : rate,
            baseUnitPrice: Number.isFinite(item.baseUnitPrice)
              ? (item.baseUnitPrice as number)
              : parseFloat((item.unitPrice / (1 + rate)).toFixed(2)),
            baseTotalPrice: Number.isFinite(item.baseTotalPrice)
              ? (item.baseTotalPrice as number)
              : parseFloat((item.totalPrice / (1 + rate)).toFixed(2)),
          };
        }
        return item;
      }

      if (shouldBeExpress) {
        const applyRate = getExpressRate();
        const factor = 1 + applyRate;
        const baseUnit = Number.isFinite(item.baseUnitPrice)
          ? (item.baseUnitPrice as number)
          : item.unitPrice;
        const baseTotal = Number.isFinite(item.baseTotalPrice)
          ? (item.baseTotalPrice as number)
          : item.totalPrice;
        return {
          ...item,
          isExpress: true,
          expressRate: applyRate,
          baseUnitPrice: baseUnit,
          baseTotalPrice: baseTotal,
          unitPrice: parseFloat((baseUnit * factor).toFixed(2)),
          totalPrice: parseFloat((baseTotal * factor).toFixed(2)),
        };
      }

      const revertRate =
        Number.isFinite(item.expressRate) && (item.expressRate as number) >= 0
          ? (item.expressRate as number)
          : EXPRESS_RATE;
      const factor = 1 + revertRate;
      const restoredUnit = Number.isFinite(item.baseUnitPrice)
        ? (item.baseUnitPrice as number)
        : parseFloat((item.unitPrice / factor).toFixed(2));
      const restoredTotal = Number.isFinite(item.baseTotalPrice)
        ? (item.baseTotalPrice as number)
        : parseFloat((item.totalPrice / factor).toFixed(2));
      return {
        ...item,
        isExpress: false,
        unitPrice: restoredUnit,
        totalPrice: restoredTotal,
      };
    });

    this.save();
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}
