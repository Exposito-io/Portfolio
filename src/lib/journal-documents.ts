import {
  GridFSBucket,
  ObjectId,
  type Collection,
  type Db,
  type GridFSFile,
} from "mongodb";
import { Readable } from "node:stream";
import { z } from "zod";

import type { JournalDocument } from "@/lib/types";

export const MAX_PDF_SIZE_BYTES = 10 * 1024 * 1024;

const markdownDocumentSchema = z.object({
  kind: z.literal("markdown"),
  title: z.string().trim().min(1).max(140),
  contentMarkdown: z.string().max(12_000).default(""),
});

const markdownDocumentUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    contentMarkdown: z.string().max(12_000).optional(),
  })
  .refine(
    (input) => input.title !== undefined || input.contentMarkdown !== undefined,
    { message: "Provide a title or Markdown content to update." },
  );

type JournalDocumentBaseRecord = {
  _id: ObjectId;
  tradeId?: ObjectId;
  groupId?: ObjectId;
  title: string;
  createdAt: Date;
  updatedAt: Date;
};

type JournalMarkdownDocumentRecord = JournalDocumentBaseRecord & {
  kind: "markdown";
  contentMarkdown: string;
};

type JournalPdfDocumentRecord = JournalDocumentBaseRecord & {
  kind: "pdf";
  fileId: ObjectId;
  contentType: "application/pdf";
  sizeBytes: number;
};

type JournalDocumentRecord =
  | JournalMarkdownDocumentRecord
  | JournalPdfDocumentRecord;

function collection(db: Db): Collection<JournalDocumentRecord> {
  return db.collection<JournalDocumentRecord>("journalDocuments");
}

export function getJournalDocumentFilesBucket(db: Db) {
  return new GridFSBucket(db, { bucketName: "journalDocumentFiles" });
}

export function serializeJournalDocument(
  document: JournalDocumentRecord,
): JournalDocument {
  const base = {
    id: document._id.toString(),
    title: document.title,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };

  if (document.kind === "markdown") {
    return {
      ...base,
      kind: "markdown",
      contentMarkdown: document.contentMarkdown,
    };
  }

  const ownerPath = document.groupId
    ? `groups/${document.groupId.toString()}`
    : `trades/${document.tradeId!.toString()}`;
  const contentUrl = `/api/journal/${ownerPath}/documents/${document._id.toString()}/content`;
  return {
    ...base,
    kind: "pdf",
    contentType: document.contentType,
    sizeBytes: document.sizeBytes,
    contentUrl,
    downloadUrl: `${contentUrl}?download=1`,
  };
}

export async function listJournalDocuments(db: Db, tradeId: string) {
  const ownerId = await findTradeId(db, tradeId);
  if (!ownerId) return null;

  const documents = await collection(db)
    .find({ tradeId: ownerId })
    .sort({ createdAt: -1 })
    .toArray();

  return documents.map(serializeJournalDocument);
}

export async function listJournalGroupDocuments(db: Db, groupId: string) {
  const ownerId = await findGroupId(db, groupId);
  if (!ownerId) return null;
  const documents = await collection(db)
    .find({ groupId: ownerId })
    .sort({ createdAt: -1 })
    .toArray();
  return documents.map(serializeJournalDocument);
}

export async function createMarkdownDocument(
  db: Db,
  tradeId: string,
  payload: unknown,
) {
  const ownerId = await findTradeId(db, tradeId);
  if (!ownerId) return null;

  const input = markdownDocumentSchema.parse(payload);
  const now = new Date();
  const document: JournalMarkdownDocumentRecord = {
    _id: new ObjectId(),
    tradeId: ownerId,
    kind: "markdown",
    title: input.title,
    contentMarkdown: input.contentMarkdown,
    createdAt: now,
    updatedAt: now,
  };

  await collection(db).insertOne(document);
  return serializeJournalDocument(document);
}

export async function createGroupMarkdownDocument(db: Db, groupId: string, payload: unknown) {
  const ownerId = await findGroupId(db, groupId);
  if (!ownerId) return null;
  const input = markdownDocumentSchema.parse(payload);
  const now = new Date();
  const document: JournalMarkdownDocumentRecord = {
    _id: new ObjectId(), groupId: ownerId, kind: "markdown", title: input.title,
    contentMarkdown: input.contentMarkdown, createdAt: now, updatedAt: now,
  };
  await collection(db).insertOne(document);
  return serializeJournalDocument(document);
}

