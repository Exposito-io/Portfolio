import { z } from "zod";

import { normalizeDefiLlamaUrl } from "@/lib/journal-metrics";

export const journalMetricEmbedsSchema = z
  .array(
    z
      .object({
        id: z.string().trim().min(1).max(80),
        provider: z.literal("defillama"),
        name: z.string().trim().min(1).max(100).optional(),
        url: z.string().trim().max(2_000),
      })
      .transform((embed, context) => {
        const url = normalizeDefiLlamaUrl(embed.url);
        if (!url) {
          context.addIssue({
            code: "custom",
            path: ["url"],
            message: "DefiLlama charts must use an HTTPS defillama.com URL.",
          });
          return z.NEVER;
        }
        return { ...embed, url };
      }),
  )
  .max(8, "Metrics can include up to 8 embedded charts.")
  .default([]);
