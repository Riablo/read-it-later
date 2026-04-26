import { describe, expect, test } from "bun:test";
import { domainLabelFromUrl, normalizeUrl } from "./domain";

describe("domain labels", () => {
  test("uses the recognizable second-level domain", () => {
    expect(domainLabelFromUrl("https://github.com/openai/codex")).toBe("github");
    expect(domainLabelFromUrl("https://news.ycombinator.com/item?id=1")).toBe("ycombinator");
  });

  test("normalizes X and Twitter as x", () => {
    expect(domainLabelFromUrl("https://x.com/user/status/1")).toBe("x");
    expect(domainLabelFromUrl("https://mobile.twitter.com/user/status/1")).toBe("x");
  });

  test("handles common multi-part public suffixes", () => {
    expect(domainLabelFromUrl("https://www.bbc.co.uk/news")).toBe("bbc");
  });
});

describe("url normalization", () => {
  test("adds https and strips hashes", () => {
    expect(normalizeUrl("example.com/page#section")).toBe("https://example.com/page");
  });
});
