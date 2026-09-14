type CacheEntry = { value: unknown; freshUntil: number; staleUntil: number };

const MAX_CACHE_ENTRIES = 256;
const MINUTE_MS = 60_000;
// Hyperliquid allows 1,200 weight/minute per IP. Leave room for other clients.
const WEIGHT_BUDGET = 900;

function requestWeight(body: Record<string, unknown>) {
  if (
    body.type === "clearinghouseState" ||
    body.type === "spotClearinghouseState"
  )
    return 2;
  if (body.type === "userFillsByTime") return 120; // Up to 2,000 fills per page.
  if (body.type === "fundingHistory") return 45; // Up to 500 rates per page.
  if (body.type === "candleSnapshot") {
    const req = body.req as {
      interval: string;
      startTime: number;
      endTime: number;
    };
    const match = /^(\d+)(m|h|d|w|M)$/.exec(req.interval);
    const unitMs: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
      M: 2_419_200_000,
    };
    const intervalMs = match ? Number(match[1]) * unitMs[match[2]] : 0;
    const count =
      intervalMs > 0
        ? Math.max(0, Math.ceil((req.endTime - req.startTime) / intervalMs)) + 1
        : 5000;
    return 20 + Math.ceil(Math.min(5000, count) / 60);
  }
  return 20;
}

// Keep live history ranges stable so page navigation can reuse the same pages.
export function getHyperliquidSnapshotTime() {
  return Math.floor(Date.now() / 15_000) * 15_000;
}

// One client per fetch implementation, shared by the server's route bundles.
const shared = globalThis as typeof globalThis & {
  portfolioHyperliquidRequestClients?: WeakMap<
    typeof fetch,
    HyperliquidInfoClient
  >;
};
const clients = (shared.portfolioHyperliquidRequestClients ??= new WeakMap());

export function getHyperliquidInfoClient(fetcher: typeof fetch) {
  let client = clients.get(fetcher);
  if (!client) {
    client = new HyperliquidInfoClient(fetcher);
    clients.set(fetcher, client);
  }
  return client;
}

export class HyperliquidInfoClient {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, Promise<unknown>>();
  private retryAt = 0;
  private reservations: Array<{ time: number; weight: number }> = [];

  constructor(private fetcher: typeof fetch) {}

  async request<T>(
    body: Record<string, unknown>,
    label: string,
    cacheKey = JSON.stringify(body),
  ): Promise<T> {
    const key = `${body.type}:${cacheKey}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && now < cached.freshUntil) return cached.value as T;

    const pending = this.inFlight.get(key);
    if (pending) return pending as Promise<T>;

    if (now < this.retryAt) {
      if (cached && now < cached.staleUntil) return cached.value as T;
      throw new Error(
        `${label} is rate limited. Try again in ${Math.ceil((this.retryAt - now) / 1000)} seconds.`,
      );
    }

    const request = this.load<T>(body, label, key)
      .catch((error: unknown) => {
        // Only slow-changing market catalogs may fall back to stale data.
        if (cached && Date.now() < cached.staleUntil) return cached.value as T;
        throw error;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  private async load<T>(
    body: Record<string, unknown>,
    label: string,
    key: string,
  ) {
    await this.reserveBudget(requestWeight(body), label);
    const response = await this.fetcher("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers?.get("retry-after");
        const seconds = retryAfter ? Number(retryAfter) : NaN;
        const retryAt = Number.isFinite(seconds)
          ? Date.now() + seconds * 1000
          : retryAfter
            ? Date.parse(retryAfter)
            : NaN;
        this.retryAt = Math.max(
          this.retryAt,
          Date.now() + MINUTE_MS,
          Number.isFinite(retryAt) ? retryAt : 0,
        );
      }
      throw new Error(`${label} returned HTTP ${response.status}.`);
    }

    const value = (await response.json()) as T;
    const catalog = body.type === "meta" || body.type === "spotMeta";
    const ttl = catalog ? 15 * MINUTE_MS : 15_000;
    const now = Date.now();
    // Bound memory use as users browse different markets and history ranges.
    for (const [cacheKey, entry] of this.cache) {
      if (entry.staleUntil <= now) this.cache.delete(cacheKey);
    }
    this.cache.delete(key);
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    this.cache.set(key, {
      value,
      freshUntil: now + ttl,
      staleUntil: now + (catalog ? 24 * 60 * MINUTE_MS : ttl),
    });
    return value;
  }

  private async reserveBudget(weight: number, label: string) {
    // Reservations are synchronous until the wait. Small live-position
    // requests can use remaining budget while a large history page waits.
    for (;;) {
      const now = Date.now();
      if (now < this.retryAt)
        throw new Error(`${label} is rate limited. Try again later.`);
      this.reservations = this.reservations.filter(
        (item) => item.time > now - MINUTE_MS,
      );
      const used = this.reservations.reduce(
        (sum, item) => sum + item.weight,
        0,
      );
      if (used + weight <= WEIGHT_BUDGET) {
        this.reservations.push({ time: now, weight });
        return;
      }
      const delay = this.reservations[0].time + MINUTE_MS - now;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
