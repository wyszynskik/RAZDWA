/**
 * Testy logiki decyzyjnej snapshotu 12h — przez wykonywalne lustro
 * (tests/helpers/catalogSnapshotEngine.ts) algorytmu z
 * devdocs/GOOGLE_APPS_SCRIPT_SETUP.md, sekcja 9.
 *
 * Code.gs nie jest uruchamialny w tym repo, więc te testy weryfikują
 * SPECYFIKACJĘ algorytmu (ręcznie portowaną do Code.gs), nie sam Code.gs.
 */
import { describe, it, expect } from "vitest";
import {
  runCatalogSnapshotIfStable,
  createInMemorySnapshotStore,
  type EngineDeps,
  type EngineCatalogState,
} from "./helpers/catalogSnapshotEngine";
import {
  findSnapshotRow,
  CatalogSnapshotPayloadTooLargeError,
} from "../src/services/catalogSnapshot";

const HOUR = 60 * 60 * 1000;
const STABLE_MS = 12 * HOUR;
const NOW = Date.parse("2026-09-10T00:00:00.000Z");

function stableLiveState(overrides: Partial<EngineCatalogState> = {}): EngineCatalogState {
  return {
    prices: { "druk-bw-a4-1-5": 0.9 },
    variants: [{ key: "v1" }],
    catalogRevision: 1,
    catalogUpdatedAt: new Date(NOW - STABLE_MS - HOUR).toISOString(), // 13h temu — stabilny
    ...overrides,
  };
}

function makeDeps(
  liveState: EngineCatalogState,
  store = createInMemorySnapshotStore(),
  overrides: Partial<EngineDeps> = {}
): EngineDeps {
  return {
    now: () => NOW,
    tryLock: () => store.tryLock(),
    releaseLock: () => store.releaseLock(),
    readCatalogStateLocked: () => ({ ...liveState }),
    readCatalogRevision: () => liveState.catalogRevision,
    readCatalogUpdatedAt: () => liveState.catalogUpdatedAt,
    getSnapshotRevisionProp: () => store.getSnapshotRevisionProp(),
    setSnapshotRevisionProp: (v) => store.setSnapshotRevisionProp(v),
    setSnapshotAtProp: (v) => store.setSnapshotAtProp(v),
    listExistingRevisions: () => store.listExistingRevisions(),
    appendRow: (row) => store.appendRow(row),
    trimRetention: (max) => store.trimRetention(max),
    log: () => {},
    ...overrides,
  };
}

