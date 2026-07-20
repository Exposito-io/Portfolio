import { describe, expect, it } from "vitest";

import {
  getDateKey,
  getZonedDateEndMs,
  getZonedDateStartMs,
  isValidDateKey,
} from "@/lib/date";

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

  it("converts date keys to local day boundaries", () => {
    expect(
      new Date(getZonedDateStartMs("2026-07-20", "America/Toronto")).toISOString(),
    ).toBe("2026-07-20T04:00:00.000Z");
    expect(
      new Date(getZonedDateEndMs("2026-01-20", "America/Toronto")).toISOString(),
    ).toBe("2026-01-21T04:59:59.999Z");
  });
});
