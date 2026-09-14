// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatsPanel } from "@/components/stats-panel";
import type { HyperliquidFilledOrder } from "@/lib/types";

vi.mock("next/dynamic", () => ({
  default: () =>
    function Chart() {
      return <div>Chart loaded</div>;
    },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const orders: HyperliquidFilledOrder[] = Array.from(
  { length: 51 },
  (_, index) => ({
    id: String(index),
    accountId: "wallet",
    accountLabel: "Wallet",
    coin: `ASSET${index}`,
    side: "Sell",
    direction: "Close Long",
    averagePrice: 0.0037295,
    totalSize: 1,
    notionalUsd: 1,
    fee: 0.1,
    feeToken: "USDC",
    closedPnl: 1.25,
    realizedPnlBasisUsd: 1,
    firstTime: 100 - index,
    lastTime: 100 - index,
    orderId: index,
    fillCount: 1,
  }),
);
const payload = { orders, accountsCount: 1, sourceErrors: [], endTime: 100 };

function respond(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe("StatsPanel", () => {
  it("paginates the table while keeping the full-history cumulative total and refreshes back to page one", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn().mockResolvedValue(respond(payload));
    vi.stubGlobal("fetch", fetcher);
    render(<StatsPanel />);
    await screen.findByText("Orders 1–50 of 51");
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      51,
    );
    expect(
      within(screen.getAllByRole("row")[1]).getByText("$63.75"),
    ).toBeVisible();
    expect(screen.getAllByText("$0.0037295")).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Orders 51–51 of 51")).toBeVisible();
    expect(screen.getByText("ASSET50")).toBeVisible();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByText("$63.75")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Orders 1–50 of 51");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shows a recoverable request error and retries", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          respond({ error: "Temporarily unavailable" }, false),
        )
        .mockResolvedValueOnce(respond(payload)),
    );
    render(<StatsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Temporarily unavailable",
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Orders 1–50 of 51");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("directs users without configured wallets to Settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          respond({ ...payload, orders: [], accountsCount: 0 }),
        ),
    );
    render(<StatsPanel />);
    await screen.findByText("No Hyperliquid accounts configured");
    expect(
      screen.getByRole("link", { name: /Add an enabled Hyperliquid account/ }),
    ).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("marks incomplete totals as partial while displaying successful transactions", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          respond({
            ...payload,
            accountsCount: 2,
            sourceErrors: [
              {
                accountId: "other",
                accountLabel: "Other",
                message: "Rate limited",
              },
            ],
          }),
        ),
    );
    render(<StatsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Partial results",
    );
    expect(screen.getByRole("table")).toBeVisible();
  });

  it("does not mistake failed wallets for an empty history or zero P/L", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          respond({
            ...payload,
            orders: [],
            sourceErrors: [
              {
                accountId: "wallet",
                accountLabel: "Wallet",
                message: "Rate limited",
              },
            ],
          }),
        ),
    );
    render(<StatsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load transaction history",
    );
    expect(screen.queryByText("No filled orders")).not.toBeInTheDocument();
    expect(screen.getByText("N/A")).toBeVisible();
  });
});