export async function uploadPdfDocument(
  db: Db,
  tradeId: string,
  file: File,
) {
  const ownerId = await findTradeId(db, tradeId);
  if (!ownerId) return null;

  validatePdf(file);
  const now = new Date();
  const documentId = new ObjectId();
  const fileId = new ObjectId();
  const bucket = getJournalDocumentFilesBucket(db);
  const uploadStream = bucket.openUploadStreamWithId(fileId, file.name, {
    metadata: {
      tradeId: ownerId,
      documentId,
      contentType: "application/pdf",
      createdAt: now,
    },
  });

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      uploadStream.on("error", reject);
      uploadStream.on("finish", () => resolve());
      Readable.from(buffer).pipe(uploadStream);
    });

    const document: JournalPdfDocumentRecord = {
      _id: documentId,
      tradeId: ownerId,
      kind: "pdf",
      title: file.name,
      fileId,
      contentType: "application/pdf",
      sizeBytes: file.size,
      createdAt: now,
      updatedAt: now,
    };
    await collection(db).insertOne(document);
    return serializeJournalDocument(document);
  } catch (error) {
    await bucket.delete(fileId).catch(() => undefined);
    throw error;
  }
}

export async function uploadGroupPdfDocument(db: Db, groupId: string, file: File) {
  const ownerId = await findGroupId(db, groupId);
  if (!ownerId) return null;
  return uploadOwnerPdfDocument(db, { groupId: ownerId }, file);
}

async function uploadOwnerPdfDocument(
  db: Db,
  owner: { tradeId: ObjectId } | { groupId: ObjectId },
  file: File,
) {
  validatePdf(file);
  const now = new Date();
  const documentId = new ObjectId();
  const fileId = new ObjectId();
  const bucket = getJournalDocumentFilesBucket(db);
  const uploadStream = bucket.openUploadStreamWithId(fileId, file.name, {
    metadata: { ...owner, documentId, contentType: "application/pdf", createdAt: now },
  });
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await new Promise<void>((resolve, reject) => {
      uploadStream.on("error", reject);
      uploadStream.on("finish", () => resolve());
      Readable.from(buffer).pipe(uploadStream);
    });
    const document: JournalPdfDocumentRecord = {
      _id: documentId, ...owner, kind: "pdf", title: file.name, fileId,
      contentType: "application/pdf", sizeBytes: file.size, createdAt: now, updatedAt: now,
    };
    await collection(db).insertOne(document);
    return serializeJournalDocument(document);
  } catch (error) {
    await bucket.delete(fileId).catch(() => undefined);
    throw error;
  }
}

export async function updateMarkdownDocument(
  db: Db,
  tradeId: string,
  documentId: string,
  payload: unknown,
) {
  const ids = toDocumentIds(tradeId, documentId);
  if (!ids) return null;

  const input = markdownDocumentUpdateSchema.parse(payload);
  const update: Partial<JournalMarkdownDocumentRecord> = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) update.title = input.title;
  if (input.contentMarkdown !== undefined) {
    update.contentMarkdown = input.contentMarkdown;
  }

  const result = await collection(db).findOneAndUpdate(
    { _id: ids.documentId, tradeId: ids.tradeId, kind: "markdown" },
    { $set: update },
    { returnDocument: "after" },
  );

  return result ? serializeJournalDocument(result) : null;
}

export async function updateGroupMarkdownDocument(
  db: Db, groupId: string, documentId: string, payload: unknown,
) {
  const ids = toOwnerDocumentIds(groupId, documentId, "groupId");
  if (!ids) return null;
  const input = markdownDocumentUpdateSchema.parse(payload);
  const update: Partial<JournalMarkdownDocumentRecord> = { updatedAt: new Date() };
  if (input.title !== undefined) update.title = input.title;
  if (input.contentMarkdown !== undefined) update.contentMarkdown = input.contentMarkdown;
  const result = await collection(db).findOneAndUpdate(
    { _id: ids.documentId, groupId: ids.ownerId, kind: "markdown" },
    { $set: update },
    { returnDocument: "after" },
  );
  return result ? serializeJournalDocument(result) : null;
}

export async function deleteJournalDocument(
  db: Db,
  tradeId: string,
  documentId: string,
) {
  const ids = toDocumentIds(tradeId, documentId);
  if (!ids) return false;

  const document = await collection(db).findOne({
    _id: ids.documentId,
    tradeId: ids.tradeId,
  });
  if (!document) return false;

  if (document.kind === "pdf") {
    await getJournalDocumentFilesBucket(db).delete(document.fileId);
  }
  const result = await collection(db).deleteOne({
    _id: ids.documentId,
    tradeId: ids.tradeId,
  });
  return result.deletedCount === 1;
}

