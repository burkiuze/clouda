import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AuthLayout from "@/components/AuthLayout";
import OnboardingForm from "@/components/OnboardingForm";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.accountType) redirect("/dashboard");

  return (
    <AuthLayout quote="Son bir adım — hesabını sana göre ayarlayalım.">
      <p className="eyebrow-plain">Son adım</p>
      <h1 className="display mt-3 text-4xl">Clouda&apos;yı ne için kullanacaksın?</h1>
      <p className="mt-3 text-clouda-muted">
        Bu bilgi hesabını doğru şekilde ayarlamamıza yarıyor, sonradan değiştirebilirsin.
      </p>
      <div className="mt-8">
        <OnboardingForm />
      </div>
    </AuthLayout>
  );
}
