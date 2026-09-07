/**
 * Finding the addresses inside a query.
 *
 * When someone pastes a link they are not asking us to search for it, they are
 * asking us to read it. Treating that as a search term is the wrong answer to
 * a question that had an obvious right one — the page is right there.
 *
 * Dependency-free so it can be compiled and tested on its own, like the other
 * pure-text modules.
 */

/**
 * Bare hostnames are ambiguous in a way schemed URLs are not: "node.js",
 * "package.json" and "app.tsx" all look like domains and none of them are.
 * Guessing wrong turns a search into a failed fetch, so a bare hostname is
 * only accepted when it ends in a suffix people actually browse to.
 *
 * Deliberately short. A miss costs a normal search, which is what the user
 * would have got anyway; a false positive costs a wasted fetch and a confusing
 * result.
 */
const BROWSABLE_SUFFIXES = new Set([
  "com", "org", "net", "edu", "gov", "int", "mil", "io", "ai", "dev", "app",
  "co", "me", "info", "biz", "news", "blog", "tech", "xyz", "site", "online",
  "tr", "uk", "de", "fr", "nl", "es", "it", "se", "no", "fi", "dk", "pl", "pt",
  "ru", "ua", "jp", "cn", "kr", "in", "br", "mx", "ca", "au", "nz", "ch", "at",
  "be", "cz", "gr", "il", "ie", "hu", "ro", "bg", "rs", "hr", "sk", "si", "lt",
  "lv", "ee", "is", "eu",
]);

/** Matches an http(s) URL, stopping before trailing sentence punctuation. */
const SCHEMED = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/** Matches a bare host, optionally with a path. */
const BARE = /\b(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi;

/** Trailing characters that are punctuation in a sentence, not part of a URL. */
function trimTrailingPunctuation(raw: string): string {
  let url = raw;
  while (url.length > 0 && /[.,;:!?)\]}»”’]$/.test(url)) {
    // A closing bracket belongs to the URL when the URL opened one, which
    // Wikipedia article paths do constantly:
    // /wiki/Ruby_(programming_language). It is punctuation only when it closes
    // a bracket that was opened in the surrounding sentence instead.
    const last = url[url.length - 1];
    const opened = url.match(/\(/g)?.length ?? 0;
    const closed = url.match(/\)/g)?.length ?? 0;
    if (last === ")" && opened >= closed) break;
    url = url.slice(0, -1);
  }
  return url;
}

function normalise(raw: string): string | null {
  const trimmed = trimTrailingPunctuation(raw);
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;

    // Credentials in a URL are a classic way to confuse a fetching proxy, and
    // there is no legitimate reason for one to arrive in a search box.
    if (url.username || url.password) return null;

    return url.toString();
  } catch {
    return null;
  }
}

export interface QueryUrls {
  /** Addresses found, in the order they appeared, deduplicated. */
  urls: string[];
  /** The query with those addresses removed, for the search half. */
  remainder: string;
  /** True when the query was nothing but addresses. */
  onlyUrls: boolean;
}

export function extractUrls(query: string, max = 3): QueryUrls {
  const found: string[] = [];
  const seen = new Set<string>();
  let remainder = query;

  const take = (raw: string, requireBrowsableSuffix: boolean): void => {
    const candidate = trimTrailingPunctuation(raw);

    if (requireBrowsableSuffix) {
      // A bare token that is not a browsable host is an ordinary word, so it
      // stays in the query for the search half to use.
      const host = candidate.split("/")[0].toLowerCase();
      const suffix = host.split(".").pop() ?? "";
      if (!BROWSABLE_SUFFIXES.has(suffix)) return;
    } else {
      // Something written as an explicit http(s) URL is an address whatever we
      // decide about it, so it leaves the query either way. Without this, a
      // rejected URL got picked apart by the bare-host pass afterwards and its
      // hostname was accepted on its own — which is how a credentialed URL we
      // had just refused came back as a plain fetch of the same host.
      remainder = remainder.replace(candidate, " ");
    }

    if (found.length >= max) return;

    const url = normalise(candidate);
    if (!url || seen.has(url)) return;

    seen.add(url);
    found.push(url);
    if (requireBrowsableSuffix) remainder = remainder.replace(candidate, " ");
  };

  for (const match of query.match(SCHEMED) ?? []) take(match, false);
  for (const match of remainder.match(BARE) ?? []) take(match, true);

  remainder = remainder.replace(/\s+/g, " ").trim();

  return { urls: found, remainder, onlyUrls: found.length > 0 && remainder.length === 0 };
}
