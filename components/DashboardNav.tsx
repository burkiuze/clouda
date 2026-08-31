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
    <header className="border-b border-clouda-border bg-clouda-bg">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-8">
          <Logo />
          <Link href="/docs" className="nav-link hidden sm:block">
            Dokümantasyon
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            {userImage && (
              <Image
                src={userImage}
                alt=""
                width={28}
                height={28}
                className="rounded-full"
                unoptimized
              />
            )}
            <span className="hidden text-sm font-medium text-clouda-ink sm:inline">{userName}</span>
          </div>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="rounded-btn border border-clouda-border bg-white px-4 py-2 text-xs font-medium text-clouda-ink transition hover:border-clouda-ink"
            >
              Çıkış
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
