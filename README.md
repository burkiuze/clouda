<img src="public/clouda-north.webp" alt="Clouda North" width="100%">

<p align="center">
  <a href="LICENSE"><img alt="Lisans: GPL v3" src="https://img.shields.io/badge/lisans-GPL%20v3-2563eb"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%20%7C%2024-2563eb">
  <img alt="54 test" src="https://img.shields.io/badge/test-54%20geçiyor-16a34a">
  <img alt="Sürüm 0.2.0" src="https://img.shields.io/badge/sürüm-0.2.0%20North-6366f1">
</p>

Yapay zeka modelleri ve ajanları için **açık kaynak web yetenekleri**. Web arama,
sayfa okuma, kaynaklı yanıt, araştırma, belge sıralama ve metin parçalama
araçlarını aynı kod tabanında birleştirir.

**Kendi makinende çalışır.** Hesap yok, API anahtarı yok, kredi yok, kota yok,
veritabanı yok. Klonla, `npm ci`, `npm run dev` — ve aramaya başla. Ajanına
REST ya da MCP üzerinden bağla.

```bash
git clone https://github.com/burkiuze/clouda.git
cd clouda && npm ci && npm run dev
```

Clouda bir model eğitmez; modele dış dünyadan bilgi getiren ve bu bilgiyi
kullanılabilir biçime dönüştüren araçlar sağlar.

### Ne değildir

Bunları peşinen söylemek, sonradan hayal kırıklığı yaşamandan iyidir.

- **Google'ın indeksi değildir.** Kapsam, açık web indeksleri artı dikey
  kaynakların birleşimi kadardır. Datacenter IP'lerine açık, her şeyi gören
  ücretsiz bir arama kaynağı yok; olsaydı burada olurdu.
- **Barındırılan bir hizmet değildir.** Ortada satılan bir API yok; bu depo,
  kendi sunucunda çalıştırdığın kodu verir. Belirli bir barındırma
  sağlayıcısına bağlı değildir; `npm start` ile herhangi bir Node.js
  sunucusunda çalışır.
- **Çok kullanıcılı değildir.** Kimlik doğrulama, kota ve kullanım muhasebesi
  bilinçli olarak yoktur. Bunu bir ekibe hizmet olarak sunacaksan o katmanı
  önüne kendin koyman gerekir.
- **Cevapları üretmez, alıntılar.** `/api/v1/answer` her cümleyi kaynağından
  birebir alır. Başarısızlık biçimi "işe yaramaz cevap"tır, "uydurulmuş cevap"
  değil.
- **Sıfır bağımlılıklı bir kütüphane değildir.** Next.js uygulaması olarak
  gelir. Ama çalışma zamanı bağımlılığı dörttür — `next`, `react`,
  `react-dom`, `cheerio` — ve `lib/` altındaki modülleri kendi projene
  doğrudan alabilirsin.

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
| MCP araçları | `lib/mcp/tools.ts` | `POST /api/mcp` |
| Makine tarafından okunabilir API şeması | `app/api/v1/openapi/` | `GET /api/v1/openapi` |

## Kod yapısı

- `lib/search/`: sağlayıcılar, keşif motoru, içerik çıkarımı, haber derlemi.
- `lib/rank/`: BM25 sıralama ve yapı korumalı parçalama. Ağ kullanmaz.
- `lib/data/`, `lib/crawl/`, `lib/research/`, `lib/social/`: canlı veri, site
  haritası, çok turlu araştırma, sosyal kaynaklar.
- `lib/core/`: ortak HTTP, önbellek, süre sınırları, hata türleri, devre kesici.
- `lib/mcp/`: MCP araç tanımları.
- `app/api/`: REST ve MCP arayüzleri.
- `app/` ve `components/`: yerel web arayüzü.
- `tests/`: sıralama, arama, önbellek, HTTP ve hata davranışını doğrulayan testler.

