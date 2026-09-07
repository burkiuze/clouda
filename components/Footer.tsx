import Link from "next/link";
import Logo from "./Logo";
import { NEWS_FEED_COUNT, TOTAL_SOURCE_COUNT } from "@/lib/constants";

export default function Footer() {
  return (
    <footer className="border-t border-clouda-border bg-clouda-bg">
      <div className="mx-auto max-w-[1240px] px-6 py-14">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Logo />
            <p className="mt-5 text-sm leading-relaxed text-clouda-muted">
              Yapay zeka modelleri ve ajanları için açık kaynak web yetenekleri. Kendi
              makinende çalışır; hesap, anahtar ve kota yoktur.
            </p>
          </div>

          <div className="flex gap-12 text-sm">
            <div>
              <p className="eyebrow-plain text-[10px]">Kullanım</p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <Link href="/docs" className="nav-link">
                    Dokümantasyon
                  </Link>
                </li>
                <li>
                  <Link href="/api/v1/openapi" className="nav-link">
                    OpenAPI şeması
                  </Link>
                </li>
                <li>
                  <Link href="/api/health" className="nav-link">
                    Durum
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <p className="eyebrow-plain text-[10px]">Kaynak</p>
              <ul className="mt-4 space-y-2.5">
                <li>
                  <a
                    href="https://github.com/burkiuze/clouda"
                    className="nav-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GitHub
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/burkiuze/clouda/blob/main/CONTRIBUTING.md"
                    className="nav-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Katkı
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/burkiuze/clouda/blob/main/LICENSE"
                    className="nav-link"
                    target="_blank"
                    rel="noreferrer"
                  >
                    GPL v3
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p className="mt-12 border-t border-clouda-border pt-6 text-xs text-clouda-muted">
          {TOTAL_SOURCE_COUNT} kaynak, {NEWS_FEED_COUNT} yayıncı beslemesi. Kapsam, açık web
          indeksleri ve dikey kaynakların birleşimi kadardır.
        </p>
      </div>
    </footer>
  );
}