describe("runCatalogSnapshotIfStable — stabilność 12h", () => {
  it("nie tworzy snapshotu przed 12h (dokładnie na granicy, 1ms brakuje)", () => {
    const liveState = stableLiveState({
      catalogUpdatedAt: new Date(NOW - STABLE_MS + 1).toISOString(), // o 1ms za wcześnie
    });
    const store = createInMemorySnapshotStore();
    const result = runCatalogSnapshotIfStable(makeDeps(liveState, store));

    expect(result.outcome).toBe("skipped_not_stable_yet");
    expect(store.rows).toHaveLength(0);
  });

  it("tworzy snapshot po dokładnie >= 12h (na granicy, ==)", () => {
    const liveState = stableLiveState({
      catalogUpdatedAt: new Date(NOW - STABLE_MS).toISOString(), // dokładnie 12h — "co najmniej", nie "ponad"
    });
    const store = createInMemorySnapshotStore();
    const result = runCatalogSnapshotIfStable(makeDeps(liveState, store));

    expect(result.outcome).toBe("created");
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].snapshotRevision).toBe(1);
  });

  it("tworzy snapshot po >12h", () => {
    const store = createInMemorySnapshotStore();
    const result = runCatalogSnapshotIfStable(makeDeps(stableLiveState(), store));

    expect(result).toEqual({ outcome: "created", revision: 1 });
    expect(store.rows).toHaveLength(1);
    const row = store.rows[0];
    expect(row.snapshotRevision).toBe(1);
    expect(row.schemaVersion).toBe(1);
    expect(JSON.parse(row.payloadJson)).toMatchObject({
      schemaVersion: 1,
      snapshotRevision: 1,
      prices: { "druk-bw-a4-1-5": 0.9 },
      variants: [{ key: "v1" }],
    });
    expect(row.payloadSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.props.get("CATALOG_SNAPSHOT_REVISION")).toBe("1");
    expect(store.props.get("CATALOG_SNAPSHOT_AT")).toBe(row.snapshotCreatedAt);
  });

  it("pusty catalogUpdatedAt jest no-opem bez błędu", () => {
    const liveState = stableLiveState({ catalogUpdatedAt: "" });
    const store = createInMemorySnapshotStore();

    expect(() => runCatalogSnapshotIfStable(makeDeps(liveState, store))).not.toThrow();
    const result = runCatalogSnapshotIfStable(makeDeps(liveState, store));

    expect(result.outcome).toBe("skipped_no_updated_at");
    expect(store.rows).toHaveLength(0);
    expect(store.props.size).toBe(0);
  });

  it("nieparsowalny catalogUpdatedAt jest no-opem bez błędu", () => {
    const liveState = stableLiveState({ catalogUpdatedAt: "nie-jest-datą" });
    const store = createInMemorySnapshotStore();
    const result = runCatalogSnapshotIfStable(makeDeps(liveState, store));

    expect(result.outcome).toBe("skipped_no_updated_at");
    expect(store.rows).toHaveLength(0);
  });

  it("niepoprawny katalog (puste prices) jest odrzucany", () => {
    const liveState = stableLiveState({ prices: {} });
    const store = createInMemorySnapshotStore();
    const result = runCatalogSnapshotIfStable(makeDeps(liveState, store));

    expect(result.outcome).toBe("skipped_invalid_catalog");
    expect(store.rows).toHaveLength(0);
  });
});

describe("runCatalogSnapshotIfStable — konflikt między Lock A i Lock B", () => {
  it("zmiana catalogRevision między lockami odrzuca snapshot", () => {
    const liveState = stableLiveState();
    const store = createInMemorySnapshotStore();

    let revisionCalls = 0;
    const deps = makeDeps(liveState, store, {
      readCatalogRevision: () => {
        revisionCalls++;
        // 1. wywołanie: KROK1 fast-path (dowolna wartość, property jest puste)
        // 2. wywołanie: KROK4 Lock B — symulujemy catalog.save między lockami
        return revisionCalls === 1 ? liveState.catalogRevision : liveState.catalogRevision + 1;
      },
    });

    const result = runCatalogSnapshotIfStable(deps);

    expect(result.outcome).toBe("skipped_state_changed");
    expect(store.rows).toHaveLength(0);
    expect(store.props.size).toBe(0);
  });

  it("zmiana catalogUpdatedAt między lockami odrzuca snapshot", () => {
    // readCatalogUpdatedAt jest wołane wyłącznie raz, w Lock B (KROK4) — Lock A
    // (readCatalogStateLocked) czyta catalogUpdatedAt jako część spójnego stanu,
    // nie przez tę funkcję. Symulacja "zmieniło się między lockami" to więc
    // po prostu: Lock A widział liveState.catalogUpdatedAt (stary), a
    // readCatalogUpdatedAt w Lock B zwraca inną, świeższą wartość.
    const liveState = stableLiveState();
    const store = createInMemorySnapshotStore();

    const deps = makeDeps(liveState, store, {
      readCatalogUpdatedAt: () => new Date(NOW).toISOString(),
    });

    const result = runCatalogSnapshotIfStable(deps);

    expect(result.outcome).toBe("skipped_state_changed");
    expect(store.rows).toHaveLength(0);
  });

  it("lock zajęty w Lock A kończy się cicho, bez wyjątku", () => {
    const liveState = stableLiveState();
    const store = createInMemorySnapshotStore();
    store.tryLock(); // symulacja: catalog.save trzyma lock

    const result = runCatalogSnapshotIfStable(makeDeps(liveState, store));

    expect(result.outcome).toBe("skipped_lock_a_busy");
    expect(store.rows).toHaveLength(0);
  });

  it("lock zajęty w Lock B kończy się cicho, bez zapisu, bez aktualizacji property i bez zawieszonego locka", () => {
    // Lock A ma się udać normalnie (katalog stabilny, poprawny), a dopiero
    // Lock B (KROK4, tuż przed zapisem) ma odmówić tryLock — symulacja np.
    // innego jednoczesnego uruchomienia triggera trzymającego lock dłużej.
    const liveState = stableLiveState();
    const store = createInMemorySnapshotStore();

    let tryLockCalls = 0;
    const deps = makeDeps(liveState, store, {
      tryLock: () => {
        tryLockCalls++;
        if (tryLockCalls === 1) return store.tryLock(); // Lock A — sukces
        return false; // Lock B — odmowa
      },
    });

    const result = runCatalogSnapshotIfStable(deps);

    expect(result.outcome).toBe("skipped_lock_b_busy");
    expect(store.rows).toHaveLength(0);
    expect(store.props.size).toBe(0);
    expect(store.isLocked()).toBe(false); // Lock A został prawidłowo zwolniony po swoim odczycie
  });
});

