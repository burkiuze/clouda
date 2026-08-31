"use client";

import { useState } from "react";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export default function ApiKeysManager({ initialKeys }: { initialKeys: ApiKeyRow[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createKey() {
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `Anahtar ${keys.length + 1}` }),
      });
      const data = await res.json();
      if (res.ok) {
        setNewKey(data.key);
        setCopied(false);
        setKeys((prev) => [
          {
            id: data.id,
            name: data.name,
            keyPrefix: data.prefix,
            revoked: false,
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-medium tracking-[-0.02em] text-clouda-ink">API anahtarları</h2>
        <button
          onClick={createKey}
          disabled={creating}
          className="rounded-btn bg-clouda-ink px-5 py-2.5 text-sm font-medium text-white transition hover:bg-clouda-ink/85 disabled:opacity-50"
        >
          {creating ? "Oluşturuluyor…" : "Yeni anahtar"}
        </button>
      </div>

      {newKey && (
        <div className="mt-6 rounded-card border border-clouda-indigo bg-clouda-indigoSoft/60 p-5">
          <p className="text-sm font-medium text-clouda-ink">
            Bu anahtarı şimdi kopyala — bir daha tam olarak gösterilmeyecek.
          </p>
          <code className="mt-3 block break-all rounded-xl border border-clouda-border bg-white px-4 py-3 font-mono text-xs text-clouda-ink">
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
              <th className="eyebrow pb-3 font-mono">Ad</th>
              <th className="eyebrow pb-3 font-mono">Anahtar</th>
              <th className="eyebrow pb-3 font-mono">Durum</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-clouda-muted">
                  Henüz bir API anahtarın yok.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-clouda-border last:border-0">
                <td className="py-3.5 pr-4 font-medium text-clouda-ink">{k.name}</td>
                <td className="py-3.5 pr-4 font-mono text-xs text-clouda-muted">{k.keyPrefix}</td>
                <td className="py-3.5 pr-4">
                  {k.revoked ? (
                    <span className="rounded-btn border border-clouda-border px-2.5 py-1 text-xs text-clouda-muted">
                      İptal edildi
                    </span>
                  ) : (
                    <span className="rounded-btn bg-clouda-indigoSoft px-2.5 py-1 text-xs font-medium text-clouda-indigo">
                      Aktif
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
