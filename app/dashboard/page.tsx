import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import DashboardNav from "@/components/DashboardNav";
import ApiKeysManager from "@/components/ApiKeysManager";
import { CREDITS_PER_SEARCH } from "@/lib/constants";

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

  const credits = user?.credits ?? 0;

  return (
    <div className="min-h-screen bg-clouda-bg">
      <DashboardNav userName={session.user.name} userImage={session.user.image} />

      <main className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        <h1 className="display text-4xl sm:text-5xl">Panel</h1>

        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-3xl bg-clouda-lime p-8">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-clouda-ink/50">
              kredi bakiyesi
            </p>
            <p className="display mt-4 text-6xl">{credits.toLocaleString("tr-TR")}</p>
            <p className="mt-2 text-sm font-semibold text-clouda-ink/60">
              ≈ {Math.floor(credits / CREDITS_PER_SEARCH).toLocaleString("tr-TR")} arama isteği
            </p>
          </div>

          <div className="rounded-3xl bg-clouda-ink p-8 lg:col-span-2">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-clouda-lime">
              hızlı başlangıç
            </p>
            <p className="mt-4 text-sm text-white/60">
              Aşağıdan bir anahtar oluştur, ardından bu isteği gönder:
            </p>
            <pre className="mt-4 overflow-x-auto rounded-2xl bg-black/40 p-5 font-mono text-[13px] text-violet-100">
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
              lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
              createdAt: k.createdAt.toISOString(),
            }))}
          />
        </div>

        <div className="mt-5 rounded-3xl bg-white p-8">
          <h2 className="text-xl font-black tracking-tight text-clouda-ink">Son kullanım</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs font-black uppercase tracking-[0.14em] text-clouda-ink/35">
                  <th className="pb-3 pr-4">Sorgu</th>
                  <th className="pb-3 pr-4">Sonuç</th>
                  <th className="pb-3 pr-4">Kredi</th>
                  <th className="pb-3 pr-4">Tarih</th>
                </tr>
              </thead>
              <tbody>
                {usageLogs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-sm text-clouda-ink/40">
                      Henüz kullanım kaydı yok.
                    </td>
                  </tr>
                )}
                {usageLogs.map((log) => (
                  <tr key={log.id} className="border-t border-black/5">
                    <td className="max-w-xs truncate py-3 pr-4 font-medium text-clouda-ink">
                      {log.query}
                    </td>
                    <td className="py-3 pr-4 text-clouda-ink/60">{log.resultCount}</td>
                    <td className="py-3 pr-4 font-semibold text-clouda-violet">
                      -{log.creditsUsed}
                    </td>
                    <td className="py-3 pr-4 text-clouda-ink/40">
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
