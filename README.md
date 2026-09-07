# Clouda North

![Clouda North](public/clouda-north.png)

**Sürüm 0.2.0 — North**

Yapay zeka modelleri ve ajanları için **açık kaynak web yetenekleri**. Web arama,
sayfa okuma, kaynaklı yanıt, araştırma, belge sıralama ve metin parçalama
araçlarını aynı kod tabanında birleştirir. Kendi ortamında çalıştırabilir,
REST API veya MCP üzerinden ajanlarına bağlayabilir ve yeni sağlayıcılar ekleyebilirsin.

Clouda bir model eğitmez; modele dış dünyadan bilgi getiren ve bu bilgiyi
kullanılabilir biçime dönüştüren araçlar sağlar.

## Yetenekler

| Yetenek | Kod | HTTP arayüzü |
| --- | --- | --- |
| Web arama, kaynak birleştirme, içerik çıkarımı | `lib/search/` | `POST /api/v1/search` |
| Birden çok sorgu | `lib/search/engine.ts` | `POST /api/v1/search/batch` |
| Kaynaklardan alıntıya dayalı yanıt | `lib/research/citations.ts` | `POST /api/v1/answer` |
| Çok turlu araştırma | `lib/research/orchestrator.ts` | `POST /api/v1/research` |
| URL'den okunabilir metin çıkarımı | `lib/search/extract.ts` | `POST /api/v1/extract` |
| Sayfa açma ve bağlantı takibi | `lib/browser/agent.ts` | `POST /api/v1/browse` |
| Site haritası | `lib/crawl/sitemap.ts` | `POST /api/v1/map` |
| Haber beslemeleri | `lib/search/newsroom.ts` | `POST /api/v1/news` |
| Yapılandırılmış canlı veri | `lib/data/live.ts` | `POST /api/v1/data` |
| BM25 ve çeşitlilik ile belge sıralama | `lib/rank/bm25.ts` | `POST /api/v1/rerank` |
| Yapıyı koruyarak metin parçalama | `lib/rank/chunk.ts` | `POST /api/v1/chunk` |
| Sosyal kaynaklar | `lib/social/providers.ts` | `POST /api/v1/social` |
| Değişiklik izleme | `lib/monitor/watcher.ts` | `POST /api/v1/monitors` |
| MCP araçları | `lib/mcp/tools.ts` | `POST /api/mcp` |
| Makine tarafından okunabilir API şeması | `app/api/v1/openapi/` | `GET /api/v1/openapi` |

## Kod yapısı

- `lib/`: arama, sıralama, içerik çıkarımı ve diğer araçların uygulaması.
- `lib/core/`: ortak HTTP, önbellek, süre sınırları, hata türleri ve kaynak sağlığı.
- `app/api/`: REST ve MCP arayüzleri.
- `app/` ve `components/`: örnek web arayüzü, hesap ve API anahtarı yönetimi.
- `prisma/`: PostgreSQL şeması ve migration dosyaları.
- `tests/`: sıralama, arama, önbellek, HTTP ve hata davranışını doğrulayan testler.

TypeScript, Next.js 15, React 19, Prisma/PostgreSQL ve Cheerio kullanılır.
Bu depo henüz bağımsız yayımlanmış bir npm SDK'sı değildir. Saf hesaplama
modülleri olan `lib/rank/` ağ veya veritabanı gerektirmez; arama ve HTTP
entegrasyonu Node.js ortamında çalışır.

## Yerel kurulum

Node.js 22 veya 24, npm ve tam API için PostgreSQL gerekir.

```bash
git clone https://github.com/burkiuze/clouda.git
cd clouda
npm ci
cp .env.example .env
```

`.env` içindeki örnek veritabanı adreslerini kendi PostgreSQL bağlantınla değiştir.
Yerel bir kurulumun biçimi şöyledir:

```dotenv
DATABASE_URL="postgresql://clouda:YOUR_LOCAL_PASSWORD@localhost:5432/clouda"
DIRECT_URL="postgresql://clouda:YOUR_LOCAL_PASSWORD@localhost:5432/clouda"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="YOUR_GENERATED_SECRET"
```

Gizli anahtarı `openssl rand -base64 32` ile üret. `DATABASE_URL` uygulama
bağlantısıdır; `DIRECT_URL` migration çalıştırabilen bağlantıdır. Yerelde aynı
adres olabilirler. Bağlantı havuzu kullanıyorsan migration adresinin DDL
çalıştırabilmesi gerekir.

```bash
npx prisma migrate deploy
npm run dev
```

