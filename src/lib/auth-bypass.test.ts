import { describe, expect, it } from "vitest";

import { isDevelopmentAuthBypassEnabled } from "@/lib/auth-bypass";

describe("isDevelopmentAuthBypassEnabled", () => {
  it.each([
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
    "[::1]",
    "[::1]:3000",
  ])("allows the loopback host %s in development", (host) => {
    expect(isDevelopmentAuthBypassEnabled(host, "development")).toBe(true);
  });

  it.each(["portfolio.test", "192.168.1.10", "localhost.example.com", null])(
    "does not allow the non-loopback host %s in development",
    (host) => {
      expect(isDevelopmentAuthBypassEnabled(host, "development")).toBe(false);
    },
  );

  it.each(["production", "test"])(
    "does not allow a bypass in %s mode",
    (environment) => {
      expect(
        isDevelopmentAuthBypassEnabled("localhost:3000", environment),
      ).toBe(false);
    },
  );
});
