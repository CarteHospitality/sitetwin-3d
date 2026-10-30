# Demo videosu ve başvuru planı

Son teslim: **5 Kasım 05:00 TSİ** (4 Kasım 21:00 ET). Özellik dondurma: **2 Kasım akşamı**.
Başvuru: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit

## Jüri puanlaması ve videoda nasıl karşılanacağı

| Ölçüt | Ağırlık | Videoda gösterilecek |
|---|---|---|
| Etki | 30% | Operatörün yüzlerce sahası var; okul/hastane yakınındaki EMF sorunlarını bugün elle, haftalarca bulur. Burada saniyeler. |
| Meta araçları | 25% | Üç Meta modeli tek akışta: **Muse Spark Open** (ajan, Baseten), **Muse Spark 1.3** (fotoğraf okuma), **Muse Voice Transcribe** (sesli komut). |
| Teknik | 20% | Ajanın araçları tarayıcıda canlı 3D ikiz üzerinde çalışır; her seçenek gerçek EMF hesabıyla denenir, tahmin değil. |
| Demo | 25% | Tek kesintisiz akış: harita → acil saha → sesli komut → 3D'de düzeltme → saha ekibi ve iş emri. |

Ek ödüller: **Best Open Weight** (Muse Spark Open kullanıyoruz, uygun), **Best Agentic** (ajan çok adımlı plan yapıyor),
**Most Viral** (X paylaşımı, 8 Kasım'a kadar etkileşim).

## Video akışı (3:00)

Ekran kaydı + seslendirme. Seslendirme İngilizce olmalı (jüri); uygulamaya verilen sesli komut **Türkçe** olabilir.
Bu bilerek iyi bir şey: "mühendis kendi dilinde konuşuyor" mesajı.

| Süre | Ekranda | Seslendirme (İngilizce) |
|---|---|---|
| 0:00–0:20 | Portföy haritası, sorunlu sahalar renkli | "Operators run thousands of rooftop sites. Some radiate into schools and homes, and finding them is slow, manual work. SiteTwin 3D checks every site automatically." |
| 0:20–0:45 | Sağda "Aciliyete göre sahalar" kartı, en üstteki sahaya tıklama | "Each site comes from a SiteTwin survey file: antennas, bands, power, and the buildings around it, from Microsoft and OpenStreetMap data." |
| 0:45–1:20 | 🎤 tuşuna basıp Türkçe: *"Hangi saha en acil? Onu aç ve okul sorununu en küçük değişiklikle çöz."* | "I just talk to it, in Turkish. Muse Voice Transcribe turns my voice into text, and the Expert Operator, running on Muse Spark Open, takes it from there." |
| 1:20–2:05 | 3D ikiz açılır; ajan seçenekleri dener, EMF bölgesi küçülür, okul kırmızıdan çıkar | "The agent doesn't guess. Every option it tries runs through the same EMF model I see: tilt, azimuth, power. It picks the smallest change that clears the school." |
| 2:05–2:35 | Sağda "Saha ekibi ve takvim" ve "İş emri" kartları belirir | "Then it plans the field work: who goes, what they carry, how long it takes." |
| 2:35–2:55 | "Eylem planı" → plan açılır → "E-postayla gönder" | "One click turns it into an action plan for the site chief: where, why, what to do, crew, tools, materials, precautions." |
| 2:55–3:00 | Logo + repo adresi | "SiteTwin 3D. Open source, built on Meta's open models." |

## Kayıt öncesi kontrol listesi

- [ ] Sunucu çalışıyor, `.env` içinde hackathon anahtarı var (`meta-models/muse-spark-open-1026`).
- [ ] **Sadece örnek veri:** `portfolio.html?portfolio=data/samples/portfolio.json`. Gerçek operatör sahaları videoda görünmemeli.
- [ ] Ankara örneğinde okul sorunu net görünmeli ve portföyde "Kritik" çıkmalı (şu an sınırda; aşağıya bak).
- [ ] Tarayıcı tam ekran, yakınlaştırma %100, bildirimler kapalı.
- [ ] Mikrofon testi; ajanın sesli cevabı da kayda girsin.
- [ ] Akışı 2–3 kez prova et; en temiz çekimi kullan. Ajan yanıtı 30–60 sn sürebilir; videoda bu kısım hızlandırılabilir.

## Bilinen eksikler (dondurmadan önce)

1. ~~Ankara örneği zayıf~~ **Düzeltildi:** batı sektörü (S3-1) okula dönük, 40 W. Bölge 42 m, okul 29 m'de;
   portföyde "Kritik". Test çekiminde ajan gücü 40 W → 18 W yaptı, okul bölgeden çıktı.
   Not: önceki bir öneri tarayıcı oturumunda kalırsa portföy sahayı "düzeltilmiş" gösterir; kayda **yeni bir sekmede** başla.
2. Ajanın yanıt süresi: her soruda 10–25 model çağrısı yapıyor. Kredi açısından sorun yok (100$), ama video için hızlandırma gerekebilir.

## Başvuru formu için gerekenler

- [ ] Public GitHub reposu (README: ne yapar, nasıl çalıştırılır, hangi Meta modelleri nerede).
- [ ] 3 dakikalık video (YouTube "liste dışı" veya Loom bağlantısı).
- [ ] Kısa açıklama (1 paragraf) ve problem tanımı.
- [ ] Kullanılan Meta araçları listesi.
- [ ] Repoda gerçek veri olmadığının kontrolü (`data/private`, `viewer/data/private`, `viewer/data/uploads` gitignore'da).
- [ ] İsteğe bağlı: X paylaşımı (Most Viral ödülü için).
