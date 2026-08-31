import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardNav from "@/components/DashboardNav";
import ApiKeysManager from "@/components/ApiKeysManager";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as typeof session.user & { id: string }).id;

  const [user, apiKeys, usageLogs] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.usageLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const credits = user?.credits ?? 0;

  return (
    <div className="min-h-screen bg-clouda-bg">
      <DashboardNav userName={session.user.name} userImage={session.user.image} />

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <div className="rounded-3xl border border-black/10 bg-white p-6 sm:col-span-1">
            <p className="section-label">kredi bakiyesi</p>
            <p className="mt-3 text-4xl font-black text-clouda-ink">{credits.toLocaleString("tr-TR")}</p>
            <p className="mt-1 text-xs text-black/40">≈ {Math.floor(credits / 10)} arama isteği</p>
          </div>
          <div className="rounded-3xl border border-black/10 bg-white p-6 sm:col-span-2">
            <p className="section-label">hızlı başlangıç</p>
            <p className="mt-3 text-sm text-black/60">
              Aşağıdan bir API anahtarı oluştur, ardından şu isteği gönder:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl bg-clouda-bg p-4 text-xs">
{`curl https://clouda.dev/api/v1/search \\
  -H "Authorization: Bearer <anahtarın>" \\
  -H "Content-Type: application/json" \\
  -d '{"query": "aranacak metin"}'`}
            </pre>
          </div>
        </div>

        <div className="mt-6">
          <ApiKeysManager
            initialKeys={apiKeys.map((k) => ({
              id: k.id,
              name: k.name,
              keyPrefix: k.keyPrefix,
              revoked: k.revoked,
              lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
              createdAt: k.createdAt.toISOString(),
            }))}
          />
        </div>

        <div className="mt-6 rounded-3xl border border-black/10 bg-white p-6">
          <h2 className="text-lg font-bold text-clouda-ink">Son kullanım</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-black/40">
                  <th className="pb-2 pr-4">Sorgu</th>
                  <th className="pb-2 pr-4">Sonuç</th>
                  <th className="pb-2 pr-4">Kredi</th>
                  <th className="pb-2 pr-4">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {usageLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-sm text-black/40">
                      Henüz kullanım kaydı yok.
                    </td>
                  </tr>
                )}
                {usageLogs.map((log) => (
                  <tr key={log.id} className="border-t border-black/5">
                    <td className="max-w-xs truncate py-3 pr-4 text-clouda-ink">{log.query}</td>
                    <td className="py-3 pr-4 text-black/60">{log.resultCount}</td>
                    <td className="py-3 pr-4 text-black/60">-{log.creditsUsed}</td>
                    <td className="py-3 pr-4 text-black/40">
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
