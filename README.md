This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Authentication setup

The application uses Google OAuth and denies access unless the Google account's
verified email is included in `src/lib/auth-allowlist.ts`.

1. Add the permitted addresses to `ALLOWED_EMAILS` in
   `src/lib/auth-allowlist.ts`.
2. Create a Google OAuth web client and add this authorized redirect URI:
   `http://localhost:3000/api/auth/callback/google` for local development. Add
   the equivalent HTTPS URI for each deployed domain.
3. Copy `.env.example` to `.env.local`, fill in `AUTH_GOOGLE_ID` and
   `AUTH_GOOGLE_SECRET`, and generate `AUTH_SECRET` with `npx auth secret`.

When self-hosting behind a reverse proxy, set `AUTH_TRUST_HOST=true` only after
ensuring the proxy supplies a safe `Host` header. Supported managed platforms
such as Vercel configure this automatically.

Keep the OAuth credentials and `AUTH_SECRET` out of source control.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
