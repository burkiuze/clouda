import Link from "next/link";
import Logo from "./Logo";

const links = [
  { href: "/#product", label: "Ürün" },
  { href: "/docs", label: "Dokümantasyon" },
  { href: "/pricing", label: "Fiyatlandırma" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-clouda-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="pill-nav-link">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="pill-nav-link hidden sm:inline-flex">
            Giriş yap
          </Link>
          <Link href="/login" className="btn-primary !px-5 !py-2.5 text-sm">
            Ücretsiz başla
          </Link>
        </div>
      </div>
    </header>
  );
}
