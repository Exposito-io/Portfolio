// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppNavigation } from "@/components/app-navigation";

afterEach(cleanup);

describe("AppNavigation", () => {
  it("opens the mobile menu and closes it after a navigation choice", async () => {
    const user = userEvent.setup();
    const signOutAction = vi.fn(async () => undefined);

    render(
      <AppNavigation
        email="investor@example.com"
        signOutAction={signOutAction}
      />,
    );

    const menuButton = screen.getByRole("button", {
      name: "Open navigation menu",
    });
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
      hidden: true,
    });

    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(navigation).not.toHaveClass("app-nav-open");

    await user.click(menuButton);

    expect(
      screen.getByRole("button", { name: "Close navigation menu" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(navigation).toHaveClass("app-nav-open");
    expect(screen.getByRole("link", { name: "Journal" })).toHaveAttribute(
      "href",
      "/journal",
    );

    navigation.addEventListener("click", (event) => event.preventDefault());
    await user.click(screen.getByRole("link", { name: "Journal" }));

    expect(
      screen.getByRole("button", { name: "Open navigation menu" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(navigation).not.toHaveClass("app-nav-open");
  });
});
