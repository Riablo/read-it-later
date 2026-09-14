import { fetchReadlaterItem } from "./fetcher.ts";
import type { FetchedMetadata } from "./types.ts";

export async function fetchUrlMetadata(url: string): Promise<FetchedMetadata> {
  return fetchReadlaterItem(url, {
    summaryLength: 280,
    timeoutSeconds: 10
  });
}

export function metadataErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "未知的抓取错误。";
}
