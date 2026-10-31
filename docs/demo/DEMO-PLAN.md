# Demo videosu ve başvuru planı

Son teslim: **5 Kasım 05:00 TSİ** (4 Kasım 21:00 ET). Özellik dondurma: **2 Kasım akşamı**.
Başvuru: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit

## Jüri puanlaması ve videoda nasıl karşılanacağı

| Ölçüt | Ağırlık | Videoda gösterilecek |
|---|---|---|
| Etki | 30% | Operatörün yüzlerce sahası var; okul/hastane yakınındaki EMF sorunlarını bugün elle bulur. Burada harita hepsini tarar, sorunu tek cümleyle söyler ve saha ekibine giden bir plan taslağı çıkar. |
| Meta araçları | 25% | **Muse Spark Open** (Baseten) canlı ikiz üzerinde araç çağıran ajan; Baseten düşerse aynı çağrıyı **Muse Spark 1.3** (Meta Model API) alır. **Muse Voice Transcribe** sesli komut, **Muse Spark 1.3** fotoğraf okuma. |
| Teknik | 20% | Her seçenek ikizin kendi EMF hesabıyla denenir (BTK yönetmeliği maddeleriyle); sıralama kartta yazan sabit kurala göre, modelin tercihi ayrıca işaretli. |
| Demo | 25% | Tek kesintisiz akış: harita → Ankara → analiz → karar kartı → plana ekle (simülasyon) → izlenen değişiklik → eylem planı. |

Ek ödüller: **Best Open Weight** (Muse Spark Open), **Best Agentic** (ajan çok adımlı plan yapıyor),
**Most Viral** (X paylaşımı, 8 Kasım'a kadar etkileşim).

## Video akışı (3:00): tek senaryo, Ankara

Ekran kaydı + İngilizce seslendirme. Ana videoda yalnız Ankara var; fotoğraf ve portföy turu ayrı kısa kliplerde.
Ajanın beklediği kısım hızlandırılırsa ekranda küçük bir "sped up" notu olsun: canlı çalıştığı inandırıcı kalır.

| Süre | Ekranda | Seslendirme (İngilizce) |
|---|---|---|
| 0:00–0:15 | Portföy haritası; Ankara pininin kartı: "A school is inside the EMF safety zone of S3-1 in the planning model…" | "Operators run thousands of rooftop sites. Some put an EMF safety zone on a school, and finding them is slow, manual work. SiteTwin 3D checks every site and says the problem in one sentence." |
| 0:15–0:30 | Karta tıklama; ikiz kurulur, aynı cümle ve **Analyse this problem** | "Each site comes from a survey file: antennas, bands, power, and the real buildings around it." |
| 0:30–1:00 | **Analyse this problem** (ya da Türkçe sesli komut, İngilizce altyazıyla); sohbette sayfanın kendi hesapladığı saha özeti, sonra ajanın adımları | "The Expert Operator runs on Muse Spark Open. It doesn't guess: every option it tries goes through the same EMF model I see." |
| 1:00–1:30 | Karar kartı: kartta yazan sıralama kuralı, bugünkü çakışmalarla yan yana, her seçeneğin değişikliği ("S3-1 height: 17.5 m → 24 m") | "The ranking rule is written on the card, so the model doesn't grade its own answer. An analysis never changes the plan: I choose." |
| 1:30–2:05 | **Add to plan (simulation)**: "Simulation · step 1 of 4", kaydırıcılar oynar, 3B'de önce / değişiklik / sonra; okul bölgeden çıkar | "Nothing changes on site: the twin plays the change step by step, before and after." |
| 2:05–2:40 | **Action plan (planning draft)**: bulgu, iş, ekip, okul bahçesinin yerinde teyidi; Print / PDF | "It ends as a draft for the site chief: where, why, what to do, the crew, and what must be measured and approved first." |
| 2:40–2:55 | İsteğe bağlı: tek cümlelik sesli komut ya da fotoğraf okuma | "I can also talk to it in Turkish, or show it a site photo." |
| 2:55–3:00 | Önce / sonra görseli + repo adresi | "SiteTwin 3D. Open source, built on Meta's models." |

Yedek klipler: portföy turu ("Fix urgent sites one by one", hızlandırılmış) ve fotoğraf okuma.

## Kayıt öncesi kontrol listesi

- [ ] Sunucu çalışıyor; `.env` içinde `BASETEN_API_KEY` **ve** `MODEL_API_KEY` var (Baseten düşerse ajan Meta Model API'ye geçer).
- [ ] **Sadece örnek veri:** `portfolio.html?portfolio=data/samples/portfolio.json`. Gerçek operatör sahaları videoda görünmemeli.
- [ ] Kayda **yeni bir sekmede** ya da **Start over** ile başla: önceki bir plan oturumda kalırsa Ankara "düzeltilmiş" görünür.
- [ ] Ankara portföyde **Critical**; kartta okul cümlesi var.
- [ ] Kayıttan hemen önce bir ısınma çalıştırması yap (ilk model çağrısı yavaş olabilir); harita karoları bir kez yüklensin.
- [ ] **Camera story** bilerek açık ya da kapalı; teknik kartlar kapalı başlasın.
- [ ] Tarayıcı tam ekran, yakınlaştırma %100, bildirimler kapalı, açılır pencerelere izin var (Print / PDF için).
- [ ] B planı: ajan cevap vermezse aynı düzeltmeyi elle göster (Manual adjustment kartında S3-1 yüksekliği ve gücü, ~20 sn).
- [ ] Akışı 2–3 kez prova et; en temiz çekimi kullan.

## Başvuru formu için gerekenler

- [x] Public GitHub reposu (README: ne yapar, nasıl çalıştırılır, hangi Meta modelleri nerede).
- [x] Kullanılan Meta araçları listesi (README, "Meta models used").
- [x] Repoda gerçek veri yok (`data/private`, `viewer/data/private`, `viewer/data/uploads` gitignore'da).
- [ ] 3 dakikalık video (YouTube "liste dışı" veya Loom bağlantısı) ve README'deki bağlantı.
- [ ] Kısa açıklama (1 paragraf) ve problem tanımı.
- [ ] İsteğe bağlı: X paylaşımı (Most Viral ödülü için): eylem planı → "Önce / sonra" görseli + 20 sn klip.
