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
    <div className="rounded-3xl bg-white p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black tracking-tight text-clouda-ink">API anahtarları</h2>
        <button
          onClick={createKey}
          disabled={creating}
          className="rounded-full bg-clouda-ink px-5 py-2.5 text-sm font-bold text-white transition hover:bg-clouda-violetDark disabled:opacity-60"
        >
          {creating ? "Oluşturuluyor…" : "+ Yeni anahtar"}
        </button>
      </div>

      {newKey && (
        <div className="mt-5 rounded-2xl border-2 border-clouda-ink bg-clouda-lime p-5">
          <p className="text-sm font-black text-clouda-ink">
            Bu anahtarı şimdi kopyala — bir daha tam olarak gösterilmeyecek.
          </p>
          <code className="mt-3 block break-all rounded-xl bg-white px-4 py-3 font-mono text-xs text-clouda-ink">
            {newKey}
          </code>
          <div className="mt-3 flex gap-3">
            <button
              onClick={copyKey}
              className="rounded-full bg-clouda-ink px-4 py-2 text-xs font-bold text-white"
            >
              {copied ? "Kopyalandı ✓" : "Kopyala"}
            </button>
            <button
              onClick={() => setNewKey(null)}
              className="rounded-full px-4 py-2 text-xs font-bold text-clouda-ink/60 hover:text-clouda-ink"
            >
              Kapat
            </button>
          </div>
        </div>
      )}

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs font-black uppercase tracking-[0.14em] text-clouda-ink/35">
              <th className="pb-3 pr-4">Ad</th>
              <th className="pb-3 pr-4">Anahtar</th>
              <th className="pb-3 pr-4">Durum</th>
              <th className="pb-3 pr-4" />
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={4} className="py-8 text-center text-sm text-clouda-ink/40">
                  Henüz bir API anahtarın yok.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-black/5">
                <td className="py-3 pr-4 font-semibold text-clouda-ink">{k.name}</td>
                <td className="py-3 pr-4 font-mono text-xs text-clouda-ink/50">{k.keyPrefix}</td>
                <td className="py-3 pr-4">
                  {k.revoked ? (
                    <span className="rounded-full bg-clouda-pink px-2.5 py-1 text-xs font-bold text-clouda-ink">
                      İptal edildi
                    </span>
                  ) : (
                    <span className="rounded-full bg-clouda-lime px-2.5 py-1 text-xs font-bold text-clouda-ink">
                      Aktif
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right">
                  {!k.revoked && (
                    <button
                      onClick={() => revokeKey(k.id)}
                      className="text-xs font-bold text-clouda-ink/45 transition hover:text-red-600"
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
