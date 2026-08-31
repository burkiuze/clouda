import Link from "next/link";
import Logo from "./Logo";

const links = [
  { href: "/#urun", label: "Ürün", dot: true },
  { href: "/docs", label: "Dokümantasyon", dot: false },
  { href: "/pricing", label: "Fiyatlandırma", dot: false },
  { href: "/#kaynaklar", label: "Kaynaklar", dot: true },
];

export default function Navbar() {
  return (
    <>
      <div className="bg-clouda-ink px-4 py-2.5 text-center text-sm font-medium text-white">
        <Link href="/login" className="hover:underline">
          <span className="text-clouda-lime">✦</span> Kayıt ol, 2000 ücretsiz kredi kazan{" "}
          <span className="text-clouda-lime">✦</span>
        </Link>
      </div>
      <header className="sticky top-0 z-50 bg-clouda-bg/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="pill-nav-link">
                {l.dot && <span className="pill-dot" />}
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="mailto:hello@clouda.dev"
              className="hidden rounded-full bg-white px-5 py-2.5 text-sm font-bold text-clouda-ink transition hover:bg-white/70 sm:inline-flex"
            >
              Bize ulaşın
            </Link>
            <Link
              href="/login"
              className="rounded-full bg-clouda-ink px-5 py-2.5 text-sm font-bold text-white transition hover:bg-clouda-violetDark"
            >
              Giriş
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
