import Link from "next/link";
import CodeSnippet from "@/components/CodeSnippet";

const errors = [
  { code: "401", desc: "API anahtarı eksik ya da geçersiz" },
  { code: "402", desc: "Yetersiz kredi" },
  { code: "400", desc: "Eksik ya da hatalı istek gövdesi" },
  { code: "429", desc: "Çok fazla istek (yalnızca demo uç noktası)" },
];

export default function DocsPage() {
  return (
    <section className="mx-auto max-w-[900px] px-6 py-20">
      <p className="slug">/dokümantasyon</p>
      <h1 className="display mt-4 text-[40px] sm:text-5xl">API referansı</h1>
      <p className="mt-6 max-w-xl text-lg text-clouda-muted">
        Clouda tek bir uç noktadan oluşur. Anahtarını{" "}
        <Link href="/dashboard" className="text-clouda-sageDark underline underline-offset-4">
          panelden
        </Link>{" "}
        oluştur, aşağıdaki isteği gönder.
      </p>

      <div className="card mt-12 p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-pill bg-clouda-sageSoft px-3 py-1.5 font-mono text-xs font-medium text-clouda-sageDark">
            POST
          </span>
          <code className="font-mono text-[15px] text-clouda-ink">/api/v1/search</code>
        </div>
        <p className="mt-5 leading-relaxed text-clouda-muted">
          Verilen sorgu için web&apos;de arama yapar, sonuç sayfalarının içeriğini çıkarır ve
          yapılandırılmış JSON döner. İstek başına <strong className="text-clouda-ink">10 kredi</strong>{" "}
          düşer.
        </p>

        <h3 className="eyebrow mt-10">Başlıklar</h3>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-clouda-bg p-5 font-mono text-[13px] leading-relaxed">
{`Authorization: Bearer cld_live_xxxxxxxx
Content-Type: application/json`}
        </pre>

        <h3 className="eyebrow mt-10">İstek gövdesi</h3>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-clouda-bg p-5 font-mono text-[13px] leading-relaxed">
{`{
  "query": "aranacak metin",
  "max_results": 5,      // opsiyonel, 1-10 arası, varsayılan 5
  "locale": "tr-TR"      // opsiyonel, sonuç dili/bölgesi, varsayılan tr-TR
}`}
        </pre>

        <h3 className="eyebrow mt-10">Yanıt</h3>
        <pre className="mt-3 overflow-x-auto rounded-xl bg-clouda-bg p-5 font-mono text-[13px] leading-relaxed">
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
  "source": "tavily",
  "credits_used": 10,
  "credits_remaining": 1990
}`}
        </pre>

        <h3 className="eyebrow mt-10">Hata kodları</h3>
        <div className="mt-3 divide-y divide-clouda-border">
          {errors.map((e) => (
            <div key={e.code} className="flex gap-5 py-3">
              <code className="font-mono text-sm text-clouda-sageDark">{e.code}</code>
              <span className="text-sm text-clouda-muted">{e.desc}</span>
            </div>
          ))}
        </div>
      </div>

      <h2 className="display mt-16 text-3xl">Örnek istek</h2>
      <div className="mt-5">
        <CodeSnippet />
      </div>
    </section>
  );
}
