export type ItemStatus = "inbox" | "trash";

export interface ReadlaterCliResult {
  url: string;
  title?: string;
  summary?: string;
  source?: string;
  fetched_at?: string;
}

export interface ReadLaterItem {
  id: string;
  url: string;
  title: string;
  summary: string;
  source: string;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  status: ItemStatus;
  domain: string;
  host: string;
}

export interface DatabaseFile {
  version: 1;
  items: ReadLaterItem[];
}
