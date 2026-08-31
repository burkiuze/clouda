"use client";

import { useState } from "react";
import { CAPABILITIES, CAPABILITY_LABELS, type Capability } from "@/lib/constants";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  revoked: boolean;
  capabilities: string[];
  rateLimitPerMin: number;
  creditCap: number | null;
  creditsSpent: number;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export default function ApiKeysManager({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [composing, setComposing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [name, setName] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [rateLimit, setRateLimit] = useState(60);
  const [creditCap, setCreditCap] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("90");

  function toggle(capability: Capability) {
    setCapabilities((prev) =>
      prev.includes(capability) ? prev.filter((c) => c !== capability) : [...prev, capability]
    );
  }

  async function createKey() {
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || `Anahtar ${keys.length + 1}`,
          capabilities,
          rateLimitPerMin: rateLimit,
          creditCap: creditCap ? Number(creditCap) : undefined,
          expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewKey(data.key);
        setCopied(false);
        setComposing(false);
        setName("");
        setCapabilities([]);
        setKeys((prev) => [
          {
            id: data.id,
            name: data.name,
            keyPrefix: data.prefix,
            revoked: false,
            capabilities: data.capabilities ?? [],
            rateLimitPerMin: data.rateLimitPerMin ?? 60,
            creditCap: data.creditCap ?? null,
            expiresAt: data.expiresAt ?? null,
            creditsSpent: 0,
            lastUsedAt: null,
            createdAt: data.createdAt,
          },
          ...prev,
        ]);
      }
    } finally {
      setCreating(false);
    }
  }

  async function revokeKey(id: string) {
    const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
    if (res.ok) {
      setKeys((prev) => prev.map((k) => (k.id === id ? { ...k, revoked: true } : k)));
    }
  }

  async function copyKey() {
    if (!newKey) return;
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="card p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium tracking-[-0.02em] text-clouda-ink">API anahtarları</h2>
          <p className="mt-1.5 text-sm text-clouda-muted">
            Web araması her anahtarda açıktır. Diğer özellikleri anahtar bazında seçersin.
          </p>
        </div>
        <button
          onClick={() => setComposing((v) => !v)}
          className="rounded-btn bg-clouda-ink px-5 py-2.5 text-sm font-medium text-white transition hover:bg-clouda-ink/85"
        >
          {composing ? "Vazgeç" : "Yeni anahtar"}
        </button>
      </div>

      {composing && (
        <div className="mt-6 rounded-card border border-clouda-border bg-clouda-bg p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label htmlFor="key-name" className="field-label">
                Anahtar adı
              </label>
              <input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field"
                placeholder="Üretim ajanı"
              />
            </div>
            <div>
              <label htmlFor="key-rate" className="field-label">
                Dakikada istek
              </label>
              <input
                id="key-rate"
                type="number"
                min={1}
                max={600}
                value={rateLimit}
                onChange={(e) => setRateLimit(Number(e.target.value))}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="key-expiry" className="field-label">
                Geçerlilik (gün)
              </label>
              <input
                id="key-expiry"
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                className="field"
                placeholder="Süresiz"
              />
              <p className="mt-1.5 text-xs text-clouda-muted">
                Boş bırakırsan süresiz olur. Süreli anahtar, sızarsa kendi kendine kapanır.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="key-cap" className="field-label">
                Kredi tavanı (opsiyonel)
              </label>
              <input
                id="key-cap"
                type="number"
                min={1}
                value={creditCap}
                onChange={(e) => setCreditCap(e.target.value)}
                className="field"
                placeholder="Sınırsız"
              />
            </div>
          </div>

          <p className="field-label mt-6">Özellikler</p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="rounded-btn border border-clouda-border bg-white px-4 py-3 opacity-70">
              <span className="flex items-center gap-2 text-sm font-medium text-clouda-ink">
                <span className="block h-2 w-2 bg-clouda-indigo" />
                Web Search
                <span className="ml-auto font-mono text-[11px] uppercase text-clouda-muted">
                  her zaman açık
                </span>
              </span>
              <span className="mt-1 block text-xs text-clouda-muted">
                Arama, içerik çıkarımı ve kalite skorları.
              </span>
            </div>

            {CAPABILITIES.map((capability) => {
              const active = capabilities.includes(capability);
              return (
                <button
                  key={capability}
                  type="button"
                  onClick={() => toggle(capability)}
                  className={`rounded-btn border px-4 py-3 text-left transition ${
                    active
                      ? "border-clouda-ink bg-clouda-indigoSoft/40"
                      : "border-clouda-border bg-white hover:border-clouda-ink/40"
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium text-clouda-ink">
                    <span
                      className={`block h-2 w-2 ${active ? "bg-clouda-indigo" : "bg-clouda-border"}`}
                    />
                    {CAPABILITY_LABELS[capability].title}
                  </span>
                  <span className="mt-1 block text-xs text-clouda-muted">
                    {CAPABILITY_LABELS[capability].description}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={createKey}
            disabled={creating}
            className="mt-6 rounded-btn bg-clouda-ink px-6 py-3 text-sm font-medium text-white transition hover:bg-clouda-ink/85 disabled:opacity-50"
          >
            {creating ? "Oluşturuluyor…" : "Anahtarı oluştur"}
          </button>
        </div>
      )}

      {newKey && (
        <div className="mt-6 rounded-card border border-clouda-indigo bg-clouda-indigoSoft/40 p-5">
          <p className="text-sm font-medium text-clouda-ink">
            Bu anahtarı şimdi kopyala — bir daha tam olarak gösterilmeyecek.
          </p>
          <code className="mt-3 block break-all rounded-btn border border-clouda-border bg-white px-4 py-3 font-mono text-xs text-clouda-ink">
            {newKey}
          </code>
          <div className="mt-3 flex gap-2">
            <button
              onClick={copyKey}
              className="rounded-btn bg-clouda-ink px-4 py-2 text-xs font-medium text-white"
            >
              {copied ? "Kopyalandı" : "Kopyala"}
            </button>
            <button
              onClick={() => setNewKey(null)}
              className="rounded-btn px-4 py-2 text-xs font-medium text-clouda-muted hover:text-clouda-ink"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-clouda-border">
              <th className="eyebrow-plain pb-3">Ad</th>
              <th className="eyebrow-plain pb-3">Anahtar</th>
              <th className="eyebrow-plain pb-3">Özellikler</th>
              <th className="eyebrow-plain pb-3">Limit</th>
              <th className="eyebrow-plain pb-3">Durum</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-clouda-muted">
                  Henüz bir API anahtarın yok.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-clouda-border align-top last:border-0">
                <td className="py-3.5 pr-4 font-medium text-clouda-ink">{k.name}</td>
                <td className="py-3.5 pr-4 font-mono text-xs text-clouda-muted">{k.keyPrefix}</td>
                <td className="py-3.5 pr-4">
                  <div className="flex flex-wrap gap-1">
                    <span className="rounded-btn bg-clouda-panel px-2 py-0.5 font-mono text-[11px] text-clouda-muted">
                      search
                    </span>
                    {k.capabilities.map((c) => (
                      <span
                        key={c}
                        className="rounded-btn bg-clouda-indigoSoft px-2 py-0.5 font-mono text-[11px] text-clouda-indigo"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="py-3.5 pr-4 text-xs text-clouda-muted">
                  {k.rateLimitPerMin}/dk
                  {k.creditCap != null && (
                    <span className="block">
                      {k.creditsSpent}/{k.creditCap} kredi
                    </span>
                  )}
                </td>
                <td className="py-3.5 pr-4">
                  {k.revoked ? (
                    <span className="rounded-btn border border-clouda-border px-2.5 py-1 text-xs text-clouda-muted">
                      İptal
                    </span>
                  ) : k.expiresAt && new Date(k.expiresAt) <= new Date() ? (
                    <span className="rounded-btn border border-clouda-border px-2.5 py-1 text-xs text-clouda-muted">
                      Süresi doldu
                    </span>
                  ) : (
                    <span className="rounded-btn bg-clouda-indigoSoft px-2.5 py-1 text-xs font-medium text-clouda-indigo">
                      Aktif
                    </span>
                  )}
                  {k.expiresAt && new Date(k.expiresAt) > new Date() && (
                    <span className="mt-1 block text-[11px] text-clouda-muted">
                      {new Date(k.expiresAt).toLocaleDateString("tr-TR")} tarihinde biter
                    </span>
                  )}
                </td>
                <td className="py-3.5 text-right">
                  {!k.revoked && (
                    <button
                      onClick={() => revokeKey(k.id)}
                      className="text-xs font-medium text-clouda-muted transition hover:text-red-600"
                    >
                      İptal et
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
