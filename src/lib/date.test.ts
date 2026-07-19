import { describe, expect, it } from "vitest";

import { getDateKey, isValidDateKey } from "@/lib/date";

describe("date helpers", () => {
  it("formats date keys in the requested timezone", () => {
    expect(
      getDateKey(new Date("2026-01-01T02:00:00.000Z"), "America/Toronto"),
    ).toBe("2025-12-31");
  });

  it("validates date-key shape", () => {
    expect(isValidDateKey("2026-07-19")).toBe(true);
    expect(isValidDateKey("07/19/2026")).toBe(false);
  });
});
