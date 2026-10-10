const LOCAL_DEVELOPMENT_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
]);

function hostnameFromHostHeader(host: string) {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isDevelopmentAuthBypassEnabled(
  host: string | null | undefined,
  environment = process.env.NODE_ENV,
) {
  if (environment !== "development" || !host) return false;

  const hostname = hostnameFromHostHeader(host.trim());
  return hostname ? LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname) : false;
}
