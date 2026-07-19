import { ObjectId, type Collection, type Db, type Document } from "mongodb";
import { getAddress, isAddress } from "viem";
import { z } from "zod";

import type { AccountSource, PortfolioAccount } from "@/lib/types";

const accountSourceSchema = z.enum(["aave", "hyperliquid"]);

export const accountInputSchema = z.object({
  source: accountSourceSchema,
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().refine((value) => isAddress(value), {
    message: "Enter a valid Ethereum-style address.",
  }),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(400).default(""),
});

type AccountDocument = {
  _id: ObjectId;
  source: AccountSource;
  label: string;
  address: string;
  enabled: boolean;
  notes: string;
  metadata: {
    chain?: "ethereum";
  };
  createdAt: Date;
  updatedAt: Date;
};

function collection(db: Db): Collection<AccountDocument> {
  return db.collection<AccountDocument>("accounts");
}

export function serializeAccount(account: AccountDocument): PortfolioAccount {
  return {
    id: account._id.toString(),
    source: account.source,
    label: account.label,
    address: account.address,
    enabled: account.enabled,
    notes: account.notes,
    metadata: account.metadata ?? {},
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export async function listAccounts(db: Db, onlyEnabled = false) {
  const query = onlyEnabled ? { enabled: true } : {};
  const accounts = await collection(db)
    .find(query)
    .sort({ source: 1, label: 1 })
    .toArray();

  return accounts.map(serializeAccount);
}

export async function createAccount(db: Db, payload: unknown) {
  const input = accountInputSchema.parse(payload);
  const now = new Date();
  const account = {
    _id: new ObjectId(),
    source: input.source,
    label: input.label,
    address: getAddress(input.address),
    enabled: input.enabled,
    notes: input.notes,
    metadata: input.source === "aave" ? { chain: "ethereum" as const } : {},
    createdAt: now,
    updatedAt: now,
  };

  await collection(db).insertOne(account);
  return serializeAccount(account);
}

export async function updateAccount(db: Db, id: string, payload: unknown) {
  const input = accountInputSchema.partial().parse(payload);
  const update: Document = {
    updatedAt: new Date(),
  };

  if (input.source) {
    update.source = input.source;
    update.metadata = input.source === "aave" ? { chain: "ethereum" } : {};
  }
  if (input.label !== undefined) update.label = input.label;
  if (input.address !== undefined) update.address = getAddress(input.address);
  if (input.enabled !== undefined) update.enabled = input.enabled;
  if (input.notes !== undefined) update.notes = input.notes;

  const result = await collection(db).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: update },
    { returnDocument: "after" },
  );

  if (!result) {
    return null;
  }

  return serializeAccount(result);
}

export async function deleteAccount(db: Db, id: string) {
  const result = await collection(db).deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount === 1;
}
