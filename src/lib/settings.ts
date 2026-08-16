import type { Collection, Db } from "mongodb";
import { z } from "zod";

import type { ApplicationSettings } from "@/lib/types";

const SETTINGS_ID = "application";

export const settingsInputSchema = z.object({
  journalDescriptionTemplate: z.string().max(12_000),
});

type SettingsDocument = {
  _id: string;
  journalDescriptionTemplate: string;
  createdAt: Date;
  updatedAt: Date;
};

function collection(db: Db): Collection<SettingsDocument> {
  return db.collection<SettingsDocument>("settings");
}

export async function getSettings(db: Db): Promise<ApplicationSettings> {
  const settings = await collection(db).findOne({ _id: SETTINGS_ID });

  return {
    journalDescriptionTemplate: settings?.journalDescriptionTemplate ?? "",
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
        journalDescriptionTemplate: input.journalDescriptionTemplate,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );

  return getSettings(db);
}
