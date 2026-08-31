import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

import { isAllowedEmail } from "@/lib/auth-allowlist";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [Google],
  pages: {
    error: "/sign-in",
    signIn: "/sign-in",
  },
  callbacks: {
    signIn({ profile, user }) {
      const email = user.email ?? profile?.email;

      // Google supplies email_verified in its OpenID Connect profile. Requiring
      // it prevents an unverified address from ever receiving a session.
      return profile?.email_verified === true && isAllowedEmail(email);
    },
  },
});