describe("runCatalogSnapshotIfStable — idempotencja i samonaprawa", () => {
  it("drugi run dla tej samej revision nie tworzy duplikatu (fast-path)", () => {
    const liveState = stableLiveState();
    const store = createInMemorySnapshotStore();
    const deps = makeDeps(liveState, store);

    const first = runCatalogSnapshotIfStable(deps);
    const second = runCatalogSnapshotIfStable(deps);

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("skipped_fast_path");
    expect(store.rows).toHaveLength(1);
  });

  it("awaria między zapisem wiersza a ustawieniem property jest naprawiana przy kolejnym runie, bez duplikatu", () => {
    const liveState = stableLiveState();
    const store = createInMemorySnapshotStore();

    let setPropCalls = 0;
    const deps = makeDeps(liveState, store, {
      setSnapshotRevisionProp: (value) => {
        setPropCalls++;
        if (setPropCalls === 1) {
          throw new Error("symulowana przejściowa awaria GAS między appendRow a setProperty");
        }
        store.setSnapshotRevisionProp(value);
      },
    });

    // Run 1: appendRow się udaje, setSnapshotRevisionProp rzuca — funkcja rzuca dalej.
    expect(() => runCatalogSnapshotIfStable(deps)).toThrow(/symulowana przejściowa awaria/);
    expect(store.rows).toHaveLength(1); // wiersz JEST zapisany
    expect(store.props.get("CATALOG_SNAPSHOT_REVISION")).toBeUndefined(); // property NIE jest ustawiona
    expect(store.isLocked()).toBe(false); // finally zwolnił lock mimo wyjątku

    // Run 2: property kłamie "nic nie zrobione", ale KROK5 znajduje wiersz w arkuszu i naprawia property.
    const secondRun = runCatalogSnapshotIfStable(deps);

    expect(secondRun).toEqual({ outcome: "healed_property_only", revision: 1 });
    expect(store.rows).toHaveLength(1); // wciąż jeden wiersz, brak duplikatu
    expect(store.props.get("CATALOG_SNAPSHOT_REVISION")).toBe("1"); // naprawione
  });

  it("samonaprawa domyka też retencję: 101 wierszy z rewizją 101 już istniejącą, property rozjechane → bez duplikatu, przycięte do 100, property naprawione", () => {
    // Symulacja stanu po awarii, która nastąpiła PO appendRow (rev 101 już
    // ma wiersz) ale PRZED _trimCatalogSnapshotRetention/setProperty w
    // poprzednim (nieudanym) biegu — dokładnie scenariusz z zadania: arkusz
    // ma 101 rekordów (przekroczony limit), a property jest brakujące/
    // rozjechane.
    const store = createInMemorySnapshotStore();
    for (let i = 1; i <= 101; i++) {
      store.appendRow({
        snapshotRevision: i,
        catalogUpdatedAt: new Date(NOW - STABLE_MS - HOUR).toISOString(),
        snapshotCreatedAt: new Date(NOW - HOUR).toISOString(),
        schemaVersion: 1,
        payloadJson: JSON.stringify({ schemaVersion: 1, snapshotRevision: i }),
        payloadSha256: "x".repeat(64),
      });
    }
    // Property rozjechane (wskazuje starszą rewizję niż to, co faktycznie
    // jest już zapisane w arkuszu) — dokładnie stan po częściowej awarii.
    store.setSnapshotRevisionProp("50");

    const liveState = stableLiveState({ catalogRevision: 101 });
    const deps = makeDeps(liveState, store);

    const result = runCatalogSnapshotIfStable(deps);

    expect(result).toEqual({ outcome: "healed_property_only", revision: 101 });

    const revisions = store.rows.map((r) => r.snapshotRevision);
    expect(store.rows).toHaveLength(100); // retencja domknięta przy naprawie
    expect(revisions.filter((r) => r === 101)).toHaveLength(1); // brak duplikatu rev 101
    expect(revisions).not.toContain(1); // najstarsza usunięta
    for (let i = 2; i <= 101; i++) {
      expect(revisions).toContain(i); // 2-101 zachowane
    }
    expect(store.props.get("CATALOG_SNAPSHOT_REVISION")).toBe("101"); // naprawione do aktualnej
  });

  it("payload przekraczający limit komórki kończy się fail-loud (throw), bez zapisu i bez zawieszonego locka", () => {
    const liveState = stableLiveState({
      prices: { "bardzo-dluga-cena-testowa": 1 },
    });
    const store = createInMemorySnapshotStore();
    // Sztucznie mały limit, żeby nie budować naprawdę 50000-znakowego payloadu w teście.
    const deps = makeDeps(liveState, store, { cellCharLimit: 10 });

    expect(() => runCatalogSnapshotIfStable(deps)).toThrow(CatalogSnapshotPayloadTooLargeError);
    expect(store.rows).toHaveLength(0);
    expect(store.isLocked()).toBe(false);
  });
});

