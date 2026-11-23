import { describe, it, expect } from "vitest";
import { deleteConfirmMessage } from "../src/ui/views/ustawienia";

describe("deleteConfirmMessage", () => {
  it("buduje treść potwierdzenia z nazwą pozycji i odniesieniem do „Zapisz cennik”", () => {
    expect(deleteConfirmMessage("Plakat A2")).toBe(
      "Usunąć „Plakat A2”? Zmiana zostanie zapisana po „Zapisz cennik”."
    );
  });

  it("wstawia dowolną etykietę bez zaszytych nazw kategorii", () => {
    expect(deleteConfirmMessage("ZZZ-Podgrupa – 100 szt.")).toBe(
      "Usunąć „ZZZ-Podgrupa – 100 szt.”? Zmiana zostanie zapisana po „Zapisz cennik”."
    );
  });
});
