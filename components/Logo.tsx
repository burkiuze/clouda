import Image from "next/image";
import Link from "next/link";

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`}>
      <Image src="/logo.png" alt="Clouda" width={32} height={19} priority className="h-7 w-auto" />
      <span className="text-lg font-bold tracking-tight text-clouda-ink">clouda</span>
    </Link>
  );
}
