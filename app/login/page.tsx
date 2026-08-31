import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import Logo from "@/components/Logo";
import { PixelArt, PixelScatter } from "@/components/PixelArt";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-clouda-bg px-5 py-16">
      <PixelArt
        shape="cloud"
        className="pointer-events-none absolute -left-20 bottom-0 hidden w-[420px] opacity-70 md:block"
        fill="#B9A6FF"
        outline="#DCFF57"
      />
      <PixelScatter
        className="pointer-events-none absolute right-0 top-0 hidden h-72 w-72 opacity-60 md:block"
        color="#7C3AED"
        count={24}
        seed={13}
      />

      <div className="relative w-full max-w-md rounded-3xl border-2 border-clouda-ink bg-white p-9">
        <Logo />
        <h1 className="display mt-8 text-4xl">
          Hoş geldin.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-clouda-ink/60">
          Google hesabınla gir, anında <strong className="text-clouda-ink">2000 ücretsiz kredi</strong>{" "}
          hesabına tanımlansın.
        </p>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/dashboard" });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-full bg-clouda-ink px-6 py-4 text-sm font-bold text-white transition hover:bg-clouda-violetDark"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z"
              />
              <path
                fill="#34A853"
                d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z"
              />
              <path
                fill="#FBBC05"
                d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33z"
              />
              <path
                fill="#EA4335"
                d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"
              />
            </svg>
            Google ile devam et
          </button>
        </form>

        <p className="mt-6 text-xs text-clouda-ink/40">
          Giriş yaparak kullanım koşullarını kabul etmiş olursun.
        </p>
      </div>
    </div>
  );
}
