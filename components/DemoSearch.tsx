"use client";

import { useState, FormEvent } from "react";

interface DemoResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

const examples = ["vektör veritabanı nedir", "next.js app router", "yapay zeka haberleri"];

export default function DemoSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DemoResult[] | null>(null);
  const [meta, setMeta] = useState<{ tookMs: number; source: string } | null>(null);

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
      setMeta({ tookMs: data.took_ms, source: data.source });
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
    <div className="w-full">
      <form
        onSubmit={handleSubmit}
        className="rounded-[24px] border border-white/70 bg-white/70 p-5 shadow-lift backdrop-blur-md"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Modelinin bilmediği bir şey sor…"
          className="w-full bg-transparent text-lg text-clouda-ink outline-none placeholder:text-clouda-muted/60 sm:text-xl"
          maxLength={200}
        />
        <div className="mt-8 flex items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-pill bg-clouda-ink px-4 py-2 text-xs font-medium text-white">
              search
            </span>
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => {
                  setQuery(ex);
                  runSearch(ex);
                }}
                className="rounded-pill px-3 py-2 text-xs font-medium text-clouda-muted transition hover:bg-white/70 hover:text-clouda-ink"
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={loading}
            aria-label="Ara"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-clouda-ink text-white transition hover:bg-black disabled:opacity-50"
          >
            {loading ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </div>
      </form>

      {error && (
        <div className="card mt-4 p-5 text-sm text-clouda-ink">{error}</div>
      )}

      {results && (
        <div className="card mt-4 overflow-hidden text-left">
          <div className="flex items-center justify-between border-b border-clouda-border px-5 py-3">
            <span className="font-mono text-xs text-clouda-muted">
              Found sources {meta?.tookMs}ms
            </span>
            {meta?.source && (
              <span className="font-mono text-xs text-clouda-sageDark">{meta.source}</span>
            )}
          </div>
          <div className="divide-y divide-clouda-border">
            {results.length === 0 && (
              <p className="px-5 py-6 text-sm text-clouda-muted">
                Sonuç bulunamadı, farklı bir sorgu dene.
              </p>
            )}
            {results.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-5 py-4 transition hover:bg-clouda-sageSoft/50"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-clouda-sage text-white">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6.5l2.5 2.5 4.5-5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-clouda-ink">{r.title}</p>
                    <p className="truncate font-mono text-xs text-clouda-muted">{r.url}</p>
                    <p className="mt-1.5 line-clamp-2 text-sm text-clouda-muted">
                      {r.snippet || r.content}
                    </p>
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
