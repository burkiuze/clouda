import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { missingAuthConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

const messages: Record<string, string> = {
  Configuration: "Sunucu yapılandırmasında eksik var.",
  AccessDenied: "Bu hesapla girişe izin verilmedi.",
  Verification: "Doğrulama bağlantısı geçersiz ya da süresi dolmuş.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const missing = missingAuthConfig();

  return (
    <AuthLayout quote="Yapılandırma tamamlanınca giriş çalışmaya başlayacak.">
      <p className="eyebrow-plain">Giriş hatası</p>
      <h1 className="display mt-3 text-4xl">Giriş tamamlanamadı</h1>
      <p className="mt-4 text-clouda-muted">
        {messages[error ?? ""] ?? "Beklenmeyen bir hata oluştu."}
      </p>

      {missing.length > 0 && (
        <div className="mt-6 rounded-card border border-clouda-border bg-white p-5">
          <p className="text-sm font-medium text-clouda-ink">
            Vercel&apos;de şu ortam değişkenleri eksik:
          </p>
          <ul className="mt-3 space-y-1.5">
            {missing.map((m) => (
              <li key={m.name} className="text-sm">
                <code className="font-mono text-clouda-indigo">{m.name}</code>
                <span className="text-clouda-muted"> — {m.why}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-clouda-muted">
            Ekledikten sonra projeyi yeniden deploy et.
          </p>
        </div>
      )}

      <Link href="/login" className="btn-dark mt-8 w-full">
        Girişe dön
      </Link>
    </AuthLayout>
  );
}
