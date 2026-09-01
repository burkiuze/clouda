import Link from "next/link";
import DemoSearch from "@/components/DemoSearch";
import CodeSnippet from "@/components/CodeSnippet";
import { CREDITS } from "@/lib/constants";

const features = [
  {
    title: "Modelleri taze web bağlamıyla besleyin",
    body: "Canlı web verisini getirir, ilgili içeriği çıkarır ve modeller için yapılandırılmış biçimde döner; ajanlar uydurmadan, gerçeklerin üzerinden akıl yürütür.",
    active: true,
  },
  {
    title: "Sayfaları okunabilir metne çevirir",
    body: "Menü, reklam ve script kalabalığı ayıklanır, sayfanın kendi karakter kodlaması korunur. Modeline yalnızca gerçek içerik gider.",
    active: false,
  },
  {
    title: "Kredi bazlı, tahmin edilebilir maliyet",
    body: `Her arama isteği ${CREDITS.search} kredi. Sürpriz fatura yok; kullanımını ve kalan kredini panelden anlık takip edersin.`,
    active: false,
  },
];

const stats = [
  { value: "2.000", label: "her yeni hesaba ücretsiz kredi" },
  { value: `${CREDITS.search} kredi`, label: "arama isteği başına sabit fiyat" },
  { value: "8 kaynak", label: "her sorguda paralel sorgulanır" },
];

export default function Home() {
  return (
    <>
      {/* Split hero */}
      <section className="grid grid-cols-1 lg:grid-cols-2">
        <div className="flex items-center bg-clouda-bg px-6 py-16 sm:px-12 lg:px-16 lg:py-24">
          <div className="max-w-xl">
            <p className="eyebrow">clouda &amp; arama api</p>
            <h1 className="display mt-8 text-[44px] sm:text-6xl lg:text-[68px]">
              Yapay zeka ajanları için eksiksiz web erişimi
            </h1>
            <p className="prose-serif mt-8">
              Clouda, modellerinin ve ajanlarının gerçek zamanlı web&apos;e erişmesini sağlayan tek
              bir API&apos;dir. Arar, sayfaların içeriğini çıkarır ve doğrudan modele
              verilebilecek temiz sonuçlar döner.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-dark">
                Ücretsiz başla
              </Link>
              <Link href="/docs" className="btn-outline">
                API dokümanı
              </Link>
            </div>
            <div className="mt-12 space-y-1.5">
              <p className="eyebrow-plain">2000 ücretsiz kredi. kredi kartı gerekmez.</p>
              <p className="eyebrow-plain">tek uç nokta, saf json, sağlayıcı kilidi yok</p>
            </div>
          </div>
        </div>

        <div
          className="relative flex items-center justify-center bg-clouda-panel bg-cover bg-center px-6 py-16 lg:px-12"
          style={{ backgroundImage: "url(/hero.jpg)" }}
        >
          <div id="urun" className="w-full max-w-xl">
            <DemoSearch />
          </div>
        </div>
      </section>

      {/* Product section */}
      <section className="border-t border-clouda-border bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-24 lg:px-10">
          <p className="eyebrow-plain">clouda search api</p>
          <h2 className="display mt-6 max-w-3xl text-[36px] sm:text-5xl">
            Tek uç noktalı, üretime hazır arama altyapısı
          </h2>
          <p className="prose-serif mt-7 max-w-2xl">
            SDK kurulumu, arama sağlayıcısı hesabı ya da altyapı yönetimi yok. Anahtarını al,
            çağır. Sonuç başlık, bağlantı, özet ve sayfadan çıkarılmış okunabilir metinle gelir.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-dark">
              Ücretsiz başla
            </Link>
            <Link href="/docs" className="btn-outline">
              Dokümantasyonu incele
            </Link>
          </div>

          <div className="mt-16 rounded-card border border-clouda-border bg-clouda-panel p-6 sm:p-12">
            <div className="mx-auto max-w-3xl rounded-card border border-clouda-border bg-white p-6">
              <div className="rounded-btn bg-clouda-bg px-4 py-3 font-mono text-sm">
                clouda.search(<span className="text-clouda-muted">&quot;sorgun&quot;</span>)
              </div>
              <p className="mt-6 font-mono text-xs text-clouda-muted">Found sources · 180 ms</p>
              <div className="mt-4 space-y-5">
                {[62, 78, 48].map((w, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-5 w-5 shrink-0 place-items-center bg-clouda-indigo text-white">
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path
                            d="M2.5 6.5l2.5 2.5 4.5-5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                      <span className="h-2.5 rounded-full bg-clouda-border" style={{ width: `${w}%` }} />
                    </div>
                    <p className="mt-3 pl-8 font-mono text-xs text-clouda-muted">Relevant chunks</p>
                    <div className="mt-2 flex gap-2 pl-8">
                      {[74, 52, 62].map((cw, j) => (
                        <span
                          key={j}
                          className="h-5 rounded bg-clouda-indigoSoft"
                          style={{ width: `${cw}px` }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-10 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className={`border-t-2 pt-6 ${f.active ? "border-clouda-indigo" : "border-clouda-border"}`}
              >
                <div className="flex gap-3">
                  <span className="mt-2 block h-2.5 w-2.5 shrink-0 bg-clouda-indigo" />
                  <div>
                    <h3 className="text-xl font-medium tracking-[-0.02em] text-clouda-ink">
                      {f.title}
                    </h3>
                    <p className="mt-3 leading-relaxed text-clouda-muted">{f.body}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Integration */}
      <section className="border-t border-clouda-border bg-clouda-bg">
        <div className="mx-auto max-w-[1400px] px-6 py-24 lg:px-10">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="eyebrow">entegrasyon</p>
              <h2 className="display mt-6 text-[36px] sm:text-5xl">
                Tek istek, her dilde çalışır
              </h2>
              <p className="prose-serif mt-7 max-w-md">
                curl, Node ya da Python — fark etmez. Clouda&apos;yı mevcut ajanına, RAG
                pipeline&apos;ına ya da chatbotuna dakikalar içinde bağla.
              </p>
              <Link href="/docs" className="btn-outline mt-9">
                API referansı
              </Link>
            </div>
            <CodeSnippet />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-t border-clouda-border bg-white">
        <div className="mx-auto max-w-[1400px] px-6 py-20 lg:px-10">
          <div className="grid grid-cols-1 gap-10 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="border-t-2 border-clouda-ink pt-6">
                <p className="display text-5xl">{s.value}</p>
                <p className="mt-4 text-clouda-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="grid grid-cols-1 border-t border-clouda-border lg:grid-cols-2">
        <div className="flex items-center bg-clouda-bg px-6 py-20 sm:px-12 lg:px-16">
          <div className="max-w-lg">
            <h2 className="display text-[36px] sm:text-5xl">
              Bugün 2000 ücretsiz kredi ile başla
            </h2>
            <p className="prose-serif mt-6">
              Kredi kartı gerekmez. Kayıt ol, API anahtarını oluştur, ilk aramanı yap.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-dark">
                Hesap oluştur
              </Link>
              <Link href="/pricing" className="btn-outline">
                Fiyatlandırma
              </Link>
            </div>
          </div>
        </div>
        <div
          className="min-h-[280px] bg-cover bg-center"
          style={{ backgroundImage: "url(/cta.jpg)" }}
          aria-hidden="true"
        />
      </section>
    </>
  );
}
