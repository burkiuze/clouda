import Image from "next/image";
import Link from "next/link";

export default function Logo({
  className = "",
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  return (
    <Link href="/" className={`flex shrink-0 items-center gap-2 ${className}`}>
      <Image src="/logo.png" alt="" width={40} height={23} priority className="h-7 w-auto" />
      <span
        className={`text-[26px] font-black tracking-tightest ${
          tone === "light" ? "text-white" : "text-clouda-ink"
        }`}
      >
        clouda
      </span>
    </Link>
  );
}
