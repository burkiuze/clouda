import Image from "next/image";
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
    <header className="border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {userImage && (
              <Image
                src={userImage}
                alt={userName ?? "Kullanıcı"}
                width={28}
                height={28}
                className="rounded-full"
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
              className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold text-clouda-ink transition hover:bg-black/5"
            >
              Çıkış yap
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
