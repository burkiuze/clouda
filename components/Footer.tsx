import Link from "next/link";
import Logo from "./Logo";
import { PixelScatter } from "./PixelArt";

const columns = [
  {
    title: "Ürün",
    links: [
      { href: "/#urun", label: "Genel bakış" },
      { href: "/docs", label: "API dokümantasyonu" },
      { href: "/pricing", label: "Fiyatlandırma" },
    ],
  },
  {
    title: "Hesap",
    links: [
      { href: "/login", label: "Giriş yap" },
      { href: "/dashboard", label: "Panel" },
    ],
  },
  {
    title: "İletişim",
    links: [{ href: "mailto:hello@clouda.dev", label: "hello@clouda.dev" }],
  },
];

export default function Footer() {
  return (
    <footer className="relative overflow-hidden bg-clouda-ink">
      <PixelScatter
        className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 opacity-30"
        color="#7C3AED"
        count={20}
        seed={5}
      />
      <div className="relative mx-auto max-w-[1400px] px-5 py-16 sm:px-8">
        <div className="flex flex-col justify-between gap-12 lg:flex-row">
          <div className="max-w-sm">
            <Logo tone="light" />
            <p className="mt-5 text-sm leading-relaxed text-white/50">
              Clouda, yapay zeka modelleri ve ajanları için gerçek zamanlı web arama
              altyapısıdır. Tek istek, temiz ve yapılandırılmış sonuçlar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-clouda-lime">
                  {col.title}
                </h4>
                <ul className="mt-4 space-y-2.5 text-sm text-white/55">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="transition hover:text-white">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-white/35 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Clouda. Tüm hakları saklıdır.</span>
          <span>Geliştiriciler için inşa edildi.</span>
        </div>
      </div>
    </footer>
  );
}
