import Link from "next/link";
import Logo from "./Logo";

/**
 * There is no account to sign into and nothing to buy, so the chrome that
 * existed to sell and gate the product is gone. What is left points at the two
 * things a person running this locally actually wants: how to use it, and the
 * source.
 */
const links = [
  { href: "/docs", label: "Dokümantasyon" },
  { href: "/api/v1/openapi", label: "OpenAPI" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-clouda-border bg-white">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-4 lg:px-10">
        <Logo />
        <nav className="flex items-center gap-6">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">
              {l.label}
            </Link>
          ))}
          <a
            href="https://github.com/burkiuze/clouda"
            className="btn-dark !px-5 !py-2.5 text-sm"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
