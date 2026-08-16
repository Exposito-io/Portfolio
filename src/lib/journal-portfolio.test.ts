import { describe, expect, it } from "vitest";

import { calculatePortfolioPercent } from "@/lib/journal-portfolio";

describe("journal portfolio allocation", () => {
  it("calculates the position share of gross portfolio investments", () => {
    expect(calculatePortfolioPercent(250_000, 1_000_000)).toBe(25);
  });

  it("returns null when gross investments are unavailable or invalid", () => {
    expect(calculatePortfolioPercent(250_000, null)).toBeNull();
    expect(calculatePortfolioPercent(250_000, 0)).toBeNull();
  });
});
