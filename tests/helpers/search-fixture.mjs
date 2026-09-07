import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { loadTs } from "./load-ts.mjs";

export const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
export { delay };

export function fixture({ root = projectRoot, providerDelays = [10, 15, 20, 25], dbReadMs = 0, results, extract } = {}) {
  const rows = new Map();
  const pending = [];
  const stats = { reads: 0, writes: 0, providerCalls: 0, pageCalls: [] };
  const offload = (task) => { pending.push(Promise.resolve().then(task).catch(() => {})); };
  const searchCache = {
    async findUnique({ where }) {
      stats.reads++;
      if (dbReadMs) await delay(dbReadMs);
      return rows.get(where.cacheKey) ?? null;
    },
    async upsert({ where, create, update }) {
      stats.writes++;
      const row = rows.has(where.cacheKey) ? { ...rows.get(where.cacheKey), ...update } :
        { ...create, id: where.cacheKey, createdAt: new Date() };
      rows.set(where.cacheKey, row);
      return row;
    },
    async update() {},
    async delete({ where }) { rows.delete(where.id); },
    async deleteMany({ where }) {
      let count = 0;
      for (const [key, row] of rows) {
        if (where.cacheKey ? key === where.cacheKey : row.expiresAt <= where.expiresAt.lte) {
          rows.delete(key); count++;
        }
      }
      return { count };
    },
  };
  const providers = providerDelays.map((ms, i) => ({
    name: `fixture-${i}`, tier: i < 2 ? "web" : "vertical", available: () => true,
    async search(query, limit) {
      stats.providerCalls++;
      if (ms) await delay(ms);
      return (results ? results(i, query) : Array.from({ length: 3 }, (_, j) => ({
        title: `${query} reference ${i}-${j}`, url: `https://source${i}.example/article/${j}`,
        snippet: `${query} explains database performance with measured examples and reliable sources.`,
        publishedAt: new Date().toISOString(),
      }))).slice(0, limit);
    },
  }));
  const load = loadTs(root, {
    "@/lib/prisma": { prisma: { searchCache } },
    "@/lib/core/offload": { offload },
    "@/lib/search/providers": {
      openProvidersForIntent: () => providers,
      searchProvider: (provider, ...args) => provider.search(...args),
    },
    "@/lib/search/extract": { async fetchAndExtract(url, options) {
      stats.pageCalls.push(url);
      return extract ? extract(url, options) : {
        url, title: "Reference", content: "Full reference content about database performance and indexing.",
        publishedAt: null, updatedAt: null, links: [], bytes: 100,
      };
    } },
  });
  const engine = load("lib/search/engine.ts");
  return {
    ...engine, load, rows, stats, providers,
    async drain() { for (let i = 0; i < pending.length; i++) await pending[i]; },
  };
}
