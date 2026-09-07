# Güvenlik

## Bildirim

Güvenlik açığı bulduysan **herkese açık issue açma.** GitHub'da
[Security Advisories](https://github.com/burkiuze/clouda/security/advisories/new)
üzerinden özel bildirim aç.

## Bu projenin saldırı yüzeyi

Clouda'nın işi, kullanıcıdan gelen girdiyle dışarıya HTTP isteği yapmak. Bu,
onu doğal olarak **SSRF** hedefi yapar; savunmanın çoğu `lib/core/security.ts`
ve `lib/core/http.ts` içinde toplanmıştır.

Bilinen ve kapatılmış üç sınıf, ne aradığın konusunda fikir versin:

- `trusted` işareti bir zamanlar SSRF kontrolünü **atlıyordu**. Artık
  atlamıyor: sağlayıcı yönlendirmeleri de herkes gibi doğrulanır.
- WHATWG URL, IPv4-mapped IPv6 adresini onaltılığa çevirir. `::ffff:7f00:1`
  eski kontrole 127.0.0.1 olarak değil, tanınmayan bir ana bilgisayar olarak
  ulaşıyordu.
- Sondaki nokta (`example.com.`) alan adı politikasını atlatabiliyordu; artık
  eşleştirmeden önce normalize edilir.

## Bilinen sınır: DNS

URL kontrolleri protokolü, alan adını ve özel IP literallerini denetler ama
**DNS yanıtını bağlantıya sabitlemez.** Yani bir alan adı kontrol anında kamuya
açık bir adrese, bağlantı anında özel bir adrese çözülebilir (DNS rebinding).

Güvenilmeyen URL'leri kamuya açık bir kurulumda işliyorsan ağ düzeyinde çıkış
kısıtı da uygula. Bu, kodun kapatabileceği bir açık değil; katman farkı.

## Çalıştırırken

- `DIAG_TOKEN` tanımlamazsan `/api/diag/selftest` kapalıdır. Bu uç çağrı başına
  yaklaşık otuz üçüncü tarafa istek yapar; **varsayılan bir değeri yoktur**,
  çünkü herkese açık bir depodaki sabit bir token savunma değil, savunma
  görüntüsüdür.
- Varsayılan olarak kimlik doğrulama **yoktur**. Bu, localhost'ta doğru
  tercihtir ve `0.0.0.0`'a bağladığın anda değildir: o noktada
  `CLOUDA_TOKEN` tanımla, yoksa sunucuna ulaşabilen herkes onu kullanabilir.
- Sunucu, senin adına dış siteleri indirir. Güvenilmeyen bir girdiyle
  çalıştırıyorsan bunun ne anlama geldiğini yukarıdaki SSRF bölümüyle birlikte
  düşün.
