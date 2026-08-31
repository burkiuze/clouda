"use client";

import { useState, FormEvent } from "react";

interface DemoResult {
  title: string;
  url: string;
  snippet: string;
  content: string;
}

export default function DemoSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DemoResult[] | null>(null);
  const [tookMs, setTookMs] = useState<number | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/demo-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
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

  return (
    <div className="w-full rounded-3xl border border-black/10 bg-white p-3 shadow-xl shadow-clouda-violet/5 sm:p-4">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Örn: 2026'da en hızlı büyüyen yapay zeka şirketleri"
          className="flex-1 rounded-2xl bg-clouda-bg px-4 py-3 text-sm text-clouda-ink outline-none ring-clouda-violet/40 placeholder:text-black/40 focus:ring-2"
          maxLength={200}
        />
        <button type="submit" disabled={loading} className="btn-primary shrink-0 disabled:opacity-60">
          {loading ? "Aranıyor..." : "Ara"}
        </button>
      </form>

      {error && <p className="mt-3 px-2 text-sm text-red-600">{error}</p>}

      {results && (
        <div className="mt-4 space-y-3 border-t border-black/5 pt-4">
          {tookMs !== null && (
            <p className="px-2 text-xs text-black/40">{results.length} sonuç · {tookMs}ms'de tamamlandı</p>
          )}
          {results.length === 0 && (
            <p className="px-2 text-sm text-black/50">Sonuç bulunamadı, farklı bir sorgu dene.</p>
          )}
          {results.map((r) => (
            <a
              key={r.url}
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl px-3 py-2 transition hover:bg-clouda-bg"
            >
              <p className="text-sm font-semibold text-clouda-violetDark">{r.title}</p>
              <p className="truncate text-xs text-black/40">{r.url}</p>
              <p className="mt-1 line-clamp-2 text-sm text-black/60">{r.snippet || r.content}</p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
