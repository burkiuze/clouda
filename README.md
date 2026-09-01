# Clouda

Yapay zeka modelleri ve ajanları için gerçek zamanlı web arama API'si. fal.ai
tarzı bir ürün sitesi + Google ile giriş + her yeni hesaba otomatik 2000
ücretsiz kredi + kendi (üçüncü parti anahtar gerektirmeyen) arama motoru.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind CSS
- Auth.js (next-auth v5) — Google OAuth + Prisma adapter
- Prisma + PostgreSQL
- Kendi arama motoru: açık indekslerin paralel sorgulanması + RRF ile sıralama
  birleştirme + sunucu taraflı sayfa içeriği çıkarımı (`lib/search/engine.ts`)
  — üçüncü parti ücretli API anahtarı gerekmez.

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

4. **Arama sağlayıcı anahtarı gerekmiyor.** Arama tamamen açık indeksler
   üzerinde çalışır; ödemeli bir sağlayıcıya bağımlılık yoktur.

   Hangi kaynakların kullanıldığı tahminle değil ölçümle seçildi: deploy'un
   kendi çıkış IP'lerinden yapılan testte DuckDuckGo'nun HTML ucu bot kontrol
   sayfası, Mojeek / Reddit / Lobsters / searchmysite ise 403 döndürüyor, bu
   yüzden listede yoklar — hiç cevap vermeyen bir sağlayıcı her sorguya sadece
   zaman aşımı ekler.

   Haberi **kendi haber odamız** karşılıyor: 22 yayıncı beslemesi (AA, TRT,
   BBC Türkçe/World/Business/Tech, NTV, Hürriyet, DW, Guardian, NYT, NPR, AP,
   Al Jazeera, CNBC, Yahoo Finance, Ars Technica, The Verge, TechCrunch,
   Science Daily) arka planda çekilip bellekte tutulur, eşleştirme derlem
   üzerinde yapılır. Ölçüldü: 580 haber, hepsi tarihli, eşleştirme 2 ms.
   Google News'ten farkı, adreslerin gerçek makale adresleri olması — o yüzden
   içerikleri okunabiliyor.

   Haberde denenip **elenenler**: GDELT (anahtarsız küresel haber indeksi
   olduğu için en umut vereni; her denemede 10 saniyede yanıt vermedi),
   Reuters beslemesi (adres çözülmüyor), Sözcü (besleme boş ayrışıyor),
   Bing ve Yahoo haber RSS'leri (kanal başlığı dışında öğe döndürmüyor).

   Açık web'i **Marginalia** ve **mwmbl** karşılıyor. İkisi birden var çünkü
   ikisi de tek başına güvenilir değil: Marginalia dakikalar arayla bir
   sorguyu 202 ms'de yanıtladı, sonra aynısını 12 saniyede yanıtlayamadı.
   Geri kalanı dikey kaynaklar (Wikipedia, Stack Exchange, GitHub, Hacker
   News, Google News, akademik sorularda OpenAlex, paket sorularında npm).
   Hepsi aynı anda sorgulanır ve sıralamaları RRF ile birleştirilir.

   Denenip **elenenler** (hepsi datacenter IP'sinden ölçüldü): SearXNG
   örnekleri JSON vermiyor ya da 403, Yep ve Qwant bot doğrulaması istiyor,
   Ecosia/Startpage/PyPI ayrıştırılabilir sonuç döndürmüyor, dev.to kendi
   arama parametresini yok sayıyor, Reddit/Mojeek/Lobsters 403.

   > **Dürüst sınır.** "Tüm internet" tek bir ücretsiz kaynaktan gelmiyor;
   > böyle bir kaynak datacenter IP'lerine açık değil. Kapsama, iki açık web
   > indeksi + dikey kaynakların birleşimi kadardır. Bunu aşmanın gerçek yolu
   > ya ücretli bir arama API'si ya da kendi tarayıcımızı residential IP'lerde
   > çalıştırmak.

   > **Lisans uyarısı.** Marginalia'nın herkese açık API'si **CC-BY-NC-SA 4.0**
   > ile yayımlanıyor — atıf zorunlu ve **ticari kullanıma kapalı**. Clouda
   > ücretli bir ürün olarak sunulacaksa bu kaynak için Marginalia ile ayrı bir
   > izin/lisans konuşulması gerekir. Ticari kullanım netleşene kadar açık web
   > katmanını ücretsiz kademeyle sınırlamak ya da devre dışı bırakmak gerekir.

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

`Authorization: Bearer cld_live_...` başlığıyla çağrılır. Arama 2 kredi,
sayfa içeriği istenmediğinde 1. Detaylar `/docs` sayfasında.

| Uç nokta | Ne yapar |
| --- | --- |
| `POST /api/v1/search` | Arama, içerik çıkarımı, kalite skorları |
| `POST /api/v1/search/batch` | Tek istekte 10 sorguya kadar paralel arama |
| `POST /api/v1/news` | 22 yayıncı beslemesinden canlı haber; sorgu opsiyonel |
| `POST /api/v1/answer` | Kaynaklı, alıntıya dayalı cevap |
| `POST /api/v1/extract` | Elindeki adresleri modele hazır metne çevirir |
| `POST /api/v1/research` | Çok turlu araştırma, kaynaklı rapor |
| `POST /api/v1/browse` | Sayfa açar, bağlantı takip eder |
| `POST /api/v1/social` | Mastodon, Lemmy, YouTube |
| `POST /api/v1/monitors` | Değişiklik izler, webhook gönderir |
| `GET /api/v1/usage` | Kullanım ve performans metrikleri |

## Gecikme

Ölçülen (Frankfurt bölgesi, production):

| Durum | Süre |
| --- | --- |
| Önbellekten | ~40 ms |
| Taze arama (içerik çıkarımıyla) | ~1,2 sn |
| Taze arama (`include_content: false`) | ~0,7 sn |

Önbelleksiz bir aramanın 300 ms'ye inmesi mümkün değil: yedi dış kaynağa
sorup sayfaları canlı indirmek tek başına bundan uzun sürer. Ağ gidiş
dönüşleri tabandır. Bunun yerine iş azaltıldı:

- Adaylar indirilmeden önce ucuz sinyallerle sıralanıp yalnızca kazananlar
  getiriliyor; bir arama en fazla 5 sayfa indirir.
- `news.google.com` bağlantıları hiç indirilmez — onlar sayfa değil base64
  yönlendirme sarmalayıcısı, hiçbir zaman içerik çıkmıyor. Stack Exchange
  ailesi de indirilmiyor: ölçüldü, stackoverflow.com ve serverfault.com bu
  deploy'dan **160 ms'de sıfır karakter** döndürüyor — zaman aşımı olamayacak
  kadar hızlı, yani ret. API'lerinden gelen snippet zaten soru ve cevap
  metnini taşıyor.
- İçerik çıkarımının gerçek süresi ölçüldü: çıkarılabilen sayfa 358-891 ms
  arasında çıkıyor, ortancası 588 ms. Bütçe buna göre ayarlandı (aşama için
  1,4 sn, tek sayfa için 1 sn). Önceki 1,2 sn keşiften sonra ~600 ms
  bırakıyordu: her indirmeyi başlatmaya yetiyor, hiçbirini bitirmeye
  yetmiyordu — yani bütçe harcanıyor, sonuçlar yine snippet'e düşüyordu.
- Her kaynağın kendi süresi var (web indeksi 700 ms, dikey 600 ms) ve süreyi
  kaçıran kaynak o sorgu için **son bilinen yanıtıyla** temsil ediliyor —
  yani süreyi kısmak kapsama kaybı anlamına gelmiyor.
- İçerik çıkarımı isteğin başından itibaren 1,2 sn'lik mutlak bir bütçeye
  karşı çalışıyor; yetişmeyen sayfa kendi snippet'ine düşüyor.
- Keşif, dört kaynak yanıtladığı anda kesiliyor — süresini doldurmayı beklemek
  yerine. Kesilen kaynak, süreyi kaçıran kaynakla aynı yolu izliyor (son bilinen
  yanıtı kullanılıyor), yani tasarruf beklemekten geliyor, kapsamdan değil.
- İlk yanıtlayan kaynağın en iyi adayları, fan-out sürerken indirilmeye
  başlıyor: iki bekleme aşaması art arda değil, üst üste çalışıyor.
- Yanıt önbelleğine yazma, kullanım kaydı ve önbellek sayacı yanıt yolundan
  çıkarıldı (`after()`), yani çağıran bizim defter tutmamızı beklemiyor.
- Haber derlemi istek anında değil arka planda tazeleniyor; haber sorgusu
  bellekten yanıtlanıyor.

`include_content: false` gönderirsen sayfa hiç indirilmez; hem yaklaşık iki
kat hızlıdır hem de tam ücret yerine keşif ücreti düşer.

## Notlar / sonraki adımlar

- Arama motoru `lib/search/engine.ts` içinde zincir değil, **paralel** çalışır:
  niyete uyan bütün kaynaklar aynı anda sorgulanır, sıralamaları reciprocal
  rank fusion ile birleştirilir. Birden fazla indeksin bağımsız olarak öne
  çıkardığı sayfa yukarı taşınır — bir toplayıcının elindeki en güçlü sinyal
  budur. Hangi kaynakların cevap verdiği yanıttaki `source` alanında, cevap
  vermeyenler ise `degraded_providers` içinde görünür.
- Aynı ana bilgisayardan en fazla iki sonuç başa alınır, böylece tek bir site
  ilk sayfayı doldurmaz.
- Sonuç bulunduktan sonra her sayfa sunucu tarafında indirilip okunabilir
  metne dönüştürülür (`fetchPageContent`) — ürünün asıl katma değeri burası.
- `lib/search/safety.ts` yetişkin içerik filtresi, sağlayıcının kendi
  güvenli arama bayrağının arkasındaki ikinci katman.
- Kredi/kullanıcı verisi olmadan (DB bağlanmadan) site ve ana sayfadaki canlı
  arama demosu sorunsuz çalışır; sadece giriş ve panel DB gerektirir.
