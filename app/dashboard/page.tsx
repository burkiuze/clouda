import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardNav from "@/components/DashboardNav";
import ApiKeysManager from "@/components/ApiKeysManager";
import { CREDITS_PER_SEARCH, SIGNUP_FREE_CREDITS } from "@/lib/constants";
import { recentSecurityEvents } from "@/lib/core/audit";
import { usageSummary } from "@/lib/core/metrics";

export const dynamic = "force-dynamic";

/** Event kinds are stored as stable identifiers; the wording lives here. */
const SECURITY_LABELS: Record<string, string> = {
  signup: "Hesap oluşturuldu",
  signup_throttled: "Kayıt sınırlandı",
  signup_weak_password: "Zayıf şifre reddedildi",
  login_failed: "Başarısız giriş",
  login_throttled: "Giriş sınırlandı",
  auth_link_blocked: "Hesap bağlama engellendi",
  key_created: "Anahtar oluşturuldu",
  key_revoked: "Anahtar iptal edildi",
  key_expired_use: "Süresi dolmuş anahtar denendi",
  demo_throttled: "Demo sınırlandı",
};

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as typeof session.user & { id: string }).id;

  const [user, apiKeys, usageLogs, securityEvents, usage, monitors] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.usageLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    recentSecurityEvents(userId, 8),
    usageSummary(userId, 24).catch(() => null),
    prisma.monitor.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        type: true,
        target: true,
        active: true,
        intervalMinutes: true,
        lastCheckedAt: true,
      },
    }),
  ]);

  if (user && !user.accountType) redirect("/onboarding");

  const credits = user?.credits ?? 0;
  const usedRatio = Math.min(100, Math.round(((SIGNUP_FREE_CREDITS - credits) / SIGNUP_FREE_CREDITS) * 100));

  return (
    <div className="min-h-screen bg-clouda-bg">
      <DashboardNav userName={session.user.name} userImage={session.user.image} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <p className="eyebrow-plain">panel</p>
        <h1 className="display mt-3 text-4xl">Genel bakış</h1>

        <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="card p-8">
            <h2 className="eyebrow-plain">Kredi bakiyesi</h2>
            <p className="mt-5 text-5xl font-medium tracking-[-0.03em] text-clouda-ink">
              {credits.toLocaleString("tr-TR")}
            </p>
            <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-clouda-border">
              <div
                className="h-full rounded-full bg-clouda-indigo"
                style={{ width: `${100 - usedRatio}%` }}
              />
            </div>
            <p className="mt-4 text-sm text-clouda-muted">
              ≈ {Math.floor(credits / CREDITS_PER_SEARCH).toLocaleString("tr-TR")} arama isteği
            </p>
          </div>

          <div className="card p-8 lg:col-span-2">
            <h2 className="eyebrow-plain">Hızlı başlangıç</h2>
            <p className="mt-5 text-clouda-muted">
              Aşağıdan bir anahtar oluştur, ardından bu isteği gönder:
            </p>
            <pre className="mt-5 overflow-x-auto rounded-xl bg-clouda-bg p-5 font-mono text-[13px] leading-relaxed text-clouda-ink">
{`curl https://clouda.dev/api/v1/search \\
  -H "Authorization: Bearer <anahtarın>" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "aranacak metin"}'`}
            </pre>
          </div>
        </div>

        <div className="mt-10">
          <p className="eyebrow-plain">son 24 saat</p>
          <h2 className="display mt-3 text-2xl">Kullanım ve performans</h2>
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-6">
            {[
              { label: "İstek", value: usage ? usage.totals.requests.toLocaleString("tr-TR") : "—" },
              { label: "Harcanan kredi", value: usage ? usage.totals.credits.toLocaleString("tr-TR") : "—" },
              { label: "Hata oranı", value: usage ? `%${Math.round(usage.errorRate * 100)}` : "—" },
              { label: "Önbellek isabeti", value: usage ? `%${Math.round(usage.cacheHitRate * 100)}` : "—" },
              { label: "Gecikme p50", value: usage ? `${usage.p50LatencyMs} ms` : "—" },
              { label: "Gecikme p95", value: usage ? `${usage.p95LatencyMs} ms` : "—" },
            ].map((stat) => (
              <div key={stat.label} className="card p-5">
                <p className="eyebrow-plain text-[10px]">{stat.label}</p>
                <p className="mt-3 text-2xl font-medium tracking-[-0.02em] text-clouda-ink">
                  {stat.value}
                </p>
              </div>
            ))}
          </div>

          {usage && Object.keys(usage.byOperation).length > 0 && (
            <div className="card mt-4 overflow-x-auto p-6">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-clouda-border">
                    <th className="eyebrow-plain pb-3">İşlem</th>
                    <th className="eyebrow-plain pb-3">İstek</th>
                    <th className="eyebrow-plain pb-3">Kredi</th>
                    <th className="eyebrow-plain pb-3">Ort. gecikme</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(usage.byOperation).map(([op, row]) => (
                    <tr key={op} className="border-b border-clouda-border last:border-0">
                      <td className="py-3 pr-4 font-mono text-xs text-clouda-indigo">{op}</td>
                      <td className="py-3 pr-4 text-clouda-ink">{row.requests}</td>
                      <td className="py-3 pr-4 text-clouda-muted">{row.credits}</td>
                      <td className="py-3 pr-4 text-clouda-muted">{row.avgLatencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-10">
          <p className="eyebrow-plain">izleyiciler</p>
          <h2 className="display mt-3 text-2xl">Web monitoring</h2>
          <p className="mt-3 max-w-2xl text-sm text-clouda-muted">
            İzleyiciler API üzerinden oluşturulur (<code className="font-mono">POST /api/v1/monitors</code>);
            burada durumları görünür. Kredisi biten hesabın izleyicileri hata döngüsüne
            girmek yerine duraklatılır.
          </p>
          <div className="card mt-5 overflow-x-auto p-6">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-clouda-border">
                  <th className="eyebrow-plain pb-3">Tür</th>
                  <th className="eyebrow-plain pb-3">Hedef</th>
                  <th className="eyebrow-plain pb-3">Sıklık</th>
                  <th className="eyebrow-plain pb-3">Son kontrol</th>
                  <th className="eyebrow-plain pb-3">Durum</th>
                </tr>
              </thead>
              <tbody>
                {monitors.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-clouda-muted">
                      Henüz izleyici yok.
                    </td>
                  </tr>
                )}
                {monitors.map((m) => (
                  <tr key={m.id} className="border-b border-clouda-border last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs text-clouda-indigo">{m.type}</td>
                    <td className="max-w-xs truncate py-3 pr-4 text-clouda-ink">{m.target}</td>
                    <td className="py-3 pr-4 text-clouda-muted">{m.intervalMinutes} dk</td>
                    <td className="py-3 pr-4 text-clouda-muted">
                      {m.lastCheckedAt ? m.lastCheckedAt.toLocaleString("tr-TR") : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {m.active ? (
                        <span className="rounded-btn bg-clouda-indigoSoft px-2.5 py-1 text-xs font-medium text-clouda-indigo">
                          Aktif
                        </span>
                      ) : (
                        <span className="rounded-btn border border-clouda-border px-2.5 py-1 text-xs text-clouda-muted">
                          Duraklatıldı
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5">
          <ApiKeysManager
            initialKeys={apiKeys.map((k) => ({
              id: k.id,
              name: k.name,
              keyPrefix: k.keyPrefix,
              revoked: k.revoked,
              capabilities: k.capabilities,
              rateLimitPerMin: k.rateLimitPerMin,
              creditCap: k.creditCap,
              creditsSpent: k.creditsSpent,
              lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
              createdAt: k.createdAt.toISOString(),
              expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
            }))}
          />
        </div>

        <div className="card mt-5 p-8">
          <h2 className="text-xl font-medium tracking-[-0.02em] text-clouda-ink">Son kullanım</h2>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-clouda-border">
                  <th className="eyebrow-plain pb-3">İşlem</th>
                  <th className="eyebrow-plain pb-3">Sorgu</th>
                  <th className="eyebrow-plain pb-3">Sonuç</th>
                  <th className="eyebrow-plain pb-3">Kredi</th>
                  <th className="eyebrow-plain pb-3">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {usageLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-clouda-muted">
                      Henüz kullanım kaydı yok.
                    </td>
                  </tr>
                )}
                {usageLogs.map((log) => (
                  <tr key={log.id} className="border-b border-clouda-border last:border-0">
                    <td className="py-3.5 pr-4 font-mono text-xs text-clouda-indigo">{log.operation}</td>
                    <td className="max-w-xs truncate py-3.5 pr-4 text-clouda-ink">{log.query}</td>
                    <td className="py-3.5 pr-4 text-clouda-muted">{log.resultCount}</td>
                    <td className="py-3.5 pr-4 text-clouda-indigo">-{log.creditsUsed}</td>
                    <td className="py-3.5 pr-4 text-clouda-muted">
                      {log.createdAt.toLocaleString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-10">
          <p className="eyebrow-plain">hesap güvenliği</p>
          <h2 className="display mt-3 text-2xl">Son güvenlik olayları</h2>
          <p className="mt-3 max-w-2xl text-sm text-clouda-muted">
            Tanımadığın bir giriş denemesi görürsen şifreni değiştir ve anahtarlarını iptal et.
          </p>
          <div className="card mt-5 overflow-x-auto p-6">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-clouda-border">
                  <th className="eyebrow-plain pb-3">Olay</th>
                  <th className="eyebrow-plain pb-3">Ayrıntı</th>
                  <th className="eyebrow-plain pb-3">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {securityEvents.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-clouda-muted">
                      Kayıtlı güvenlik olayı yok.
                    </td>
                  </tr>
                )}
                {securityEvents.map((event) => (
                  <tr key={event.id} className="border-b border-clouda-border last:border-0">
                    <td className="py-3.5 pr-4 font-mono text-xs text-clouda-indigo">
                      {SECURITY_LABELS[event.kind] ?? event.kind}
                    </td>
                    <td className="max-w-xs truncate py-3.5 pr-4 text-clouda-muted">
                      {event.detail ?? "—"}
                    </td>
                    <td className="py-3.5 pr-4 text-clouda-muted">
                      {event.createdAt.toLocaleString("tr-TR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
