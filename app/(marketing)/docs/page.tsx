import Link from "next/link";
import { CREDITS } from "@/lib/constants";

export const metadata = {
  title: "Clouda API dokümantasyonu",
  description: "Search, Deep Research, Browser Agent, Monitoring ve Citations uç noktaları.",
};

const endpoints = [
  {
    method: "POST",
    path: "/api/v1/search",
    capability: "her zaman açık",
    cost: `${CREDITS.search} kredi`,
    summary: "Web araması, içerik çıkarımı ve kalite skorları.",
  },
  {
    method: "POST",
    path: "/api/v1/research",
    capability: "research",
    cost: `${CREDITS.researchBase} + arama başına ${CREDITS.researchPerSearch}`,
    summary: "Soruyu alt sorulara böler, çok turlu araştırır, kaynaklı rapor üretir.",
  },
  {
    method: "POST",
    path: "/api/v1/browse",
    capability: "browse",
    cost: `${CREDITS.browseBase} + adım başına ${CREDITS.browsePerStep}`,
    summary: "Sayfa açar, bağlantı takip eder, sayfalar, sayfa içinde arar.",
  },
  {
    method: "POST",
    path: "/api/v1/answer",
    capability: "citations",
    cost: `${CREDITS.search + CREDITS.citations} kredi`,
    summary: "Soruyu kaynaklı, alıntıya dayalı bir cevaba çevirir.",
  },
  {
    method: "POST",
    path: "/api/v1/extract",
    capability: "her zaman açık",
    cost: `${CREDITS.extractBase} + adres başına ${CREDITS.extractPerUrl}`,
    summary: "Elindeki adresleri temiz, modele hazır metne çevirir.",
  },
  {
    method: "POST",
    path: "/api/v1/social",
    capability: "social",
    cost: `${CREDITS.social} kredi`,
    summary: "Açık sosyal platformlarda ve YouTube'da arar; video adreslerini çözer.",
  },
  {
    method: "POST",
    path: "/api/v1/monitors",
    capability: "monitor",
    cost: `kontrol başına ${CREDITS.monitorCheck}`,
    summary: "URL ya da sorgu izler, değişince webhook gönderir.",
  },
  {
    method: "GET",
    path: "/api/v1/usage",
    capability: "her zaman açık",
    cost: "ücretsiz",
    summary: "Kullanım, maliyet ve performans metrikleri.",
  },
];

const errorCodes = [
  ["missing_api_key", "401", "Authorization başlığı yok"],
  ["invalid_api_key", "401", "Anahtar tanınmadı"],
  ["capability_not_enabled", "403", "Bu anahtarda ilgili özellik kapalı"],
  ["insufficient_credits", "402", "Hesap bakiyesi yetersiz"],
  ["credit_cap_reached", "402", "Anahtarın kredi tavanına ulaşıldı"],
  ["rate_limited", "429", "Dakikalık istek sınırı aşıldı"],
  ["blocked_url", "403", "Özel ağ ya da yasaklı hedef"],
  ["domain_not_allowed", "403", "Anahtarın alan adı politikasına takıldı"],
  ["captcha_encountered", "502", "Kaynak bot doğrulaması istedi"],
  ["fetch_timeout", "504", "Kaynak zamanında yanıt vermedi"],
  ["provider_failed", "502", "Arama sağlayıcısı yanıt vermedi"],
];

