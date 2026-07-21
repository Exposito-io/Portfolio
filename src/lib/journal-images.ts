import { GridFSBucket, ObjectId, type Db } from "mongodb";
import { Readable } from "node:stream";

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type JournalImage = {
  id: string;
  filename: string;
  contentType: string;
  length: number;
};

export function getJournalImagesBucket(db: Db) {
  return new GridFSBucket(db, {
    bucketName: "journalImages",
  });
}

export async function saveJournalImage(db: Db, file: File): Promise<JournalImage> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPG, GIF, or WebP image.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Image must be 10 MB or smaller.");
  }

  const bucket = getJournalImagesBucket(db);
  const id = new ObjectId();
  const filename = file.name || `journal-image-${id.toString()}`;
  const uploadStream = bucket.openUploadStreamWithId(id, filename, {
    metadata: {
      contentType: file.type,
      createdAt: new Date(),
    },
  });

  await new Promise<void>(async (resolve, reject) => {
    uploadStream.on("error", reject);
    uploadStream.on("finish", () => resolve());

    const buffer = Buffer.from(await file.arrayBuffer());
    Readable.from(buffer).pipe(uploadStream);
  });

  return {
    id: id.toString(),
    filename,
    contentType: file.type,
    length: file.size,
  };
}

export async function findJournalImage(db: Db, id: string) {
  if (!ObjectId.isValid(id)) return null;

  const bucket = getJournalImagesBucket(db);
  const _id = new ObjectId(id);
  const file = await bucket.find({ _id }).limit(1).next();

  if (!file) return null;

  return {
    _id,
    contentType:
      typeof file.metadata?.contentType === "string"
        ? file.metadata.contentType
        : "application/octet-stream",
    file,
    stream: bucket.openDownloadStream(_id),
  };
}
