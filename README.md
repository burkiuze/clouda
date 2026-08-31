# Clouda

Yapay zeka modelleri ve ajanları için gerçek zamanlı web arama API'si. fal.ai
tarzı bir ürün sitesi + Google ile giriş + her yeni hesaba otomatik 2000
ücretsiz kredi + kendi (üçüncü parti anahtar gerektirmeyen) arama motoru.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- Auth.js (next-auth v5) — Google OAuth + Prisma adapter
- Prisma + PostgreSQL
- Kendi arama motoru: DuckDuckGo HTML sonuçları + sunucu taraflı sayfa
  içeriği çıkarımı (`lib/search/engine.ts`) — üçüncü parti ücretli API key
  gerekmez.

## Yerel geliştirme

```bash
npm install
cp .env.example .env   # değerleri doldur
npx prisma migrate dev --name init
npm run dev
```

## Vercel'e deploy ederken eklemen gereken environment variable'lar

Proje zaten deploy edildi, ama aşağıdakiler eklenmeden **Google ile giriş ve
kredi sistemi çalışmaz** (site ve canlı arama demosu env olmadan da çalışır):

1. **Veritabanı** — Vercel projesinde **Storage** sekmesinden bir Postgres
   veritabanı oluştur (Neon/Vercel Postgres). Projeye bağladığında
   `DATABASE_URL` otomatik eklenir. Sonra bir kere şunu çalıştırman gerekir
   (tablo oluşturmak için):
   ```bash
   npx prisma migrate deploy
   ```
   (Vercel CLI ile `vercel env pull` yapıp yerelden, ya da bir CI adımından
   çalıştırabilirsin.)

2. **Google OAuth** — [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   üzerinden bir OAuth Client ID oluştur (Web application). Authorized
   redirect URI olarak şunu ekle:
   ```
   https://<vercel-domainin>/api/auth/callback/google
   ```
   Sonra Vercel'de şu env variable'ları ekle:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

3. **Auth secret** — güçlü bir gizli anahtar üret ve ekle:
   ```bash
   openssl rand -base64 32
   ```
   - `NEXTAUTH_SECRET` (veya `AUTH_SECRET`)

4. (Opsiyonel) `SIGNUP_FREE_CREDITS` — varsayılan 2000, değiştirmek istersen ekle.

Hepsini ekledikten sonra Vercel'de **Redeploy** yap.

## API

Tek uç nokta: `POST /api/v1/search` — `Authorization: Bearer cld_live_...`
başlığıyla, istek başına 10 kredi düşer. Detaylar `/docs` sayfasında.

## Notlar / sonraki adımlar

- Arama motoru MVP olarak DuckDuckGo'nun HTML sonuç sayfasını kullanıyor —
  anahtar gerektirmez ama bulut IP'lerinden zaman zaman hız sınırına
  takılabilir. `lib/search/engine.ts` içindeki `searchWeb` fonksiyonu tek
  giriş noktası olduğu için ileride Tavily/Brave/Serper gibi ücretli bir
  sağlayıcıya geçmek tek dosyalık bir değişiklik.
- Kredi/kullanıcı verisi olmadan (DB bağlanmadan) site ve ana sayfadaki canlı
  arama demosu sorunsuz çalışır; sadece giriş ve panel DB gerektirir.