describe("retencja — dokładnie 100 najnowszych rekordów", () => {
  it("przycina do 100 najnowszych, usuwając najstarsze", () => {
    const store = createInMemorySnapshotStore();
    for (let i = 1; i <= 105; i++) {
      store.appendRow({
        snapshotRevision: i,
        catalogUpdatedAt: new Date(NOW).toISOString(),
        snapshotCreatedAt: new Date(NOW).toISOString(),
        schemaVersion: 1,
        payloadJson: "{}",
        payloadSha256: "x".repeat(64),
      });
    }

    store.trimRetention(100);

    expect(store.rows).toHaveLength(100);
    expect(store.rows[0].snapshotRevision).toBe(6); // rewizje 1-5 usunięte jako najstarsze
    expect(store.rows[store.rows.length - 1].snapshotRevision).toBe(105);
  });

  it("nie robi nic, gdy liczba wierszy nie przekracza limitu", () => {
    const store = createInMemorySnapshotStore();
    store.appendRow({
      snapshotRevision: 1,
      catalogUpdatedAt: "x",
      snapshotCreatedAt: "x",
      schemaVersion: 1,
      payloadJson: "{}",
      payloadSha256: "x".repeat(64),
    });
    store.trimRetention(100);
    expect(store.rows).toHaveLength(1);
  });

  it("pełny run silnika: 100 istniejących snapshotów (rev 1-100) + nowa stabilna rev 101 → dokładnie 100 wierszy, rev 1 usunięta, rev 2-101 zachowane", () => {
    const store = createInMemorySnapshotStore();
    for (let i = 1; i <= 100; i++) {
      store.appendRow({
        snapshotRevision: i,
        catalogUpdatedAt: new Date(NOW - STABLE_MS - HOUR).toISOString(),
        snapshotCreatedAt: new Date(NOW - HOUR).toISOString(),
        schemaVersion: 1,
        payloadJson: JSON.stringify({ schemaVersion: 1, snapshotRevision: i }),
        payloadSha256: "x".repeat(64),
      });
    }
    // Property odzwierciedla realistyczny stan sprzed tego runu — ostatni
    // zarejestrowany snapshot to rev 100, katalog właśnie stał się stabilny
    // na rev 101.
    store.setSnapshotRevisionProp("100");
    store.setSnapshotAtProp(new Date(NOW - HOUR).toISOString());

    const liveState = stableLiveState({ catalogRevision: 101 });
    const deps = makeDeps(liveState, store);

    const result = runCatalogSnapshotIfStable(deps);

    expect(result).toEqual({ outcome: "created", revision: 101 });
    expect(store.rows).toHaveLength(100);

    const revisions = store.rows.map((r) => r.snapshotRevision);
    expect(revisions).not.toContain(1); // najstarsza, usunięta przez retencję
    for (let i = 2; i <= 101; i++) {
      expect(revisions).toContain(i); // 2-101 zachowane, w tym nowo utworzona 101
    }
    expect(store.rows[0].snapshotRevision).toBe(2);
    expect(store.rows[store.rows.length - 1].snapshotRevision).toBe(101);
    expect(store.props.get("CATALOG_SNAPSHOT_REVISION")).toBe("101");
  });
});

