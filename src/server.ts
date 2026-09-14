import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { displayHost, domainLabelFromUrl, normalizeUrl } from "./domain.ts";
import { fetchUrlMetadata, metadataErrorMessage } from "./readlater.ts";
import { clearTrash, getCounts, listItems, moveItem, upsertFetchedItem } from "./store.ts";
import type { ItemStatus, SortDirection } from "./types.ts";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 3042);
const hostname = process.env.HOST || "127.0.0.1";
const maxBodySize = 128 * 1024 * 1024; // Preserve Bun.serve's default request limit.

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

function html(body: string, init?: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init?.headers
    }
  });
}

function redirect(path: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: path
    }
  });
}

function parseStatus(raw: string | null): ItemStatus {
  if (raw === "kept" || raw === "trash") {
    return raw;
  }

  return "inbox";
}

function parseSortDirection(raw: string | null): SortDirection {
  return raw === "asc" ? "asc" : "desc";
}

async function serveStatic(pathname: string): Promise<Response> {
  const filePath = pathname === "/" ? join(publicDir, "index.html") : join(publicDir, pathname);

  if (!filePath.startsWith(publicDir + sep)) {
    return new Response("未找到", { status: 404 });
  }

  let file;
  try {
    file = await readFile(filePath);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EISDIR"].includes((error as NodeJS.ErrnoException).code || "")) {
      return new Response("未找到", { status: 404 });
    }
    throw error;
  }

  return new Response(file, {
    headers: {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(filePath)] || "application/octet-stream"
    }
  });
}

async function saveUrl(rawUrl: string | null): Promise<Response> {
  if (!rawUrl) {
    return html(savePage("缺少 URL", "请添加 url 查询参数来保存页面。", true), {
      status: 400
    });
  }

  try {
    const url = normalizeUrl(rawUrl);
    const fetched = await fetchUrlMetadata(url);
    const item = await upsertFetchedItem(fetched);
    return redirect(`/?saved=${encodeURIComponent(item.id)}`);
  } catch (error) {
    return html(savePage("保存失败", metadataErrorMessage(error), true), { status: 500 });
  }
}

function savePage(title: string, message: string, failed = false): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - 稍后阅读</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="message-page">
  <main class="message-panel" data-tone="${failed ? "error" : "muted"}">
    <p class="eyebrow">稍后阅读</p>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/">返回列表</a>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function handleApi(request: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/items" && request.method === "GET") {
    const status = parseStatus(url.searchParams.get("status"));
    const query = url.searchParams.get("q") || "";
    const sort = parseSortDirection(url.searchParams.get("sort"));
    const [items, counts] = await Promise.all([listItems(status, { query, sort }), getCounts()]);
    return json({ items, counts });
  }

  if (url.pathname === "/api/save" && request.method === "POST") {
    try {
      const body = (await request.json()) as { url?: string };
      const targetUrl = normalizeUrl(body.url || "");
      const fetched = await fetchUrlMetadata(targetUrl);
      const item = await upsertFetchedItem(fetched);
      const counts = await getCounts();
      return json({ item, counts }, { status: 201 });
    } catch (error) {
      return json({ error: metadataErrorMessage(error) }, { status: 400 });
    }
  }

  if (url.pathname === "/api/trash/clear" && request.method === "POST") {
    try {
      const body = (await request.json()) as { confirm?: string };

      if (body.confirm !== "CLEAR_TRASH") {
        return json({ error: "请确认后再清空回收站。" }, { status: 400 });
      }

      const removed = await clearTrash();
      const counts = await getCounts();
      return json({ removed, counts });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "无法清空回收站。" }, { status: 400 });
    }
  }

  const moveMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/(trash|restore|keep)$/);
  if (moveMatch && request.method === "POST") {
    try {
      const id = decodeURIComponent(moveMatch[1]);
      const status: ItemStatus =
        moveMatch[2] === "trash" ? "trash" : moveMatch[2] === "keep" ? "kept" : "inbox";
      const item = await moveItem(id, status);
      const counts = await getCounts();
      return json({ item, counts });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "无法移动链接。" }, { status: 404 });
    }
  }

  if (url.pathname === "/api/preview-domain" && request.method === "POST") {
    try {
      const body = (await request.json()) as { url?: string };
      const targetUrl = normalizeUrl(body.url || "");
      return json({
        url: targetUrl,
        domain: domainLabelFromUrl(targetUrl),
        host: displayHost(targetUrl)
      });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "URL 无效。" }, { status: 400 });
    }
  }

  return json({ error: "未找到" }, { status: 404 });
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/save" && request.method === "GET") {
    return saveUrl(url.searchParams.get("url") || url.searchParams.get("u"));
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(request, url);
  }

  return serveStatic(url.pathname);
}

const server = createServer(async (incoming, outgoing) => {
  try {
    if (Number(incoming.headers["content-length"]) > maxBodySize) {
      outgoing.writeHead(413).end("Payload Too Large");
      return;
    }
    const chunks: Buffer[] = [];
    let bodySize = 0;
    for await (const chunk of incoming) {
      bodySize += chunk.length;
      if (bodySize > maxBodySize) {
        outgoing.writeHead(413).end("Payload Too Large");
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
    }
    const request = new Request(new URL(incoming.url || "/", `http://${hostname}:${port}`), {
      method: incoming.method,
      headers,
      body: chunks.length ? Buffer.concat(chunks) : undefined
    });
    const response = await handleRequest(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    outgoing.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    outgoing.end(JSON.stringify({ error: error instanceof Error ? error.message : "服务器发生意外错误。" }));
  }
});

server.listen(port, hostname, () => {
  const address = server.address();
  console.log(`稍后阅读正在运行：http://${hostname}:${typeof address === "object" && address ? address.port : port}`);
});

process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
