import { describe, it, expect } from "vitest";
import { sanitizeLabelText } from "../src/core/compat";

describe("sanitizeLabelText", () => {
  it("passes through clean text unchanged", () => {
    expect(sanitizeLabelText("Wizytówki")).toBe("Wizytówki");
  });

  it("replaces real newline with space", () => {
    expect(sanitizeLabelText("Druk\nA4")).toBe("Druk A4");
  });

  it("replaces carriage return with space", () => {
    expect(sanitizeLabelText("Druk\rA4")).toBe("Druk A4");
  });

  it("replaces CRLF with single space", () => {
    expect(sanitizeLabelText("Druk\r\nA4")).toBe("Druk A4");
  });

  it("replaces tab with space", () => {
    expect(sanitizeLabelText("Druk\tA4")).toBe("Druk A4");
  });

  it("replaces literal backslash-n with space", () => {
    expect(sanitizeLabelText("Druk\\nA4")).toBe("Druk A4");
  });

  it("collapses multiple spaces from replaced newlines", () => {
    expect(sanitizeLabelText("Druk\n\nA4")).toBe("Druk A4");
  });

  it("trims leading and trailing whitespace", () => {
    expect(sanitizeLabelText("  Druk A4  ")).toBe("Druk A4");
  });

  it("handles empty string", () => {
    expect(sanitizeLabelText("")).toBe("");
  });

  it("handles string with only newlines", () => {
    expect(sanitizeLabelText("\n\r\n")).toBe("");
  });
});
