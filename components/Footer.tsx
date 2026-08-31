import Link from "next/link";
import Logo from "./Logo";

const columns = [
  {
    title: "Ürün",
    links: [
      { href: "/#nasil-calisir", label: "Genel bakış" },
      { href: "/pricing", label: "Fiyatlandırma" },
      { href: "/docs", label: "Dokümantasyon" },
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
    <footer className="border-t border-clouda-border bg-clouda-bg">
      <div className="mx-auto max-w-[1240px] px-6 py-16">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo />
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-clouda-muted">
              Yapay zeka ajanları için gerçek zamanlı web erişim katmanı. Aranmış, çıkarılmış ve
              modele hazır sonuçlar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="eyebrow">{col.title}</h4>
                <ul className="mt-4 space-y-3">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="nav-link">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-14 border-t border-clouda-border pt-6 text-xs text-clouda-muted">
          © {new Date().getFullYear()} Clouda. Tüm hakları saklıdır.
        </div>
      </div>
    </footer>
  );
}
