import "server-only";

const allowedEmailSet = new Set(
  (process.env.AUTH_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);

export function isAllowedEmail(email: string | null | undefined) {
  return email ? allowedEmailSet.has(email.trim().toLowerCase()) : false;
}
