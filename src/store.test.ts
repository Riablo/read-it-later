import { describe, expect, test } from "bun:test";
import { filterAndSortItems } from "./store";
import type { ItemStatus, ReadLaterItem } from "./types";

function item(overrides: Partial<ReadLaterItem>): ReadLaterItem {
  return {
    id: overrides.id || crypto.randomUUID(),
    url: overrides.url || "https://example.com",
    title: overrides.title || "Example",
    summary: overrides.summary || "",
    source: overrides.source || "test",
    fetchedAt: overrides.fetchedAt || "2026-01-01T00:00:00.000Z",
    createdAt: overrides.createdAt || "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt || "2026-01-01T00:00:00.000Z",
    deletedAt: overrides.deletedAt ?? null,
    status: overrides.status || "inbox",
    domain: overrides.domain || "example",
    host: overrides.host || "example.com"
  };
}

describe("item filtering and sorting", () => {
  test("searches title, summary, url, domain, and host", () => {
    const items = [
      item({ id: "title", title: "TypeScript Notes" }),
      item({ id: "summary", summary: "Useful Bun patterns" }),
      item({ id: "url", url: "https://docs.example.com/search" }),
      item({ id: "domain", domain: "github", host: "github.com" })
    ];

    expect(filterAndSortItems(items, "inbox", { query: "bun" }).map((result) => result.id)).toEqual(["summary"]);
    expect(filterAndSortItems(items, "inbox", { query: "DOCS" }).map((result) => result.id)).toEqual(["url"]);
    expect(filterAndSortItems(items, "inbox", { query: "github" }).map((result) => result.id)).toEqual(["domain"]);
  });

  test("sorts inbox items newest first or oldest first by creation time", () => {
    const items = [
      item({ id: "older", createdAt: "2026-01-01T00:00:00.000Z" }),
      item({ id: "newer", createdAt: "2026-02-01T00:00:00.000Z" })
    ];

    expect(filterAndSortItems(items, "inbox", { sort: "desc" }).map((result) => result.id)).toEqual([
      "newer",
      "older"
    ]);
    expect(filterAndSortItems(items, "inbox", { sort: "asc" }).map((result) => result.id)).toEqual([
      "older",
      "newer"
    ]);
  });

  test("sorts trash by deletion time when available", () => {
    const trashItems = [
      item({
        id: "updated-later",
        status: "trash" as ItemStatus,
        updatedAt: "2026-03-01T00:00:00.000Z",
        deletedAt: "2026-01-01T00:00:00.000Z"
      }),
      item({
        id: "deleted-later",
        status: "trash" as ItemStatus,
        updatedAt: "2026-02-01T00:00:00.000Z",
        deletedAt: "2026-04-01T00:00:00.000Z"
      })
    ];

    expect(filterAndSortItems(trashItems, "trash", { sort: "desc" }).map((result) => result.id)).toEqual([
      "deleted-later",
      "updated-later"
    ]);
  });
});
