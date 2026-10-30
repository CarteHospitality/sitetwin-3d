# Expert Operator: Domain Knowledge Base for Base-Station Change Planning

Purpose: give the "Expert Operator" AI in the SiteTwin 3D digital twin the judgement of a senior RF/site engineer: when a site needs a change, why, what the change should be, and what must be checked first. Audience for the product pitch: an equipment vendor (Huawei) and Turkish operators.

**Evidence labels used throughout**
- **[S]** = backed by a cited source URL.
- **[D]** = my own derivation/arithmetic from cited inputs (formula shown).
- **[E]** = engineering rule of thumb from general RF practice, NOT verified by a public source in this research. Treat as a tunable default, not a fact. Operators keep real thresholds internal; the public record is thin, and this document says so rather than inventing numbers.

---

## Türkçe Özet (10 madde)

1. Bir sahada değişiklik tetikleyicileri: yoğun saat PRB doluluğu (ör. %70-85 bandı, operatöre göre değişir), kullanıcı başı throughput düşüşü, RRC kullanıcı sayısı, düşen çağrı/bırakma oranı, zayıf RSRP/SINR dağılımı, overshoot/girişim, şikayetler, drive test/MDT bulguları ve çevredeki yeni bina/okul gibi fiziksel değişimler.
2. Türkiye'de ana çerçeve BTK'nın "Elektronik Haberleşme Cihazları Güvenlik Sertifikası Yönetmeliği"dir (ilk hali 21.04.2011, RG 27912; adı 17.04.2018 değişikliğiyle bugünkü hâline geldi). Her sabit cihaz için güvenlik sertifikası zorunludur.
3. Sınır değerler ICNIRP'in alan şiddeti değerlerinin kesri olarak verilir: tek cihaz için ~%20, ortam toplamı için ~%70 (örn. 2-94 GHz'de 12,3 V/m tek cihaz, 42,93 V/m ortam). Kaynak özetine göre; resmi metinle teyit edilmeli.
4. Hassas alanlar: sağlık kuruluşlarında cihazların oluşturduğu elektrik alan 3 V/m'yi geçemez; çok katlı binada anaokulu/ilkokul bulunan katlarda sertifikalı cihaz kurulamaz; çocuk oyun alanı ve okul bahçe sınırlarına güvenlik mesafesi gerekir.
5. Çevrede yeni bina, okul veya sağlık merkezi çıkarsa ölçüm hemen yapılıp BTK'ya bildirilmelidir (Madde 17/7). Dijital ikiz bu "yeni hassas alıcı" olayını doğrudan tetikleyici olarak kullanmalıdır.
6. Aksiyonlar: tilt, azimut, yükseklik, güç, yeni bant (n78 3,5 GHz massive MIMO, 700 MHz), sektör bölme/ekleme, küçük hücre, DAS, 2G/3G refarming, CA, söküm. Her biri EMF bölgesi, girişim ve kapsama yan etkisiyle birlikte simüle edilmelidir.
7. Tilt değişiminin etkisi geometrik olarak hesaplanabilir: 30 m yükseklikte 4° tilt yaklaşık 430 m ana huzme yere ulaşma mesafesi verir; 4°'de her 1° yaklaşık 107 m, 8°'de yaklaşık 27 m değiştirir (kendi türetmem).
8. Otomasyon: 3GPP SON/CCO (TS 28.313) emsaldir. Önceliklendirme çok kriterli skorla yapılmalı; yalnızca düşük riskli, geri alınabilir, EMF'yi artırmayan (ör. küçük elektrik tilt) değişiklikler otomatik; güç artışı, yapısal iş, yeni anten onay ister.
9. Güç, yapısal yük, rüzgâr, çatı erişimi, mal sahibi/izin, SHGM mânia yükseklikleri, anten izolasyonu, topraklama, görsel uyum, batarya ve transmisyon kapasitesi kontrol listesinde yer almalıdır.
10. Demo için 10 senaryo (yeni 9 katlı bina, 30 m'de okul, S1'de %92 PRB, hastane, gece/gündüz nüfus kayması, kalabalık etkinlik vb.) hazırlandı; her birinde tetikleyici veri, uzmanın söyleyeceği cümle, simüle edilecek değişiklik ve raporlanacak kontroller var.

---

## 0. Ground rules for the AI

