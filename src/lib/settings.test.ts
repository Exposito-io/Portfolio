import type { Db } from "mongodb";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { getSettings, updateSettings } from "@/lib/settings";

describe("application settings", () => {
  it("returns defaults and persists the journal template with native dates", async () => {
    let document: Record<string, unknown> | null = null;
    const db = {
      collection: () => ({
        findOne: async () => document,
        updateOne: async (
          _filter: unknown,
          update: {
            $set: Record<string, unknown>;
            $setOnInsert: Record<string, unknown>;
          },
        ) => {
          document = {
            _id: "application",
            ...update.$setOnInsert,
            ...update.$set,
          };
          return { acknowledged: true };
        },
      }),
    } as unknown as Db;

    expect(await getSettings(db)).toEqual({
      journalDescriptionTemplate: "",
      createdAt: null,
      updatedAt: null,
    });

    const saved = await updateSettings(db, {
      journalDescriptionTemplate: "## Setup\n\n- Thesis",
    });

    expect(saved.journalDescriptionTemplate).toBe("## Setup\n\n- Thesis");
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(document?.createdAt).toBeInstanceOf(Date);
    expect(document?.updatedAt).toBeInstanceOf(Date);
  });

  it("rejects templates over the journal description limit", async () => {
    const db = {} as Db;

    await expect(
      updateSettings(db, { journalDescriptionTemplate: "x".repeat(12_001) }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