TypeScript, Next.js 15, React 19 ve Cheerio. Çalışma zamanı bağımlılığı dört
pakettir. Önbellek, kaynak sağlığı ve sayaçlar sürecin belleğindedir —
veritabanı yoktur, dolayısıyla yeniden başlatınca sıfırlanırlar. Bu, tek
süreçlik bir araç için doğru takas: soğuk başlangıç bir yavaş aramaya mal
olur, PostgreSQL şartı ise ilk aramadan önce bir kuruluma.

Bu depo henüz bağımsız yayımlanmış bir npm SDK'sı değildir, ama `lib/`
altındaki modülleri kendi projene doğrudan alabilirsin.

## Kurulum

Node.js 22 veya 24 ve npm. Başka hiçbir şey.

```bash
git clone https://github.com/burkiuze/clouda.git
cd clouda
npm ci
npm run dev
```

`http://localhost:3000` açılır ve ana sayfadaki kutu doğrudan çalışır. Yapılandırma
dosyası oluşturman gerekmez; `.env.example` içindeki her değişken bir şeyi açar ya
da davranışı değiştirir, hiçbiri kurulum şartı değildir.

Üretim için `npm run build && npm start`. Belirli bir barındırma hizmeti gerekmez.

## API kullanımı

Kimlik doğrulama yoktur. Kendi makinende çalışan bir araçla aranda tören olmasının
bir anlamı yok.

```bash
curl http://localhost:3000/api/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"postgres index bloat","search_depth":"fast"}'
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
| `mode: "claims"` | Sonuçlardan iddia çıkarır ve kaynaklarla eşler. |

### Sorguya link koyabilirsin

Bir adres yapıştırdığında onu aramaz, **okur**. Sayfa getirilir, metni çıkarılır
ve sonuçların başına konur.

```bash
# Yalnızca link: arama yapılmaz, sadece o sayfa okunur.
-d '{"query":"https://docs.python.org/3/library/asyncio.html"}'

# Link + soru: hem sayfa okunur hem soru aranır, sayfa başa gelir.
-d '{"query":"https://example.com/post bu ne diyor"}'
```

Şemasız adresler de tanınır (`wikipedia.org`, `www.bbc.co.uk/news`), ama yalnızca
insanların gerçekten girdiği uzantılarda — `node.js` ve `package.json` arama
terimi olarak kalır, çünkü yanlış tahmin aramayı başarısız bir indirmeye çevirir.

Okunamayan bir adres yine de sonuçlarda görünür, sebebiyle birlikte: yapıştırılan
bir linki sessizce düşürmek, aracın kullanıcıyı yok sayması gibi görünür. Adresler
her uçtaki SSRF kontrollerinden geçer — özel ağ adresleri reddedilir.

Tarihi bilinmeyen bir sonuç güncel olduğu iddiasıyla etiketlenmez; tarih alanı
`null` kalır. `degraded_providers`, yanıt vermeyen veya son kayıtlı yanıtıyla
kullanılan kaynakları açıklar. Tam şema `/api/v1/openapi` ve `/docs` adreslerinde.

### Ağa açarsan

`CLOUDA_TOKEN` tanımla. O andan itibaren her uç `Authorization: Bearer <token>`
ister — REST de MCP de. Tanımlı değilken sunucu kendisine ulaşabilen herkese
yanıt verir, ki localhost'ta o kişi sensin; 0.0.0.0'a bağladığın anda değildir.

### MCP

Ajan istemcini `http://localhost:3000/api/mcp` adresine bağla:

```json
{
  "mcpServers": {
    "clouda": { "type": "http", "url": "http://localhost:3000/api/mcp" }
  }
}
```

Sekiz araç: `clouda_search`, `clouda_news`, `clouda_extract`, `clouda_answer`,
`clouda_data`, `clouda_map`, `clouda_rerank`, `clouda_chunk`. Şemaları
`tools/list` yanıtından keşfedilir; uygulamaları `lib/mcp/tools.ts` içinde.

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

