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
    <section className="bg-clouda-bg">
      <div className="mx-auto max-w-[1000px] px-5 py-20 sm:px-8">
        <p className="section-label">dokümantasyon</p>
        <h1 className="display mt-4 text-[12vw] sm:text-[7vw] lg:text-[4.6rem]">API referansı</h1>
        <p className="mt-6 max-w-xl text-lg text-clouda-ink/60">
          Clouda tek bir uç noktadan oluşur. Anahtarını{" "}
          <Link href="/dashboard" className="font-semibold text-clouda-ink underline">
            panelden
          </Link>{" "}
          oluştur, aşağıdaki isteği gönder.
        </p>

        <div className="mt-12 rounded-3xl bg-white p-8">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-clouda-lime px-3 py-1.5 text-xs font-black tracking-wide text-clouda-ink">
              POST
            </span>
            <code className="font-mono text-base font-bold text-clouda-ink">/api/v1/search</code>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-clouda-ink/65">
            Verilen sorgu için web&apos;de arama yapar, sonuç sayfalarının içeriğini çıkarır ve
            yapılandırılmış JSON döner. İstek başına <strong>10 kredi</strong> düşer.
          </p>

          <h3 className="mt-8 text-sm font-black uppercase tracking-[0.16em] text-clouda-violetDark">
            Başlıklar
          </h3>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-clouda-bg p-5 font-mono text-[13px]">
{`Authorization: Bearer cld_live_xxxxxxxx
Content-Type: application/json`}
          </pre>

          <h3 className="mt-8 text-sm font-black uppercase tracking-[0.16em] text-clouda-violetDark">
            İstek gövdesi
          </h3>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-clouda-bg p-5 font-mono text-[13px]">
{`{
  "query": "aranacak metin",
  "max_results": 5   // opsiyonel, 1-10 arası, varsayılan 5
}`}
          </pre>

          <h3 className="mt-8 text-sm font-black uppercase tracking-[0.16em] text-clouda-violetDark">
            Yanıt
          </h3>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-clouda-bg p-5 font-mono text-[13px]">
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

          <h3 className="mt-8 text-sm font-black uppercase tracking-[0.16em] text-clouda-violetDark">
            Hata kodları
          </h3>
          <div className="mt-3 divide-y divide-black/5">
            {errors.map((e) => (
              <div key={e.code} className="flex gap-4 py-2.5 text-sm">
                <code className="font-mono font-bold text-clouda-violet">{e.code}</code>
                <span className="text-clouda-ink/65">{e.desc}</span>
              </div>
            ))}
          </div>
        </div>

        <h2 className="display mt-16 text-3xl">Örnek istek</h2>
        <div className="mt-5">
          <CodeSnippet />
        </div>
      </div>
    </section>
  );
}
