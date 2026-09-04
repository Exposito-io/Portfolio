// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JournalDetailEntries } from "@/components/journal-detail-entries";

afterEach(cleanup);

describe("JournalDetailEntries", () => {
  it("shows the new-entry action in the Entries header and opens it", async () => {
    const onNewEntry = vi.fn();
    const user = userEvent.setup();

    render(
      <JournalDetailEntries
        entries={[]}
        orderTotals={new Map()}
        ordersLoading={false}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
        onNewEntry={onNewEntry}
      />,
    );

    const entriesSection = screen.getByRole("heading", { name: "Entries" })
      .closest("section");
    expect(entriesSection).not.toBeNull();

    const newEntryButton = within(entriesSection as HTMLElement).getByRole(
      "button",
      { name: "New journal entry" },
    );
    await user.click(newEntryButton);

    expect(onNewEntry).toHaveBeenCalledOnce();
  });
});
