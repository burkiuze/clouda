import Link from "next/link";
import DemoSearch from "@/components/DemoSearch";
import CodeSnippet from "@/components/CodeSnippet";
import { PixelArt, PixelScatter } from "@/components/PixelArt";

const valueProps = [
  "2000 ücretsiz kredi",
  "tek uç nokta",
  "kurulum yok",
  "saf JSON",
  "sağlayıcı kilidi yok",
];

const useCases = [
  {
    title: "Güncel haberler",
    desc: "Modelin eğitim verisinin bittiği yerden sonrasını canlı olarak getir.",
    bg: "bg-clouda-cyan",
    shape: "cloud" as const,
    fill: "#2563EB",
    outline: "#DCFF57",
  },
  {
    title: "Ürün & fiyat araştırması",
    desc: "Ajanının karar vermesi için sayfa içeriklerini ham metin olarak çıkar.",
    bg: "bg-clouda-lime",
    shape: "bolt" as const,
    fill: "#4C1D95",
    outline: "#FFFFFF",
  },
  {
    title: "RAG için kaynak toplama",
    desc: "Sorgu başına temiz, parçalanmaya hazır içerik blokları al.",
    bg: "bg-clouda-pink",
    shape: "cloud" as const,
    fill: "#BE185D",
    outline: "#0A0612",
  },
  {
    title: "Doğrulama & fact-check",
    desc: "Modelin ürettiği iddiaları gerçek kaynaklara karşı kontrol ettir.",
    bg: "bg-clouda-mint",
    shape: "bolt" as const,
    fill: "#047857",
    outline: "#0A0612",
  },
];

