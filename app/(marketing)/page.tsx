import Link from "next/link";
import DemoSearch from "@/components/DemoSearch";
import CodeSnippet from "@/components/CodeSnippet";

const steps = [
  {
    color: "bg-[#DCEBFF]",
    title: "1. Sorgunu gönder",
    desc: "Modelinin ya da ajanının ihtiyaç duyduğu soruyu tek bir API isteğiyle Clouda'ya iletir.",
  },
  {
    color: "bg-[#E6E1FF]",
    title: "2. Clouda web'i tarar",
    desc: "Clouda kendi arama altyapısıyla ilgili sayfaları bulur, içeriklerini çeker ve gereksiz kısımları ayıklar.",
  },
  {
    color: "bg-[#FFF3C4]",
    title: "3. Temiz sonucu al",
    desc: "Başlık, bağlantı ve okunabilir içerikten oluşan yapılandırılmış JSON'u saniyeler içinde alırsın.",
  },
];

const stats = [
  { value: "2000", label: "her yeni hesaba ücretsiz kredi" },
  { value: "REST", label: "tek uç nokta, tek istek" },
  { value: "JSON", label: "modeller için hazır, temiz çıktı" },
];

export default function Home() {
  return (
    <>
      <section className="bg-clouda-radial">
        <div className="mx-auto max-w-7xl px-6 pb-20 pt-16 sm:pt-24">
          <p className="section-label">clouda api</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-black leading-[1.05] tracking-tight text-clouda-ink sm:text-6xl md:text-7xl">
            Yapay zeka modelleri için web arama API&apos;si.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-black/60">
            Clouda, modellerinize ve ajanlarınıza gerçek zamanlı web arama gücü katar. Kayıt
            ol, saniyeler içinde API anahtarını al, ilk aramanı yap.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login" className="btn-primary">
              Ücretsiz başla — 2000 kredi
            </Link>
            <Link href="/docs" className="btn-secondary">
              Dokümantasyona bak
            </Link>
          </div>

          <div id="product" className="mt-14 max-w-2xl">
            <DemoSearch />
            <p className="mt-3 px-2 text-xs text-black/40">
              Yukarıdaki kutu Clouda&apos;nın gerçek arama motorunu canlı olarak kullanır — kayıt gerekmez.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y border-black/5 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-12 sm:grid-cols-3">
          {stats.map((s) => (
            <div key={s.label} className="text-center sm:text-left">
              <p className="text-4xl font-black text-clouda-ink">{s.value}</p>
              <p className="mt-1 text-sm text-black/50">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24">
        <p className="section-label">nasıl çalışır</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-black tracking-tight text-clouda-ink sm:text-4xl">
          Üç adımda modelinize web erişimi kazandırın.
        </h2>
        <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.title} className={`rounded-3xl ${step.color} p-8`}>
              <h3 className="text-lg font-bold text-clouda-ink">{step.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-black/70">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-[#0B0714] py-24">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-clouda-lilac">
              geliştiriciler için
            </p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Tek istek, her yerde çalışır.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
              Basit bir REST API. Sağlayıcı kilidi yok, karmaşık SDK yok — LLM ajanınıza,
              RAG pipeline&apos;ınıza ya da chatbotunuza dakikalar içinde entegre edin.
            </p>
            <Link href="/docs" className="btn-secondary mt-6 !bg-transparent !text-white hover:!bg-white/10">
              Tüm API dokümanı
            </Link>
          </div>
          <CodeSnippet />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-24 text-center">
        <h2 className="text-3xl font-black tracking-tight text-clouda-ink sm:text-4xl">
          Bugün 2000 ücretsiz kredi ile başla.
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm text-black/60">
          Kredi kartı gerekmez. Google hesabınla giriş yap, API anahtarını al, aramaya başla.
        </p>
        <Link href="/login" className="btn-primary mt-8 inline-flex">
          Ücretsiz hesap oluştur
        </Link>
      </section>
    </>
  );
}
