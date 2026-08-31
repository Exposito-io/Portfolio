import "server-only";

// Keep this list on the server. Email matching is case-insensitive.
// Add every Google account that should be able to access the application.
const ALLOWED_EMAILS: readonly string[] = [
  "mathew.corm@gmail.com",
];

const allowedEmailSet = new Set(
  ALLOWED_EMAILS.map((email) => email.trim().toLowerCase()),
);

export function isAllowedEmail(email: string | null | undefined) {
  return email ? allowedEmailSet.has(email.trim().toLowerCase()) : false;
}
