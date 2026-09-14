// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({
  default: () =>
    function MockStatsChart() {
      return <div data-testid="stats-pnl-chart">Stats chart</div>;
    },
}));
vi.mock("@/components/allocation-chart", () => ({
  AllocationChart: () => <div data-testid="allocation-chart" />,
}));

import { PortfolioDashboard } from "@/components/portfolio-dashboard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const portfolioPayload = {
  mode: "live",
  selectedDateKey: "2026-09-14",
  effectiveDateKey: "2026-09-14",
  timezone: "America/Toronto",
  accountsCount: 1,
  snapshot: {
    dateKey: "2026-09-14",
    timezone: "America/Toronto",
    capturedAt: "2026-09-14T12:00:00.000Z",
    totals: {
      netWorthUsd: 100,
      totalInvestmentsUsd: 100,
      totalDebtUsd: 0,
      yearlyPnlUsd: 5,
      aaveHealthFactor: null,
    },
    sourceSummaries: [],
    positions: [],
    sourceErrors: [],
  },
};

const statsPayload = {
  accountsCount: 1,
  sourceErrors: [],
  endTime: 1,
  orders: [
    {
      id: "order-1",
      accountId: "account-1",
      accountLabel: "Wallet",
      coin: "BTC",
      side: "Sell",
      direction: "Close Long",
      averagePrice: 100,
      totalSize: 1,
      notionalUsd: 100,
      fee: 0,
      feeToken: "USDC",
      closedPnl: 5,
      realizedPnlBasisUsd: 95,
      firstTime: 1,
      lastTime: 1,
      orderId: 1,
      fillCount: 1,
    },
  ],
};

describe("PortfolioDashboard", () => {
  it("renders the Stats cumulative P/L chart below the portfolio sections", async () => {
    const fetcher = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url === "/api/stats" ? statsPayload : portfolioPayload,
          ),
          { status: 200 },
        ),
      );
    });
    vi.stubGlobal("fetch", fetcher);

    render(<PortfolioDashboard />);

    const chart = await screen.findByTestId("stats-pnl-chart");
    expect(chart).toBeVisible();
    expect(screen.getByRole("heading", { name: "Debts" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Cumulative realized P/L" }),
    ).toBeVisible();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/stats",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    expect(screen.getAllByText("$5")).toHaveLength(2);

    const statsRequestsBeforeRefresh = fetcher.mock.calls.filter(
      ([input]) => String(input) === "/api/stats",
    ).length;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(
      fetcher.mock.calls.filter(([input]) => String(input) === "/api/stats"),
    ).toHaveLength(statsRequestsBeforeRefresh + 1);
  });
});
