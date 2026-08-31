import Link from "next/link";
import { PixelArt } from "@/components/PixelArt";

const tiers = [
  {
    name: "Ücretsiz",
    price: "0₺",
    period: "kayıt olur olmaz",
    credits: "2.000 kredi",
    bg: "bg-clouda-cyan",
    features: ["≈200 arama isteği", "Tüm API özellikleri", "Kredi kartı gerekmez"],
    cta: "Ücretsiz başla",
    href: "/login",
    dark: false,
  },
  {
    name: "Kullandıkça öde",
    price: "10 kredi",
    period: "arama isteği başına",
    credits: "İhtiyacın kadar",
    bg: "bg-clouda-ink",
    features: [
      "İstediğin zaman kredi ekle",
      "Kullanım geçmişi ve panel",
      "Sınırsız API anahtarı",
      "Öncelikli destek",
    ],
    cta: "Panele git",
    href: "/dashboard",
    dark: true,
  },
  {
    name: "Kurumsal",
    price: "Konuşalım",
    period: "özel anlaşma",
    credits: "Özel limit",
    bg: "bg-clouda-lime",
    features: ["Özel hız ve limit anlaşmaları", "SLA ve öncelikli destek", "Entegrasyon desteği"],
    cta: "İletişime geç",
    href: "mailto:hello@clouda.dev",
    dark: false,
  },
];

export default function PricingPage() {
  return (
    <section className="relative overflow-hidden bg-clouda-bg">
      <PixelArt
        shape="cloud"
        className="pointer-events-none absolute -right-24 top-10 hidden w-[420px] opacity-70 lg:block"
        fill="#B9A6FF"
        outline="#DCFF57"
      />
      <div className="relative mx-auto max-w-[1400px] px-5 py-20 sm:px-8">
        <p className="section-label">fiyatlandırma</p>
        <h1 className="display mt-4 max-w-[12ch] text-[12vw] sm:text-[8vw] lg:text-[5.5rem]">
          Basit, kredi bazlı.
        </h1>
        <p className="mt-6 max-w-lg text-lg text-clouda-ink/60">
          Her yeni hesap 2000 ücretsiz kredi ile başlar. Bir arama isteği 10 kredi tutar —
          sürpriz yok.
        </p>

        <div className="mt-16 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col rounded-3xl ${tier.bg} p-8 ${
                tier.dark ? "text-white" : "text-clouda-ink"
              }`}
            >
              <h3 className="text-sm font-bold uppercase tracking-[0.18em] opacity-60">
                {tier.name}
              </h3>
              <p className="display mt-5 text-4xl">{tier.price}</p>
              <p className={`mt-1 text-sm ${tier.dark ? "text-white/50" : "text-clouda-ink/50"}`}>
                {tier.period}
              </p>
              <p
                className={`mt-6 w-fit rounded-full px-3 py-1.5 text-xs font-bold ${
                  tier.dark ? "bg-clouda-lime text-clouda-ink" : "bg-white/70 text-clouda-violetDark"
                }`}
              >
                {tier.credits}
              </p>
              <ul className="mt-7 flex-1 space-y-3 text-sm font-medium">
                {tier.features.map((f) => (
                  <li key={f} className={tier.dark ? "text-white/70" : "text-clouda-ink/75"}>
                    • {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`mt-9 rounded-full px-6 py-3.5 text-center text-sm font-bold transition ${
                  tier.dark
                    ? "bg-white text-clouda-ink hover:bg-white/85"
                    : "bg-clouda-ink text-white hover:bg-clouda-violetDark"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
