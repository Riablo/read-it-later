import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayHost, domainLabelFromUrl, normalizeUrl } from "./domain";
import type { DatabaseFile, FetchedMetadata, ItemStatus, ReadLaterItem } from "./types";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultDataPath = join(rootDir, "data", "readlater.json");
const dataPath = process.env.READLATER_DATA || defaultDataPath;

const EMPTY_DB: DatabaseFile = {
  version: 1,
  items: []
};

let writeQueue: Promise<void> = Promise.resolve();

async function ensureDataDir() {
  await mkdir(dirname(dataPath), { recursive: true });
}

async function readDb(): Promise<DatabaseFile> {
  await ensureDataDir();

  try {
    const raw = await readFile(dataPath, "utf8");
    const parsed = JSON.parse(raw) as DatabaseFile;

    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      throw new Error("不支持的数据库格式。");
    }

    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return structuredClone(EMPTY_DB);
    }

    throw error;
  }
}

async function writeDb(db: DatabaseFile): Promise<void> {
  await ensureDataDir();
  const tmpPath = `${dataPath}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  await rename(tmpPath, dataPath);
}

async function mutateDb<T>(mutator: (db: DatabaseFile) => Promise<T> | T): Promise<T> {
  const run = writeQueue.then(async () => {
    const db = await readDb();
    const result = await mutator(db);
    await writeDb(db);
    return result;
  });

  writeQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

function sortItems(items: ReadLaterItem[], status: ItemStatus): ReadLaterItem[] {
  return [...items].sort((a, b) => {
    const left = status === "trash" ? a.deletedAt ?? a.updatedAt : a.createdAt;
    const right = status === "trash" ? b.deletedAt ?? b.updatedAt : b.createdAt;
    return right.localeCompare(left);
  });
}

export async function listItems(status: ItemStatus): Promise<ReadLaterItem[]> {
  const db = await readDb();
  return sortItems(
    db.items.filter((item) => item.status === status),
    status
  );
}

export async function getCounts(): Promise<Record<ItemStatus, number>> {
  const db = await readDb();
  return db.items.reduce<Record<ItemStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { inbox: 0, trash: 0 }
  );
}

export async function clearTrash(): Promise<number> {
  return mutateDb((db) => {
    const before = db.items.length;
    db.items = db.items.filter((item) => item.status !== "trash");
    return before - db.items.length;
  });
}

export async function upsertFetchedItem(result: FetchedMetadata): Promise<ReadLaterItem> {
  return mutateDb((db) => {
    const now = new Date().toISOString();
    const url = normalizeUrl(result.url);
    const existing = db.items.find((item) => item.url === url);

    if (existing) {
      existing.title = cleanTitle(result.title, url);
      existing.summary = result.summary?.trim() || "";
      existing.source = result.source?.trim() || "unknown";
      existing.fetchedAt = result.fetched_at || now;
      existing.createdAt = now;
      existing.updatedAt = now;
      existing.deletedAt = null;
      existing.status = "inbox";
      existing.domain = domainLabelFromUrl(url);
      existing.host = displayHost(url);
      return existing;
    }

    const item: ReadLaterItem = {
      id: crypto.randomUUID(),
      url,
      title: cleanTitle(result.title, url),
      summary: result.summary?.trim() || "",
      source: result.source?.trim() || "unknown",
      fetchedAt: result.fetched_at || now,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      status: "inbox",
      domain: domainLabelFromUrl(url),
      host: displayHost(url)
    };

    db.items.push(item);
    return item;
  });
}

export async function moveItem(id: string, status: ItemStatus): Promise<ReadLaterItem> {
  return mutateDb((db) => {
    const item = db.items.find((candidate) => candidate.id === id);

    if (!item) {
      throw new Error("链接不存在。");
    }

    const now = new Date().toISOString();
    item.status = status;
    item.updatedAt = now;
    item.deletedAt = status === "trash" ? now : null;

    if (status === "inbox") {
      item.createdAt = now;
    }

    return item;
  });
}

function cleanTitle(title: string | undefined, url: string): string {
  const trimmed = title?.trim();
  if (trimmed) {
    return trimmed;
  }

  return displayHost(url);
}
