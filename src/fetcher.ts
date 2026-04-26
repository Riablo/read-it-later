import type { FetchedMetadata } from "./types";

const APP_NAME = "read-it-later";
const DEFAULT_TIMEOUT_SECONDS = 10;
const DEFAULT_SUMMARY_LENGTH = 280;
const DEFAULT_RETRIES = 1;
const USER_AGENT = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  "AppleWebKit/537.36 (KHTML, like Gecko)",
  `${APP_NAME}/1.0`
].join(" ");

const X_HOSTS = new Set([
  "x.com",
  "twitter.com",
  "mobile.twitter.com",
  "www.x.com",
  "www.twitter.com"
]);

const BLOCK_TAGS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "br",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "p",
  "section",
  "td",
  "th",
  "tr"
]);

const SKIP_TAGS = new Set(["script", "style", "noscript", "template", "svg"]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "...",
  lt: "<",
  mdash: "-",
  nbsp: " ",
  ndash: "-",
  quot: '"'
};

interface HttpResponse {
  url: string;
  status: number;
  headers: Headers;
  body: Uint8Array;
}

export interface XStatusInfo {
  handle: string | null;
  statusId: string;
}

export interface HtmlMetadata {
  title: string | null;
  bodyText: string | null;
  meta: Record<string, string>;
  links: Record<string, string>;
}

export async function fetchReadlaterItem(
  rawUrl: string,
  options: { timeoutSeconds?: number; summaryLength?: number } = {}
): Promise<FetchedMetadata> {
  const url = normalizeInputUrl(rawUrl);
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const summaryLength = options.summaryLength ?? DEFAULT_SUMMARY_LENGTH;
  const xInfo = parseXStatusUrl(url);

  if (xInfo) {
    try {
      return await fetchXOembed(url, xInfo, timeoutSeconds, summaryLength);
    } catch {
      try {
        const item = await fetchGenericUrl(url, timeoutSeconds, summaryLength);
        return isUnhelpfulXItem(item) ? buildXUrlFallback(url, xInfo) : item;
      } catch {
        return buildXUrlFallback(url, xInfo);
      }
    }
  }

  return fetchGenericUrl(url, timeoutSeconds, summaryLength);
}

export function normalizeInputUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) {
    throw new Error("请输入 URL。");
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`只支持 http/https URL：${rawUrl}`);
  }

  url.hash = "";
  return url.toString();
}

export function parseXStatusUrl(rawUrl: string): XStatusInfo | null {
  const url = new URL(rawUrl);
  const host = normalizeHost(url.host);

  if (!X_HOSTS.has(host)) {
    return null;
  }

  const parts = url.pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));

  if (parts.length >= 3 && ["status", "statuses"].includes(parts[1]) && /^\d+$/.test(parts[2])) {
    return { handle: parts[0], statusId: parts[2] };
  }

  if (parts.length >= 4 && parts[0] === "i" && parts[1] === "web" && parts[2] === "status" && /^\d+$/.test(parts[3])) {
    return { handle: null, statusId: parts[3] };
  }

  return null;
}

export function extractTextFromOembedHtml(rawHtml: string): string | null {
  let inParagraph = 0;
  const paragraphParts: string[] = [];
  const allParts: string[] = [];

  scanHtml(rawHtml, {
    tag(token) {
      const tag = parseTag(token);
      if (!tag || tag.name !== "p") {
        return;
      }

      if (tag.type === "start") {
        inParagraph += 1;
      } else if (tag.type === "end" && inParagraph > 0) {
        inParagraph -= 1;
      }
    },
    text(text) {
      if (!text) {
        return;
      }

      allParts.push(text);
      if (inParagraph > 0) {
        paragraphParts.push(text);
      }
    }
  });

  let text = cleanText(paragraphParts.join(" ")) || cleanText(allParts.join(" "));
  if (!text) {
    return null;
  }

  text = text.replace(/\s+pic\.(?:twitter|x)\.com\/\S+$/i, "");
  return cleanText(text);
}