function Section({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-clouda-border pt-12">
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-card border border-clouda-border bg-white p-5 font-mono text-[13px] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-[1000px] px-6 py-16">
      <p className="eyebrow">dokümantasyon</p>
      <h1 className="display mt-6 text-[40px] sm:text-5xl">AI Web Intelligence API</h1>
      <p className="prose-serif mt-6 max-w-2xl">
        Tek bir kimlik doğrulama, tek bir hata sözlüğü, tutarlı JSON. Web araması her anahtarda
        açıktır; derin araştırma, tarayıcı ajanı, izleme ve alıntı doğrulama özelliklerini anahtar
        bazında sen seçersin.
      </p>

      <div className="mt-10 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-clouda-border">
              <th className="eyebrow-plain pb-3">Uç nokta</th>
              <th className="eyebrow-plain pb-3">Özellik</th>
              <th className="eyebrow-plain pb-3">Maliyet</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((e) => (
              <tr key={e.path} className="border-b border-clouda-border align-top last:border-0">
                <td className="py-3.5 pr-4">
                  <code className="font-mono text-clouda-ink">
                    <span className="text-clouda-indigo">{e.method}</span> {e.path}
                  </code>
                  <p className="mt-1 text-clouda-muted">{e.summary}</p>
                </td>
                <td className="py-3.5 pr-4 font-mono text-xs text-clouda-muted">{e.capability}</td>
                <td className="py-3.5 pr-4 text-xs text-clouda-muted">{e.cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-16 space-y-16">
        <Section id="auth">
          <h2 className="display text-3xl">Kimlik doğrulama</h2>
          <p className="mt-4 text-clouda-muted">
            Her istek panelden oluşturduğun anahtarı taşır. Anahtar yalnızca oluşturulurken bir kez
            gösterilir; sunucuda SHA-256 özeti saklanır.
          </p>
          <Code>{`Authorization: Bearer cld_live_xxxxxxxx
Content-Type: application/json`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            Yanıt başlıklarında <code className="font-mono">X-Clouda-Credits-Remaining</code> ve{" "}
            <code className="font-mono">X-Clouda-RateLimit-Limit</code> döner.
          </p>
        </Section>

        <Section id="search">
          <h2 className="display text-3xl">Search</h2>
          <p className="mt-4 text-clouda-muted">
            Sorguyu analiz eder, uygun sağlayıcıyı seçer, sonuç sayfalarını okur ve her sonuca
            kalite skorları ekler.
          </p>
          <Code>{`POST /api/v1/search

{
  "query": "vektör veritabanı karşılaştırması",
  "max_results": 5,          // 1-30, varsayılan 10
  "locale": "tr-TR",         // varsayılan tr-TR
  "freshness": "week",       // hour | day | week | month | year | saat sayısı
  "include_content": true,   // sayfa metni çıkarılsın mı
  "no_cache": false,         // cache'i tamamen atla
  "mode": "results"          // results | sources | claims
}`}</Code>
          <Code>{`{
  "query": "vektör veritabanı karşılaştırması",
  "mode": "results",
  "intent": "product",
  "freshness_applied": true,
  "provider": "marginalia+wikipedia+stackexchange",
  "cached": false,
  "results": [
    {
      "title": "…",
      "url": "https://…",
      "snippet": "…",
      "content": "Sayfadan çıkarılan okunabilir metin…",
      "published_at": "2026-08-21T09:14:00.000Z",
      "updated_at": null,
      "source": "marginalia+wikipedia+stackexchange",
      "scores": {
        "relevance": 0.82,
        "credibility": 0.78,
        "freshness": 0.64,
        "overall": 0.76,
        "signals": ["referans", "dolu-içerik"]
      }
    }
  ],
  "credits_used": 2,
  "credits_remaining": 1998,
  "took_ms": 842
}`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            <strong className="font-medium text-clouda-ink">Modlar.</strong>{" "}
            <code className="font-mono">sources</code> yalnızca bağlantı ve skorları döner (sayfa
            indirilmez, daha hızlıdır). <code className="font-mono">claims</code> sonuçlardan iddia
            çıkarır ve kaynaklarla eşler — <code className="font-mono">citations</code> özelliği
            gerektirir.
          </p>
        </Section>

        <Section id="scoring">
          <h2 className="display text-3xl">Kalite skorları</h2>
          <p className="mt-4 text-clouda-muted">
            Dört skor da 0-1 aralığındadır. Amaç, modelin sıralamaya körü körüne güvenmek yerine
            neye dayanacağını seçebilmesi.
          </p>
          <div className="mt-6 space-y-5">
            {[
              {
                name: "relevance",
                body: "Sorgu terimlerinin başlık, özet ve içerikteki kapsanma oranı. Başlık en yüksek ağırlığa sahiptir; tam ifade eşleşmesi ayrıca puan ekler.",
              },
              {
                name: "credibility",
                body: "Alan adının sınıfı (birincil kaynak, akademik, resmi dokümantasyon, kurumsal haber, referans, topluluk, bilinmeyen) sayfa sinyalleriyle düzeltilir: HTTPS yokluğu düşürür, çıkarılabilen dolu içerik yükseltir, aynı iddiayı bağımsız kaynakların desteklemesi yükseltir.",
              },
              {
                name: "freshness",
                body: "İçeriğin yaşına göre üstel azalma. Yarılanma süresi konuya göre değişir: haberde 24 saat, finansta 12 saat, teknik içerikte 180 gün. Tarih bilinmiyorsa 0.5 döner — eski varsayılmaz.",
              },
              {
                name: "overall",
                body: "Üçünün ağırlıklı ortalaması. Ağırlıklar sorgu türüne göre değişir: haber sorgusunda tazelik, akademik sorguda güvenilirlik baskındır.",
              },
            ].map((s) => (
              <div key={s.name} className="flex gap-3">
                <span className="mt-2 block h-2 w-2 shrink-0 bg-clouda-indigo" />
                <div>
                  <code className="font-mono text-sm text-clouda-ink">{s.name}</code>
                  <p className="mt-1 text-sm leading-relaxed text-clouda-muted">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section id="research">
          <h2 className="display text-3xl">Deep Research</h2>
          <p className="mt-4 text-clouda-muted">
            Soruyu alt sorulara böler, her biri için arama yapar, kaynakları okur, zayıf kalan
            açılar için yeni tur arama yapar ve kaynaklı bir rapor döner.
          </p>
          <Code>{`POST /api/v1/research

{
  "question": "Vektör veritabanları 2026'da nasıl konumlanıyor?",
  "depth": "standard",       // quick | standard | deep
  "max_sources": 12,         // 3-40
  "max_duration_ms": 60000,  // 5000-120000
  "freshness": "month"
}`}</Code>
          <Code>{`{
  "research_id": "…",
  "plan": ["…alt soru 1", "…alt soru 2"],
  "summary": "En iyi desteklenen bulgulardan derlenen özet.",
  "sections": [
    { "subQuestion": "…", "summary": "…", "findings": [ /* claim */ ], "sourceUrls": ["…"] }
  ],
  "key_findings": [
    {
      "id": "claim_1",
      "text": "Kaynakta birebir geçen cümle.",
      "citations": [{ "url": "…", "quote": "…", "credibility": 0.9 }],
      "conflicts": [],
      "independentSources": 3,
      "confidence": 0.82,
      "basis": ["3 bağımsız kaynak", "ortalama güvenilirlik 0.86"]
    }
  ],
  "conflicts": [ /* kaynakların çeliştiği iddialar */ ],
  "sources": [{ "url": "…", "credibility": 0.9, "usedFor": ["…"] }],
  "gaps": ["… için doğrulanabilir kaynak bulunamadı."],
  "stats": { "searches": 6, "sourcesExamined": 12, "rounds": 2, "budgetExhausted": false }
}`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            Derinlik profilleri: <code className="font-mono">quick</code> 1 tur / 3 alt soru,{" "}
            <code className="font-mono">standard</code> 2 tur / 5 alt soru,{" "}
            <code className="font-mono">deep</code> 3 tur / 8 alt soru. Bütçe üç eksende birden
            sınırlanır — tur, kaynak ve süre — ve hangisi önce dolarsa rapor{" "}
            <code className="font-mono">budgetExhausted</code> ile döner.
          </p>
        </Section>

        <Section id="citations">
          <h2 className="display text-3xl">Citations ve doğrulama</h2>
          <p className="mt-4 text-clouda-muted">
            İddialar üretilmez, çıkarılır: her <code className="font-mono">claim.text</code>{" "}
            kaynakta birebir geçen bir cümledir, dolayısıyla alıntı her zaman gerçekten var olan
            bir metni gösterir.
          </p>
          <p className="mt-4 text-clouda-muted">
            Aynı şeyi söyleyen cümleler tek iddiada gruplanır; grubu destekleyen{" "}
            <em>farklı alan adı</em> sayısı bağımsız destek olarak sayılır. Aynı konuda farklı sayı
            veren ya da birbirini olumsuzlayan cümleler çelişki olarak işaretlenir.{" "}
            <code className="font-mono">confidence</code>, bağımsız destekle doyuma ulaşan bir
            eğriden gelir, kaynak güvenilirliğiyle ölçeklenir ve her çelişki için düşürülür.
          </p>
        </Section>

        <Section id="browse">
          <h2 className="display text-3xl">Browser Agent</h2>
          <p className="mt-4 text-clouda-muted">
            Adım adım gezinme. Her adım aynı SSRF ve alan adı politikasından geçer, adım sınırına
            sayılır ve dönen <code className="font-mono">trace</code> içinde loglanır.
          </p>
          <Code>{`POST /api/v1/browse

{
  "actions": [
    { "type": "open", "url": "https://ornek.com/urunler" },
    { "type": "find", "query": "fiyat" },
    { "type": "paginate", "pages": 2 },
    { "type": "follow", "linkText": "detaylar" },
    { "type": "extract" }
  ],
  "max_steps": 8,            // 1-20
  "max_duration_ms": 45000
}`}</Code>
          <p className="mt-4 text-sm leading-relaxed text-clouda-muted">
            <strong className="font-medium text-clouda-ink">Sınırlar, açıkça.</strong> Arkada
            headless tarayıcı yoktur: JavaScript çalıştırılmaz, bu yüzden içeriği yalnızca istemci
            tarafında oluşan sayfalarda yanıt{" "}
            <code className="font-mono">warning: javascript_required</code> ile döner.{" "}
            <code className="font-mono">submit</code> yalnızca GET sorgu parametresi ekler — durum
            değiştiren POST gönderimi bilinçli olarak desteklenmez, çünkü otonom bir ajanın bu API
            üzerinden satın alma ya da gönderi yapabilmesi istenmez.
          </p>
        </Section>

        <Section id="answer">
          <h2 className="display text-3xl">Answer</h2>
          <p className="mt-4 text-clouda-muted">
            Soru soran bir ajan genelde cevabı ister; kendisinin getirip okuyup
            karşılaştırması gereken bir sonuç listesini değil. Bu uç nokta o gidiş
            dönüşü sunucu tarafında yapar: arar, içeriği çıkarır, birden fazla bağımsız
            kaynağın aynı şekilde ifade ettiği cümleleri gruplar ve ne kadar
            desteklendiklerine göre sıralayıp döner.
          </p>
          <p className="mt-4 text-clouda-muted">
            Cevap bilerek <strong className="font-medium text-clouda-ink">alıntıya
            dayalıdır</strong>: dönen her cümle bir kaynaktan birebir alınmıştır ve
            geldiği URL&apos;yi taşır. Yani buradan uydurma bir bilgi çıkamaz — kötü
            senaryo işe yaramayan bir cevaptır, uydurulmuş bir cevap değil. Kaynaklar
            çelişiyorsa çelişki çözülmez, olduğu gibi döndürülür; hangisinin doğru
            olduğuna karar vermek çağıranın işidir.
          </p>
          <Code>{`POST /api/v1/answer

{
  "query": "postgres index bloat neden olur",
  "max_sentences": 4,
  "max_sources": 8
}`}</Code>
          <Code>{`{
  "answered": true,
  "answer": [
    {
      "text": "…",
      "confidence": 0.71,
      "independent_sources": 3,
      "basis": ["3 bağımsız kaynak", "yüksek güvenilirlik"],
      "citations": [{ "url": "…", "title": "…", "quote": "…" }]
    }
  ],
  "contested": 0,
  "sources": [{ "title": "…", "url": "…", "credibility": 0.85 }]
}`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            Yeterince desteklenen bir cümle bulunamazsa{" "}
            <code className="font-mono">answered: false</code> döner ve sebebi belirtilir;
            kaynaklar yine döndürülür. Dürüst bir &quot;bilmiyorum&quot;, kendinden emin
            bir tahminden iyidir. <code className="font-mono">citations</code> özelliği
            açık bir anahtar gerekir.
          </p>
        </Section>

        <Section id="extract">
          <h2 className="display text-3xl">Extract</h2>
          <p className="mt-4 text-clouda-muted">
            Arama &quot;ne okumalıyım&quot; sorusunu cevaplar; bu uç nokta &quot;bu sayfa ne
            diyor&quot; sorusunu. Adresleri zaten başka bir yerden aldıysan, menüyü, çerez
            uyarısını ve altbilgiyi ayıklayıp geriye okunabilir metni bırakır. Her adres
            platformun geri kalanıyla aynı SSRF politikasından geçer.
          </p>
          <Code>{`POST /api/v1/extract

{
  "urls": ["https://ornek.com/makale"],  // tek adres için "url" da olur, en fazla 10
  "max_chars": 4000
}`}</Code>
          <Code>{`{
  "pages": [
    {
      "url": "https://ornek.com/makale",
      "ok": true,
      "title": "…",
      "content": "…",
      "published_at": "2026-08-20T09:00:00.000Z",
      "truncated": false
    }
  ],
  "requested": 1,
  "extracted": 1
}`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            Okunamayan sayfa <code className="font-mono">ok: false</code> ile döner ve
            ücretlendirilmez; yalnızca gerçekten çıkarılan sayfalar için kredi düşer.
          </p>
        </Section>

        <Section id="social">
          <h2 className="display text-3xl">Social &amp; Video</h2>
          <p className="mt-4 text-clouda-muted">
            İki mod var. <code className="font-mono">query</code> ile açık sosyal
            platformlarda arar; <code className="font-mono">video_urls</code> ile elindeki
            video adreslerinin başlık, kanal ve küçük resim bilgisini döner.
          </p>
          <Code>{`POST /api/v1/social

{
  "query": "kubernetes",
  "platforms": ["mastodon", "lemmy", "youtube"],   // varsayılan: hepsi
  "limit": 10
}`}</Code>
          <Code>{`// video modu
{
  "video_urls": ["https://www.youtube.com/watch?v=..."]
}`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            <strong className="font-medium text-clouda-ink">Neyin olmadığı da sözleşmenin
            parçası.</strong> X, Instagram, Facebook ve Reddit burada yok — hesap ya da
            ücretli anahtar olmadan erişilemiyorlar. Ölçüm sonuçları: Reddit RSS görünümü
            dahil anonim datacenter trafiğine 403, Bluesky&apos;ın herkese açık AppView&apos;u
            403, YouTube kanal beslemeleri 404, Nitter ise kapanmış. Hiç cevap vermeyen bir
            kaynağı listelemek her isteğe sadece zaman aşımı ekler.
          </p>
          <p className="mt-4 text-sm text-clouda-muted">
            <strong className="font-medium text-clouda-ink">Transkript yok.</strong> Video
            sonuçları başlık, kanal ve küçük resim taşır ama altyazı taşımaz: YouTube
            caption track&apos;lerini artık anonim datacenter isteklerine sunmuyor. Yanıtta{" "}
            <code className="font-mono">transcript_available: false</code> olarak açıkça
            belirtilir — tahmin etmen gerekmez.
          </p>
        </Section>

        <Section id="monitoring">
          <h2 className="display text-3xl">Monitoring</h2>
          <p className="mt-4 text-clouda-muted">
            Bir URL&apos;yi ya da bir arama sorgusunu izler. Değişiklik, ham HTML üzerinde değil
            çıkarılmış metin üzerinde hesaplanır; böylece dönen reklam ya da oturum jetonu
            &quot;değişiklik&quot; sayılmaz.
          </p>
          <Code>{`POST /api/v1/monitors

{
  "type": "url",                       // url | query
  "target": "https://ornek.com/fiyat",
  "webhook_url": "https://seninapp.com/hooks/clouda",
  "interval_minutes": 60               // 15-1440
}`}</Code>
          <Code>{`// webhook gövdesi
{
  "event": "monitor.changed",
  "monitor_id": "…",
  "change_type": "content_changed",    // content_changed | new_results | unreachable
  "summary": "Fiyat değişti: 1.299 TL → 1.149 TL",
  "target": "https://ornek.com/fiyat",
  "occurred_at": "2026-08-31T18:00:00.000Z",
  "data": { "previousPrices": ["1.299 TL"], "currentPrices": ["1.149 TL"] }
}`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            <strong className="font-medium text-clouda-ink">Webhook doğrulama.</strong> Her çağrı{" "}
            <code className="font-mono">X-Clouda-Signature: v1=&lt;hex&gt;</code> ve{" "}
            <code className="font-mono">X-Clouda-Timestamp</code> başlıklarıyla gelir. İmza,
            anahtarı oluştururken bir kez gösterilen <code className="font-mono">webhookSecret</code>{" "}
            ile <code className="font-mono">HMAC-SHA256(&quot;&lt;timestamp&gt;.&lt;gövde&gt;&quot;)</code>{" "}
            olarak hesaplanır. Doğrulamadan hiçbir çağrıya güvenme: imzasız bir webhook, adresi
            öğrenen herkesin sisteminize sahte bildirim gönderebileceği açık bir uçtur.
          </p>
          <Code>{`// Node ile doğrulama
import { createHmac, timingSafeEqual } from "crypto";

const expected = "v1=" + createHmac("sha256", process.env.CLOUDA_WEBHOOK_SECRET)
  .update(req.headers["x-clouda-timestamp"] + "." + rawBody)
  .digest("hex");

const a = Buffer.from(expected);
const b = Buffer.from(req.headers["x-clouda-signature"]);
const valid = a.length === b.length && timingSafeEqual(a, b);

// Tekrar saldırısını kes: 5 dakikadan eski çağrıyı reddet.
const fresh = Math.abs(Date.now() / 1000 - Number(req.headers["x-clouda-timestamp"])) < 300;`}</Code>
          <p className="mt-4 text-sm text-clouda-muted">
            <code className="font-mono">GET /api/v1/monitors</code> izleyicileri ve son olayları
            listeler, <code className="font-mono">DELETE /api/v1/monitors/&#123;id&#125;</code>{" "}
            durdurur. Kredisi biten hesabın izleyicileri hata döngüsüne girmek yerine
            duraklatılır.
          </p>
          <p className="mt-4 text-sm text-clouda-muted">
            <strong className="font-medium text-clouda-ink">Kontrol sıklığı.</strong> Zamanlanmış
            sweep <code className="font-mono">/api/cron/monitors</code> üzerinden çalışır. Vercel
            Hobby planı günde bir defadan sık cron çalıştırmaya izin vermediği için varsayılan
            zamanlama günlüktür; daha sık kontrol için Pro plana geçmek ya da bu uç noktayı harici
            bir zamanlayıcıyla (<code className="font-mono">Authorization: Bearer $CRON_SECRET</code>{" "}
            ile) çağırmak gerekir. <code className="font-mono">interval_minutes</code> sweep'ten
            daha sık kontrol edilmesini sağlamaz; yalnızca bir izleyicinin ne kadar sıklıkla
            kontrol edilmeye hak kazandığını belirler.
          </p>
        </Section>

        <Section id="reliability">
          <h2 className="display text-3xl">Güvenilirlik ve fallback</h2>
          <p className="mt-4 text-clouda-muted">
            Kaynaklar sırayla değil <strong className="font-medium text-clouda-ink">paralel</strong>{" "}
            sorgulanır ve sıralamaları reciprocal rank fusion ile birleştirilir; birden fazla
            indeksin bağımsız olarak öne çıkardığı sayfa yukarı taşınır. Ödemeli sağlayıcı yoktur,
            anahtar gerekmez.
          </p>
          <p className="mt-4 text-clouda-muted">
            Açık web&apos;i iki bağımsız indeks karşılar (Marginalia ve mwmbl), geri kalanı dikey
            kaynaklardır. İki indeks var çünkü her biri tek başına kararsız: ölçümde Marginalia bir
            sorguyu 202 ms&apos;de yanıtladı, dakikalar sonra aynısını 12 saniyede yanıtlayamadı.
            Bir kaynak cevap vermezse o sorgu için <em>son bilinen yanıtı</em> devreye girer ve
            yanıtta bayat olduğu açıkça işaretlenir.
          </p>
          <p className="mt-4 text-clouda-muted">
            Cevap vermeyen ya da süreyi kaçıran kaynaklar yanıtta{" "}
            <code className="font-mono">degraded_providers</code> altında görünür — sessizce
            yutulmaz. Süreyi kaçıran kaynak iptal edilmez: arka planda tamamlanıp önbelleğe yazar,
            böylece bir sonraki isteğe yetişir.
          </p>
          <p className="mt-4 text-clouda-muted">
            Cache, sorgunun normalize edilmiş hâline göre çalışır ve tazelik penceresi cache
            sözleşmesinin parçasıdır: &quot;son 1 saat&quot; isteyen bir çağrıya bir gün önce
            üretilmiş satır asla dönmez. TTL konuya göre değişir — haberde 5 dakika, teknik
            içerikte 24 saat.
          </p>
        </Section>

        <Section id="security">
          <h2 className="display text-3xl">Güvenlik</h2>
          <ul className="mt-4 space-y-3">
            {[
              "Tüm giden istekler SSRF kontrolünden geçer: özel ağ aralıkları, loopback, link-local ve bulut metadata adresleri reddedilir.",
              "Yönlendirmeler elle takip edilir; her hedef yeniden politikadan geçirilir, böylece açık yönlendirmeyle iç ağa sızılamaz.",
              "Anahtar bazında izinli/yasaklı alan adı listesi tanımlanabilir; tarayıcı ajanı ve izleyiciler bu listeye uyar.",
              "Her isteğe zaman aşımı, boyut sınırı ve adım sınırı uygulanır.",
              "Kullanıcı bilgisi taşıyan URL'ler ve http/https dışındaki şemalar reddedilir.",
              "Anahtarlar hash'lenmiş saklanır, kullanıcı verisi anahtar bazında izole edilir.",
            ].map((item) => (
              <li key={item} className="flex gap-3 text-sm leading-relaxed text-clouda-muted">
                <span className="mt-1.5 block h-2 w-2 shrink-0 bg-clouda-indigo" />
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="errors">
          <h2 className="display text-3xl">Hata kodları</h2>
          <p className="mt-4 text-clouda-muted">
            Hatalar tek bir zarf içinde döner. <code className="font-mono">retryable</code> alanı,
            aynı isteğin kısa bir beklemeden sonra tekrar denenmeye değer olup olmadığını söyler.
          </p>
          <Code>{`{
  "error": "rate_limited",
  "message": "Dakikada 60 istek sınırını aştın.",
  "retryable": true,
  "details": { "limit": 60, "windowSeconds": 60 }
}`}</Code>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-clouda-border">
                  <th className="eyebrow-plain pb-3">Kod</th>
                  <th className="eyebrow-plain pb-3">HTTP</th>
                  <th className="eyebrow-plain pb-3">Anlamı</th>
                </tr>
              </thead>
              <tbody>
                {errorCodes.map(([code, status, meaning]) => (
                  <tr key={code} className="border-b border-clouda-border last:border-0">
                    <td className="py-3 pr-4 font-mono text-xs text-clouda-indigo">{code}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-clouda-muted">{status}</td>
                    <td className="py-3 pr-4 text-clouda-muted">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="usage">
          <h2 className="display text-3xl">Kullanım ve gözlemlenebilirlik</h2>
          <Code>{`GET /api/v1/usage?hours=24

{
  "key": { "capabilities": ["research"], "rate_limit_per_min": 60, "credits_spent": 320 },
  "credits_remaining": 1680,
  "totals": { "requests": 42, "credits": 320, "errors": 1, "cacheHits": 11 },
  "by_operation": { "search": { "requests": 38, "credits": 240, "avgLatencyMs": 910 } },
  "provider_success_rate": { "marginalia": { "calls": 38, "successRate": 0.974 } },
  "cache_hit_rate": 0.262,
  "error_rate": 0.024,
  "latency_ms": { "p50": 780, "p95": 2140 }
}`}</Code>
        </Section>
      </div>

      <div className="mt-16 border-t border-clouda-border pt-10">
        <h2 className="display text-3xl">Başlamaya hazır mısın?</h2>
        <p className="mt-4 text-clouda-muted">
          Kayıt ol, panelden anahtarını oluştur ve istediğin özellikleri seç.
        </p>
        <Link href="/signup" className="btn-dark mt-6">
          Ücretsiz başla
        </Link>
      </div>
    </div>
  );
}
