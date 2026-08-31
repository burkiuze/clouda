import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import AuthLayout from "@/components/AuthLayout";
import SignupForm from "@/components/SignupForm";
import GoogleButton from "@/components/GoogleButton";
import { SIGNUP_FREE_CREDITS } from "@/lib/constants";

export default async function SignupPage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <AuthLayout quote="Ajanlarını gerçek zamanlı web'e bağla. İlk 2000 kredi bizden.">
      <p className="eyebrow-plain">Kayıt ol</p>
      <h1 className="display mt-3 text-4xl">Hesabını oluştur</h1>
      <p className="mt-3 text-clouda-muted">
        {SIGNUP_FREE_CREDITS.toLocaleString("tr-TR")} ücretsiz kredi hediye, kredi kartı gerekmez.
      </p>

      <div className="mt-8">
        <GoogleButton label="Google ile devam et" />
      </div>

      <div className="my-6 flex items-center gap-4">
        <span className="h-px flex-1 bg-clouda-border" />
        <span className="text-xs uppercase tracking-wider text-clouda-muted">veya</span>
        <span className="h-px flex-1 bg-clouda-border" />
      </div>

      <SignupForm />

      <p className="mt-6 text-sm text-clouda-muted">
        Zaten hesabın var mı?{" "}
        <Link href="/login" className="font-medium text-clouda-ink underline underline-offset-4">
          Giriş yap
        </Link>
      </p>
    </AuthLayout>
  );
}
