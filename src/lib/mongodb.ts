import { Db, MongoClient } from "mongodb";

import { getMongoDatabaseName, requireMongoUri } from "@/lib/config";

// Route bundles and development reloads must share both the connection and
// services keyed by this client (including per-wallet fill synchronization).
const shared = globalThis as typeof globalThis & {
  portfolioMongoClientPromise?: Promise<MongoClient>;
};

export async function getMongoClient() {
  if (!shared.portfolioMongoClientPromise) {
    shared.portfolioMongoClientPromise = new MongoClient(requireMongoUri())
      .connect()
      .catch((error) => {
        shared.portfolioMongoClientPromise = undefined;
        throw error;
      });
  }

  return shared.portfolioMongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const uri = requireMongoUri();
  const client = await getMongoClient();
  return client.db(getMongoDatabaseName(uri));
}