- Never state a number the twin cannot derive or the operator has not configured. Where a threshold is operator-specific, present it as a configurable policy value.
- Always output: **trigger -> evidence -> proposed change -> predicted effect (coverage, capacity, interference, EMF) -> constraint checks -> approval class**.
- "Public data" caveat: operators' internal planning thresholds are not published. Huawei's own capacity-monitoring guide says thresholds are set "based on experiences" and that operators define them from actual conditions ([Huawei eRAN Capacity Monitoring Guide, mirror](https://www.scribd.com/document/326845109/Capacity-Monitoring-Guide)) [S].

---

## 1. TRIGGERS

For each trigger: revealing signal, public-ish thresholds, typical remedies. Threshold values flagged [E] are defaults to be calibrated per operator.

### 1.1 Capacity exhaustion (most common trigger)
- **Signals:** busy-hour DL/UL PRB utilisation; average RRC connected users; user-experienced DL throughput; share of busy hours above threshold over N days; cell-edge user share; PDCCH/CCE utilisation; buffer/latency.
- **Thresholds seen publicly:** A practitioner post lists busy-hour PRB < 85%, average user DL throughput > 10 Mbps and cell-edge-user share < 20% as the conditions under which a cell is considered healthy (expansion needed when violated), and suggests mobility load balancing from ~70% PRB ([TelecomHall practical strategies](https://www.telecomhall.net/t/practical-strategies-for-lte-network-optimization-and-capacity-enhancement/36322)) [S, forum-grade]. Another thread reports mature LTE networks often run 70-80%+ PRB and proposes ~80% busy-hour as an expansion trigger tuned to experience targets ([TelecomHall capacity guidelines](https://telecomhall.net/t/capacity-guidelines-number-of-users-prb-utilization-data-volume-throughput/13458)) [S, forum-grade]. Forum commenters stress PRB alone is misleading; RRC users and payload should be co-evaluated ([TelecomHall](https://www.telecomhall.net/t/lte-ran-utilization-how-to-measure/5039)) [S].
- **Recommended default policy [E]:** flag when busy-hour PRB > 70% on >= 5 of last 14 days (warning), > 85% (critical), AND user throughput below the service target.
- **Remedies, in order of cost:** load balancing / tilt to offload -> carrier add or refarm -> CA -> massive MIMO n78 -> sector split/add -> small cell/DAS.

### 1.2 Coverage hole / weak indoor or outdoor coverage
- **Signals:** RSRP (LTE) / SS-RSRP (NR) distribution, share of samples below a floor, geolocated MDT, drive tests, customer complaints with location, high RRC re-establishment, low CQI.
- **Thresholds:** no universal public value; [E] typical design targets are outdoor RSRP better than about -105 to -110 dBm and indoor deep-urban better than about -100 dBm; flag when >5-10% of MDT samples in a bin fall under the floor.
- **MDT:** 3GPP defines MDT as automatic UE collection of measurements to reduce manual drive tests, with coverage and capacity optimisation among its use cases ([3GPP TS 37.320 overview and TR 36.805 use cases, via search results](https://blog.3g4g.co.uk/2010/12/minimization-of-drive-tests-mdt-in-3gpp.html)) [S]. Logged MDT = idle-mode logs; immediate MDT = connected-mode reports [S, same source].
- **Remedies:** uptilt / azimuth / height / power, add a low band (700 MHz), small cell, DAS/indoor, new site.

### 1.3 Interference / overshoot / pilot pollution
- **Signals:** poor SINR despite good RSRP; many cells within X dB of the best server; abnormal TA distribution (users at TA far beyond the design radius = overshoot); high UL RSSI/IoT; cross-border handover failures; PCI collision/confusion.
- **Thresholds [E]:** more than 3 cells within 6 dB of best server in a bin = pollution; share of connections beyond 1.5x design cell radius > 5-10% = overshoot.
- **Remedies:** downtilt, power reduction, azimuth change, PCI re-plan, antenna with better sidelobe suppression, height reduction.

### 1.4 Quality degradation (drops, accessibility, mobility)
- **Signals:** call/bearer drop rate, RRC/E-RAB setup success, HO success, RLF reports, MRO counters.
- **Thresholds [E]:** operators typically target drop rate around or below 1% (LTE) and setup success above 99%; exact values are KPI-contract specific.
- **Remedies:** MRO parameter tuning (SON), neighbour list fixes, tilt/azimuth, hardware swap if feeder/antenna fault (VSWR, PIM alarms).

### 1.5 Environment change (physical world changes)
- **Signals:** new building raises obstruction in the main lobe (clutter/DSM update, building permits, satellite change detection); new or relocated school/hospital/kindergarten/playground near the site; demolition (coverage gets better, interference worse); new road/stadium.
- **Regulatory consequence:** in Turkey, nearby construction of a new building, school or health centre obliges immediate EMF measurement and notification to BTK (Art. 17(7)) ([Lexpera, Elektronik Haberleşme Cihazları Güvenlik Sertifikası Yönetmeliği](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3)) [S, fetched summary; verify against official text].
- **Remedies:** re-azimuth/height-raise/re-tilt, relocate antenna on roof, pull antenna back, power cut in the sensitive direction, or add small cell to fill shadow.

### 1.6 Spectrum / technology events
- **Signals:** new spectrum licence (n78 3.5 GHz, 700 MHz), vendor end-of-support, 3G shutdown, 5G NSA->SA, neighbour rollout.
- **Remedies:** add band/AAU, swap antennas for multi-band, refarm 2G/3G spectrum to LTE/NR.

### 1.7 Equipment/structural/lease triggers
- **Signals:** passive intermodulation (PIM), VSWR alarms, antenna age, tower structural audit failure, landlord notice, lease expiry, building refurbishment/roof waterproofing.
- **Remedies:** swap, relocate, decommission, relocate to a different building.

### 1.8 Energy and cost triggers
- **Signals:** very low utilisation for long periods, high energy cost per GB, redundant overlapping layers.
- **Remedies:** carrier switch-off schedules, decommission of redundant layer/site (the "ES" SON use case), AAU sleep modes.

### 1.9 Demand-pattern triggers (time/place dependent)
- **Signals:** daytime vs night-time population shifts (CBD vs residential), events, seasonality (tourist), new housing estates, footfall data.
- **Remedies:** capacity add with temporary (COW/event) cells, scheduled parameters, sector re-orientation.

---

## 2. CONSTRAINTS CHECKED BEFORE ANY CHANGE

### 2.1 EMF / RF exposure

**International: ICNIRP**
- ICNIRP 2020 general-public power density reference above 2 GHz is 10 W/m^2 ([ICNIRP 2020 via Frontiers analysis](https://www.frontiersin.org/articles/10.3389/frcmn.2022.744528)) [S]. Whole-body reference levels below 10 GHz are the same as ICNIRP 1998 (same source) [S]. Averaging time is commonly 6 minutes; one search result flagged the claim as muddled, so verify against the ICNIRP document ([ICNIRP 2020 guidelines text](https://modgov.sefton.gov.uk/documents/s125303/ICNIRPrfgdl2020.pdf)) [S].
- For massive MIMO, compliance can use an "actual maximum" instead of theoretical maximum power by applying a power reduction factor (PRF) to theoretical maximum, per IEC TR 62669 and the IEC 62232 revision; one worked example gives duty cycle 0.75 x PRF 0.32 = 25% of rated power averaged over 6 min ([Frontiers in Public Health, 2021](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2021.777759/pdf)) [S]. Measured exposure at real mMIMO sites is reported well below modelled actual-maximum (same source) [S].

**Turkey (Bilgi Teknolojileri ve İletişim Kurumu - BTK)**
- Instrument: **"Elektronik Haberleşme Cihazları Güvenlik Sertifikası Yönetmeliği"**, originally the regulation on the determination, control and supervision of exposure limit values of electromagnetic field intensity from electronic communications devices according to international standards, Resmî Gazete 21.04.2011 No. 27912; renamed by the amendment of 17.04.2018 (No. 30394) ([Lexpera](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3); [Resmî Gazete 17.02.2012 amendment](https://www.resmigazete.gov.tr/eskiler/2012/02/20120217-1.htm)) [S]. The pre-2018 original title and the consolidated text should be confirmed on mevzuat.gov.tr before the pitch.
- **Limits (Art. 16, Table 1)**, field strength, f in MHz ([Lexpera](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3)) [S]:

| Band | Single device (V/m) | Ambient total (V/m) |
|---|---|---|
| 10-400 MHz | 6.2 | 21 |
| 400-789 MHz | 0.305*sqrt(f) | 1.03*sqrt(f) |
| 790-2000 MHz | 0.275*sqrt(f) | 0.96*sqrt(f) |
| 2000-94000 MHz | 12.3 | 42.93 |

  The source describes these as 20% (single device) and 70% (ambient) of ICNIRP values. These ratios match the ICNIRP field-strength reference levels (e.g., 1.375*sqrt(f) for 400-2000 MHz, 61 V/m above 2 GHz) [D]. Note: they are field-strength fractions, so as power density the single-device limit is about 4% of ICNIRP and ambient about 49% [D]. An academic summary also says the BTK single-device limit assumes up to four transmitters, taking about a quarter of the total ([EMO paper](https://www.emo.org.tr/ekler/594760fd78c503b_ek.pdf)) [S, secondary; conflicts with the 20%/70% ratio, so use the Table values and flag for verification].
- **Worked values [D]:** at 900 MHz single device = 0.275*30 = 8.25 V/m (about 0.18 W/m^2); at 1800 MHz about 11.7 V/m; at 3.5 GHz 12.3 V/m (about 0.40 W/m^2, from E^2/377); ambient at 3.5 GHz 42.93 V/m (about 4.9 W/m^2).
- **Sensitive places (Art. 6)** ([Lexpera](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3)) [S]:
  - Health facilities: electric field produced by installed devices in the area cannot exceed **3 V/m** (Art. 6(8)).
  - Pre-school and primary education: safety distance computed with play-area/garden boundaries; base-station antennas and equipment must be at least the safety distance from children's play-area boundaries (Art. 6(2),(4)).
  - In a multi-storey building, certificate-requiring devices cannot be installed on floors where a pre-school/primary institution operates (Art. 6(5)).
  - Without a separate garden wall, BTK sets the boundary by on-site inspection (Art. 6(6)).
  - The April 2018 directive revision also allows base stations in large parks including those with playgrounds, subject to a safety distance (no figure given) ([Hurriyet Daily News](https://hurriyetdailynews.com/turkish-telecom-authority-issues-directive-allowing-base-stations-in-large-parks-playgrounds-130515)) [S].
  - BTK's consumer leaflet likewise says play-area and kindergarten/primary garden boundaries are taken into account and health-facility field strength is capped ([BTK baz istasyonu broşürü](https://tuketici.btk.gov.tr/uploads/pages/tuketici-rehberi/baz-istasyonu-brosur.pdf), as summarised by search) [S, summary only].
  - No source found gives a fixed metre figure for the school/playground safety distance; it is computed per site (limit-based). The twin should compute it from the EMF model, not hard-code metres.
- **Process (Art. 7-9):** safety certificate per fixed device (form EK-1), application EK-2, issued within 30 days; infrastructure work cannot start before issue; must go live within 120 days; measurement values (EK-3) due within 7 business days of going live or the certificate is cancelled; certificate displayed on site ([Lexpera](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3)) [S]. **Implication: any power increase, new antenna or new band is a new/changed device and needs the certificate path; this is a hard gate for the AI.**
- **Exemption:** fixed devices with output power of 5 W or less are outside scope, except cellular systems (Art. 2(2)) (same source) [S].
- **Measurement rules:** cellular base stations measured at >= 3 points, >= 1 minute per antenna/sector, probe at >= 1.5 m (Art. 15(3)) (same source) [S].
- **Enforcement (Art. 19):** a single device above its limit gets 10 business days to fix; ambient total exceeded with all devices compliant requires coordinated fixes, else the most recently installed device is sanctioned (same source) [S]. The AI should therefore treat "newest device" risk explicitly.
- **Public lookup:** citizens can query base stations via e-Devlet and BTK's EMA measurement system (ema-olcum.btk.gov.tr) ([search summary of BTK sources](https://tuketici.btk.gov.tr/uploads/pages/tuketici-rehberi/baz-istasyonu-brosur.pdf)) [S].

**EMF compliance-distance arithmetic the twin can compute [D]:** far-field power density S = EIRP / (4*pi*d^2); compliance distance d = sqrt(EIRP / (4*pi*S_limit)). Illustration only: a hypothetical 10 kW EIRP (70 dBm) beam at 3.5 GHz vs single-device 0.40 W/m^2 gives d about 45 m in free space with full theoretical power; applying a 25% actual-maximum factor halves it to about 22 m. The product must use the real EIRP of the configured AAU, not this number. The twin should show the exceedance volume (lobe-shaped), not a circle, and re-evaluate when the sector's tilt/azimuth/height changes.

### 2.2 Structural load and wind load
- Check roof slab/parapet capacity for added mass and wind area (AAU weight and windward area are significantly larger than a passive panel). [E] Use manufacturer datasheet weight and EPA/area; Turkish wind loading follows the national code (TS 498 / TBDY, not verified here).
- Fresh structural calculation needed for: new mast, height increase, extra AAU, ballast mounts on flat roofs. Typical action by humans: structural engineer sign-off.

### 2.3 Rooftop access and safety
- Safe access, restricted-zone markings, fall protection, working distances in front of antennas. Operators commonly require "RF safety zones" on roof (public/occupational) tied to the EMF model; the twin's EMF volume doubles as roof-safety marking. [E]

### 2.4 Landlord, permits, municipality
- Landlord/building-owner consent (kat malikleri), municipality/construction permits and BTK certificate; concealment requests. Lease terms can limit height or count of antennas. [E] These are human-process gates the AI flags but cannot clear.

### 2.5 Civil aviation / obstacle limits
- Near airports, height limits come from obstacle limitation surfaces; Turkey's SHGM instruction on aeronautical studies and shadowing lists base stations, antennas, masts, poles among potential obstacles, and shadowing is not allowed inside transition surfaces ([SHGM SHT-HCG](https://web.shgm.gov.tr/documents/sivilhavacilik/files/mevzuat/sektorel/talimatlar/SHT-HCG_D2.pdf)) [S]. The exact allowed height needs the airport's obstacle chart; the twin should take it as an input layer, not guess. Also CNS-facility criteria (SHY-CNS) apply ([same source](https://web.shgm.gov.tr/documents/sivilhavacilik/files/mevzuat/sektorel/talimatlar/2020/SHT-HCG.pdf)) [S].

### 2.6 Antenna isolation / co-location
- Horizontal/vertical spacing to other operators' and own antennas to avoid blocking, desensitisation and PIM; microwave dishes need line-of-sight and clearance. [E] Vendors specify minimum spacing in datasheets; the twin should use per-antenna keep-out volumes and warn when a proposed re-azimuth puts a main lobe into another antenna's near-field or mast.
- Own-sector obstruction: antenna's main lobe blocked by the roof structure, lift motor room, water tank or neighbouring mast -> that is itself a trigger.

### 2.7 Lightning/grounding
- Antennas must stay within the lightning protection zone; grounding bars and surge arrestors on feeders/DC. [E] Raising height or moving to a new mount requires re-checking the protection cone.

### 2.8 Visual/concealment
- Municipal or landlord rules, heritage districts, façade-matching enclosures. Concealment (radomes) can add loss and wind area. [E]

### 2.9 Power and batteries
- Adding an AAU (hundreds of watts of PA output; see 4.5) raises rectifier, breaker, cable and battery load. Check rectifier capacity (N+1), DC cable gauge, autonomy time target. [E] Example AAU power figures in 4.5.

### 2.10 Transmission / backhaul
- Adding n78 massive MIMO can need 10 Gbit/s-class fibre/microwave and CPRI/eCPRI interface capability. [E] Check port count on the BBU, fronthaul fibre, and backhaul headroom.

---

## 3. DATA THAT DRIVES DECISIONS

| Data source | What it contains | Decision it feeds |
|---|---|---|
| OSS PM counters (hourly/15-min) | PRB util, RRC users, throughput, drop, setup, HO, TA, CQI, IoT, PDCCH, energy | Capacity triggers, quality triggers, ranking score |
| CM / configuration data | tilt (RET), azimuth, height, power, bands, PCI, neighbour lists, alarms | What can be changed remotely vs physically; current baseline for the twin |
| Alarms / fault management | VSWR, PIM, sleeping cell, hardware faults | Swap/repair vs optimisation |
| Geolocated MDT / trace | RSRP/RSRQ/SINR per location, throughput per location, RLF | Coverage holes, overshoot, calibrating the propagation model (see 3GPP MDT [source](https://blog.3g4g.co.uk/2010/12/minimization-of-drive-tests-mdt-in-3gpp.html)) [S] |
| Drive-test / walk-test | Ground truth, indoor spots | Validation of model and change |
| Customer complaints / CRM / social | Location-tagged tickets | Priority weighting; hidden problem detection |
| Building heights & footprints (OSM, municipal 3D, LiDAR/photogrammetry) | Obstruction, shadow, indoor-population estimate | Line-of-sight, height change, new building trigger |
| Clutter / terrain (DEM/DSM) | Path-loss model class | Radius prediction, azimuth/tilt effect |
| Change detection (satellite/aerial, permit database) | New construction, demolition | Environment trigger |
| Population/demographics: daytime vs night-time (census, mobile-derived, workplace data) | People per building/block by time of day | Demand forecast and **EMF receptor weighting** (who is exposed when) |
| POI layer: schools, kindergartens, hospitals, playgrounds | Sensitive receptors and their boundaries | EMF compliance checks (Art. 6) |
| Events calendar, stadiums, fairs, festivals | Temporary load | Temporary capacity (COW), scheduling |
| Footfall (transport hubs, malls) | Crowd density | Small cell/DAS siting |
| Spectrum holdings and licences | Available bands | Which add-band options exist |
| Site engineering data | Roof plan, load capacity, power/battery, fibre, lease | Feasibility of each action |
| Competitor/neighbour site data | Other-operator antennas, shared sites | Isolation and co-location checks |
| EMF measurements & BTK certificate records | Measured V/m, certificates | Calibrate the twin's EMF model; certificate gating |

The 3GPP CCO function itself consumes measurements plus MDT, RLF and RCEF reports to detect coverage holes and capacity problems and decide actions within a policy (CCOPolicy) ([3GPP TS 28.313 CCO, iTecSpec](https://www.itecspec.com/3gpp/28.313/s/6.4.2.4)) [S]. PRB usage counters are named inputs to CCO ([iTecSpec TS 28.628](https://www.itecspec.com/3gpp/28.628/s/4.5.4.2)) [S].

---

## 4. ACTIONS CATALOGUE

Geometry used for tilt: on flat ground the main beam hits the ground at d = h / tan(theta), theta = total downtilt (mechanical + electrical) ([Kathrein/downtilt references](https://www.repeater-builder.com/antenna/downtilt.html); calculator [everythingrf](https://everythingrf.com/rf-calculators/down-tilt-coverage-radius)) [S]. The beam's upper edge reaches the horizon when the tilt is below half the vertical beamwidth, which is how overshoot occurs (same sources) [S]. The sensitivities below are my calculations [D].

### 4.1 Tilt change (electrical RET / mechanical)
- **When it helps:** overshoot, interference, load balancing between neighbours (CCO precedent), small coverage fill (uptilt).
- **Magnitude [D], flat terrain, antenna 30 m above ground:** tilt 2 deg -> 859 m; 4 deg -> 429 m; 6 deg -> 286 m; 8 deg -> 213 m; 10 deg -> 170 m. Sensitivity d(d)/d(theta) = h / sin^2(theta): about 107 m per degree near 4 deg, about 55 m per degree near 6 deg, about 27 m per degree near 8 deg. Rule: small changes at low tilt move the footprint a lot; at high tilt, little. In dense urban with buildings, real footprint is limited by clutter and the effective change is smaller.
- **Side effects:** uptilt grows coverage and also overshoot, interference and the EMF volume's horizontal reach; downtilt reduces them but opens a coverage gap at the edge. Beam pattern and electrical tilt with mechanical tilt distort the horizontal pattern (azimuth beam broadening). [E]
- **Cost/time:** remote electrical tilt (RET) is near zero cost and minutes (remote); mechanical tilt requires a rooftop visit (hours, low cost).
- **Automation class:** safest candidate (see 5.3).

### 4.2 Azimuth change
- **When:** main lobe obstructed by a new building; traffic hotspot not in lobe; sector overlap.
- **Magnitude:** typical sector 3-sector 120-degree plan; changes of 10-30 degrees are usual. [E] Every degree shifts the lobe laterally by d*tan(1 deg) = about 1.7 m per 100 m of range [D].
- **Side effects:** moves coverage to different neighbours -> HO relations, PCI/neighbour plan updates; moves the EMF lobe toward/away from sensitive receptors and roof edge; may cause mast/other-antenna blockage.
- **Cost/time:** rooftop visit with crew, hours; low-to-moderate cost; may need re-measurement and certificate update (device changed).

### 4.3 Height change
- **When:** obstruction by a new building or roof clutter (raise); overshoot or EMF issue (lower); mounting on a better structure.
- **Magnitude:** each +3 m is a mount/pole-section change. Effect: raising increases the cell radius at fixed tilt (d = h/tan theta scales linearly with h on flat ground [D]) and the line-of-sight clearance; also increases reach of overshoot.
- **Side effects:** structural and wind load, aviation limits, visual, lightning cone; coverage footprint and EMF "ground footprint" shift outward.
- **Cost/time:** weeks to months; structural calc, landlord, permits; moderate to high cost.

### 4.4 Power change
- **When:** raise for coverage hole; lower for interference, EMF compliance or energy saving.
- **Magnitude:** coverage radius scales with path-loss exponent: +3 dB power ~ +20% radius for exponent 3.5 (10^(3/35) = 1.22) [D]; EMF compliance distance scales with sqrt(power): +3 dB (x2) -> +41% distance [D].
- **Side effects:** raising power hits **EMF limits and certificate** (new certificate path in Turkey), uplink-downlink imbalance (UL-limited), more interference. Lowering power is the cleanest EMF fix.
- **Cost/time:** remote, minutes; but power increase is regulated (certificate) -> days to weeks for approval.
- **Automation class:** power decrease can be automated; increase needs approval.

### 4.5 Add band: 5G n78 3.5 GHz massive MIMO AAU; 700 MHz
- **n78 AAU:** 64T64R 3.5 GHz AAUs from Huawei: public numbers are inconsistent; search found AAU5639w at 240 W peak and AAU5645 at 280 W ([South African regulator submission containing Huawei data](https://www.icasa.org.za/uploads/files/MTN-Supplementary-submission-annex-3-Draft-Consultation-Document-on-Spectrum-Outlook.pdf); [AAU5645 listing](https://www.scribd.com/document/669769241/3-5GHz-ANTENA-ACTIVA-AAU5645)) [S, secondary]; a forum mentions 200 W 64T64R ([TelecomHall](https://www.telecomhall.net/t/maximum-transmit-power-with-mmimo/9379?page=2)) [S, forum]. Peak EIRP for an official Huawei 3.5 GHz AAU was **not found** in public sources; the demo should take EIRP, weight, power draw from a vendor profile supplied in the pitch (Huawei can provide the datasheet). Do not invent EIRP.
- **When it helps:** capacity in dense urban with many users; high throughput; spatial multiplexing via beamforming.
- **Side effects:** 3.5 GHz has higher path loss than 1.8/2.1 GHz, so coverage per site is smaller and indoor penetration worse; uplink may be limiting (NSA with LTE anchor helps); big EMF beams, though time-averaged exposure is much lower than the theoretical maximum (PRF; see 2.1); more power, weight, wind area, fronthaul.
- **700 MHz:** wide-area and deep-indoor coverage, lower capacity per MHz of available bandwidth; compatible with existing panels only if wideband antenna. Filters/diplexers and isolation. [E]
- **Cost/time:** AAU swap/add: months; high cost (equipment + structural + power + transmission); certificate required.

### 4.6 Sector split / add sector
- **When:** one sector saturated (e.g., 92% PRB) while neighbours are not; six-sector plan using narrow-beam antennas.
- **Magnitude [E]:** splitting one 3-sector site to 6 sectors can nearly double capacity in good conditions, but inter-sector interference trims the gain. Only use as a qualitative statement unless operator data provides numbers.
- **Side effects:** more antennas on roof (space, isolation), extra EMF sources (ambient total limit!), more PCIs, handover planning.
- **Cost/time:** weeks to months; moderate.

### 4.7 Small cell / DAS / indoor
- **When:** localized hotspot or indoor demand that the macro cannot serve; EMF-sensitive buildings where macro power cannot rise; shadow behind a new building.
- **Side effects:** low individual power (many fall under the 5 W exemption, but cellular systems are explicitly kept in scope by Art. 2(2) - verify per case) [S]; needs backhaul and power at street level; interference with macro if on the same frequency.
- **Cost/time:** small cell weeks, DAS months and costly. [E]

### 4.8 Refarm 2G/3G to LTE/NR
- **When:** 2G/3G traffic is low and spectrum is more valuable for LTE/NR; energy saving.
- **Side effects:** legacy device and voice fallback (VoLTE readiness), IoT/M2M and eCall users on 2G; need customer migration plan.
- **Cost/time:** software plus planning; quarters.

### 4.9 Carrier aggregation
- **When:** several LTE/NR carriers exist; improves user throughput; needs UE support.
- **Side effects:** none on EMF if no power added; better capacity use. Software licence.
- **Cost/time:** days; low cost.

### 4.10 Decommission / relocation
- **When:** redundant layer or site, lease loss, structural failure, EMF conflict that cannot be fixed.
- **Side effects:** coverage loss in the area (the twin must simulate the "after" state and neighbours' compensation, CCO-style), load moving onto neighbours; the ambient EMF reduces. Unwinding takes site restoration.
- **Cost/time:** months; moderate cost; regulatory notice. [E]

---

## 5. AUTOMATION

### 5.1 SON precedent
- 3GPP defines centralized SON CCO (Coverage and Capacity Optimization): it collects measurements and MDT/RLF/RCEF reports, detects coverage holes and capacity issues in NR cells/beams, decides actions inside a policy envelope ([TS 28.313 clause 6.4.2.4](https://www.itecspec.com/3gpp/28.313/s/6.4.2.4)) [S]. Other SON use cases: Mobility Robustness Optimisation (distributed) and Load Balancing Optimisation ([TS 28.313 contents](https://itecspec.com/3gpp/28.313/s/contents)) [S].
- Academic precedent: joint tilt/power optimisation for CCO under uneven traffic ([EURASIP 2014](https://link.springer.com/article/10.1186/1687-1499-2014-57)) [S]; RET-based self-optimisation to offload congested cells ([thesis summary](https://www.scribd.com/doc/254179370/Self-Optim-Antenna-Tilt)) [S].
- **Positioning for the pitch:** "SON automates parameters inside a cell; the Expert Operator reasons about physical-world changes (new building, school, roof) that SON cannot see, and produces a whole change package with regulatory checks."

### 5.2 Scoring and ranking logic
Compute a **Site Attention Score** (0-100) from normalised sub-scores; weights are configurable operator policy [E]:

| Component | Inputs | Suggested weight [E] |
|---|---|---|
| Capacity stress | busy-hour PRB (vs 70/85%), duration (days over threshold), users, user throughput deficit | 25 |
| Coverage / quality gap | % MDT samples below RSRP/SINR floor, drop rate, accessibility | 20 |
| Customer impact | affected subscribers (day and night population), complaints, premium/enterprise customers, revenue per site | 20 |
| Regulatory/EMF risk | % of limit at nearest sensitive receptor; new sensitive receptor within safety distance; ambient total vs limit (highest priority: a breach is a hard floor) | 20 |
| Environment drift | new obstruction, new building, outdated model confidence | 10 |
| Fixability / cost inverse | cheap remote fix available? (boosts urgency to act) | 5 |

Rules:
- **Override:** any EMF compliance breach or new sensitive receptor inside the safety distance = top priority regardless of score (Art. 17(7), Art. 19) ([Lexpera](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3)) [S].
- Use persistence (N of M days), seasonality and trend to avoid reacting to a one-off event.
- Group by cluster: a capacity fix on site A may relieve neighbour B; rank clusters, not single sites.
- Always show confidence (data freshness, model calibration vs MDT).

### 5.3 Automation levels

| Class | Examples | Rule |
|---|---|---|
| A. Auto-apply (with rollback and monitoring) | Small RET changes (+/-1-2 deg) that do not raise EMF at any receptor and whose predicted KPI delta is positive; PCI/neighbour fixes; CA enablement; scheduled energy saving | Predicted EMF volume must not grow or cross a sensitive receptor; guard-rail window; auto-revert if KPI degrades |
| B. One-click approval | Larger tilt/azimuth sets, power decrease, load-balancing parameter sets, 2G/3G carrier reallocation | Show before/after twin plus checks; engineer approves |
| C. Human-led project | Power increase, new antenna/AAU, new band, height change, sector split, small cell/DAS, relocation, decommission | Needs BTK certificate, structural, landlord, aviation, power/transmission checks; the AI produces the dossier and work order, not the change |

Hard stops (never auto): anything that increases power or adds a device (certificate), anything changing exposure toward a school/hospital/playground, structural changes, anything needing a landlord or permit.

---

## 6. TEN DEMO SCENARIOS (urban Turkish rooftop site, voice-driven)

Convention: the site has 3 sectors (S1 ~0 deg, S2 ~120 deg, S3 ~240 deg), antenna centre ~30 m above ground on a 7-storey rooftop, LTE 800/1800/2100/2600 + NR n78 as available. All numbers in "trigger data" are scenario inputs, not real data. Distances/EMF values must come from the twin's computation.

**1. New 9-storey building in sector 2's main lobe**
- *Trigger data:* change detection flags a new 27 m building 70 m from site along 120 deg; MDT shows RSRP in the shadow behind it dropping about 12 dB [scenario input]; complaints rising.
- *Expert says:* "A new nine-storey building has appeared 70 m into sector 2's main lobe. The building top is near antenna height, so it will shadow the street behind it. I recommend raising sector 2 by 6 m and shifting azimuth 15 degrees to clear the corner, with 1 degree less tilt to refill the shadow."
- *Simulate:* height +6 m, azimuth +15 deg, tilt -1 deg; show before/after coverage and shadow.
- *Checks to report:* structural/wind (human), landlord, aviation limit layer, EMF volume vs neighbouring roofs/receptors, certificate needed for changed device (Art. 7-9), clearance to other antennas.

**2. A school opened 30 m away**
- *Trigger data:* POI layer: new primary school with fenced garden boundary 30 m from S1's main lobe.
- *Expert says:* "A primary school now sits 30 metres from sector 1. The regulation requires a safety distance to the garden boundary and a measurement and notification to BTK right away. Current modelled field at the fence is X percent of the single-device limit. I recommend lowering sector 1 power by 3 dB and 2 degrees more downtilt, then re-measuring."
- *Simulate:* power -3 dB, tilt +2; display EMF isosurface and the fence line.
- *Checks:* field at fence vs single-device and ambient limits; building floor rule (Art. 6(5)) if the antenna is on the same building; Art. 17(7) measurement obligation; coverage loss to nearby residents.

**3. Sector 1 PRB utilisation 92% in busy hour**
- *Trigger data:* S1 busy-hour PRB 92% for 9 of last 14 days; user throughput 3.8 Mbps vs target; RRC users 210; neighbours S2 51%, S3 48% [scenario].
- *Expert says:* "Sector 1 is saturated while its neighbours have headroom. First step: shift traffic by 1.5 degrees more tilt on S1 and one degree less on S3. If PRB stays above 85 percent, I would add a second LTE carrier, then propose an n78 AAU."
- *Simulate:* tilt change plus predicted load shift; second step shows carrier/AAU add.
- *Checks:* EMF does not grow (downtilt), edge-coverage hole check, then for AAU: certificate, structural, power, backhaul.

**4. Hospital within 60 m (3 V/m limit)**
- *Trigger data:* hospital building 60 m from S3; new certificate check; modelled field at the hospital façade.
- *Expert says:* "Health facilities have a 3 V/m cap on the field produced by installed devices. Sector 3 gives a worst-case X V/m at the north façade. I recommend rotating azimuth 20 degrees away and lowering power 2 dB."
- *Simulate:* azimuth -20 deg, power -2 dB; field map with 3 V/m contour.
- *Checks:* 3 V/m (Art. 6(8)) ([Lexpera](https://www.lexpera.com.tr/mevzuat/yonetmelikler/elektronik-haberlesme-cihazlarindan-kaynaklanan-elektromanyetik-alan-siddetinin-uluslararasi-2011-27912-3)) [S]; coverage loss in the opposite direction; ambient total.

**5. Add n78 massive MIMO to a crowded sector**
- *Trigger data:* NR licence available; S2 serving a dense residential/commercial area; heavy video usage.
- *Expert says:* "I recommend a 3.5 GHz massive MIMO AAU on sector 2. It adds capacity but the beam is strong: the twin shows the compliance volume reaching X metres and not touching any receptor. Roof load, power feed and fibre must be confirmed by site engineering."
- *Simulate:* place the vendor AAU model with its EIRP profile; show coverage and EMF.
- *Checks:* EMF vs single-device 12.3 V/m and ambient 42.93 V/m [S]; new certificate; structural/wind; rectifier/battery; fronthaul/backhaul; isolation to other antennas.

**6. Overshoot into a neighbour site's cell**
- *Trigger data:* TA distribution shows 12% of S3 connections beyond 1.5x design radius; neighbour site's SINR poor in overlap; high HO ping-pong.
- *Expert says:* "Sector 3 reaches over the river into the neighbouring cell. I recommend two more degrees of downtilt. That cuts the main-beam ground intercept from about 430 to about 290 metres."
- *Simulate:* tilt 4 -> 6 deg (geometry in 4.1 [D]).
- *Checks:* no new coverage hole inside the design radius; EMF volume shrinks; no certificate change if power constant (operator confirm).

**7. Daytime business district vs night-time residential population shift**
- *Trigger data:* day population estimate 4x night; PRB peaks 11:00-16:00 only; the site was dimensioned for residential night peak.
- *Expert says:* "This is a daytime-dominant cell: day-time population is about four times the night count. Evening KPIs are fine, but the workday peak is saturating sector 2. I recommend a capacity solution for the office block, a small cell or indoor DAS, rather than more macro power."
- *Simulate:* small cell/DAS at the office base; day vs night EMF receptor weighting (more people exposed in the day).
- *Checks:* backhaul/power at the office, landlord, interference to macro, EMF at street level.

**8. Large event (stadium match) next week**
- *Trigger data:* events calendar: 40,000-seat stadium 400 m from sector 1; past events show PRB 100% and drop rate spike.
- *Expert says:* "A stadium event is scheduled. I suggest a temporary mobile cell on wheels and a one-day schedule that raises S1 power within the certificate limit, plus load balancing to neighbours."
- *Simulate:* temporary cell; parameter profile with start/end.
- *Checks:* any power increase must remain within certified values; EMF near crowds; temporary device certificate; auto-revert after event.

**9. Existing antenna blocked by roof structure / elevator shaft**
- *Trigger data:* azimuth S2 line-of-sight check finds a rooftop lift-motor room 8 m in front of the antenna blocking 40 degrees of the lobe; MDT shows a gap.
- *Expert says:* "A rooftop structure sits in front of sector 2's antenna and blocks part of its beam. I recommend moving the S2 mount to the opposite corner of the roof, 12 metres away, which clears the line of sight."
- *Simulate:* relocate antenna to the other corner; show unblocked footprint.
- *Checks:* structural at new location, access/safety, landlord, new EMF distances to roof edge and neighbouring buildings, cable run, lightning protection, certificate update.

**10. Redundant layer or site decommission**
- *Trigger data:* the 2G/3G layer carries 1.5% of traffic; or a nearby site's cells have PRB under 10% with overlapping coverage; high energy cost.
- *Expert says:* "This layer carries almost no traffic. I recommend switching off the 3G carrier and refarming its 10 MHz to LTE. Coverage is preserved by LTE 800. Decommissioning the antennas frees roof space for an n78 AAU."
- *Simulate:* remove layer, show coverage unchanged, capacity improved, ambient EMF reduced.
- *Checks:* legacy devices/voice fallback, IoT, regulatory notice, equipment removal, ambient EMF decreases (positive effect for neighbour operators' margin).

---

## 7. Open items to verify before the pitch

1. Exact consolidated text of the Turkish regulation on mevzuat.gov.tr (title history, current limit table). The Table values came from a private law-database summary (Lexpera) and conflict with a secondary academic note about "one quarter for a single device".
2. Official Huawei datasheet values (EIRP, weight, wind area, power) for the n78 AAU model to be shown (AAU5639w / AAU5645 class).
3. Operator-specific KPI thresholds (PRB, throughput, drop rate) from Turkcell, Türk Telekom or Vodafone TR; public sources only show practitioner-level guidance.
4. Airport obstacle charts and local municipal rules per site (aviation layer is input data, not computed).
5. Wind/structural codes applicable in Turkey for rooftop installations (not researched here).
