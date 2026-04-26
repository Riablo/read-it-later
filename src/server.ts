import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { displayHost, domainLabelFromUrl, normalizeUrl } from "./domain";
import { fetchUrlMetadata, metadataErrorMessage } from "./readlater";
import { clearTrash, getCounts, listItems, moveItem, upsertFetchedItem } from "./store";
import type { ItemStatus } from "./types";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");
const port = Number(process.env.PORT || 3042);
const hostname = process.env.HOST || "127.0.0.1";

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
  return raw === "trash" ? "trash" : "inbox";
}

async function serveStatic(pathname: string): Promise<Response> {
  const filePath = pathname === "/" ? join(publicDir, "index.html") : join(publicDir, pathname);

  if (!filePath.startsWith(publicDir)) {
    return new Response("未找到", { status: 404 });
  }

  const file = Bun.file(filePath);
  const exists = await file.exists();

  if (!exists) {
    return new Response("未找到", { status: 404 });
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
  const tone = failed ? "#B91C1C" : "#0F766E";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} - 稍后阅读</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    main { width: min(520px, calc(100vw - 40px)); border: 1px solid #dbe4ea; border-radius: 8px; background: white; padding: 28px; box-shadow: 0 24px 60px rgb(15 23 42 / 0.10); }
    h1 { margin: 0 0 10px; color: ${tone}; font-size: 22px; letter-spacing: 0; }
    p { margin: 0 0 18px; line-height: 1.6; color: #475569; word-break: break-word; }
    a { color: #0f766e; font-weight: 700; }
  </style>
</head>
<body>
  <main>
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
    const [items, counts] = await Promise.all([listItems(status), getCounts()]);
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

  const moveMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/(trash|restore)$/);
  if (moveMatch && request.method === "POST") {
    try {
      const id = decodeURIComponent(moveMatch[1]);
      const status: ItemStatus = moveMatch[2] === "trash" ? "trash" : "inbox";
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

const server = Bun.serve({
  port,
  hostname,
  async fetch(request) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/save" && request.method === "GET") {
        return saveUrl(url.searchParams.get("url") || url.searchParams.get("u"));
      }

      if (url.pathname.startsWith("/api/")) {
        return handleApi(request, url);
      }

      return serveStatic(url.pathname);
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : "服务器发生意外错误。"
        },
        { status: 500 }
      );
    }
  }
});

console.log(`稍后阅读正在运行：http://${server.hostname}:${server.port}`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.stop();
  process.exit(0);
});

setInterval(() => {
  // Keep the local service alive when started without an attached terminal.
}, 60_000);
