import Link from "next/link";
import DemoSearch from "@/components/DemoSearch";
import CodeSnippet from "@/components/CodeSnippet";

const stats = [
  { value: "2.000", label: "yeni her hesaba ücretsiz kredi", bar: "bg-clouda-sky" },
  { value: "10 kredi", label: "arama isteği başına sabit fiyat", bar: "bg-clouda-violet" },
  { value: "6 kaynak", label: "her sorguda paralel sorgulanır", bar: "bg-clouda-amber" },
];

const capabilities = [
  {
    title: "Modelleri taze web bağlamıyla besleyin",
    body: "Canlı web verisini getirir, ilgili içeriği çıkarır ve modeller için yapılandırılmış biçimde döner; ajanlar uydurmadan, gerçeklerin üzerinden akıl yürütür.",
  },
  {
    title: "Sayfaları okunabilir metne çevirir",
    body: "Menü, reklam ve script kalabalığı ayıklanır, sayfanın kendi karakter kodlaması korunur. Modeline yalnızca gerçek içerik gider.",
  },
  {
    title: "Kredi bazlı, tahmin edilebilir maliyet",
    body: "Her arama isteği 10 kredi. Sürpriz fatura yok; kullanımını ve kalan kredini panelden anlık takip edersin.",
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: "url(/hero.jpg)" }}
          aria-hidden="true"
        />
        {/* Keeps the wash at the edges and the type on a calm, light centre. */}
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(70% 55% at 50% 38%, rgba(250,248,245,0.92) 0%, rgba(250,248,245,0.55) 45%, rgba(250,248,245,0) 100%)",
          }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10 bg-gradient-to-b from-clouda-bg/70 via-transparent to-clouda-bg"
          aria-hidden="true"
        />

        <div className="mx-auto max-w-[1240px] px-6 pb-24 pt-20 text-center sm:pt-28">
          <h1 className="display mx-auto max-w-4xl text-[42px] sm:text-6xl lg:text-[76px]">
            Yapay zeka ajanlarınızı
            <br />
            <span className="text-clouda-sage">web&apos;e bağlayın</span>
          </h1>
          <p className="mx-auto mt-7 max-w-xl text-lg text-clouda-muted">
            Gerçek zamanlı web erişimi için tek bir API.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link href="/login" className="btn-dark">
              Ücretsiz dene
            </Link>
            <Link href="/docs" className="btn-light">
              API dokümanı
            </Link>
          </div>

          <div className="mx-auto mt-16 max-w-3xl">
            <DemoSearch />
            <p className="mt-4 text-sm text-clouda-muted">
              Bu kutu Clouda&apos;nın gerçek arama motorunu kullanır — kayıt gerekmez.
            </p>
          </div>
        </div>
      </section>

      {/* Capability section */}
      <section id="nasil-calisir" className="border-t border-clouda-border bg-clouda-bg">
        <div className="mx-auto max-w-[1240px] px-6 py-24">
          <p className="slug">/ajanlar için web erişim katmanı</p>
          <h2 className="display mt-4 max-w-3xl text-[34px] sm:text-5xl">
            Geliştiriciler için basit, üretim için sağlam
          </h2>

          <div className="mt-16 grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div className="card p-7">
              <div className="rounded-xl bg-clouda-bg px-4 py-3 font-mono text-sm text-clouda-ink">
                clouda.search(<span className="text-clouda-muted">&quot;sorgun&quot;</span>)
              </div>
              <p className="mt-6 font-mono text-xs text-clouda-muted">Found sources 180 ms</p>
              <div className="mt-4 space-y-5">
                {[0, 1, 2].map((i) => (
                  <div key={i}>
                    <div className="flex items-center gap-3">
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-clouda-sage text-white">
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
                      <span
                        className="h-2.5 rounded-full bg-clouda-border"
                        style={{ width: `${[62, 76, 48][i]}%` }}
                      />
                    </div>
                    <p className="mt-3 pl-8 font-mono text-xs text-clouda-muted">Relevant chunks</p>
                    <div className="mt-2 flex gap-2 pl-8">
                      {[0, 1, 2].map((j) => (
                        <span
                          key={j}
                          className="h-5 rounded bg-clouda-sageSoft"
                          style={{ width: `${[74, 52, 62][j]}px` }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-10">
              {capabilities.map((c) => (
                <div key={c.title}>
                  <h3 className="text-2xl font-medium tracking-[-0.02em] text-clouda-ink">
                    {c.title}
                  </h3>
                  <p className="mt-3 max-w-md leading-relaxed text-clouda-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Code */}
      <section className="border-t border-clouda-border">
        <div className="mx-auto max-w-[1240px] px-6 py-24">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="slug">/entegrasyon</p>
              <h2 className="display mt-4 text-[34px] sm:text-[44px]">
                Tek istek, her dilde çalışır
              </h2>
              <p className="mt-5 max-w-md leading-relaxed text-clouda-muted">
                curl, Node ya da Python — fark etmez. SDK kurulumu yok, arama sağlayıcısı hesabı
                yok. Anahtarını al, mevcut ajanına dakikalar içinde bağla.
              </p>
              <Link href="/docs" className="btn-light mt-8">
                Dokümantasyonu incele
              </Link>
            </div>
            <CodeSnippet />
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-t border-clouda-border bg-clouda-bg">
        <div className="mx-auto max-w-[1240px] px-6 py-24">
          <p className="slug">/rakamlarla</p>
          <h2 className="display mt-4 text-[34px] sm:text-5xl">Şeffaf ve tahmin edilebilir</h2>
          <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="card p-8">
                <p className="text-4xl font-medium tracking-[-0.03em] text-clouda-ink">{s.value}</p>
                <span className={`mt-6 block h-1 w-10 rounded-full ${s.bar}`} />
                <p className="mt-5 text-sm leading-relaxed text-clouda-muted">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-clouda-border">
        <div
          className="absolute inset-0 -z-10 bg-cover bg-center"
          style={{ backgroundImage: "url(/cta.jpg)" }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(65% 60% at 50% 50%, rgba(250,248,245,0.9) 0%, rgba(250,248,245,0.5) 55%, rgba(250,248,245,0.2) 100%)",
          }}
          aria-hidden="true"
        />
        <div className="mx-auto max-w-[1240px] px-6 py-28 text-center">
          <h2 className="display mx-auto max-w-2xl text-[34px] sm:text-5xl">
            Yapay zekanı gerçek zamanlı web aramasıyla güçlendir
          </h2>
          <p className="mt-5 text-clouda-muted">Kredi kartı gerekmez. 2000 kredi hediye.</p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <Link href="/docs" className="nav-link">
              API dokümanını keşfet →
            </Link>
            <Link href="/login" className="btn-dark">
              Hemen başla
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
