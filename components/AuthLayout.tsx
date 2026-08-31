import Link from "next/link";
import Logo from "./Logo";

/**
 * Split auth screen: the form on the left, a quiet panel on the right.
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

      <div className="relative hidden border-l border-clouda-border bg-clouda-panel lg:block lg:w-1/2">
        <p className="absolute bottom-14 left-14 right-14 font-serif text-2xl leading-snug text-clouda-ink/70">
          {quote}
        </p>
      </div>
    </div>
  );
}
