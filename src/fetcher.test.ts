import { describe, expect, test } from "bun:test";
import { extractTextFromOembedHtml, parseHtmlMetadata, parseXStatusUrl } from "./fetcher";

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
});
