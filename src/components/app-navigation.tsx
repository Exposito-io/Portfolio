"use client";

import Link from "next/link";
import {
  ChartNoAxesCombined,
  LogOut,
  Menu,
  Newspaper,
  NotebookText,
  Settings,
  X,
} from "lucide-react";
import { useState } from "react";

type AppNavigationProps = {
  email?: string | null;
  signOutAction: () => Promise<void>;
};

export function AppNavigation({ email, signOutAction }: AppNavigationProps) {
  const [isOpen, setIsOpen] = useState(false);

  function closeMenu() {
    setIsOpen(false);
  }

  return (
    <>
      <button
        aria-controls="app-navigation-menu"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close navigation menu" : "Open navigation menu"}
        className="mobile-menu-button lg:hidden"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        {isOpen ? (
          <X size={22} aria-hidden="true" />
        ) : (
          <Menu size={22} aria-hidden="true" />
        )}
      </button>
      <nav
        aria-label="Primary navigation"
        className={`app-nav ${isOpen ? "app-nav-open" : ""} order-last w-full flex-col items-stretch gap-1 lg:order-none lg:w-auto lg:flex-row lg:items-center lg:gap-2`}
        id="app-navigation-menu"
      >
        <Link className="nav-link" href="/" onClick={closeMenu}>
          Portfolio
        </Link>
        <Link className="nav-link" href="/journal" onClick={closeMenu}>
          <NotebookText size={16} aria-hidden="true" />
          Journal
        </Link>
        <Link className="nav-link" href="/stats" onClick={closeMenu}>
          <ChartNoAxesCombined size={16} aria-hidden="true" />
          Stats
        </Link>
        <Link className="nav-link" href="/news" onClick={closeMenu}>
          <Newspaper size={16} aria-hidden="true" />
          News
        </Link>
        <Link className="nav-link" href="/settings" onClick={closeMenu}>
          <Settings size={16} aria-hidden="true" />
          Settings
        </Link>
        <form action={signOutAction} className="w-full lg:ml-1 lg:w-auto">
          <button
            className="nav-link w-full lg:w-auto"
            type="submit"
            title={email ?? "Sign out"}
          >
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </form>
      </nav>
    </>
  );
}
