import Link from "next/link";
import Logo from "./Logo";

const links = [
  { href: "/#urun", label: "Ürün" },
  { href: "/docs", label: "Dokümantasyon" },
  { href: "/pricing", label: "Fiyatlandırma" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-clouda-border bg-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-4 lg:px-10">
        <Logo />
        <nav className="hidden items-center gap-8 md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-5">
          <Link href="/login" className="nav-link hidden sm:block">
            Giriş yap
          </Link>
          <Link href="/signup" className="btn-dark !px-5 !py-2.5 text-sm">
            Ücretsiz başla
          </Link>
        </div>
      </div>
    </header>
  );
}
