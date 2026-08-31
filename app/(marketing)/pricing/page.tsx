import Link from "next/link";

const tiers = [
  {
    name: "Ücretsiz",
    price: "0₺",
    period: "kayıt olunca",
    highlight: false,
    credits: "2.000 kredi",
    features: ["≈200 arama isteği", "Tüm API özellikleri", "Kredi bittiğinde yeniden yükleme"],
    cta: "Ücretsiz başla",
    href: "/login",
  },
  {
    name: "Kullandıkça Öde",
    price: "İstek başına",
    period: "kredi paketleri",
    highlight: true,
    credits: "İhtiyacın kadar",
    features: [
      "10 kredi / arama isteği",
      "İstediğin zaman kredi ekle",
      "Kullanım geçmişi ve panel",
      "Öncelikli destek",
    ],
    cta: "Panele git",
    href: "/dashboard",
  },
  {
    name: "Kurumsal",
    price: "Bizimle konuş",
    period: "özel anlaşma",
    highlight: false,
    credits: "Özel limit",
    features: [
      "Özel hız/limit anlaşmaları",
      "SLA ve öncelikli destek",
      "Özel entegrasyon desteği",
    ],
    cta: "İletişime geç",
    href: "mailto:hello@clouda.dev",
  },
];

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-20">
      <p className="section-label text-center">fiyatlandırma</p>
      <h1 className="mt-3 text-center text-4xl font-black tracking-tight text-clouda-ink sm:text-5xl">
        Basit, kredi bazlı fiyatlandırma.
      </h1>
      <p className="mx-auto mt-4 max-w-lg text-center text-sm text-black/60">
        Her yeni hesap 2000 ücretsiz kredi ile başlar. Bir arama isteği 10 kredi tutar.
      </p>

      <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`flex flex-col rounded-3xl border p-8 ${
              tier.highlight
                ? "border-clouda-violet bg-clouda-ink text-white shadow-xl"
                : "border-black/10 bg-white text-clouda-ink"
            }`}
          >
            <h3 className="text-lg font-bold">{tier.name}</h3>
            <p className="mt-4 text-3xl font-black">{tier.price}</p>
            <p className={`text-xs ${tier.highlight ? "text-white/50" : "text-black/40"}`}>
              {tier.period}
            </p>
            <p
              className={`mt-4 inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                tier.highlight ? "bg-white/10 text-white" : "bg-clouda-lilac/40 text-clouda-violetDark"
              }`}
            >
              {tier.credits}
            </p>
            <ul className="mt-6 flex-1 space-y-3 text-sm">
              {tier.features.map((f) => (
                <li key={f} className={`flex gap-2 ${tier.highlight ? "text-white/70" : "text-black/70"}`}>
                  <span>—</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href={tier.href}
              className={`mt-8 rounded-full px-5 py-3 text-center text-sm font-semibold transition ${
                tier.highlight
                  ? "bg-white text-clouda-ink hover:bg-white/90"
                  : "bg-clouda-ink text-white hover:bg-clouda-violetDark"
              }`}
            >
              {tier.cta}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
