import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clouda — Yapay zeka modelleri için web arama API'si",
  description:
    "Clouda, yapay zeka modellerinin ve ajanlarının gerçek zamanlı web'de arama yapmasını sağlayan bir API platformudur. Ücretsiz kayıt ol, 2000 kredi kazan.",
  metadataBase: new URL("https://clouda.dev"),
  openGraph: {
    title: "Clouda — Yapay zeka modelleri için web arama API'si",
    description:
      "Modellerinize gerçek zamanlı web arama gücü katın. Tek bir API çağrısı, temiz sonuçlar.",
    siteName: "Clouda",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body className="bg-clouda-bg font-sans antialiased">{children}</body>
    </html>
  );
}
