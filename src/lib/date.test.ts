import { describe, expect, it } from "vitest";

import {
  formatJournalDateTimeKey,
  getDateKey,
  getDateTimeKey,
  getJournalDateKey,
  getTimeKey,
  getZonedDateEndMs,
  getZonedDateStartMs,
  getZonedDateTimeMs,
  getZonedJournalDateMs,
  isValidDateKey,
  isValidDateTimeKey,
  isValidTimeKey,
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

  it("formats, validates, and converts local times", () => {
    expect(
      getTimeKey(new Date("2026-01-01T02:35:00.000Z"), "America/Toronto"),
    ).toBe("21:35");
    expect(isValidTimeKey("23:59")).toBe(true);
    expect(isValidTimeKey("24:00")).toBe(false);
    expect(
      new Date(
        getZonedDateTimeMs("2026-07-20", "14:35", "America/Toronto"),
      ).toISOString(),
    ).toBe("2026-07-20T18:35:00.000Z");
    expect(
      getDateTimeKey(
        new Date("2026-07-20T18:35:00.000Z"),
        "America/Toronto",
      ),
    ).toBe("2026-07-20T14:35");
    expect(isValidDateTimeKey("2026-07-20T14:35")).toBe(true);
    expect(isValidDateTimeKey("2026-07-20")).toBe(true);
    expect(isValidDateTimeKey("2026-07-20T25:00")).toBe(false);
    expect(getJournalDateKey("2026-07-20T14:35")).toBe("2026-07-20");
    expect(formatJournalDateTimeKey("2026-07-20T14:35")).toBe(
      "2026-07-20 · 2:35 PM",
    );
    expect(
      new Date(
        getZonedJournalDateMs(
          "2026-07-20T14:35",
          "America/Toronto",
          "start",
        ),
      ).toISOString(),
    ).toBe("2026-07-20T18:35:00.000Z");
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
