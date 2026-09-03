import type { PriceRecord } from "../types/price-schema";

const DB_NAME = "razdwa-price-db";
const DB_VERSION = 2;

/**
 * Otwarcie IndexedDB jest prawie zawsze natychmiastowe. Gdy nie jest —
 * najczęściej inna karta trzyma połączenie do starszej wersji bazy i
 * blokuje upgrade (`onblocked`), albo środowisko po prostu nigdy nie
 * wyemituje żadnego zdarzenia. Bez tego limitu handler "Zapisz cennik"
 * wisiał w nieskończoność na `await reconcilePriceStore()`, zanim dotarł
 * do pierwszego komunikatu dla użytkowniczki — patrz diagnostyka incydentu.
 */
export const IDB_OPEN_TIMEOUT_MS = 4000;

let _dbPromise: Promise<IDBDatabase> | null = null;

/** Tylko do testów — czyści singleton połączenia między przypadkami testowymi. */
export function resetPriceStoreConnectionForTests(): void {
  _dbPromise = null;
}

function openDB(timeoutMs: number = IDB_OPEN_TIMEOUT_MS): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this environment"));
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      _dbPromise = null;
      reject(new Error("IndexedDB: przekroczono limit czasu otwarcia bazy."));
    }, timeoutMs);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (event.oldVersion < 2 && db.objectStoreNames.contains("sync_log")) {
        db.deleteObjectStore("sync_log");
      }
      if (!db.objectStoreNames.contains("prices")) {
        const store = db.createObjectStore("prices", { keyPath: "id" });
        store.createIndex("by_category", "category", { unique: false });
        // _dirty i _deleted są boolean — boolean nie jest prawidłowym kluczem IDB.
        // getDirty/getDeleted używają filtrowania in-memory.
      }
    };

    // Inna karta trzyma otwarte połączenie do starszej wersji bazy i blokuje
    // upgrade. Bez tego handlera żądanie nigdy nie wyemitowałoby ani
    // onsuccess, ani onerror — zawisłoby na zawsze (do czasu timeoutu wyżej).
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _dbPromise = null;
      reject(
        new Error(
          "IndexedDB: otwarcie zablokowane przez inną kartę z tą aplikacją. Zamknij pozostałe karty i spróbuj ponownie."
        )
      );
    };

    request.onsuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const db = request.result;
      // Gdy inna karta/urządzenie podniesie DB_VERSION, ta połączenie trzeba
      // zamknąć — inaczej to ono blokowałoby cudzy upgrade przez onblocked.
      db.onversionchange = () => {
        db.close();
        _dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _dbPromise = null;
      reject(request.error ?? new Error("IndexedDB: nie udało się otworzyć bazy."));
    };
  });
  return _dbPromise;
}

function req<T>(idbReq: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbReq.onsuccess = () => resolve(idbReq.result);
    idbReq.onerror = () => reject(idbReq.error);
  });
}

export const priceStore = {
  async getAll(): Promise<PriceRecord[]> {
    const db = await openDB();
    return req(db.transaction("prices", "readonly").objectStore("prices").getAll());
  },

  async getById(id: string): Promise<PriceRecord | undefined> {
    const db = await openDB();
    return req(db.transaction("prices", "readonly").objectStore("prices").get(id));
  },

  async put(record: PriceRecord): Promise<void> {
    const db = await openDB();
    await req(db.transaction("prices", "readwrite").objectStore("prices").put(record));
  },

  /**
   * Zapis wielu rekordów w JEDNEJ transakcji — uzgodnienie cennika potrafi
   * dotknąć setek pozycji naraz, a osobna transakcja na rekord blokowałaby
   * zapis cennika na kilka sekund.
   */
  async putMany(records: PriceRecord[]): Promise<void> {
    if (records.length === 0) return;
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const txn = db.transaction("prices", "readwrite");
      const store = txn.objectStore("prices");
      txn.oncomplete = () => resolve();
      txn.onerror = () => reject(txn.error);
      txn.onabort = () => reject(txn.error);
      for (const record of records) {
        store.put(record);
      }
    });
  },

  async softDelete(id: string): Promise<void> {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const txn = db.transaction("prices", "readwrite");
      const store = txn.objectStore("prices");
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const record = getReq.result as PriceRecord | undefined;
        if (!record) {
          resolve();
          return;
        }
        const putReq = store.put({
          ...record,
          _deleted: true,
          _dirty: true,
          updatedAt: new Date().toISOString(),
        });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  },

  async getDirty(): Promise<PriceRecord[]> {
    const all = await this.getAll();
    return all.filter((r) => r._dirty);
  },

  async count(): Promise<number> {
    const db = await openDB();
    return req(db.transaction("prices", "readonly").objectStore("prices").count());
  },

  async clearAll(): Promise<void> {
    const db = await openDB();
    await req(db.transaction("prices", "readwrite").objectStore("prices").clear());
  },
};
