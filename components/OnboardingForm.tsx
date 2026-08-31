"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

const types = [
  { id: "personal", label: "Bireysel", desc: "Kendi projelerim için" },
  { id: "organization", label: "Kurumsal", desc: "Şirketim/ekibim adına" },
] as const;

export default function OnboardingForm() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<"personal" | "organization">("personal");
  const [companyName, setCompanyName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/account-type", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountType, companyName }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Kaydedilemedi, tekrar dene.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {types.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAccountType(t.id)}
            className={`rounded-btn border px-4 py-4 text-left transition ${
              accountType === t.id
                ? "border-clouda-ink bg-clouda-indigoSoft/40"
                : "border-clouda-border bg-white hover:border-clouda-ink/40"
            }`}
          >
            <span className="block font-medium text-clouda-ink">{t.label}</span>
            <span className="mt-0.5 block text-xs text-clouda-muted">{t.desc}</span>
          </button>
        ))}
      </div>

      {accountType === "organization" && (
        <div>
          <label htmlFor="company" className="field-label">
            Kurum adı
          </label>
          <input
            id="company"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="field"
            placeholder="Şirketin"
          />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={loading} className="btn-dark w-full disabled:opacity-60">
        {loading ? "Kaydediliyor…" : "Devam et"}
      </button>
    </form>
  );
}
