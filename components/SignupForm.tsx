"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

const types = [
  { id: "personal", label: "Bireysel", desc: "Kendi projelerim için" },
  { id: "organization", label: "Kurumsal", desc: "Şirketim/ekibim adına" },
] as const;

export default function SignupForm() {
  const router = useRouter();
  const [accountType, setAccountType] = useState<"personal" | "organization">("personal");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, accountType, companyName }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.message ?? "Kayıt tamamlanamadı, tekrar dene.");
      setLoading(false);
      return;
    }

    const signInRes = await signIn("credentials", { email, password, redirect: false });
    if (signInRes?.error) {
      router.push("/login");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <span className="field-label">Hesap türü</span>
        <div className="grid grid-cols-2 gap-2">
          {types.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setAccountType(t.id)}
              className={`rounded-btn border px-4 py-3 text-left transition ${
                accountType === t.id
                  ? "border-clouda-ink bg-clouda-indigoSoft/40"
                  : "border-clouda-border bg-white hover:border-clouda-ink/40"
              }`}
            >
              <span className="block text-sm font-medium text-clouda-ink">{t.label}</span>
              <span className="mt-0.5 block text-xs text-clouda-muted">{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="name" className="field-label">
          Ad soyad
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="field"
          placeholder="Adın"
        />
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

      <div>
        <label htmlFor="email" className="field-label">
          E-posta
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
          placeholder="sen@sirket.com"
        />
      </div>

      <div>
        <label htmlFor="password" className="field-label">
          Şifre
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field"
          placeholder="En az 8 karakter"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button type="submit" disabled={loading} className="btn-dark w-full disabled:opacity-60">
        {loading ? "Hesap oluşturuluyor…" : "Hesap oluştur"}
      </button>
    </form>
  );
}
