"use client";

import { useState, FormEvent } from "react";

interface DemoResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

const examples = [
  "2026 yapay zeka model haberleri",
  "en iyi vektör veritabanları",
  "istanbul hava durumu",
];

export default function DemoSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DemoResult[] | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);

  async function runSearch(q: string) {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/demo-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Bir şeyler ters gitti, tekrar deneyin.");
        return;
      }
      setResults(data.results);
      setTookMs(data.took_ms);
    } catch {
      setError("Bağlantı hatası, tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    runSearch(query);
  }

  return (
    <div className="overflow-hidden rounded-3xl border-2 border-clouda-ink bg-white">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 p-3 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Bir şey sor — Clouda web'de arasın"
          className="flex-1 rounded-2xl bg-clouda-bg px-5 py-4 text-base font-medium text-clouda-ink outline-none ring-clouda-violet placeholder:text-clouda-ink/35 focus:ring-2"
          maxLength={200}
        />
        <button
          type="submit"
          disabled={loading}
          className="btn-primary shrink-0 !px-8 !py-4 text-base disabled:opacity-60"
        >
          {loading ? "Aranıyor…" : "Ara"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2 px-4 pb-4">
        {examples.map((ex) => (
          <button
            key={ex}
            onClick={() => {
              setQuery(ex);
              runSearch(ex);
            }}
            className="rounded-full bg-clouda-panel px-3 py-1.5 text-xs font-semibold text-clouda-violetDark transition hover:bg-clouda-violet hover:text-white"
          >
            {ex}
          </button>
        ))}
      </div>

      {error && (
        <p className="border-t-2 border-clouda-ink bg-clouda-pink px-5 py-4 text-sm font-semibold text-clouda-ink">
          {error}
        </p>
      )}

      {results && (
        <div className="border-t-2 border-clouda-ink bg-clouda-bg/60">
          {tookMs !== null && (
            <p className="px-5 pt-4 text-xs font-bold uppercase tracking-[0.14em] text-clouda-ink/40">
              {results.length} sonuç · {tookMs}ms
            </p>
          )}
          <div className="space-y-1 p-3">
            {results.length === 0 && (
              <p className="px-2 py-4 text-sm text-clouda-ink/50">
                Sonuç bulunamadı, farklı bir sorgu dene.
              </p>
            )}
            {results.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-2xl px-4 py-3 transition hover:bg-white"
              >
                <p className="font-bold text-clouda-violetDark">{r.title}</p>
                <p className="truncate text-xs text-clouda-ink/40">{r.url}</p>
                <p className="mt-1 line-clamp-2 text-sm text-clouda-ink/65">
                  {r.snippet || r.content}
                </p>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
