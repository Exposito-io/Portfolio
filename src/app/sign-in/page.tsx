import Image from "next/image";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { isAllowedEmail } from "@/lib/auth-allowlist";

type SignInPageProps = {
  searchParams: Promise<{
    callbackUrl?: string | string[];
    error?: string | string[];
  }>;
};

function safeCallbackUrl(value: string | string[] | undefined) {
  const callbackUrl = Array.isArray(value) ? value[0] : value;

  if (!callbackUrl?.startsWith("/") || callbackUrl.startsWith("//")) {
    return "/";
  }

  return callbackUrl;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams]);

  if (isAllowedEmail(session?.user?.email)) {
    redirect("/");
  }

  const callbackUrl = safeCallbackUrl(params.callbackUrl);
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  const errorMessage =
    error === "AccessDenied"
      ? "This Google account is not authorized. Try another account or ask the site owner to add your email."
      : error
        ? "Sign-in could not be completed. Check the Google OAuth configuration and try again."
        : null;

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl });
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f6f4ef] px-4 py-12 text-[#1f2523]">
      <section className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-8 shadow-[0_24px_70px_rgba(26,31,28,0.10)] sm:p-10">
        <div className="mb-8 flex items-center gap-3">
          <Image src="/logo.svg" alt="" width={44} height={44} priority />
          <div>
            <h1 className="text-xl font-semibold">Sign in to Portfolio</h1>
            <p className="mt-1 text-sm text-[#69706c]">
              Access is limited to approved Google accounts.
            </p>
          </div>
        </div>

        {errorMessage ? (
          <p className="alert alert-error mb-5" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <form action={signInWithGoogle}>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-black/15 bg-white px-4 font-semibold transition hover:bg-[#f3f1eb] focus:outline-none focus:ring-4 focus:ring-[#1f7a68]/20"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
              <path
                fill="#4285F4"
                d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4h5.4a4.6 4.6 0 0 1-2 3v2.6h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z"
              />
              <path
                fill="#34A853"
                d="M12 22c2.7 0 5-.9 6.7-2.4L15.4 17c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.7A10 10 0 0 0 12 22Z"
              />
              <path
                fill="#FBBC05"
                d="M6.5 13.9a6 6 0 0 1 0-3.8V7.4H3.1a10 10 0 0 0 0 9.2l3.4-2.7Z"
              />
              <path
                fill="#EA4335"
                d="M12 6c1.5 0 2.8.5 3.9 1.5l2.9-2.9A9.8 9.8 0 0 0 3.1 7.4l3.4 2.7A5.9 5.9 0 0 1 12 6Z"
              />
            </svg>
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
