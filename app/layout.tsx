import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clouda — Yapay zeka ajanlarını web'e bağlayın",
  description:
    "Clouda, yapay zeka modellerinin ve ajanlarının gerçek zamanlı web'e erişmesini sağlayan tek bir API'dir. Kayıt ol, 2000 ücretsiz kredi kazan.",
  openGraph: {
    title: "Clouda — Yapay zeka ajanlarını web'e bağlayın",
    description:
      "Gerçek zamanlı web erişimi için tek güvenli API. Aranmış, çıkarılmış ve modele hazır sonuçlar.",
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
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-clouda-bg antialiased">{children}</body>
    </html>
  );
}
