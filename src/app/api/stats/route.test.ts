import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accounts", () => ({ listAccounts: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ getApiAuthorizationError: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getCacheDb: vi.fn(), getDb: vi.fn() }));
vi.mock("@/lib/hyperliquid-fill-cache", () => ({
  getHyperliquidFillCache: vi.fn(() => ({ syncAccount: vi.fn() })),
}));
vi.mock("@/lib/hyperliquid-stats-cache", () => ({
  getHyperliquidStatsCache: vi.fn(() => ({ getStats: vi.fn() })),
}));
vi.mock("@/lib/stats-service", () => ({ loadStats: vi.fn() }));

import { GET } from "@/app/api/stats/route";
import { listAccounts } from "@/lib/accounts";
import { getApiAuthorizationError } from "@/lib/authorization";
import { getCacheDb, getDb } from "@/lib/mongodb";
import { loadStats } from "@/lib/stats-service";

beforeEach(() => vi.resetAllMocks());

describe("GET /api/stats", () => {
  it("rejects unauthenticated requests before reading accounts", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(
      new Response(null, { status: 401 }) as never,
    );
    expect((await GET()).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
    expect(getCacheDb).not.toHaveBeenCalled();
    expect(loadStats).not.toHaveBeenCalled();
  });

  it("returns the available history for authenticated requests", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
    vi.mocked(listAccounts).mockResolvedValue([]);
    const payload = {
      orders: [],
      orderCount: 0,
      page: 0,
      pageSize: 50,
      points: [],
      totalPnlUsd: null,
      cumulativePnlByOrderId: {},
      historyStartTime: null,
      accountsCount: 0,
      sourceErrors: [],
      endTime: 100,
    };
    vi.mocked(loadStats).mockResolvedValue(payload);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(loadStats).toHaveBeenCalledWith(
      [],
      expect.any(Number),
      expect.objectContaining({
        syncAccount: expect.any(Function),
        getStats: expect.any(Function),
      }),
      { page: 0, pageSize: 50, includeOrders: true },
    );
  });

  it("requests summary-only data and validates page numbers", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
    vi.mocked(listAccounts).mockResolvedValue([]);
    vi.mocked(loadStats).mockResolvedValue({
      orders: [],
      orderCount: 0,
      page: 0,
      pageSize: 50,
      points: [],
      totalPnlUsd: null,
      cumulativePnlByOrderId: {},
      historyStartTime: null,
      accountsCount: 0,
      sourceErrors: [],
      endTime: 100,
    });
    expect(
      (await GET(new Request("http://localhost/api/stats?page=-1"))).status,
    ).toBe(400);
    await GET(new Request("http://localhost/api/stats?summary=1"));
    expect(loadStats).toHaveBeenLastCalledWith(
      [],
      expect.any(Number),
      expect.any(Object),
      { page: 0, pageSize: 50, includeOrders: false },
    );
  });

  it("returns a server error when account loading fails", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("Database unavailable"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Database unavailable" });
  });
});
