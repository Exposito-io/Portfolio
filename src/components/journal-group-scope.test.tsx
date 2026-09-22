// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { JournalGroupScope } from "@/components/journal-group-scope";
import type { JournalTradeGroup } from "@/lib/types";

const group = {
  id: "group-1",
  members: [
    { id: "trade-1", asset: { coin: "CRWV" }, endDate: null },
    { id: "trade-2", asset: { coin: "GOOGL" }, endDate: "2026-09-20" },
  ],
} as JournalTradeGroup;

afterEach(cleanup);

describe("JournalGroupScope", () => {
  it("links from a member trade back to All and marks the member active", () => {
    render(<JournalGroupScope activeTradeId="trade-1" group={group} />);

    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/journal/groups/group-1",
    );
    expect(screen.getByText("CRWV").closest("span")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /GOOGL/ })).toHaveAttribute(
      "href",
      "/journal/trade-2",
    );
  });

  it("marks All active on the grouped overview", () => {
    render(<JournalGroupScope activeTradeId={null} group={group} />);

    expect(screen.getByText("All").closest("span")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /CRWV/ })).toHaveAttribute(
      "href",
      "/journal/trade-1",
    );
  });
});
