export const PORTFOLIO_TIMEZONE =
  process.env.PORTFOLIO_TIMEZONE || "America/Toronto";

export function requireMongoUri() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured.");
  }

  return process.env.MONGODB_URI;
}

export function requireEthereumRpcUrl() {
  if (!process.env.ETHEREUM_RPC_URL) {
    throw new Error("ETHEREUM_RPC_URL is not configured.");
  }

  return process.env.ETHEREUM_RPC_URL;
}

export function getMongoDatabaseName(uri: string) {
  const parsed = new URL(uri);
  const pathname = parsed.pathname.replace(/^\//, "");
  return pathname || "portfolio";
}