export async function deleteJournalGroupDocument(db: Db, groupId: string, documentId: string) {
  const ids = toOwnerDocumentIds(groupId, documentId, "groupId");
  if (!ids) return false;
  const document = await collection(db).findOne({ _id: ids.documentId, groupId: ids.ownerId });
  if (!document) return false;
  if (document.kind === "pdf") await getJournalDocumentFilesBucket(db).delete(document.fileId);
  const result = await collection(db).deleteOne({ _id: ids.documentId, groupId: ids.ownerId });
  return result.deletedCount === 1;
}

export async function findJournalPdf(
  db: Db,
  tradeId: string,
  documentId: string,
) {
  const ids = toDocumentIds(tradeId, documentId);
  if (!ids) return null;

  const document = await collection(db).findOne({
    _id: ids.documentId,
    tradeId: ids.tradeId,
    kind: "pdf",
  });
  if (!document || document.kind !== "pdf") return null;

  const bucket = getJournalDocumentFilesBucket(db);
  const file = await bucket.find({ _id: document.fileId }).limit(1).next();
  if (!file) return null;

  return {
    document: serializeJournalDocument(document),
    file: file as GridFSFile,
    stream: bucket.openDownloadStream(document.fileId),
  };
}

export async function findJournalGroupPdf(db: Db, groupId: string, documentId: string) {
  const ids = toOwnerDocumentIds(groupId, documentId, "groupId");
  if (!ids) return null;
  const document = await collection(db).findOne({ _id: ids.documentId, groupId: ids.ownerId, kind: "pdf" });
  if (!document || document.kind !== "pdf") return null;
  const bucket = getJournalDocumentFilesBucket(db);
  const file = await bucket.find({ _id: document.fileId }).limit(1).next();
  if (!file) return null;
  return { document: serializeJournalDocument(document), file: file as GridFSFile, stream: bucket.openDownloadStream(document.fileId) };
}

export async function deleteJournalDocumentsForGroup(db: Db, groupId: string) {
  if (!ObjectId.isValid(groupId)) return;
  const ownerId = new ObjectId(groupId);
  const documents = await collection(db).find({ groupId: ownerId }).toArray();
  const bucket = getJournalDocumentFilesBucket(db);
  await Promise.all(documents.flatMap((document) => document.kind === "pdf" ? [bucket.delete(document.fileId)] : []));
  await collection(db).deleteMany({ groupId: ownerId });
}

export async function deleteJournalDocumentsForTrade(db: Db, tradeId: string) {
  if (!ObjectId.isValid(tradeId)) return;
  const ownerId = new ObjectId(tradeId);
  const documents = await collection(db).find({ tradeId: ownerId }).toArray();
  const bucket = getJournalDocumentFilesBucket(db);

  await Promise.all(
    documents.flatMap((document) =>
      document.kind === "pdf" ? [bucket.delete(document.fileId)] : [],
    ),
  );
  await collection(db).deleteMany({ tradeId: ownerId });
}

async function findTradeId(db: Db, tradeId: string) {
  if (!ObjectId.isValid(tradeId)) return null;
  const _id = new ObjectId(tradeId);
  const trade = await db.collection("journalTrades").findOne(
    { _id },
    { projection: { _id: 1 } },
  );
  return trade ? _id : null;
}

async function findGroupId(db: Db, groupId: string) {
  if (!ObjectId.isValid(groupId)) return null;
  const _id = new ObjectId(groupId);
  const group = await db.collection("journalTradeGroups").findOne(
    { _id },
    { projection: { _id: 1 } },
  );
  return group ? _id : null;
}

function toDocumentIds(tradeId: string, documentId: string) {
  if (!ObjectId.isValid(tradeId) || !ObjectId.isValid(documentId)) return null;
  return {
    tradeId: new ObjectId(tradeId),
    documentId: new ObjectId(documentId),
  };
}

function toOwnerDocumentIds(ownerId: string, documentId: string, field: "groupId") {
  void field;
  if (!ObjectId.isValid(ownerId) || !ObjectId.isValid(documentId)) return null;
  return { ownerId: new ObjectId(ownerId), documentId: new ObjectId(documentId) };
}

function validatePdf(file: File) {
  if (!file.name || file.size === 0) {
    throw new JournalDocumentValidationError("Choose a non-empty PDF file.");
  }
  if (
    file.type !== "application/pdf" ||
    !file.name.toLocaleLowerCase().endsWith(".pdf")
  ) {
    throw new JournalDocumentValidationError("Upload a PDF file.");
  }
  if (file.name.length > 255) {
    throw new JournalDocumentValidationError(
      "The PDF filename must be 255 characters or fewer.",
    );
  }
  if (file.size > MAX_PDF_SIZE_BYTES) {
    throw new JournalDocumentValidationError("PDF must be 10 MB or smaller.");
  }
}

export class JournalDocumentValidationError extends Error {}
