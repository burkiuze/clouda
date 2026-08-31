import CodeSnippet from "@/components/CodeSnippet";

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-4xl px-6 py-20">
      <p className="section-label">dokümantasyon</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-clouda-ink">API Referansı</h1>
      <p className="mt-4 text-sm leading-relaxed text-black/60">
        Clouda tek bir uç noktadan oluşur. API anahtarını{" "}
        <a href="/dashboard" className="font-semibold text-clouda-violetDark underline">
          panelden
        </a>{" "}
        oluşturduktan sonra aşağıdaki isteği gönderebilirsin.
      </p>

      <div className="mt-10 rounded-2xl border border-black/10 bg-white p-6">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-700">
            POST
          </span>
          <code className="text-sm font-semibold text-clouda-ink">/api/v1/search</code>
        </div>
        <p className="mt-3 text-sm text-black/60">
          Verilen sorgu için web&apos;de arama yapar, sonuç sayfalarının içeriğini çıkarır ve
          yapılandırılmış sonuç döner. İstek başına <strong>10 kredi</strong> düşer.
        </p>

        <h3 className="mt-6 text-sm font-bold text-clouda-ink">Başlıklar</h3>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-clouda-bg p-4 text-xs">
{`Authorization: Bearer cld_live_xxxxxxxx
Content-Type: application/json`}
        </pre>

        <h3 className="mt-6 text-sm font-bold text-clouda-ink">Gövde (body)</h3>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-clouda-bg p-4 text-xs">
{`{
  "query": "aranacak metin",
  "max_results": 5   // opsiyonel, 1-10 arası, varsayılan 5
}`}
        </pre>

        <h3 className="mt-6 text-sm font-bold text-clouda-ink">Yanıt</h3>
        <pre className="mt-2 overflow-x-auto rounded-xl bg-clouda-bg p-4 text-xs">
{`{
  "query": "aranacak metin",
  "results": [
    {
      "title": "Sayfa başlığı",
      "url": "https://ornek.com/sayfa",
      "snippet": "Arama sonucu özeti...",
      "content": "Sayfadan çıkarılan okunabilir metin..."
    }
  ],
  "took_ms": 842,
  "credits_used": 10,
  "credits_remaining": 1990
}`}
        </pre>

        <h3 className="mt-6 text-sm font-bold text-clouda-ink">Hata kodları</h3>
        <ul className="mt-2 space-y-1 text-sm text-black/60">
          <li><code className="text-clouda-violetDark">401</code> — API anahtarı eksik veya geçersiz</li>
          <li><code className="text-clouda-violetDark">402</code> — yetersiz kredi</li>
          <li><code className="text-clouda-violetDark">400</code> — eksik ya da hatalı istek gövdesi</li>
        </ul>
      </div>

      <h2 className="mt-14 text-xl font-black tracking-tight text-clouda-ink">Örnek istek</h2>
      <div className="mt-4">
        <CodeSnippet />
      </div>
    </section>
  );
}
