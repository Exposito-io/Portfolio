// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "@/components/settings-panel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("journal template settings", () => {
  it("edits, adds, removes and persists templates without changing another template's content", async () => {
    let templates = [
      {
        id: "default",
        title: "Default template",
        descriptionMarkdown: "  ## Existing\n ",
      },
    ];
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/accounts")
        return { ok: true, json: async () => ({ accounts: [] }) };
      if (options?.method === "PUT")
        templates = JSON.parse(
          options.body as string,
        ).journalDescriptionTemplates;
      return {
        ok: true,
        json: async () => ({
          settings: { journalDescriptionTemplates: templates },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    const view = render(<SettingsPanel />);
    expect(await screen.findByLabelText("Description template")).toHaveValue(
      "  ## Existing\n ",
    );
    await user.clear(screen.getByLabelText("Template title"));
    await user.type(screen.getByLabelText("Template title"), "My setup");
    await user.click(screen.getByRole("button", { name: "Add template" }));
    await user.type(screen.getByLabelText("Template title"), "Review");
    await user.type(
      screen.getByLabelText("Description template"),
      "Lessons learned",
    );
    expect(screen.getAllByLabelText("Description template")).toHaveLength(1);
    await user.selectOptions(
      screen.getByLabelText("Journal template"),
      "default",
    );
    expect(screen.getByLabelText("Template title")).toHaveValue("My setup");
    expect(screen.getByLabelText("Description template")).toHaveValue(
      "  ## Existing\n ",
    );
    await user.selectOptions(
      screen.getByLabelText("Journal template"),
      screen.getByRole("option", { name: "Review" }),
    );
    expect(screen.getByLabelText("Description template")).toHaveValue(
      "Lessons learned",
    );
    await user.click(screen.getByRole("button", { name: "Save templates" }));
    await screen.findByText("Saved");
    expect(templates).toEqual([
      {
        id: "default",
        title: "My setup",
        descriptionMarkdown: "  ## Existing\n ",
      },
      {
        id: expect.any(String),
        title: "Review",
        descriptionMarkdown: "Lessons learned",
      },
    ]);
    view.unmount();
    render(<SettingsPanel />);
    expect(await screen.findByLabelText("Template title")).toHaveValue(
      "My setup",
    );
    expect(screen.getByRole("option", { name: "Review" })).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Remove selected template" }),
    );
    expect(screen.getByLabelText("Description template")).toHaveValue(
      "Lessons learned",
    );
    await user.click(screen.getByRole("button", { name: "Save templates" }));
    await waitFor(() => expect(templates).toHaveLength(1));
    await user.click(
      screen.getByRole("button", { name: "Remove selected template" }),
    );
    await user.click(screen.getByRole("button", { name: "Save templates" }));
    await waitFor(() => expect(templates).toEqual([]));
  });

  it("prevents saving an empty collection when settings failed to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => ({
        ok: url === "/api/accounts",
        json: async () =>
          url === "/api/accounts"
            ? { accounts: [] }
            : { error: "Settings unavailable" },
      })),
    );
    render(<SettingsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Settings unavailable",
    );
    expect(
      screen.queryByRole("button", { name: "Save templates" }),
    ).not.toBeInTheDocument();
  });

  it("keeps unsaved content and shows a failed save next to the templates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, options) => ({
        ok: !options?.method,
        json: async () =>
          options?.method
            ? { error: "Unable to save settings." }
            : url === "/api/accounts"
              ? { accounts: [] }
              : { settings: { journalDescriptionTemplates: [] } },
      })),
    );
    const user = userEvent.setup();
    render(<SettingsPanel />);
    await user.click(
      await screen.findByRole("button", { name: "Add template" }),
    );
    await user.type(screen.getByLabelText("Template title"), "Draft");
    await user.type(
      screen.getByLabelText("Description template"),
      "Do not lose this",
    );
    await user.click(screen.getByRole("button", { name: "Save templates" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to save settings.",
    );
    expect(screen.getByLabelText("Description template")).toHaveValue(
      "Do not lose this",
    );
  });
});
