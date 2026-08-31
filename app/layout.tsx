import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clouda — Yapay zeka için web arama altyapısı",
  description:
    "Clouda, yapay zeka modellerinin ve ajanlarının gerçek zamanlı web'de arama yapmasını sağlayan API platformudur. Kayıt ol, 2000 ücretsiz kredi kazan.",
  openGraph: {
    title: "Clouda — Yapay zeka için web arama altyapısı",
    description:
      "Modellerinize gerçek zamanlı web arama gücü katın. Tek API çağrısı, temiz sonuçlar.",
    siteName: "Clouda",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-clouda-bg antialiased">{children}</body>
    </html>
  );
}
