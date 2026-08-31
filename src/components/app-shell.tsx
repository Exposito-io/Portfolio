import Link from "next/link";
import Image from "next/image";
import { LogOut, Newspaper, NotebookText, Settings } from "lucide-react";

import { auth, signOut } from "@/auth";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await auth();

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-[#1f2523]">
      <header className="border-b border-black/10 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-stretch gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.svg" alt="" width={36} height={36} priority />
            <span>
              <span className="block text-base font-semibold">Portfolio</span>
              <span className="block text-xs text-[#6b716e]">
                DeFi net worth tracker
              </span>
            </span>
          </Link>
          <nav className="app-nav flex w-full items-center gap-1 overflow-x-auto sm:w-auto sm:gap-2">
            <Link className="nav-link" href="/">
              Portfolio
            </Link>
            <Link className="nav-link" href="/journal">
              <NotebookText size={16} aria-hidden="true" />
              Journal
            </Link>
            <Link className="nav-link" href="/news">
              <Newspaper size={16} aria-hidden="true" />
              News
            </Link>
            <Link className="nav-link" href="/settings">
              <Settings size={16} aria-hidden="true" />
              Settings
            </Link>
            <form action={handleSignOut} className="ml-auto sm:ml-1">
              <button
                className="nav-link"
                type="submit"
                title={session?.user?.email ?? "Sign out"}
              >
                <LogOut size={16} aria-hidden="true" />
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
