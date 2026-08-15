import { describe, expect, it } from "vitest";

import { calculateJournalFundingSummary } from "@/lib/journal-funding";

const HOUR_MS = 60 * 60 * 1000;

describe("journal funding summary", () => {
  it("annualizes the current rate and trailing averages", () => {
    const now = 30 * 24 * HOUR_MS;
    const summary = calculateJournalFundingSummary(
      [
        { coin: "ETH", fundingRate: 0.00001, time: now - 29 * 24 * HOUR_MS },
        { coin: "ETH", fundingRate: 0.00002, time: now - 6 * 24 * HOUR_MS },
        { coin: "ETH", fundingRate: -0.00001, time: now - 12 * HOUR_MS },
      ],
      now,
    );

    expect(summary).toEqual({
      currentAnnualizedPercent: -8.76,
      average24hAnnualizedPercent: -8.76,
      average7dAnnualizedPercent: 4.38,
      average30dAnnualizedPercent: 5.84,
    });
  });

  it("returns null without valid funding rates", () => {
    expect(calculateJournalFundingSummary([])).toBeNull();
  });

  it("uses the live hourly rate for the current annualized value", () => {
    const summary = calculateJournalFundingSummary(
      [{ coin: "ETH", fundingRate: 0.00001, time: 1 }],
      1,
      0.00002,
    );

    expect(summary?.currentAnnualizedPercent).toBe(17.52);
  });
});