const mosaic = [
  {
    text: "Her yeni hesap 2000 kredi ile başlar. Kredi kartı istemiyoruz.",
    className: "bg-clouda-lime text-clouda-ink font-bold",
  },
  {
    text: "Arama isteği başına 10 kredi. Şeffaf, sabit fiyat.",
    className: "bg-white/5 text-white/70",
  },
  {
    text: "Sonuçlar başlık, bağlantı, özet ve okunabilir sayfa içeriğiyle döner.",
    className: "bg-white/5 text-white/70",
  },
  { text: "Kendi arama altyapımız", className: "bg-clouda-panel text-clouda-ink font-bold" },
  {
    text: "İptal edilebilir API anahtarları ve kullanım geçmişi panelde.",
    className: "bg-white/5 text-white/70",
  },
  { text: "Anahtarını al, 30 saniyede entegre et.", className: "bg-clouda-cyan text-clouda-ink font-bold" },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-clouda-bg">
        <PixelScatter
          className="pointer-events-none absolute right-0 top-0 hidden h-[380px] w-[380px] opacity-70 md:block"
          color="#7C3AED"
          count={30}
          seed={11}
        />
        <PixelArt
          shape="cloud"
          className="pointer-events-none absolute -right-16 bottom-[-40px] hidden w-[440px] opacity-90 lg:block"
          fill="#B9A6FF"
          outline="#DCFF57"
        />

        <div className="relative mx-auto max-w-[1400px] px-5 pb-28 pt-16 sm:px-8 sm:pt-24">
          <h1 className="display max-w-[15ch] text-[13vw] leading-[0.9] sm:text-[9vw] lg:text-[7.2rem]">
            Yapay zeka için web arama altyapısı.
          </h1>
          <p className="mt-8 max-w-lg text-lg leading-relaxed text-clouda-ink/70">
            Modellerin ve ajanların gerçek zamanlı web&apos;e erişsin. Tek bir API çağrısı
            gönder, aranmış ve içeriği çıkarılmış temiz sonuçları al.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn-primary !px-7 !py-3.5 text-base">
              Ücretsiz başla — 2000 kredi
            </Link>
            <Link href="/docs" className="btn-secondary !px-7 !py-3.5 text-base">
              Dokümantasyon
            </Link>
          </div>
        </div>
      </section>

      {/* Value strip */}
      <section className="border-y border-black/5 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-5 py-8 sm:px-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
            {valueProps.map((v) => (
              <span
                key={v}
                className="text-sm font-bold uppercase tracking-[0.14em] text-clouda-ink/45"
              >
                {v}
              </span>
            ))}
          </div>
          <span className="shrink-0 text-sm font-semibold text-clouda-ink/40">
            Geliştiriciler için inşa edildi
          </span>
        </div>
      </section>

      {/* Live demo + gallery */}
      <section id="urun" className="bg-white">
        <div className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-end">
            <h2 className="display text-[10vw] sm:text-[7vw] lg:text-[4.6rem]">
              Modelinin
              <br />
              bilmediği her şey
              <br />
              canlı web&apos;de
            </h2>
            <p className="max-w-md text-lg leading-relaxed text-clouda-ink/60 lg:pb-4">
              Clouda kendi arama altyapısını çalıştırır: sorguyu alır, ilgili sayfaları bulur,
              içeriklerini çeker ve gereksiz her şeyi ayıklar. Sonuç, doğrudan{" "}
              <Link href="/docs" className="font-semibold text-clouda-ink underline">
                modele verilebilir JSON
              </Link>
              . Ücretsiz katman{" "}
              <Link href="/pricing" className="font-semibold text-clouda-ink underline">
                2000 kredi
              </Link>{" "}
              ile başlar.
            </p>
          </div>

          <div className="mt-14">
            <p className="mb-4 text-2xl font-black tracking-tightest">Şimdi dene →</p>
            <DemoSearch />
            <p className="mt-3 text-sm text-clouda-ink/40">
              Bu kutu Clouda&apos;nın gerçek arama motorunu kullanır — kayıt gerekmez.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {useCases.map((c) => (
              <div
                key={c.title}
                className={`relative overflow-hidden rounded-2xl ${c.bg} p-6 pt-24`}
              >
                <PixelArt
                  shape={c.shape}
                  fill={c.fill}
                  outline={c.outline}
                  cell={8}
                  className="absolute -right-4 -top-2 h-24 w-40 opacity-90"
                />
                <h3 className="relative text-lg font-black tracking-tight text-clouda-ink">
                  {c.title}
                </h3>
                <p className="relative mt-2 text-sm leading-relaxed text-clouda-ink/70">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Product bento */}
      <section className="bg-clouda-bg">
        <div className="mx-auto max-w-[1400px] px-5 py-24 sm:px-8">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="relative">
              <h2 className="display text-[12vw] sm:text-[8vw] lg:text-[4.4rem]">
                Kur,
                <br />
                bağla,
                <br />
                ölçekle.
              </h2>
              <PixelArt
                shape="bolt"
                className="mt-8 hidden w-40 lg:block"
                fill="#7C3AED"
                outline="#DCFF57"
              />
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div className="rounded-3xl bg-clouda-panel p-8 sm:p-10">
                <p className="pixel-mark text-clouda-violetDark">clouda SEARCH API</p>
                <h3 className="display mt-6 max-w-xl text-3xl sm:text-4xl">
                  Gerçek zamanlı web araması. Üretime hazır.
                </h3>
                <p className="mt-4 max-w-xl text-sm leading-relaxed text-clouda-ink/70">
                  Tek bir REST uç noktası. SDK kurulumu, arama sağlayıcısı hesabı ya da altyapı
                  yönetimi yok — anahtarını al ve çağır.
                </p>
                <ul className="mt-6 space-y-2 text-sm font-medium text-clouda-ink/80">
                  <li>• LLM ajanlarına ve RAG pipeline&apos;larına doğrudan bağlanır</li>
                  <li>• Sayfa içeriği çıkarımı ücrete dahil</li>
                  <li>• İstek başına sabit 10 kredi</li>
                </ul>
                <Link href="/docs" className="btn-primary mt-8">
                  API&apos;yi incele
                </Link>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="rounded-3xl bg-clouda-cyan p-8">
                  <p className="pixel-mark text-blue-800">clouda EXTRACT</p>
                  <h3 className="display mt-5 text-2xl sm:text-3xl">
                    Sayfaları temiz metne çevirir.
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-clouda-ink/70">
                    Menü, reklam ve script kalabalığı ayıklanır; modeline yalnızca okunabilir
                    içerik gider.
                  </p>
                </div>
                <div className="rounded-3xl bg-clouda-lime p-8">
                  <p className="pixel-mark text-clouda-violetDark">clouda SCALE</p>
                  <h3 className="display mt-5 text-2xl sm:text-3xl">
                    Kredi bittiğinde durmaz.
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-clouda-ink/70">
                    Panelden kredi ekle, kullanımını takip et; yüksek hacim için bizimle özel
                    limit konuş.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dark developer section */}
      <section id="kaynaklar" className="relative overflow-hidden bg-clouda-ink py-24">
        <PixelScatter
          className="pointer-events-none absolute left-0 top-0 h-64 w-64 opacity-40"
          color="#DCFF57"
          count={22}
          seed={3}
        />
        <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <h2 className="display text-[11vw] text-white sm:text-[7vw] lg:text-[4.4rem]">
                Tek istek,
                <br />
                her yerde
                <br />
                çalışır.
              </h2>
              <p className="mt-6 max-w-md text-base leading-relaxed text-white/55">
                curl, Node ya da Python — fark etmez. Clouda&apos;yı mevcut ajanına dakikalar
                içinde bağla.
              </p>
              <Link href="/login" className="btn-outline-dark mt-8">
                Anahtarını al
              </Link>
            </div>
            <CodeSnippet />
          </div>

          <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mosaic.map((m) => (
              <div key={m.text} className={`card-mosaic ${m.className}`}>
                {m.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden bg-clouda-bg py-28">
        <PixelArt
          shape="cloud"
          className="pointer-events-none absolute -bottom-16 right-[-80px] hidden w-[460px] opacity-80 md:block"
          fill="#B9A6FF"
          outline="#DCFF57"
        />
        <div className="relative mx-auto max-w-[1400px] px-5 sm:px-8">
          <h2 className="display max-w-[14ch] text-[12vw] sm:text-[8vw] lg:text-[5.5rem]">
            Bugün 2000 kredi ile başla.
          </h2>
          <p className="mt-6 max-w-md text-lg text-clouda-ink/60">
            Kredi kartı gerekmez. Google hesabınla gir, anahtarını oluştur, ilk aramanı yap.
          </p>
          <Link href="/login" className="btn-primary mt-8 !px-8 !py-4 text-base">
            Ücretsiz hesap oluştur
          </Link>
        </div>
      </section>
    </>
  );
}