Bunlar uygulama içi bekleme bütçeleridir; yanıttaki `took_ms` çalışma ortamının
kendi maliyetlerini de içerir. İnternet gecikmesi, soğuk başlangıç ve kaynak
kapsaması için sabit bir ms ya da sonuç sayısı garantisi yoktur.

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

`npm test` ağ kullanmaz. Saf modüller derlenerek test
edilir; entegrasyon testleri gerçek TypeScript modüllerini yükleyip yalnızca
I/O sınırlarını denetimli karşılıklarla değiştirir. Önbellek ayrımı, eşzamanlı
istekler, alan adı filtreleri, güncellik, süre sınırları ve hata toparlanması
bu kapsamda doğrulanır.

`npm run build && npm start` bir Node.js sunucusunda çalışmak için yeterlidir;
belirli bir barındırma hizmeti zorunlu değildir.

`/api/diag/selftest`, `DIAG_TOKEN` ile korunan canlı kontrol ucudur.
**Varsayılan bir token yoktur**: değişken tanımlı değilse uç 404 döner. Çağrı
başına yaklaşık otuz üçüncü tarafa istek yapar, dolayısıyla herkese açık bir
depodaki sabit bir token savunma değil savunma görüntüsü olurdu.

Unit test değildir; üçüncü taraf erişimini kullandığı için zaman ve çalıştırma
ortamına bağlıdır. Kaynak sağlığı ve bellek önbelleği her süreçte ayrıdır;
çoklu süreçlerde bu ortak bir küresel karne değildir.

## Katkı

Tek bir kural diğerlerinden önce gelir: **tahmin etme, ölç.** Buradaki kaynak
listesi itibara göre değil, dağıtımın kendi çıkış IP'sinden yapılan ölçümle
seçildi — ve elenenlerin hiçbiri kendi belgelerinde "çalışmıyor" yazmıyordu.

Yeni sağlayıcı eklemek, test yazmak ve değişiklik göndermek için
[CONTRIBUTING.md](CONTRIBUTING.md). Güvenlik açığı bildirimi için
[SECURITY.md](SECURITY.md) — herkese açık issue açma.

## Sınırlar ve lisans

Arama kapsamı açık web indeksleri ve dikey sağlayıcıların birleşimi kadardır.
Sağlayıcı erişimi ve veri koşulları zamanla değişebilir. Dış hizmetlerin
lisansları, projenin kaynak kodu lisansından ayrıdır.

> **Marginalia ve ticari kullanım.** Marginalia'nın herkese açık API'si bu
> projede daha önce **CC-BY-NC-SA 4.0** olarak belgelenmişti: atıf zorunlu ve
> **ticari kullanıma kapalı**. Kendin için çalıştırıyorsan bu seni bağlamaz.
> Ama Marginalia iki genel web indeksinden biri — açık web katmanının yarısı —
> ve bu kodu ticari bir işin parçası yaparsan kısıt seni bulur. O noktada
> [sağlayıcının API açıklamasını](https://about.marginalia-search.com/article/api/)
> teyit et; koşullar hâlâ ticari kullanıma kapalıysa ya Marginalia ile ayrı bir
> izin konuş, ya `MARGINALIA_API_KEY` ile kendi anlaşmalı anahtarını kullan, ya
> da o kaynağı devre dışı bırak.
>
> Kod tabanı yeni API adresine (`api2.marginalia-search.com`) taşındığı için
> koşulların değişmiş olması da mümkün. Bu satır, "değişmiş olabilir" demek
> için değil, neyin doğrulanması gerektiğini isimlendirmek için burada.

URL kontrolleri protokol, alan adı ve özel IP literal kısıtları uygular.
DNS yanıtlarını bağlantıya sabitlemez; güvenilmeyen URL'lerle kamuya açık bir
kurulumda ağ düzeyinde çıkış kısıtları ayrıca uygulanmalıdır.

Kaynak kodu lisansı: [GNU GPL v3](LICENSE).
