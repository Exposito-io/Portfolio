import type { Collection, Db } from "mongodb";
import { z } from "zod";

import type {
  ApplicationSettings,
  JournalDescriptionTemplate,
} from "@/lib/types";

const SETTINGS_ID = "application";

export const settingsInputSchema = z.object({
  journalDescriptionTemplates: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        title: z
          .string()
          .trim()
          .min(1, "Each template needs a title.")
          .max(100),
        descriptionMarkdown: z.string().max(12_000),
      }),
    )
    .max(50)
    .refine(
      (templates) =>
        new Set(templates.map((template) => template.id)).size ===
        templates.length,
      "Template IDs must be unique.",
    ),
});

type SettingsDocument = {
  _id: string;
  journalDescriptionTemplate?: string;
  journalDescriptionTemplates?: JournalDescriptionTemplate[];
  createdAt: Date;
  updatedAt: Date;
};

function collection(db: Db): Collection<SettingsDocument> {
  return db.collection<SettingsDocument>("settings");
}

export async function getSettings(db: Db): Promise<ApplicationSettings> {
  const settings = await collection(db).findOne({ _id: SETTINGS_ID });

  return {
    // Read legacy content without rewriting settings or any journal documents.
    // An explicitly saved empty list must not revive a removed legacy template.
    journalDescriptionTemplates:
      settings?.journalDescriptionTemplates ??
      (settings?.journalDescriptionTemplate
        ? [
            {
              id: "default",
              title: "Default template",
              descriptionMarkdown: settings.journalDescriptionTemplate,
            },
          ]
        : []),
    createdAt: settings?.createdAt.toISOString() ?? null,
    updatedAt: settings?.updatedAt.toISOString() ?? null,
  };
}

export async function updateSettings(db: Db, payload: unknown) {
  const input = settingsInputSchema.parse(payload);
  const now = new Date();

  await collection(db).updateOne(
    { _id: SETTINGS_ID },
    {
      $set: {
        journalDescriptionTemplates: input.journalDescriptionTemplates,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return getSettings(db);
}
