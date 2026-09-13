import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accounts", () => ({ listAccounts: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ getApiAuthorizationError: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/stats-service", () => ({ loadStats: vi.fn() }));

import { GET } from "@/app/api/stats/route";
import { listAccounts } from "@/lib/accounts";
import { getApiAuthorizationError } from "@/lib/authorization";
import { getDb } from "@/lib/mongodb";
import { loadStats } from "@/lib/stats-service";

beforeEach(() => vi.resetAllMocks());

describe("GET /api/stats", () => {
  it("rejects unauthenticated requests before reading accounts", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(
      new Response(null, { status: 401 }) as never,
    );
    expect((await GET()).status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
    expect(loadStats).not.toHaveBeenCalled();
  });

  it("returns the available history for authenticated requests", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
    vi.mocked(listAccounts).mockResolvedValue([]);
    const payload = {
      orders: [],
      accountsCount: 0,
      sourceErrors: [],
      endTime: 100,
    };
    vi.mocked(loadStats).mockResolvedValue(payload);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(loadStats).toHaveBeenCalledWith([], expect.any(Number));
  });

  it("returns a server error when account loading fails", async () => {
    vi.mocked(getDb).mockRejectedValue(new Error("Database unavailable"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Database unavailable" });
  });
});