export function parseHtmlMetadata(rawHtml: string): HtmlMetadata {
  const meta: Record<string, string> = {};
  const links: Record<string, string> = {};
  const titleParts: string[] = [];
  const bodyParts: string[] = [];
  let inTitle = false;
  let inBody = false;
  let skipDepth = 0;

  scanHtml(rawHtml, {
    tag(token) {
      const tag = parseTag(token);
      if (!tag) {
        return;
      }

      if (tag.type === "start" && SKIP_TAGS.has(tag.name)) {
        skipDepth += 1;
        return;
      }

      if (tag.type === "end" && SKIP_TAGS.has(tag.name)) {
        if (skipDepth > 0) {
          skipDepth -= 1;
        }
        return;
      }

      if (skipDepth > 0) {
        return;
      }

      if (tag.name === "title") {
        inTitle = tag.type === "start";
      } else if (tag.name === "body") {
        inBody = tag.type === "start";
      } else if (tag.type === "start" && tag.name === "meta") {
        const key = (tag.attrs.property || tag.attrs.name || tag.attrs.itemprop || "").trim().toLowerCase();
        const content = cleanText(tag.attrs.content);
        if (key && content && !meta[key]) {
          meta[key] = content;
        }
      } else if (tag.type === "start" && tag.name === "link") {
        const rel = (tag.attrs.rel || "").toLowerCase();
        const href = cleanText(tag.attrs.href);
        if (href && rel.includes("canonical")) {
          links.canonical = href;
        }
      }

      if (inBody && BLOCK_TAGS.has(tag.name)) {
        bodyParts.push("\n");
      }
    },
    text(text) {
      if (skipDepth > 0) {
        return;
      }

      if (inTitle) {
        titleParts.push(text);
      } else if (inBody && bodyParts.length < 800) {
        bodyParts.push(text);
      }
    }
  });

  return {
    title: cleanText(titleParts.join(" ")),
    bodyText: cleanText(bodyParts.join(" ")),
    meta,
    links
  };
}

async function fetchGenericUrl(
  url: string,
  timeoutSeconds: number,
  summaryLength: number
): Promise<FetchedMetadata> {
  const response = await requestBytes(url, timeoutSeconds, "text/html,application/xhtml+xml,*/*;q=0.8");

  if (!isProbablyHtml(response.headers)) {
    const contentType = cleanText(response.headers.get("content-type") || "");
    return {
      url,
      canonical_url: response.url !== url ? response.url : undefined,
      title: readableTitleFromUrl(response.url),
      summary: contentType ? `非 HTML 内容：${contentType}` : undefined,
      source: "url",
      fetched_at: utcNowIso()
    };
  }

  const rawHtml = decodeHtml(response.body, response.headers);
  const parser = parseHtmlMetadata(rawHtml);
  const title =
    firstMeta(parser.meta, ["og:title", "twitter:title"]) ||
    parser.title ||
    readableTitleFromUrl(response.url);
  const summary = removeTitlePrefix(
    firstMeta(parser.meta, ["og:description", "description", "twitter:description"]) || parser.bodyText,
    title
  );
  const canonical = firstMeta(parser.meta, ["og:url"]) || parser.links.canonical;

  return {
    url,
    canonical_url: normalizeCanonicalUrl(canonical, response.url) || (response.url !== url ? response.url : undefined),
    title: truncateText(title, 160) || readableTitleFromUrl(response.url),
    summary: truncateText(summary, summaryLength) || undefined,
    source: "html",
    site_name: firstMeta(parser.meta, ["og:site_name", "application-name"]) || undefined,
    fetched_at: utcNowIso()
  };
}

async function fetchXOembed(
  url: string,
  info: XStatusInfo,
  timeoutSeconds: number,
  summaryLength: number
): Promise<FetchedMetadata> {
  const query = new URLSearchParams({
    url,
    omit_script: "true",
    hide_media: "true",
    hide_thread: "true",
    dnt: "true"
  });
  const payload = await requestJson(`https://publish.x.com/oembed?${query}`, timeoutSeconds);
  const rawHtml = typeof payload.html === "string" ? payload.html : "";
  const summary = truncateText(extractTextFromOembedHtml(rawHtml), summaryLength);

  if (!summary) {
    throw new Error("X oEmbed 响应中没有可读正文。");
  }

  const authorName = cleanText(toStringValue(payload.author_name));
  const authorUrl = cleanText(toStringValue(payload.author_url));
  const handle = handleFromUrl(authorUrl) || info.handle;

  return {
    url,
    canonical_url: cleanText(toStringValue(payload.url)) || undefined,
    title: buildXTitle(authorName, handle),
    summary,
    source: "x-oembed",
    author_name: authorName || undefined,
    author_url: authorUrl || undefined,
    site_name: "X",
    fetched_at: utcNowIso()
  };
}

