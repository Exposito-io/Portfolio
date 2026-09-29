// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HyperliquidSimulator } from "@/components/hyperliquid-simulator";
import type { HyperliquidSimulatorSnapshot } from "@/lib/types";

const account = {
  id: "hl1",
  source: "hyperliquid" as const,
  label: "Main Hyperliquid",
  address: "0x0000000000000000000000000000000000000000",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

const snapshot: HyperliquidSimulatorSnapshot = {
  account,
  accountMode: "unifiedAccount",
  capturedAt: "2026-09-28T12:00:00.000Z",
  accountEquity: 1000,
  spotUsdcBalance: 1000,
  crossMaintenance: 5,
  isolatedMargin: 0,
  unsupportedPositionCount: 0,
  markets: [
    {
      id: "default:BTC",
      dex: "",
      coin: "BTC",
      label: "BTC",
      markPrice: 100,
      sizeDecimals: 2,
      maxLeverage: 10,
      marginMode: "cross",
      marginTiers: [{ lowerBound: 0, maxLeverage: 10 }],
    },
    {
      id: "default:ETH",
      dex: "",
      coin: "ETH",
      label: "ETH",
      markPrice: 50,
      sizeDecimals: 2,
      maxLeverage: 10,
      marginMode: "cross",
      marginTiers: [{ lowerBound: 0, maxLeverage: 10 }],
    },
  ],
  positions: [
    {
      id: "default:BTC",
      marketId: "default:BTC",
      dex: "",
      coin: "BTC",
      signedSize: 1,
      entryPrice: 90,
      markPrice: 100,
      liquidationPrice: null,
      positionValue: 100,
      unrealizedPnl: 10,
      marginMode: "cross",
      leverage: 5,
      isolatedRawUsd: null,
      marginUsed: 20,
      maxLeverage: 10,
      accruedFunding: -1.25,
      sizeDecimals: 2,
      marginTiers: [{ lowerBound: 0, maxLeverage: 10 }],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/api/accounts") {
        return new Response(JSON.stringify({ accounts: [account] }), {
          status: 200,
        });
      }
      if (url.startsWith("/api/hyperliquid/simulator")) {
        return new Response(JSON.stringify({ snapshot }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("HyperliquidSimulator", () => {
  it("loads live positions and updates the analysis when target size changes", async () => {
    const user = userEvent.setup();
    render(<HyperliquidSimulator />);

    expect(
      screen.getByRole("heading", { name: "Hyperliquid simulator" }),
    ).toBeInTheDocument();
    const size = await screen.findByRole("spinbutton", {
      name: "BTC target size",
    });
    await user.clear(size);
    await user.type(size, "2");

    expect(await screen.findByText("Increase BTC long by 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Review impact/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Scenario impact");
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Nothing will be sent to Hyperliquid",
    );
    expect(
      screen.queryByRole("button", { name: /submit|trade|place order/i }),
    ).not.toBeInTheDocument();
  });

  it("simulates a USD order for a new market without a network write", async () => {
    const user = userEvent.setup();
    render(<HyperliquidSimulator />);
    await screen.findByRole("spinbutton", { name: "BTC target size" });

    await user.click(screen.getByRole("button", { name: "Simulate order" }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Market" }),
      "default:ETH",
    );
    const value = within(dialog).getByRole("spinbutton", { name: "Order value" });
    await user.clear(value);
    await user.type(value, "100");
    expect(dialog).toHaveTextContent("Calculated size2");
    expect(dialog).toHaveTextContent("Liquidation price—");
    expect(dialog).toHaveTextContent("Additional initial margin$20.00");
    await user.click(
      within(dialog).getByRole("button", { name: "Apply to scenario" }),
    );

    expect(
      await screen.findByRole("spinbutton", { name: "ETH target size" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Buy \$100 of ETH at \$50/)).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("stacks orders and replaces their ledger after a direct edit", async () => {
    const user = userEvent.setup();
    render(<HyperliquidSimulator />);
    const targetSize = await screen.findByRole("spinbutton", {
      name: "BTC target size",
    });

    for (const amount of [100, 50]) {
      await user.click(screen.getByRole("button", { name: "Simulate order" }));
      const dialog = screen.getByRole("dialog");
      const value = within(dialog).getByRole("spinbutton", { name: "Order value" });
      await user.clear(value);
      await user.type(value, String(amount));
      await user.click(
        within(dialog).getByRole("button", { name: "Apply to scenario" }),
      );
    }

    expect(screen.getByText(/Pending changes \(2\)/)).toBeInTheDocument();
    await user.clear(targetSize);
    await user.type(targetSize, "3");
    expect(screen.getByText(/Pending changes \(1\)/)).toBeInTheDocument();
    expect(screen.getByText("Increase BTC long by 2")).toBeInTheDocument();
  });

  it("shows the configured-account empty state", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ accounts: [] }), { status: 200 }),
    );
    render(<HyperliquidSimulator />);
    expect(
      await screen.findByRole("heading", {
        name: "No Hyperliquid accounts configured",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
  });
});
