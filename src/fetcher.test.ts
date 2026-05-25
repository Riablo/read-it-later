import { afterEach, describe, expect, test } from "bun:test";
import { extractTextFromOembedHtml, fetchReadlaterItem, parseHtmlMetadata, parseXStatusUrl } from "./fetcher";

const originalFetch = globalThis.fetch;
type FetchHandler = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function setMockFetch(handler: FetchHandler) {
  const mockedFetch = Object.assign(handler, {
    preconnect: originalFetch.preconnect.bind(originalFetch)
  }) as typeof fetch;

  globalThis.fetch = mockedFetch;
}

describe("fetcher html metadata", () => {
  test("reads title, description, canonical, and body fallback text", () => {
    const parsed = parseHtmlMetadata(`
      <!doctype html>
      <html>
        <head>
          <title>Fallback Title</title>
          <meta property="og:title" content="OG Title &amp; More">
          <meta name="description" content="A compact description">
          <link rel="canonical" href="/canonical">
        </head>
        <body>
          <script>ignored()</script>
          <main><p>First paragraph.</p><p>Second paragraph.</p></main>
        </body>
      </html>
    `);

    expect(parsed.title).toBe("Fallback Title");
    expect(parsed.meta["og:title"]).toBe("OG Title & More");
    expect(parsed.meta.description).toBe("A compact description");
    expect(parsed.links.canonical).toBe("/canonical");
    expect(parsed.bodyText).toContain("First paragraph. Second paragraph.");
  });
});

describe("fetcher x support", () => {
  test("parses public X status URLs", () => {
    expect(parseXStatusUrl("https://x.com/jack/status/20")).toEqual({
      handle: "jack",
      statusId: "20"
    });
    expect(parseXStatusUrl("https://x.com/i/web/status/20")).toEqual({
      handle: null,
      statusId: "20"
    });
  });

  test("extracts readable text from oEmbed html", () => {
    const text = extractTextFromOembedHtml(`
      <blockquote>
        <p>just setting up my twttr pic.twitter.com/abc</p>
        <a href="https://x.com/jack/status/20">date</a>
      </blockquote>
    `);

    expect(text).toBe("just setting up my twttr");
  });

  test("uses post text as the saved X title", async () => {
    setMockFetch(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(url).toContain("publish.x.com/oembed");

      return new Response(
        JSON.stringify({
          html: '<blockquote><p>just setting up my twttr</p></blockquote>',
          author_name: "jack",
          author_url: "https://twitter.com/jack",
          url: "https://twitter.com/jack/status/20"
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    });

    const item = await fetchReadlaterItem("https://x.com/jack/status/20");

    expect(item.title).toBe("just setting up my twttr");
    expect(item.summary).toBe("@jack on X");
  });
});

describe("fetcher network recovery", () => {
  test("retries transient network errors before failing", async () => {
    let attempts = 0;
    setMockFetch(async () => {
      attempts += 1;

      if (attempts === 1) {
        throw new TypeError("The socket connection was closed unexpectedly.");
      }

      return new Response(
        `
          <!doctype html>
          <html>
            <head>
              <title>Codegraph</title>
              <meta name="description" content="Pre-indexed code knowledge graph">
            </head>
            <body>
              <p>Pre-indexed code knowledge graph.</p>
            </body>
          </html>
        `,
        {
          headers: {
            "content-type": "text/html; charset=utf-8"
          }
        }
      );
    });

    const item = await fetchReadlaterItem("https://github.com/colbymchenry/codegraph");

    expect(attempts).toBe(2);
    expect(item.title).toBe("Codegraph");
    expect(item.summary).toBe("Pre-indexed code knowledge graph");
  });

  test("falls back to repository metadata when GitHub keeps closing the connection", async () => {
    setMockFetch(async () => {
      throw new TypeError("The socket connection was closed unexpectedly.");
    });

    const item = await fetchReadlaterItem("https://github.com/colbymchenry/codegraph");

    expect(item.title).toBe("colbymchenry/codegraph");
    expect(item.summary).toBe("GitHub 仓库 · colbymchenry");
    expect(item.site_name).toBe("GitHub");
    expect(item.source).toBe("github-url-fallback");
  });
});
