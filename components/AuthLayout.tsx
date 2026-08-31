import Link from "next/link";
import Logo from "./Logo";

/**
 * Split auth screen: the form sits on the left, a full-bleed photograph
 * fills the right half on wide viewports.
 */
export default function AuthLayout({
  children,
  quote,
}: {
  children: React.ReactNode;
  quote: string;
}) {
  return (
    <div className="flex min-h-screen bg-clouda-bg">
      <div className="flex w-full flex-col px-6 py-8 sm:px-12 lg:w-1/2 lg:px-16">
        <div className="flex items-center justify-between">
          <Logo />
          <Link href="/" className="text-sm text-clouda-muted transition hover:text-clouda-ink">
            ← Ana sayfa
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>

      <div className="relative hidden lg:block lg:w-1/2">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url(/auth.jpg)" }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <p className="absolute bottom-12 left-12 right-12 font-serif text-2xl leading-snug text-white">
          {quote}
        </p>
      </div>
    </div>
  );
}
