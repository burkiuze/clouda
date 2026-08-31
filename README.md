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

1. **Veritabanı** — iki değişken gerekir: uygulamanın çalışma anında
   kullandığı `DATABASE_URL` (transaction pooler, port 6543) ve
   migration'ların kullandığı `DIRECT_URL` (session pooler, port 5432).
   Transaction modunda DDL çalıştırılamadığı için ikisi ayrı.

   Supabase kullanıyorsan **ikisi de pooler üzerinden** gitmeli. Supabase'in
   doğrudan adresi (`db.<ref>.supabase.co`) ücretsiz planda yalnızca IPv6
   kaydına sahip, Vercel fonksiyonları ise IPv4 — doğrudan adres oradan
   bağlanamaz. Bağlantı dizelerini Supabase panelinde **Connect** düğmesinden
   alabilirsin.

   Tabloları ayrıca oluşturman gerekmez: `DATABASE_URL` ve `DIRECT_URL`
   tanımlıyken build sırasında `prisma migrate deploy` otomatik çalışır
   (`scripts/migrate.mjs`), tanımlı değilken atlanır.

2. **Google OAuth** (opsiyonel, e-posta/şifre ile de kayıt olunabilir) — [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
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

4. **Arama sağlayıcı anahtarı (önerilir)** — genel web araması için bir
   anahtar ekle (birini seç):
   - `TAVILY_API_KEY` — https://tavily.com
   - `BRAVE_SEARCH_API_KEY` — https://brave.com/search/api
   - `SERPER_API_KEY` — https://serper.dev

   Neden gerekli: bulut sunucu IP'lerinden ücretsiz arama kaynaklarının
   tamamı engelleniyor (DuckDuckGo ve Mojeek bot kontrol sayfası, Brave HTML
   429, Bing'in RSS görünümü ise sorguyla alakasız sonuçlar döndürüyor).
   Anahtar olmadan da site ve API çalışır, ama sonuçlar yalnızca açık
   kaynaklardan (Wikipedia, Google News) gelir. Anahtar eklendiği anda motor
   onu ilk sırada kullanır, kod değişikliği gerekmez.

5. (Opsiyonel) `SIGNUP_FREE_CREDITS` — varsayılan 2000, değiştirmek istersen ekle.

Hepsini ekledikten sonra Vercel'de **Redeploy** yap. Kurulumun doğru olup
olmadığını tek istekle görebilirsin:

```
https://<vercel-domainin>/api/health
```

Her bağımlılığı ayrı ayrı raporlar; `ready: true` dönerse kayıt ve giriş
çalışıyor demektir. Veritabanına bağlanamıyorsa hatanın kendisini gösterir.

## Giriş / kayıt

İki yöntem var:

- **Google ile** — `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` gerekir.
- **E-posta + şifre** — ek bir servis gerekmez; şifreler bcrypt ile hash'lenip
  `User.passwordHash` alanında saklanır.

Kayıt sırasında hesap türü sorulur (**bireysel** / **kurumsal**); kurumsalda
kurum adı da alınır. Google ile gelen kullanıcılar bu soruyu ilk girişte
`/onboarding` ekranında yanıtlar. Oturumlar JWT tabanlıdır (credentials
sağlayıcısı bunu gerektirir), kullanıcı kayıtları yine Prisma'da tutulur.

## API

Tek uç nokta: `POST /api/v1/search` — `Authorization: Bearer cld_live_...`
başlığıyla, istek başına 10 kredi düşer. Detaylar `/docs` sayfasında.

## Notlar / sonraki adımlar

- Arama motoru `lib/search/engine.ts` içinde sıralı kaynak zinciri olarak
  çalışır: anahtarlı sağlayıcılar (Tavily / Brave / Serper — hangisinin
  anahtarı varsa) → DuckDuckGo (bulut dışı sunucularda çalışır) → Wikipedia →
  Google News. Bir kaynak boş dönerse sıradakine geçer, hangisinin cevap
  verdiği yanıttaki `source` alanında görünür.
- Sonuç bulunduktan sonra her sayfa sunucu tarafında indirilip okunabilir
  metne dönüştürülür (`fetchPageContent`) — ürünün asıl katma değeri burası.
- `lib/search/safety.ts` yetişkin içerik filtresi, sağlayıcının kendi
  güvenli arama bayrağının arkasındaki ikinci katman.
- Kredi/kullanıcı verisi olmadan (DB bağlanmadan) site ve ana sayfadaki canlı
  arama demosu sorunsuz çalışır; sadece giriş ve panel DB gerektirir.
