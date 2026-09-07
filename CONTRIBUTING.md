# Katkı

Bu projede tek bir kural diğerlerinden önce gelir: **tahmin etme, ölç.**

Buradaki kaynak listesi itibara göre değil, dağıtımın kendi çıkış IP'sinden
yapılan ölçümle seçildi. DuckDuckGo'nun HTML ucu bot kontrol sayfası veriyor;
Mojeek, Reddit ve Lobsters 403 dönüyor; GDELT on saniyede yanıt vermiyor;
Stack Exchange sayfaları 160 ms'de sıfır karakter döndürüyor. Bunların hiçbiri
belgelerinde yazmıyordu. Yanıt vermeyen bir kaynak, listede durduğu sürece her
sorguya yalnızca zaman aşımı ekler.

## Geliştirme

```bash
npm ci
npm test          # ağ kullanmaz
npm run typecheck
npm run dev       # http://localhost:3000
```

Yapılandırma gerekmez. `.env` yalnızca isteğe bağlı şeyler için:
`.env.example` içindeki her değişken bir şeyi açar, hiçbiri kurulum şartı değil.

`npm test` saf modülleri derleyip çalıştırır; entegrasyon testleri gerçek
TypeScript modüllerini yükler ve yalnızca I/O sınırlarını denetimli
karşılıklarla değiştirir.

## Yeni arama sağlayıcısı

1. **Önce ölç.** `lib/search/providers.ts` içine eklemeden önce kaynağın senin
   çalıştırma ortamından yanıt verdiğini gör. Bir kez değil, birkaç kez: bu
   projede arXiv sırasıyla 6 sn zaman aşımı, 87 ms ve 11,2 sn ölçüldü. Tek
   ölçüm "hızlı" ya da "bozuk" demeye yetmez.
2. `Provider` sözleşmesini uygula. Çıktı başlık, URL ve snippet taşımalı;
   yayın tarihi bilinmiyorsa `null` bırak — bilinmeyeni bugün gibi göstermek,
   modele bayat bilgiyi taze diye vermenin yoludur.
3. Uygun sorgu türlerine ekle (`providersForIntent`). Her kaynağı her niyete
   koyma: OpenAlex bir haber sorgusuna, sorguyla yalnızca tek kelime paylaşan
   makaleler döndürür.
4. **Gerçek hatayı geçerli boş sonuçtan ayır.** Kaynak çalıştı ve bir şey
   bulamadıysa bu bir arıza değildir; arıza sayılırsa sıra dışı bir sorgu
   devre kesiciyi açar.
5. Süre sınırlarına uy. Fan-out en yavaş üyesine bağlıdır.

Beş küçük kaynak eklemek yerine onları tek bir bileşik kaynağın arkasında
gruplamayı düşün — `packages` beş paket kayıt defterini, `scholar` üç akademik
indeksi böyle taşıyor. Fan-out'ta bir yuva harcarlar, beş değil.

## Değişiklik gönderirken

- İlgili regresyon testini ekle. Bu depodaki testler işe yaradı: MMR'ın indeks
  şişmesi sorusuna makarna tarifi döndürdüğünü, `running`'in `run` ile
  eşleşmediğini ve alıntı motorunun bir Stack Overflow **sorusunu** cevap diye
  sunduğunu testler yakaladı.
- `npm test` ve `npm run typecheck` çalıştır.
- Performansa dokunuyorsan gecikmenin yanında **sonuç sayısını ve dış istek
  sayısını** da karşılaştır. Daha az kaynağa sorarak hızlanmak hızlanma
  değildir; `scripts/benchmark-search.mjs` üçünü birden basar.
- Commit mesajında neyi neden değiştirdiğini yaz. Ölçtüysen sayıyı da yaz.

## Güvenlik

Güvenlik açığı bulduysan herkese açık bir issue açma; `SECURITY.md` dosyasına
bak.
