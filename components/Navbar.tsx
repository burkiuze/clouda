import Link from "next/link";
import Logo from "./Logo";

const links = [
  { href: "/#nasil-calisir", label: "Ürün" },
  { href: "/docs", label: "Dokümantasyon" },
  { href: "/pricing", label: "Fiyatlandırma" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-clouda-border/70 bg-clouda-bg/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-6 px-6 py-4">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/login" className="nav-link hidden sm:block">
            Giriş
          </Link>
          <Link href="/login" className="btn-dark !px-5 !py-2.5 text-sm">
            Ücretsiz dene
          </Link>
        </div>
      </div>
    </header>
  );
}
