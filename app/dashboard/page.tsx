import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardNav from "@/components/DashboardNav";
import ApiKeysManager from "@/components/ApiKeysManager";
import { CREDITS_PER_SEARCH, SIGNUP_FREE_CREDITS } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as typeof session.user & { id: string }).id;

  const [user, apiKeys, usageLogs] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.apiKey.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.usageLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
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
      </main>
    </div>
  );
}
