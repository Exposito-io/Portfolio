import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/accounts", () => ({ getAccount: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ getApiAuthorizationError: vi.fn() }));
vi.mock("@/lib/hyperliquid-simulator-service", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/hyperliquid-simulator-service")
  >("@/lib/hyperliquid-simulator-service");
  return {
    ...actual,
    fetchHyperliquidSimulatorSnapshot: vi.fn(),
  };
});
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

import { GET } from "@/app/api/hyperliquid/simulator/route";
import { getAccount } from "@/lib/accounts";
import { getApiAuthorizationError } from "@/lib/authorization";
import {
  fetchHyperliquidSimulatorSnapshot,
  UnsupportedHyperliquidAccountModeError,
} from "@/lib/hyperliquid-simulator-service";
import { getDb } from "@/lib/mongodb";

const account = {
  id: "account-1",
  source: "hyperliquid" as const,
  label: "Main Hyperliquid",
  address: "0x0000000000000000000000000000000000000000",
  enabled: true,
  notes: "",
  metadata: {},
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
};

beforeEach(() => vi.resetAllMocks());

describe("GET /api/hyperliquid/simulator", () => {
  it("rejects unauthenticated requests before account access", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(
      new Response(null, { status: 401 }) as never,
    );
    const response = await GET(
      new Request("http://localhost/api/hyperliquid/simulator?accountId=one"),
    );
    expect(response.status).toBe(401);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires a configured Hyperliquid account", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
    expect(
      (
        await GET(new Request("http://localhost/api/hyperliquid/simulator"))
      ).status,
    ).toBe(400);

    vi.mocked(getAccount).mockResolvedValue(null);
    expect(
      (
        await GET(
          new Request(
            "http://localhost/api/hyperliquid/simulator?accountId=missing",
          ),
        )
      ).status,
    ).toBe(404);
  });

  it("returns a normalized simulator snapshot", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
    vi.mocked(getAccount).mockResolvedValue(account);
    vi.mocked(fetchHyperliquidSimulatorSnapshot).mockResolvedValue({
      account,
      accountMode: "unifiedAccount",
      capturedAt: "2026-09-28T12:00:00.000Z",
      accountEquity: 1000,
      spotUsdcBalance: 1000,
      crossMaintenance: 50,
      isolatedMargin: 0,
      positions: [],
      markets: [],
      unsupportedPositionCount: 0,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/hyperliquid/simulator?accountId=account-1",
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).snapshot.accountMode).toBe("unifiedAccount");
    expect(fetchHyperliquidSimulatorSnapshot).toHaveBeenCalledWith(account);
  });

  it("reports unsupported account modes without masking them as upstream failures", async () => {
    vi.mocked(getApiAuthorizationError).mockResolvedValue(null);
    vi.mocked(getAccount).mockResolvedValue(account);
    vi.mocked(fetchHyperliquidSimulatorSnapshot).mockRejectedValue(
      new UnsupportedHyperliquidAccountModeError("portfolioMargin"),
    );

    const response = await GET(
      new Request(
        "http://localhost/api/hyperliquid/simulator?accountId=account-1",
      ),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error:
        "The simulator currently supports unified Hyperliquid accounts. This account uses portfolioMargin.",
      accountMode: "portfolioMargin",
    });
  });
});
