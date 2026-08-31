import Image from "next/image";
import Link from "next/link";
import Logo from "./Logo";
import { signOut } from "@/lib/auth";

export default function DashboardNav({
  userName,
  userImage,
}: {
  userName?: string | null;
  userImage?: string | null;
}) {
  return (
    <header className="bg-clouda-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <div className="flex items-center gap-6">
          <Logo />
          <Link
            href="/docs"
            className="hidden text-sm font-semibold text-clouda-ink/60 transition hover:text-clouda-ink sm:block"
          >
            Dokümantasyon
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {userImage && (
              <Image
                src={userImage}
                alt=""
                width={30}
                height={30}
                className="rounded-full"
                unoptimized
              />
            )}
            <span className="hidden text-sm font-semibold text-clouda-ink sm:inline">
              {userName}
            </span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="rounded-full bg-white px-4 py-2.5 text-xs font-bold text-clouda-ink transition hover:bg-white/70"
            >
              Çıkış
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
