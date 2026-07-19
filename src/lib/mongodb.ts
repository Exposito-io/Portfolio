import { Db, MongoClient } from "mongodb";

import { getMongoDatabaseName, requireMongoUri } from "@/lib/config";

let clientPromise: Promise<MongoClient> | null = null;

export async function getMongoClient() {
  if (!clientPromise) {
    clientPromise = new MongoClient(requireMongoUri()).connect();
  }

  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const uri = requireMongoUri();
  const client = await getMongoClient();
  return client.db(getMongoDatabaseName(uri));
}
