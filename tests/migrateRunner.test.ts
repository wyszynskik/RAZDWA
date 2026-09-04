import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Testy jednorazowego runnera CLI migracji A → B
 * (scripts/migrate-plakaty-ekonomiczne-a2b.mts).
 *
 * Runner uruchamia się wyłącznie przez `node <plik>.mts` z natywnym
 * wsparciem Node 22+ dla TypeScript, więc jego relatywne importy MUSZĄ nosić
 * jawne rozszerzenie (.ts) — wymóg ESM w Node. `tsc` z ustawieniami tego
 * repo (moduleResolution: "node") odrzuca taki import, więc plik nie jest
 * częścią głównego programu `npx tsc --noEmit` (nie jest importowany przez
 * żaden plik w src/ ani tests/ — patrz brak importu poniżej). Zamiast tego
 * cała weryfikacja idzie przez rzeczywiste uruchomienia procesu (spawn) —
 * to i tak jedyny sposób, w jaki administrator będzie z niego korzystać.
 * Typy runnera są osobno zweryfikowane doraźnym wywołaniem tsc ze
 * `--moduleResolution bundler --allowImportingTsExtensions` (bez zmiany
 * współdzielonego tsconfig.json) — patrz raport.
 */

const FIXTURE_PATH = join(__dirname, "fixtures", "plakaty-ekonomiczne-a2b.synthetic.json");
const RUNNER_SCRIPT = join(__dirname, "..", "scripts", "migrate-plakaty-ekonomiczne-a2b.mts");

const LEGACY_KEY_A1 = "plakaty-maly-canon-margin-170-ekonomiczne-z-marginesem-a4-130g-10-szt-10-szt";
const LEGACY_KEY_A2 =
  "plakaty-maly-canon-margin-170-ekonomiczne-z-marginesem-a4-130g-10-szt-ekonomiczne-a4-130g-10-szt";
const B10 = "plakaty-a4-a3-plakaty-ekonomiczne-a4-10";
const B20 = "plakaty-a4-a3-plakaty-ekonomiczne-a4-20";

let workDir: string;

function freshInput(): string {
  workDir = mkdtempSync(join(tmpdir(), "razdwa-migrate-runner-"));
  const inputPath = join(workDir, "input.json");
  writeFileSync(inputPath, readFileSync(FIXTURE_PATH, "utf-8"), "utf-8");
  return inputPath;
}