Arayüz: `http://localhost:3000`. Kendi hesabını oluşturup panelden bir API
anahtarı üretebilirsin. Hesap, yetenek izinleri ve kredi sayacı mevcut örnek
API katmanının parçalarıdır; bunlar yerel veritabanında tutulur.

Google ile giriş isteğe bağlıdır: kullanacaksan `GOOGLE_CLIENT_ID` ve
`GOOGLE_CLIENT_SECRET` tanımla. E-posta/şifre ile giriş de vardır.
`GITHUB_TOKEN`, GitHub arama sağlayıcısı için isteğe bağlıdır.
`CRON_SECRET`, haber ve izleme zamanlayıcı uçlarını korur. Zamanlayıcıları kendi
çalıştırma ortamında ayrıca kurmalısın.

Veritabanı olmadan saf hesaplama testleri ve kontrollü I/O testleri çalışır.
Hesap ve anahtarla kullanılan HTTP API'si ise veritabanı gerektirir.

## API kullanımı

Aşağıdaki değişkeni kendi kurulumundan aldığın anahtarla tanımla:

```bash
export CLOUDA_API_KEY="YOUR_API_KEY"
curl http://localhost:3000/api/v1/search \
  -H "Authorization: Bearer $CLOUDA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"postgres index bloat","max_results":5,"include_content":false}'
```

| Seçenek | Davranış |
| --- | --- |
| `search_depth: "fast" / "balanced" / "deep"` | Gecikme ve kaynak kapsamı bütçesini seçer; varsayılan `balanced`. |
| `include_content: false` | Sayfa indirmez; başlık, URL ve snippet döndürür. |
| `include_content: true` | Seçilen sayfalardan okunabilir metin çıkarmayı dener. |
| `freshness: "day"` | Bilinen yayın tarihi son 24 saatin dışında olan sonuçları eler. |
| `include_domains` / `exclude_domains` | Adayları indirme ve birleştirme öncesinde süzer. |
| `no_cache: true` | Yanıt ve sağlayıcı önbelleklerini okumaz veya yazmaz. |
| `mode: "sources"` | İçerik indirmeden kaynak biçiminde yanıt verir. |

Tarihi bilinmeyen bir sonuç güncel olduğu iddiasıyla etiketlenmez; tarih alanı
`null` kalır. `degraded_providers`, yanıt vermeyen veya son kayıtlı yanıtıyla
kullanılan kaynakları açıklar. Ayrıntılı istek/yanıt şeması çalışan uygulamanın
`/api/v1/openapi` ve `/docs` adreslerindedir.

MCP istemcisini `http://localhost:3000/api/mcp` adresine, aynı Bearer anahtarıyla
bağla. Araç adları ve giriş şemaları `tools/list` yanıtından keşfedilir;
uygulamaları `lib/mcp/tools.ts` içindedir.

## Kaynak kapsamı

Marginalia ve Mwmbl genel web indekslerini; Wikipedia/Wikidata, teknik kaynaklar,
akademik arşivler, paket kayıtları ve 22 yayıncı beslemesi konuya özel kapsamı sağlar.
Marginalia entegrasyonu güncel `api2.marginalia-search.com` API'sini kullanır.
Ortak `public` anahtarının sınırlarına bağlıdır; kendi anahtarını
`MARGINALIA_API_KEY` ile tanımlayabilirsin.

