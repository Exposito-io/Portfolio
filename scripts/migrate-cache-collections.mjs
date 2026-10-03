import { MongoClient } from "mongodb";

const mongoUri = process.env.MONGODB_URI;
const cacheDatabaseName =
  process.env.MONGODB_CACHE_DATABASE?.trim() || "cache";
const keepSource = process.argv.includes("--keep-source");
const batchSize = 500;

if (!mongoUri) throw new Error("MONGODB_URI is not configured.");

const portfolioDatabaseName =
  new URL(mongoUri).pathname.replace(/^\//, "") || "portfolio";
if (portfolioDatabaseName === cacheDatabaseName) {
  throw new Error("The portfolio and cache database names must be different.");
}

const migrations = [
  ["aaveReserveCaches", "aave_reserve_hints_v1"],
  ["hyperliquidFills", "hyperliquid_fills_v1"],
  ["hyperliquidFillSyncs", "hyperliquid_fill_syncs_v1"],
  ["journalNewsQueryCaches", "google_news_queries_v1"],
  ["journalNewsArticles", "google_news_articles_v1"],
];

const client = new MongoClient(mongoUri);

try {
  await client.connect();
  const portfolioDb = client.db(portfolioDatabaseName);
  const cacheDb = client.db(cacheDatabaseName);
  await ensureTargetIndexes(cacheDb);
  const existingSources = new Set(
    (await portfolioDb.listCollections({}, { nameOnly: true }).toArray()).map(
      ({ name }) => name,
    ),
  );
  const results = [];

  for (const [sourceName, targetName] of migrations) {
    if (!existingSources.has(sourceName)) {
      results.push({ sourceName, targetName, status: "source-missing" });
      continue;
    }

    const source = portfolioDb.collection(sourceName);
    const target = cacheDb.collection(targetName);
    let copied = 0;
    let batch = [];

    for await (const document of source.find().batchSize(batchSize)) {
      batch.push(document);
      if (batch.length === batchSize) {
        await copyAndVerifyBatch(target, batch);
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await copyAndVerifyBatch(target, batch);
      copied += batch.length;
    }

    await verifySourceIds(source, target);
    if (!keepSource) await source.drop();
    results.push({
      sourceName,
      targetName,
      documentsCopiedOrAlreadyPresent: copied,
      sourceRemoved: !keepSource,
      status: "complete",
    });
  }

  console.log(
    JSON.stringify(
      {
        portfolioDatabase: portfolioDatabaseName,
        cacheDatabase: cacheDatabaseName,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

async function copyAndVerifyBatch(target, documents) {
  await target.bulkWrite(
    documents.map((document) => ({
      updateOne: {
        filter: { _id: document._id },
        update: { $setOnInsert: document },
        upsert: true,
      },
    })),
    { ordered: false },
  );

  const ids = documents.map(({ _id }) => _id);
  const copied = await target.countDocuments({ _id: { $in: ids } });
  if (copied !== ids.length) {
    throw new Error(
      `Only ${copied} of ${ids.length} documents were verified in ${target.collectionName}.`,
    );
  }
}

async function verifySourceIds(source, target) {
  let ids = [];
  for await (const { _id } of source.find({}, { projection: { _id: 1 } })) {
    ids.push(_id);
    if (ids.length === batchSize) {
      await verifyIds(target, ids);
      ids = [];
    }
  }
  if (ids.length) await verifyIds(target, ids);
}

async function verifyIds(target, ids) {
  const count = await target.countDocuments({ _id: { $in: ids } });
  if (count !== ids.length) {
    throw new Error(
      `Only ${count} of ${ids.length} source documents exist in ${target.collectionName}.`,
    );
  }
}

async function ensureTargetIndexes(cacheDb) {
  await Promise.all([
    cacheDb
      .collection("hyperliquid_fills_v1")
      .createIndex({ wallet: 1, time: 1 }),
    cacheDb
      .collection("google_news_articles_v1")
      .createIndex({ queryKeys: 1, publishedAt: -1 }),
    cacheDb
      .collection("google_news_articles_v1")
      .createIndex(
        { publishedAt: 1 },
        { expireAfterSeconds: 48 * 60 * 60 },
      ),
  ]);
}
