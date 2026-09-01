import Link from "next/link";
import { CREDITS, SIGNUP_FREE_CREDITS } from "@/lib/constants";

const tiers = [
  {
    name: "Ücretsiz",
    price: "0₺",
    period: "kayıt olur olmaz",
    credits: "2.000 kredi",
    features: [`≈${Math.floor(SIGNUP_FREE_CREDITS / CREDITS.search).toLocaleString("tr-TR")} arama isteği`, "Tüm API özellikleri", "Kredi kartı gerekmez"],
    cta: "Ücretsiz başla",
    href: "/login",
    featured: false,
  },
  {
    name: "Kullandıkça öde",
    price: `${CREDITS.search} kredi`,
    period: "arama isteği başına",
    credits: "İhtiyacın kadar",
    features: [
      "İstediğin zaman kredi ekle",
      "Kullanım geçmişi ve panel",
      "Sınırsız API anahtarı",
      "Öncelikli destek",
    ],
    cta: "Panele git",
    href: "/dashboard",
    featured: true,
  },
  {
    name: "Kurumsal",
    price: "Konuşalım",
    period: "özel anlaşma",
    credits: "Özel limit",
    features: ["Özel hız ve limit anlaşmaları", "SLA ve öncelikli destek", "Entegrasyon desteği"],
    cta: "İletişime geç",
    href: "mailto:hello@clouda.dev",
    featured: false,
  },
];

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 py-20">
      <p className="eyebrow-plain">fiyatlandırma</p>
      <h1 className="display mt-4 max-w-2xl text-[40px] sm:text-6xl">
        Basit, kredi bazlı fiyatlandırma
      </h1>
      <p className="mt-6 max-w-lg text-lg text-clouda-muted">
        Her yeni hesap 2000 ücretsiz kredi ile başlar. Bir arama isteği {CREDITS.search} kredi tutar — sürpriz
        yok.
      </p>

      <div className="mt-16 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`flex flex-col rounded-card border p-8 ${
              tier.featured
                ? "border-clouda-indigo bg-clouda-indigoSoft/60"
                : "border-clouda-border bg-white "
            }`}
          >
            <h3 className="eyebrow-plain">{tier.name}</h3>
            <p className="mt-6 text-4xl font-medium tracking-[-0.03em] text-clouda-ink">
              {tier.price}
            </p>
            <p className="mt-1.5 text-sm text-clouda-muted">{tier.period}</p>
            <p className="mt-6 w-fit rounded-btn border border-clouda-border bg-white px-3 py-1.5 text-xs font-medium text-clouda-indigo">
              {tier.credits}
            </p>
            <ul className="mt-8 flex-1 space-y-3.5">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-clouda-muted">
                  <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-clouda-indigo text-white">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6.5l2.5 2.5 4.5-5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href={tier.href}
              className={`mt-10 rounded-btn px-6 py-3.5 text-center text-[15px] font-medium transition ${
                tier.featured
                  ? "bg-clouda-ink text-white hover:bg-clouda-ink/85"
                  : "border border-clouda-border bg-white text-clouda-ink hover:border-clouda-ink"
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
