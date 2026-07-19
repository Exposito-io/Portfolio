import { describe, expect, it, vi } from "vitest";

import { fetchHyperliquidAccount } from "@/lib/hyperliquid";
import type { PortfolioAccount } from "@/lib/types";

const account: PortfolioAccount = {
  id: "hl1",
  source: "hyperliquid",
  label: "Hyperliquid",
  address: "0x0000000000000000000000000000000000000000",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("Hyperliquid normalization", () => {
  it("normalizes account value and open positions", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        marginSummary: {
          accountValue: "3000.42",
          totalNtlPos: "2500",
          totalMarginUsed: "400",
        },
        withdrawable: "1200",
        assetPositions: [
          {
            position: {
              coin: "SOL",
              szi: "12",
              positionValue: "2500",
              unrealizedPnl: "100",
              marginUsed: "400",
            },
          },
        ],
      }),
    });

    const result = await fetchHyperliquidAccount(account, fetcher);

    expect(result.summary.netWorthUsd).toBe(3000.42);
    expect(result.positions).toHaveLength(2);
    expect(result.positions[1]).toMatchObject({
      symbol: "SOL",
      valueUsd: 2500,
      quantity: 12,
    });
  });
});
