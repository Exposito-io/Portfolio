import { describe, expect, it } from "vitest";

import {
  DefiLlamaEmbedError,
  parseDefiLlamaEmbedInput,
} from "@/lib/journal-metrics";

describe("DefiLlama metric embeds", () => {
  it("accepts a direct DefiLlama chart URL", () => {
    expect(
      parseDefiLlamaEmbedInput(
        "https://defillama.com/chart/chain/Ethereum?foo=1&bar=2",
      ),
    ).toEqual({
      provider: "defillama",
      url: "https://defillama.com/chart/chain/Ethereum?foo=1&bar=2",
    });
  });

  it("extracts the URL and title from iframe code", () => {
    expect(
      parseDefiLlamaEmbedInput(
        '<iframe title="Ethereum TVL" src="https://defillama.com/chart/chain/Ethereum?foo=1&amp;bar=2"></iframe>',
      ),
    ).toEqual({
      provider: "defillama",
      name: "Ethereum TVL",
      url: "https://defillama.com/chart/chain/Ethereum?foo=1&bar=2",
    });
  });

  it("rejects non-DefiLlama and non-HTTPS URLs", () => {
    expect(() =>
      parseDefiLlamaEmbedInput("https://example.com/chart"),
    ).toThrow(DefiLlamaEmbedError);
    expect(() =>
      parseDefiLlamaEmbedInput("http://defillama.com/chart/chain/Ethereum"),
    ).toThrow(DefiLlamaEmbedError);
  });
});