Daha geniş bir arama havuzu için işlettiğin SearXNG sunucusunun adresini
`SEARXNG_BASE_URL` ile ekle. Sunucuda JSON çıktısı etkin olmalı; yalnızca kamuya
açık HTTP(S) adresleri kabul edilir. Yapılandırılmadığında bu kaynak etkin değildir.
SearXNG'nin kullandığı motorları ve erişim koşullarını sunucu işletmecisi belirler.
[Resmî arama API'si](https://docs.searxng.org/dev/search_api.html).

| Profil | İlk kaynak dalgası | Keşif: web / dikey | Kurtarma üst sınırı | İçerik son sınırı / sayfa sınırı |
| --- | --- | --- | --- | --- |
| `fast` | 3 kaynak; gerekirse 80 ms sonra diğerleri | 450 / 350 ms | 700 ms | 1000 ms / 3 |
| `balanced` | 4 kaynak; gerekirse 120 ms sonra diğerleri | 700 / 600 ms | 1200 ms | 1400 ms / 5 |
| `deep` | Uygun tüm kaynaklar | 1800 / 1600 ms | 2500 ms | 3500 ms / 8 |

Keşif/kurtarma süreleri keşfin, içerik son sınırı aramanın başlangıcından ölçülür.
`fast` ve `balanced` yeterli ilgili ve benzersiz sonuçla ek kaynak dalgasını atlar.
`deep`, sonuca katkı yapabilecek geç kaynakları da bütçesi içinde bekler.
Hiçbiri bütün interneti eksiksiz taradığı veya her kaynağın o an erişilebilir
olduğu anlamına gelmez.

Yanıttaki `diagnostics`, derinliği, başlatılan sağlayıcı görevlerini,
sonuç veren sağlayıcıları, birleştirilen adayları, sayfa indirmelerini ve sonuç
alan adı sayısını gösterir. Sağlayıcı görevleri ortak yürütülebilir ve bir görev
birden fazla HTTP isteği yapabilir; bu sayaç elektrik tüketimi ölçümü değildir.
Yanıt önbelleği isabetinde yeni iş sayaçları sıfırdır; `provider` saklanan yanıtın
kaynak bilgisini korur.

## Arama gecikmesi ve dayanıklılık

- Aynı anda gelen eşdeğer sorgular aynı sunucu örneğinde ortak yürütülür.
  Arama derinliği, içerik modu, güncellik aralığı, sonuç sayısı ve alan adı izinleri farklıysa
  yanıt önbelleği ayrılır.
- Güncellik isteyen sorgular da bellek önbelleğini kullanır. Veritabanı
  önbellek okuması 60 ms bütçesini aşarsa arama ilerler; bekleyen okuma sayısı
  sınırlıdır ve aynı anahtarın okumaları birleştirilir.
- Başlatılan sağlayıcıların canlı çağrıları ve son yanıt okumaları paralel başlar.
  Varsayılan `balanced` profilinde keşif bütçesi
  dikey kaynaklarda 600 ms, genel web kaynaklarında 700 ms'dir. Yeterli uygun
  kaynak ve sonuç geldiğinde erken tamamlanır.
- İlk aşamada hiçbir sonuç gelmezse keşfin başlangıcından itibaren en fazla
  1200 ms'lik kurtarma penceresi kullanılır. Kaynak çalışmaları en fazla
  2500 ms sürer; geç gelen işler önbelleği doldurmak için arka planda tamamlanır.
- Varsayılan içerik çıkarımı aramanın başlangıcından itibaren 1400 ms bütçeye sahiptir.
  Tek sayfanın HTTP bütçesi en fazla 1000 ms'dir. Spekülatif indirmeler dahil
  en fazla **5 sayfa** başlatılır; yetişmeyenler snippet ile döner.
- HTTP süre sınırı yönlendirmeler ve yanıt gövdesi boyunca ortaktır.
  Kaynak doğrulama sayfaları veya HTTP hata sayfaları makale diye sunulmaz.
- Eşzamanlı haber yenilemeleri aynı süreçte tek işi paylaşır. ETag / Last-Modified
  koşullu istekleri destekleyen beslemelerde değişmeyen gövde tekrar indirilmez.
  Başarısız yenilemede en fazla bir saatlik son doğrulanmış besleme korunur;
  makalenin yayın tarihi değişmez.
- Gerçek sağlayıcı hataları devre kesiciye kaydedilir. Geçerli ama boş bir
  yanıt hata sayılmaz; birleşik sağlayıcının çalışan alt kaynağı korunur.

Bunlar uygulama içi bekleme bütçeleridir. API'nin toplam `took_ms` değeri kimlik
doğrulama, kredi işlemleri ve çalışma ortamının maliyetlerini de içerir.
İnternet gecikmesi, soğuk başlangıç ve kaynak kapsaması için sabit bir ms
veya sonuç sayısı garantisi yoktur.

### Tekrarlanabilir yerel ölçüm

```bash
npm run benchmark:search
```

Benchmark gerçek arama/önbellek kodunu, kontrollü sağlayıcı ve veritabanı
gecikmeleriyle çalıştırır. Her senaryo beş kez ölçülür; p50, p95, dış çağrı
sayısı ve sonuç sayısı yazdırılır. **Canlı internet veya üretim ölçümü değildir.**

İlk karşılaştırma, Node.js 24 ortamında `e8611d5` ile aynı arama koduna sahip
başlangıç sürümüne karşı alınmıştır:

| Senaryo | Önce p50 | Sonra p50 | Sonuç sayısı |
| --- | ---: | ---: | --- |
| Hızlı sağlayıcılar, önbelleksiz | 26,7 ms | 26,7 ms | 10 → 10 |
| Güncellik önbelleğinin tekrar kullanımı | 60,5 ms | 0,2 ms | 10 → 10 |
| Yavaş veritabanı önbelleği | 326,2 ms | 86,7 ms | 10 → 10 |
| Tüm kaynaklar yavaş | 2402,6 ms | 1201,5 ms | 10 → 9 |

On eşzamanlı aynı sorguda sağlayıcı çağrıları **40'tan 4'e** iner; toplam
100 sonuç korunur. Yavaş kaynak senaryosundaki hızlanmanın bir kısmı, son
kaynağı beklemeyi bırakmaktan gelir: bu örnekte bir sonuç eksiktir. Benchmark
sonuç sayısını bu farkı görünür tutmak için de raporlar.

Ek regresyon senaryosunda sekiz hızlı sağlayıcıdan `balanced` yalnızca dördünü
çağırarak 10 sonuç verir; `deep` sekizini de sorgular. Yirmi eşzamanlı haber
refresh'i 22 besleme için toplam 22 çağrıya birleşir. Bunlar kontrollü I/O
ölçümleridir; üretimdeki kapsamı ve enerji tüketimini temsil etmez.

## Test ve derleme

```bash
npm test
npm run typecheck
npm run build
npm start
```

`npm test` ağ veya gerçek veritabanı kullanmaz. Saf modüller derlenerek test
edilir; entegrasyon testleri gerçek TypeScript modüllerini yükleyip yalnızca
I/O sınırlarını denetimli karşılıklarla değiştirir. Önbellek ayrımı, eşzamanlı
istekler, alan adı filtreleri, güncellik, süre sınırları ve hata toparlanması
bu kapsamda doğrulanır.

Mevcut `build` komutu veritabanı değişkenleri tanımlıysa migration betiğini de
çalıştırır. Migration'ı derlemeden ayrı yönetmek için `npx prisma generate` ve
`npx next build` komutlarını kullanabilirsin. Bir Node.js sunucusunda
`npm start` ile çalıştırmak yeterlidir; belirli bir barındırma hizmeti zorunlu değildir.

`/api/diag/selftest`, yapılandırılmış gizli anahtarla korunan canlı kontrol
ucudur. Unit test değildir; üçüncü taraf erişimini kullandığı için zaman ve
çalıştırma ortamına bağlıdır. Kaynak sağlığı ve bellek önbelleği her süreçte
ayrıdır; çoklu süreçlerde bu durum ortak bir küresel karne değildir.

## Katkı

Yeni arama sağlayıcısı için `lib/search/providers.ts` içindeki `Provider`
sözleşmesini uygula ve uygun sorgu türlerinin listesine ekle. Çıktıların başlık,
URL ve snippet içermeli; yayın tarihi bilinmiyorsa `null` kullan. Gerçek
sağlayıcı hataları ile geçerli boş sonuçları ayır ve süre sınırlarına uy.

Değişiklikle ilgili regresyon testini ekle, `npm test` ve `npm run typecheck`
çalıştır. Performans değiştiriyorsan gecikmenin yanında sonuç sayısını ve dış
istek sayısını da karşılaştır.

## Sınırlar ve lisans

Arama kapsamı açık web indeksleri ve dikey sağlayıcıların birleşimi kadardır.
Sağlayıcı erişimi ve veri koşulları zamanla değişebilir. Dış hizmetlerin
lisansları, projenin kaynak kodu lisansından ayrıdır.

> **Marginalia ve ticari kullanım.** Marginalia'nın herkese açık API'si bu
> projede daha önce **CC-BY-NC-SA 4.0** olarak belgelenmişti: atıf zorunlu ve
> **ticari kullanıma kapalı**. Bu, belirsiz bir ayrıntı değil somut bir kısıt —
> Marginalia iki genel web indeksinden biri, yani açık web katmanının yarısı, ve
> bu depodaki site kredi satıyor. Ücretli trafiği bu kaynağa dayandırmadan önce
> [sağlayıcının API açıklamasını](https://about.marginalia-search.com/article/api/)
> teyit et; koşullar hâlâ ticari kullanıma kapalıysa ya Marginalia ile ayrı bir
> izin konuş, ya `MARGINALIA_API_KEY` ile kendi anlaşmalı anahtarını kullan, ya
> da bu kaynağı ücretsiz kademeyle sınırla.
>
> Kod tabanı yeni API adresine (`api2.marginalia-search.com`) taşındığı için
> koşulların değişmiş olması da mümkün. Bu satır, "değişmiş olabilir" demek
> için değil, neyin doğrulanması gerektiğini isimlendirmek için burada.

URL kontrolleri protokol, alan adı ve özel IP literal kısıtları uygular.
DNS yanıtlarını bağlantıya sabitlemez; güvenilmeyen URL'lerle kamuya açık bir
kurulumda ağ düzeyinde çıkış kısıtları ayrıca uygulanmalıdır.

Kaynak kodu lisansı: [GNU GPL v3](LICENSE).
