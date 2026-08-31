import Link from "next/link";
import Logo from "./Logo";

export default function Footer() {
  return (
    <footer className="border-t border-black/5 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-14">
        <div className="flex flex-col justify-between gap-10 md:flex-row">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-4 text-sm leading-relaxed text-black/60">
              Clouda, yapay zeka modelleri ve ajanları için gerçek zamanlı web arama API'sidir.
              Tek istek, temiz ve yapılandırılmış sonuçlar.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <h4 className="text-sm font-semibold text-clouda-ink">Ürün</h4>
              <ul className="mt-3 space-y-2 text-sm text-black/60">
                <li><Link href="/#product" className="hover:text-clouda-ink">Genel bakış</Link></li>
                <li><Link href="/docs" className="hover:text-clouda-ink">API dokümantasyonu</Link></li>
                <li><Link href="/pricing" className="hover:text-clouda-ink">Fiyatlandırma</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-clouda-ink">Hesap</h4>
              <ul className="mt-3 space-y-2 text-sm text-black/60">
                <li><Link href="/login" className="hover:text-clouda-ink">Giriş yap</Link></li>
                <li><Link href="/dashboard" className="hover:text-clouda-ink">Panel</Link></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="mt-12 flex flex-col items-start justify-between gap-4 border-t border-black/5 pt-6 text-xs text-black/40 sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Clouda. Tüm hakları saklıdır.</span>
          <span>Geliştiriciler için inşa edildi.</span>
        </div>
      </div>
    </footer>
  );
}
