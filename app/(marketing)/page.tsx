import Link from "next/link";
import DemoSearch from "@/components/DemoSearch";
import { NEWS_FEED_COUNT, TOTAL_SOURCE_COUNT } from "@/lib/constants";
import { publicBaseUrl } from "@/lib/config";

/**
 * The home page of a tool rather than the front of a product.
 *
 * It used to sell: a hero, feature tiles, a free-credit offer and a sign-up
 * button. There is nothing to sell and nobody to sign up, so the page leads
 * with the thing itself — a search box that works on load — and then answers
 * the only two questions left: what can it do, and how do I drive it from my
 * own code.
 */

const capabilities = [
  { name: "search", path: "/api/v1/search", what: "Web araması, kaynak birleştirme, içerik çıkarımı" },
  { name: "news", path: "/api/v1/news", what: `${NEWS_FEED_COUNT} yayıncı beslemesinden canlı haber` },
  { name: "data", path: "/api/v1/data", what: "Hava, kur, kripto, hisse, deprem, gösterge — sayı olarak" },
  { name: "answer", path: "/api/v1/answer", what: "Yalnızca alıntıya dayalı, kaynaklı cevap" },
  { name: "extract", path: "/api/v1/extract", what: "Adresi modele hazır metne çevirir" },
  { name: "map", path: "/api/v1/map", what: "Bir sitenin bütün adresleri, kendi haritasından" },
  { name: "research", path: "/api/v1/research", what: "Çok turlu araştırma, kaynaklı rapor" },
  { name: "browse", path: "/api/v1/browse", what: "Sayfa açar, bağlantı takip eder" },
  { name: "rerank", path: "/api/v1/rerank", what: "Kendi belgelerini sıralar (BM25 + MMR), ağ kullanmaz" },
  { name: "chunk", path: "/api/v1/chunk", what: "Yapıyı koruyarak metni parçalara böler" },
  { name: "social", path: "/api/v1/social", what: "Mastodon, Lemmy, YouTube" },
];

export default function Home() {
  const base = publicBaseUrl();

  return (
    <>
      <section className="border-b border-clouda-border bg-clouda-bg">
        <div className="mx-auto max-w-[1000px] px-6 py-16 lg:py-24">
          <p className="eyebrow">clouda north · açık kaynak</p>
          <h1 className="display mt-6 text-[40px] leading-[1.05] sm:text-6xl">
            Modeline canlı web ver.
            <br />
            Kendi makinende.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-clouda-muted">
            Arama, sayfa okuma, kaynaklı cevap, canlı veri ve belge sıralama — hepsi tek
            kod tabanında. Hesap yok, anahtar yok, kota yok. Klonla, çalıştır, kullan.
          </p>

          <div className="mt-10">
            <DemoSearch />
          </div>

          <p className="mt-4 text-sm text-clouda-muted">
            Bu kutu, çalışan kurulumunun kendi arama motorunu kullanıyor —{" "}
            {TOTAL_SOURCE_COUNT} kaynak, sorunun türüne göre paralel sorgulanır.
          </p>
        </div>
      </section>

      <section className="border-b border-clouda-border">
        <div className="mx-auto max-w-[1000px] px-6 py-16">
          <p className="eyebrow-plain">uçlar</p>
          <h2 className="display mt-3 text-3xl">Ne yapabilir</h2>
          <p className="mt-4 max-w-2xl text-clouda-muted">
            Hepsi <code className="font-mono text-sm text-clouda-ink">POST</code>, hepsi JSON.
            Aynı yetenekler <Link href="/docs#mcp" className="underline">MCP</Link> üzerinden
            ajanına doğrudan bağlanır.
          </p>

          <div className="mt-8 divide-y divide-clouda-border border-y border-clouda-border">
            {capabilities.map((c) => (
              <div key={c.name} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-6">
                <code className="font-mono text-sm text-clouda-ink sm:w-64 sm:shrink-0">
                  {c.path}
                </code>
                <span className="text-sm text-clouda-muted">{c.what}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-clouda-bg">
        <div className="mx-auto max-w-[1000px] px-6 py-16">
          <p className="eyebrow-plain">başlangıç</p>
          <h2 className="display mt-3 text-3xl">Çalıştır</h2>

          <pre className="mt-6 overflow-x-auto rounded-xl border border-clouda-border bg-white p-5 font-mono text-[13px] leading-relaxed text-clouda-ink">
{`git clone https://github.com/burkiuze/clouda.git
cd clouda && npm ci
npm run dev`}
          </pre>

          <p className="mt-6 text-clouda-muted">
            Veritabanı gerekmez, yapılandırma gerekmez. Sonra:
          </p>

          <pre className="mt-4 overflow-x-auto rounded-xl border border-clouda-border bg-white p-5 font-mono text-[13px] leading-relaxed text-clouda-ink">
{`curl ${base}/api/v1/search \\
  -H "Content-Type: application/json" \\
  -d '{"query":"postgres index bloat","search_depth":"fast"}'`}
          </pre>

          <p className="mt-6 text-sm text-clouda-muted">
            Ağa açacaksan <code className="font-mono text-clouda-ink">CLOUDA_TOKEN</code>{" "}
            tanımla; o zaman her uç{" "}
            <code className="font-mono text-clouda-ink">Authorization: Bearer</code> ister.
            Ayrıntılar <Link href="/docs" className="underline">dokümantasyonda</Link>.
          </p>
        </div>
      </section>
    </>
  );
}
