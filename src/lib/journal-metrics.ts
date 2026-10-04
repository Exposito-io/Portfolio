import type { JournalMetricEmbed } from "@/lib/types";

const IFRAME_SRC_PATTERN = /<iframe\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const IFRAME_TITLE_PATTERN = /<iframe\b[^>]*\btitle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

export class DefiLlamaEmbedError extends Error {}

export function parseDefiLlamaEmbedInput(input: string): Omit<JournalMetricEmbed, "id"> {
  const value = input.trim();
  if (!value) {
    throw new DefiLlamaEmbedError("Paste a DefiLlama chart URL or iframe code.");
  }

  const iframeMatch = value.match(IFRAME_SRC_PATTERN);
  if (value.startsWith("<") && !iframeMatch) {
    throw new DefiLlamaEmbedError("The iframe code does not include a chart URL.");
  }

  const rawUrl = decodeHtmlAttribute(
    iframeMatch?.[1] ?? iframeMatch?.[2] ?? iframeMatch?.[3] ?? value,
  );
  const url = normalizeDefiLlamaUrl(rawUrl);
  if (!url) {
    throw new DefiLlamaEmbedError(
      "Use an HTTPS URL hosted by defillama.com.",
    );
  }

  const titleMatch = value.match(IFRAME_TITLE_PATTERN);
  const rawTitle = titleMatch?.[1] ?? titleMatch?.[2] ?? titleMatch?.[3];
  const name = rawTitle
    ? decodeHtmlAttribute(rawTitle).trim().slice(0, 100)
    : undefined;

  return {
    provider: "defillama",
    url,
    ...(name ? { name } : {}),
  };
}

export function normalizeDefiLlamaUrl(value: string) {
  try {
    const url = new URL(value.trim());
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (hostname !== "defillama.com" && !hostname.endsWith(".defillama.com"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtmlAttribute(value: string) {
  return value
    .replace(/&amp;|&#38;|&#x26;/gi, "&")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'");
}
