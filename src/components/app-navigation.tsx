"use client";

import Link from "next/link";
import {
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
        className="mobile-menu-button sm:hidden"
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
        className={`app-nav ${isOpen ? "app-nav-open" : ""} order-last w-full flex-col items-stretch gap-1 sm:order-none sm:w-auto sm:flex-row sm:items-center sm:gap-2`}
        id="app-navigation-menu"
      >
        <Link className="nav-link" href="/" onClick={closeMenu}>
          Portfolio
        </Link>
        <Link className="nav-link" href="/journal" onClick={closeMenu}>
          <NotebookText size={16} aria-hidden="true" />
          Journal
        </Link>
        <Link className="nav-link" href="/news" onClick={closeMenu}>
          <Newspaper size={16} aria-hidden="true" />
          News
        </Link>
        <Link className="nav-link" href="/settings" onClick={closeMenu}>
          <Settings size={16} aria-hidden="true" />
          Settings
        </Link>
        <form action={signOutAction} className="w-full sm:ml-1 sm:w-auto">
          <button
            className="nav-link w-full sm:w-auto"
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
