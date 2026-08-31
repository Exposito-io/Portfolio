import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { AppNavigation } from "@/components/app-navigation";
import {
  getAllowedSession,
  requireAllowedSession,
} from "@/lib/authorization";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const session = await getAllowedSession();
  if (!session) redirect("/sign-in");

  async function handleSignOut() {
    "use server";
    await requireAllowedSession();
    await signOut({ redirectTo: "/sign-in" });
  }

  return (
    <div className="min-h-screen bg-[#f6f4ef] text-[#1f2523]">
      <header className="border-b border-black/10 bg-white/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:flex-nowrap sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.svg" alt="" width={36} height={36} priority />
            <span>
              <span className="block text-base font-semibold">Portfolio</span>
              <span className="block text-xs text-[#6b716e]">
                DeFi net worth tracker
              </span>
            </span>
          </Link>
          <AppNavigation
            email={session.user?.email}
            signOutAction={handleSignOut}
          />
        </div>
      </header>
      {children}
    </div>
  );
}