async function requestJson(url: string, timeoutSeconds: number): Promise<Record<string, unknown>> {
  const response = await requestBytes(url, timeoutSeconds, "application/json");
  const text = decodeHtml(response.body, response.headers);

  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("响应 JSON 格式不正确。");
    }

    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("响应不是合法 JSON。");
    }

    throw error;
  }
}

async function requestBytes(url: string, timeoutSeconds: number, accept: string): Promise<HttpResponse> {
  return requestBytesWithRetries(url, timeoutSeconds, accept, DEFAULT_RETRIES);
}

async function requestBytesWithRetries(
  url: string,
  timeoutSeconds: number,
  accept: string,
  retries: number
): Promise<HttpResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept,
          "accept-encoding": "gzip, deflate",
          "user-agent": USER_AGENT
        },
        signal: AbortSignal.timeout(timeoutSeconds * 1000),
        redirect: "follow"
      });
      const body = new Uint8Array(await response.arrayBuffer());

      if (!response.ok) {
        const message = compactErrorBody(decodeHtml(body, response.headers));
        throw new Error(`HTTP ${response.status}：${message || response.statusText}`);
      }

      return {
        url: response.url,
        status: response.status,
        headers: response.headers,
        body
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries && isRetryableError(error)) {
        continue;
      }

      throw new Error(formatNetworkError(error));
    }
  }

  throw new Error(formatNetworkError(lastError));
}

function scanHtml(
  rawHtml: string,
  handlers: {
    tag?: (token: string) => void;
    text?: (text: string) => void;
  }
) {
  let index = 0;

  while (index < rawHtml.length) {
    const tagStart = rawHtml.indexOf("<", index);
    if (tagStart === -1) {
      handlers.text?.(rawHtml.slice(index));
      break;
    }

    if (tagStart > index) {
      handlers.text?.(rawHtml.slice(index, tagStart));
    }

    const tagEnd = findTagEnd(rawHtml, tagStart + 1);
    if (tagEnd === -1) {
      handlers.text?.(rawHtml.slice(tagStart));
      break;
    }

    handlers.tag?.(rawHtml.slice(tagStart, tagEnd + 1));
    index = tagEnd + 1;
  }
}

function findTagEnd(rawHtml: string, start: number): number {
  let quote: string | null = null;

  for (let index = start; index < rawHtml.length; index += 1) {
    const char = rawHtml[index];

    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === ">") {
      return index;
    }
  }

  return -1;
}

function parseTag(token: string): { type: "start" | "end"; name: string; attrs: Record<string, string> } | null {
  if (/^<\s*(?:!|--|\?)/.test(token)) {
    return null;
  }

  const match = token.match(/^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9:-]*)\b([\s\S]*?)\/?\s*>$/);
  if (!match) {
    return null;
  }

  return {
    type: match[1] ? "end" : "start",
    name: match[2].toLowerCase(),
    attrs: parseAttrs(match[3] || "")
  };
}

function parseAttrs(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrPattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(rawAttrs))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeHtmlEntities(value);
  }

  return attrs;
}

function cleanText(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const text = decodeHtmlEntities(value)
    .replaceAll("\u200b", "")
    .replaceAll("\ufeff", "")
    .replace(/\s+/g, " ")
    .trim();

  return text || null;
}

function truncateText(value: string | null | undefined, limit: number): string | null {
  const text = cleanText(value);
  if (!text) {
    return null;
  }

  if (limit <= 0 || text.length <= limit) {
    return text;
  }

  let cutAt = text.lastIndexOf(" ", Math.max(1, limit - 3));
  if (cutAt < Math.max(20, Math.floor(limit / 2))) {
    cutAt = Math.max(1, limit - 3);
  }

  return `${text.slice(0, cutAt).trimEnd()}...`;
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);?/gi, (match, entity: string) => {
    const key = entity.toLowerCase();

    if (key.startsWith("#x")) {
      const codePoint = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (key.startsWith("#")) {
      const codePoint = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return NAMED_ENTITIES[key] ?? match;
  });
}

