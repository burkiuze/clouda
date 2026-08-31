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

  return (
    <div className="rounded-3xl border border-black/10 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-clouda-ink">API anahtarları</h2>
        <button onClick={createKey} disabled={creating} className="btn-primary !px-4 !py-2 text-xs disabled:opacity-60">
          {creating ? "Oluşturuluyor..." : "+ Yeni anahtar"}
        </button>
      </div>

      {newKey && (
        <div className="mt-4 rounded-2xl border border-clouda-violet/30 bg-clouda-lilac/10 p-4">
          <p className="text-xs font-semibold text-clouda-violetDark">
            Bu anahtarı şimdi kopyala — bir daha tam olarak gösterilmeyecek.
          </p>
          <code className="mt-2 block break-all rounded-lg bg-white px-3 py-2 text-xs text-clouda-ink">
            {newKey}
          </code>
          <button
            onClick={() => setNewKey(null)}
            className="mt-2 text-xs font-semibold text-clouda-violetDark underline"
          >
            Kapat
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-black/40">
              <th className="pb-2 pr-4">Ad</th>
              <th className="pb-2 pr-4">Anahtar</th>
              <th className="pb-2 pr-4">Durum</th>
              <th className="pb-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-black/40">
                  Henüz bir API anahtarın yok.
                </td>
              </tr>
            )}
            {keys.map((k) => (
              <tr key={k.id} className="border-t border-black/5">
                <td className="py-3 pr-4 font-medium text-clouda-ink">{k.name}</td>
                <td className="py-3 pr-4 font-mono text-xs text-black/50">{k.keyPrefix}</td>
                <td className="py-3 pr-4">
                  {k.revoked ? (
                    <span className="rounded-full bg-red-100 px-2 py-1 text-xs font-semibold text-red-600">
                      İptal edildi
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-600">
                      Aktif
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-right">
                  {!k.revoked && (
                    <button
                      onClick={() => revokeKey(k.id)}
                      className="text-xs font-semibold text-red-500 hover:underline"
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