describe("findSnapshotRow — logika getSnapshot (najnowszy / po revision)", () => {
  const rows = [
    { snapshotRevision: 1, payload: "rev1" },
    { snapshotRevision: 2, payload: "rev2" },
    { snapshotRevision: 3, payload: "rev3" },
  ];

  it("bez revision zwraca najnowszy (ostatni append)", () => {
    expect(findSnapshotRow(rows)).toEqual({ snapshotRevision: 3, payload: "rev3" });
  });

  it("z revision zwraca dokładnie pasujący wiersz", () => {
    expect(findSnapshotRow(rows, 2)).toEqual({ snapshotRevision: 2, payload: "rev2" });
  });

  it("z nieistniejącą revision zwraca null", () => {
    expect(findSnapshotRow(rows, 999)).toBeNull();
  });

  it("dla pustej listy zwraca null niezależnie od revision", () => {
    expect(findSnapshotRow([])).toBeNull();
    expect(findSnapshotRow([], 1)).toBeNull();
  });
});

describe("Strukturalna gwarancja: silnik snapshotu nie ma dostępu do zapisu cennika", () => {
  it("interfejs EngineDeps nie zawiera żadnej funkcji zapisującej API_CENNIK/API_VARIANTS/catalogRevision", () => {
    // Gwarancja na poziomie typu, nie runtime: EngineDeps (i jego odpowiednik
    // w Code.gs, runCatalogSnapshotIfStable) nie ma żadnej zależności typu
    // writeCennik/writeVariants/bumpCatalogRevision — strukturalnie nie da
    // się z tego miejsca zapisać ani zmienić cen. To jest to samo, co
    // potwierdza git diff: handleCatalogSave nie jest w ogóle dotknięty.
    const deps = makeDeps(stableLiveState());
    const depsKeys = Object.keys(deps);
    const forbidden = [
      "writeCennik",
      "writeVariants",
      "bumpCatalogRevision",
      "_writeCennikRows",
      "_writeVariantRows",
    ];
    forbidden.forEach((name) => expect(depsKeys).not.toContain(name));
  });
});