function decodeHtml(body: Uint8Array, headers: Headers): string {
  const contentType = headers.get("content-type") || "";
  const charset = contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1];
  const asciiHead = new TextDecoder("ascii", { fatal: false }).decode(body.slice(0, 4096));
  const metaCharset = asciiHead.match(/charset=["']?([A-Za-z0-9._-]+)/i)?.[1];
  const candidates = [charset, metaCharset, "utf-8", "gb18030", "latin1"].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      return new TextDecoder(candidate).decode(body);
    } catch {
      continue;
    }
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(body);
}

function compactErrorBody(value: string): string | null {
  let text = value.trim();
  if (!text) {
    return null;
  }

  if (/<(?:!doctype\s+html|html|body|title|h1)\b/i.test(text)) {
    text = text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }

  return truncateText(text, 300);
}

function firstMeta(meta: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = cleanText(meta[key.toLowerCase()]);
    if (value) {
      return value;
    }
  }

  return null;
}

function removeTitlePrefix(summary: string | null, title: string | null): string | null {
  const cleanSummary = cleanText(summary);
  const cleanTitle = cleanText(title);

  if (!cleanSummary || !cleanTitle) {
    return cleanSummary;
  }

  if (cleanSummary.toLowerCase().startsWith(cleanTitle.toLowerCase())) {
    const rest = cleanSummary.slice(cleanTitle.length).replace(/^[\s\-:|]+/, "").trim();
    return rest || cleanSummary;
  }

  return cleanSummary;
}

function readableTitleFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  const lastPathPart = decodeURIComponent(url.pathname.replace(/\/$/, "").split("/").at(-1) || "");
  const name = lastPathPart.replace(/[-_]+/g, " ").trim();
  return name || url.host || rawUrl;
}

function normalizeCanonicalUrl(rawCanonical: string | null, baseUrl: string): string | undefined {
  if (!rawCanonical) {
    return undefined;
  }

  try {
    return new URL(rawCanonical, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function isProbablyHtml(headers: Headers): boolean {
  const contentType = (headers.get("content-type") || "").toLowerCase();
  return !contentType || contentType.includes("html") || contentType.includes("text/");
}

function isUnhelpfulXItem(item: FetchedMetadata): boolean {
  const title = (item.title || "").trim().toLowerCase();
  const summary = (item.summary || "").trim().toLowerCase();

  if (["x", "x / ?", "nothing to see here"].includes(title)) {
    return true;
  }

  if (title.startsWith("x /") && !item.summary) {
    return true;
  }

  return summary.includes("something went wrong") || summary.includes("nothing to see here");
}

function buildXUrlFallback(url: string, info: XStatusInfo): FetchedMetadata {
  return {
    url,
    title: buildXTitle(null, info.handle),
    source: "x-url",
    site_name: "X",
    fetched_at: utcNowIso()
  };
}

function buildXTitle(authorName: string | null, handle: string | null): string {
  const author = cleanText(authorName);

  if (author && handle) {
    return `${author} (@${handle}) on X`;
  }

  if (author) {
    return `${author} on X`;
  }

  if (handle) {
    return `@${handle} on X`;
  }

  return "X Post";
}

function handleFromUrl(rawUrl: string | null): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    const handle = decodeURIComponent(url.pathname.split("/").filter(Boolean)[0] || "").replace(/^@/, "").trim();
    return handle || null;
  } catch {
    return null;
  }
}

function normalizeHost(netloc: string): string {
  return netloc.split("@").at(-1)?.split(":")[0].toLowerCase() || netloc.toLowerCase();
}

function utcNowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return ["AbortError", "TimeoutError", "TypeError"].includes(error.name);
}

function formatNetworkError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "请求超时。";
    }

    if (error.message.startsWith("HTTP ")) {
      return error.message;
    }

    return `请求失败：${error.message}`;
  }

  return "请求失败。";
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (value == null) {
    return null;
  }

  return String(value);
}
