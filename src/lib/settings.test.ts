import type { Db } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { getSettings, updateSettings } from "@/lib/settings";

function settingsDb(initial: Record<string, unknown> | null = null) {
  let document = initial;
  const updateOne = vi.fn(async (_filter, update) => {
    document = {
      ...(document ?? { _id: "application", ...update.$setOnInsert }),
      ...update.$set,
    };
  });
  const collection = vi.fn((name: string) => {
    expect(name).toBe("settings");
    return { findOne: async () => document, updateOne };
  });
  return {
    db: { collection } as unknown as Db,
    collection,
    updateOne,
    document: () => document,
  };
}

const templates = [
  { id: "setup", title: "Setup", descriptionMarkdown: "## Setup\n\n- Thesis" },
  {
    id: "review",
    title: "Review",
    descriptionMarkdown: "## Review\n\n- Lessons",
  },
];

describe("application settings", () => {
  it("returns defaults and round trips multiple templates with native dates", async () => {
    const store = settingsDb();
    expect(await getSettings(store.db)).toEqual({
      journalDescriptionTemplates: [],
      createdAt: null,
      updatedAt: null,
    });
    const saved = await updateSettings(store.db, {
      journalDescriptionTemplates: templates,
    });
    expect(saved.journalDescriptionTemplates).toEqual(templates);
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(store.document()?.createdAt).toBeInstanceOf(Date);
    expect(store.document()?.updatedAt).toBeInstanceOf(Date);
    const createdAt = store.document()?.createdAt;
    await updateSettings(store.db, {
      journalDescriptionTemplates: [templates[1]],
    });
    expect(store.document()?.createdAt).toBe(createdAt);
    expect((await getSettings(store.db)).journalDescriptionTemplates).toEqual([
      templates[1],
    ]);
  });

  it("preserves legacy content exactly and never revives it after removing all templates", async () => {
    const content = "  ## My existing template\n\n- Keep this\n ";
    const createdAt = new Date("2025-01-01");
    const store = settingsDb({
      journalDescriptionTemplate: content,
      createdAt,
      updatedAt: createdAt,
    });
    const migrated = (await getSettings(store.db)).journalDescriptionTemplates;
    expect(migrated).toEqual([
      {
        id: "default",
        title: "Default template",
        descriptionMarkdown: content,
      },
    ]);
    expect(store.updateOne).not.toHaveBeenCalled();
    await updateSettings(store.db, {
      journalDescriptionTemplates: [...migrated, templates[1]],
    });
    expect(
      (await getSettings(store.db)).journalDescriptionTemplates[0]
        .descriptionMarkdown,
    ).toBe(content);
    await updateSettings(store.db, { journalDescriptionTemplates: [] });
    expect((await getSettings(store.db)).journalDescriptionTemplates).toEqual(
      [],
    );
    expect(store.document()?.journalDescriptionTemplate).toBe(content);
    expect(
      store.collection.mock.calls.every(([name]) => name === "settings"),
    ).toBe(true);
  });

  it.each([
    {},
    {
      journalDescriptionTemplate:
        "stale client must not replace the collection",
    },
    { journalDescriptionTemplates: [{ ...templates[0], title: "   " }] },
    {
      journalDescriptionTemplates: [
        { ...templates[0], title: "x".repeat(101) },
      ],
    },
    {
      journalDescriptionTemplates: [
        { ...templates[0], descriptionMarkdown: "x".repeat(12_001) },
      ],
    },
    { journalDescriptionTemplates: [templates[0], templates[0]] },
    { journalDescriptionTemplates: [{ ...templates[0], id: "" }] },
    {
      journalDescriptionTemplates: Array.from({ length: 51 }, (_, index) => ({
        ...templates[0],
        id: String(index),
      })),
    },
  ])("rejects invalid settings before any write: %j", async (payload) => {
    await expect(updateSettings({} as Db, payload)).rejects.toBeInstanceOf(
      ZodError,
    );
  });
});
