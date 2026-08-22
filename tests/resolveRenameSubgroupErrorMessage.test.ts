import { describe, it, expect } from "vitest";
import { resolveRenameSubgroupErrorMessage } from "../src/ui/views/ustawienia";

describe("resolveRenameSubgroupErrorMessage", () => {
  it('maps "Subgroup prefix does not exist: ..." to a localized Polish message', () => {
    expect(
      resolveRenameSubgroupErrorMessage("Subgroup prefix does not exist: plakaty-brak-")
    ).toBe("⚠️ Wybrana podgrupa już nie istnieje.");
  });

  it('maps "Subgroup label cannot be empty" to a localized Polish message', () => {
    expect(resolveRenameSubgroupErrorMessage("Subgroup label cannot be empty")).toBe(
      "⚠️ Nazwa podgrupy nie może być pusta."
    );
  });

  it("falls back to a generic Polish message for an unrecognized error string", () => {
    expect(resolveRenameSubgroupErrorMessage("Network request failed")).toBe(
      "⚠️ Nie udało się zapisać nazwy."
    );
  });
});
