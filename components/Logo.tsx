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
    <Link href="/" className={`flex shrink-0 items-center gap-2.5 ${className}`}>
      <Image src="/logo.png" alt="" width={40} height={23} priority className="h-6 w-auto" />
      <span
        className={`text-[22px] font-semibold tracking-[-0.02em] ${
          tone === "light" ? "text-white" : "text-clouda-ink"
        }`}
      >
        clouda
      </span>
    </Link>
  );
}
