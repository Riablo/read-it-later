const MULTI_PART_TLDS = new Set([
  "co.uk",
  "org.uk",
  "ac.uk",
  "com.au",
  "net.au",
  "com.br",
  "com.cn",
  "com.hk",
  "co.jp",
  "co.kr",
  "co.nz",
  "com.sg",
  "com.tw"
]);

export function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();

  if (!trimmed) {
    throw new Error("请输入 URL。");
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  const url = new URL(withProtocol);
  url.hash = "";
  return url.toString();
}

export function hostFromUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

export function domainLabelFromUrl(rawUrl: string): string {
  const host = hostFromUrl(rawUrl);

  if (host === "x.com" || host.endsWith(".x.com")) {
    return "x";
  }

  if (host === "twitter.com" || host.endsWith(".twitter.com")) {
    return "x";
  }

  const parts = host.split(".").filter(Boolean);

  if (parts.length <= 2) {
    return parts[0] || host;
  }

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.at(-3) ?? parts[0];
  }

  return parts.at(-2) ?? parts[0];
}

export function displayHost(rawUrl: string): string {
  return hostFromUrl(rawUrl);
}
