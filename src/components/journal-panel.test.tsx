// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { JournalPanel } from "@/components/journal-panel";
import type { JournalTrade } from "@/lib/types";

vi.mock("@/components/journal-trade-card", () => ({
  JournalTradeCard: ({ trade }: { trade: JournalTrade }) => <div>{trade.title}</div>,
}));
vi.mock("@/components/journal-trade-form", () => ({ JournalTradeForm: () => null }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("fetches closed trade history only after expanding the closed section", async () => {
  const trades = [
    { id: "open", kind: "trade", title: "Open trade", endDate: null, asset: { chartCoin: "BTC" } },
    { id: "closed", kind: "trade", title: "Closed trade", endDate: "2026-09-01", asset: { chartCoin: "ETH" } },
  ];
  const fetcher = vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url === "/api/journal/trades" ? { trades }
      : url === "/api/hyperliquid/markets" ? { markets: [] }
        : url === "/api/settings" ? { settings: { journalDescriptionTemplate: "" } }
          : url.startsWith("/api/hyperliquid/candles") ? { candles: [] }
            : {},
  }));
  vi.stubGlobal("fetch", fetcher);
  render(<JournalPanel />);

  await screen.findByText("Open trade");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes("/open/filled-orders"))).toBe(true));
  expect(fetcher.mock.calls.some(([url]) => url.includes("/closed/filled-orders"))).toBe(false);
  expect(fetcher.mock.calls.some(([url]) => url.includes("coin=ETH"))).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: /Closed journal items/ }));
  await screen.findByText("Closed trade");
  await waitFor(() => expect(fetcher.mock.calls.some(([url]) => url.includes("/closed/filled-orders"))).toBe(true));
  expect(fetcher.mock.calls.some(([url]) => url.includes("coin=ETH"))).toBe(true);
});
