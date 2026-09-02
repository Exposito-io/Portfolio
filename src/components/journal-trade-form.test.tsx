// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalTradeForm } from "@/components/journal-trade-form";

afterEach(cleanup);

const market = {
  kind: "perp" as const,
  label: "ETH perp",
  coin: "ETH",
  chartCoin: "ETH",
};

describe("JournalTradeForm", () => {
  it("keeps direction available and submits it for trade ideas", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);

    render(
      <JournalTradeForm
        markets={[market]}
        saving={false}
        submitLabel="Add item"
        onSubmit={onSubmit}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", { name: "This is a trade idea" }),
    );

    const longDirection = screen.getByRole("radio", { name: "long" });
    const shortDirection = screen.getByRole("radio", { name: "short" });
    expect(longDirection).toBeVisible();
    expect(shortDirection).toBeVisible();

    await user.click(shortDirection);
    await user.type(screen.getByLabelText("Title"), "ETH breakdown idea");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "idea",
          direction: "short",
          title: "ETH breakdown idea",
          asset: market,
        }),
      ),
    );
  });
});