afterEach(() => {
  if (workDir && existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
});

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", ["--no-warnings", RUNNER_SCRIPT, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("runner CLI migrate-plakaty-ekonomiczne-a2b — end-to-end na kopii fixture'u syntetycznego", () => {
  it("1. dry-run nie zmienia inputu", () => {
    const input = freshInput();
    const before = readFileSync(input, "utf-8");
    const { status } = runCli(["--input", input, "--dry-run"]);
    expect(status).toBe(0);
    expect(readFileSync(input, "utf-8")).toBe(before);
  });

  it("2. dry-run nie tworzy pliku output (nawet gdy --output podano razem z --dry-run)", () => {
    const input = freshInput();
    const output = join(workDir, "should-not-exist.json");
    const { status } = runCli(["--input", input, "--output", output, "--dry-run"]);
    expect(status).toBe(0);
    expect(existsSync(output)).toBe(false);
  });

  it("3. apply bez --output kończy się błędem", () => {
    const input = freshInput();
    const { status, stderr } = runCli(["--input", input, "--apply"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("--output");
  });

  it("4. apply nie nadpisuje inputu", () => {
    const input = freshInput();
    const before = readFileSync(input, "utf-8");
    const output = join(workDir, "after.json");
    const { status } = runCli(["--input", input, "--output", output, "--apply"]);
    expect(status).toBe(0);
    expect(readFileSync(input, "utf-8")).toBe(before);
  });

  it("5/6/7/8. output nie zawiera A, zawiera dokładnie B-10=49, nie zawiera B-20, reszta bit-identyczna", () => {
    const input = freshInput();
    const before = JSON.parse(readFileSync(input, "utf-8"));
    const output = join(workDir, "after.json");
    const { status } = runCli(["--input", input, "--output", output, "--apply"]);
    expect(status).toBe(0);

    const after = JSON.parse(readFileSync(output, "utf-8"));

    // 5. brak A
    expect(after.data.prices[LEGACY_KEY_A1]).toBeUndefined();
    expect(after.data.prices[LEGACY_KEY_A2]).toBeUndefined();
    expect(after.data.variants.some((v: { key: string }) => v.key === LEGACY_KEY_A1)).toBe(false);
    expect(after.data.variants.some((v: { key: string }) => v.key === LEGACY_KEY_A2)).toBe(false);

    // 6. dokładnie B-10 = 49
    expect(after.data.prices[B10]).toBe(49);
    expect(after.data.priceLabels[B10]).toBe("10 szt.");
    const bVariant = after.data.variants.find((v: { key: string }) => v.key === B10);
    expect(bVariant).toBeDefined();
    expect(bVariant.subgroupLabel).toBe("Plakaty ekonomiczne A4");
    expect(bVariant.calcScheme).toBe("interpolated");
    expect(bVariant.materialSizeOptions).toEqual([{ material: "130", size: "A4" }]);

    // 7. brak B-20
    expect(after.data.prices[B20]).toBeUndefined();
    expect(after.data.variants.some((v: { key: string }) => v.key === B20)).toBe(false);

    // 8. reszta bit-identyczna
    for (const [key, value] of Object.entries(before.data.prices as Record<string, unknown>)) {
      if (key === LEGACY_KEY_A1 || key === LEGACY_KEY_A2) continue;
      expect(after.data.prices[key]).toBe(value);
    }
    for (const v of before.data.variants as { key: string }[]) {
      if (v.key === LEGACY_KEY_A1 || v.key === LEGACY_KEY_A2) continue;
      expect(after.data.variants.find((x: { key: string }) => x.key === v.key)).toEqual(v);
    }
  });

  it("9. nieprawidłowy legacy scope (dokładnie 1 zamiast 2 rekordów A) blokuje działanie", () => {
    const input = freshInput();
    const data = JSON.parse(readFileSync(input, "utf-8"));
    // Usuwamy TYLKO JEDEN z dwóch legacy rekordów A — zostaje dokładnie 1,
    // co jest scope mismatchem (0 byłoby poprawnym no-opem, 2 poprawnym stanem).
    data.data.variants = data.data.variants.filter((v: { key: string }) => v.key !== LEGACY_KEY_A1);
    writeFileSync(input, JSON.stringify(data), "utf-8");

    const { status, stderr } = runCli(["--input", input, "--dry-run"]);
    expect(status).toBe(2); // EXIT_LEGACY_SCOPE_MISMATCH
    expect(stderr).toContain("LEGACY_SCOPE_MISMATCH");
  });

  it("10. B_CONFLICT (istniejące B niezgodne z modelem) blokuje działanie", () => {
    const input = freshInput();
    const data = JSON.parse(readFileSync(input, "utf-8"));
    data.data.prices[B10] = 999;
    data.data.variants.push({
      key: B10,
      categoryId: "plakaty-a4-a3",
      subcategoryPrefix: "plakaty-a4-a3-plakaty-ekonomiczne-a4-",
      subgroupLabel: "Plakaty ekonomiczne A4",
      label: "10 szt.",
      legend: "",
      visibleInSettings: true,
      visibleInCalculator: true,
      sortOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      calcScheme: "interpolated",
      materialSizeOptions: [{ material: "130", size: "A4" }],
    });
    writeFileSync(input, JSON.stringify(data), "utf-8");

    const { status, stderr } = runCli(["--input", input, "--dry-run"]);
    expect(status).toBe(3); // EXIT_B_CONFLICT
    expect(stderr).toContain("B_CONFLICT");
  });

  it("11. nieprawidłowy JSON blokuje działanie", () => {
    workDir = mkdtempSync(join(tmpdir(), "razdwa-migrate-runner-"));
    const input = join(workDir, "bad.json");
    writeFileSync(input, "{ to nie jest json", "utf-8");

    const { status, stderr } = runCli(["--input", input, "--dry-run"]);
    expect(status).toBe(1); // EXIT_INVALID_INPUT
    expect(stderr).toContain("INVALID_JSON");
  });

  it("12. runner nie wykonuje żadnych requestów sieciowych", () => {
    const source = readFileSync(RUNNER_SCRIPT, "utf-8");
    for (const forbidden of [
      "fetch(",
      "http.request",
      "https.request",
      "XMLHttpRequest",
      "script.google.com",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    // Dowód uzupełniający: każdy spawn powyżej (w tym pełny --apply w teście
    // 5/6/7/8) kończy się deterministycznym kodem wyjścia w tym samym
    // środowisku sandboxowym, w którym każde nieautoryzowane wyjście
    // sieciowe jest blokowane przez politykę proxy — gdyby runner próbował
    // się z kimkolwiek połączyć, te testy albo zawiesiłyby proces, albo
    // zwróciły błąd sieciowy zamiast czystego kodu wyjścia.
  });

  it("format wejścia inny niż razdwa-configuration jest odrzucany jako INVALID_FORMAT", () => {
    workDir = mkdtempSync(join(tmpdir(), "razdwa-migrate-runner-"));
    const input = join(workDir, "wrong-format.json");
    writeFileSync(input, JSON.stringify({ format: "cos-innego" }), "utf-8");

    const { status, stderr } = runCli(["--input", input, "--dry-run"]);
    expect(status).toBe(1);
    expect(stderr).toContain("INVALID_FORMAT");
  });

  it("brak --input konczy się błędem użycia", () => {
    const { status, stderr } = runCli(["--dry-run"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("--input");
  });

  it("brak --dry-run i --apply konczy się błędem użycia", () => {
    const input = freshInput();
    const { status, stderr } = runCli(["--input", input]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("--dry-run");
  });
});
