import Link from "next/link";
import { BarChart3, Settings } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f4ef] text-[#1f2523]">
      <header className="border-b border-black/10 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#123d34] text-white">
              <BarChart3 size={20} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-base font-semibold">Portfolio</span>
              <span className="block text-xs text-[#6b716e]">
                DeFi net worth tracker
              </span>
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link className="nav-link" href="/">
              Portfolio
            </Link>
            <Link className="nav-link" href="/settings">
              <Settings size={16} aria-hidden="true" />
              Settings
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
