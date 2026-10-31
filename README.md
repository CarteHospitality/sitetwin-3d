# SiteTwin 3D

A **3D digital twin and change planner for mobile base-station sites**, built on Meta models. Load a site file, and every site is checked automatically on a map; open one and an **Expert Operator** agent (Muse Spark Open, by text or voice) finds the problem and simulates the fix: EMF safety zones against real neighbouring buildings, sensitive buildings like schools and hospitals, rooftop safety, capacity and coverage.

Built for the Meta Global AI Developer Hackathon (Indie track). Demo video: _link to be added_.

## Demo in three minutes

1. **The map** (`portfolio.html?portfolio=data/samples/portfolio.json`): five sites, coloured by urgency. Hover Ankara: its card says the problem in one sentence, "A school is inside the EMF safety zone of S3-1 in the planning model: it needs a fix or a measurement." Every sample site is labelled a synthetic sample; **Sources and assumptions** in the twin's top bar shows where each figure comes from.
2. **The twin**: click the card. The 3D twin opens on the same sentence and one button, **Analyse this problem**.
3. **The operator works in the open**: the chat shows the site summary the page calculates itself (structure, antennas, people nearby, EMF, roof, load, coverage, next year's load), then the operator's real steps as they happen: thinking, comparing options.
4. **The decision**: its answer in plain words, then one open card with the options it compared, ranked by a fixed rule written on the card (sensitive buildings, other buildings, coverage loss, roof, field work): EMF conflicts against today's, roof, coverage loss and the field work each would take. An option applies only from its own row.
5. **In your own words**: instead of the button, ask for a goal the buttons do not offer, for example "Okulu etkilemeden, en az saha işiyle güney kapasitesini artır; kapsama kaybı olursa söyle". The operator turns it into options and compares them with the twin's own checks; **Technical steps** shows each tool call and the numbers it returned, and the card's fixed ranking stays apart from the operator's own preference.
6. **The change, watched**: Apply. The plan's steps are listed, then carried out one at a time in the manual-adjustment card (the antenna is picked, its slider moves) while the 3D view moves with it; with **Camera story** on, the camera tells it as before, change, after. Skip plays the rest at once.
7. **The plan**: "Action plan ready". Review shows the plan's status (a planning draft: a field measurement and approval come first), the finding that made it, the work, the expected result, the crew, tools, materials and precautions; Print / PDF, Copy or an e-mail draft take it to the site chief.

## Meta models used

| Model | Where | What it does |
|---|---|---|
| **Muse Spark Open** (`meta-models/muse-spark-open-1026`, on Baseten) | `viewer/agent.js`, relayed by `sitetwin3d/server.py` `/api/chat` | The Expert Operator agent: calls tools on the live 3D twin, compares options, applies the fix, plans the field work. |
| **Muse Spark 1.3** (Meta Model API) | `sitetwin3d/extract.py`, `/api/photo`, `viewer/photo.js` | Reads a site photo: equipment, label text, safety notes. The agent then checks it against the twin. |
| **Muse Voice Transcribe** (Meta Model API) | `viewer/voice.js`, `/api/transcribe` | Push-to-talk: the engineer speaks (Turkish or English), the agent acts. |

## What existed before vs. what is new

- **Pre-existing (not in this repo):** SiteTwin, my private site-engineering tool. It produces regulatory EMF reports and site-survey documents, and writes one machine-readable site file per site (schema `jevbtk-digital-site@1`).
- **Built during the hackathon (everything in this repo):** this standalone module that consumes that site file. It does not import or contain SiteTwin code. The five sample site files in `samples/sitetwin/` let anyone run it without SiteTwin. The EMF calculation here was written from scratch.

## How it works

```
SiteTwin site file (JSON)  ──►  importer  ──►  3D twin  ──►  portfolio map + checks  ──►  Expert Operator
antennas, heights, azimuths,     + real surroundings          (EMF, sensitive           (Muse Spark Open, tools
bands, power, structure,           fetched automatically:      buildings, roof,          on the live twin,
measured load per cell             Microsoft footprints,       capacity, changes         voice via Muse Voice
                                   OpenStreetMap uses          planned in 3D)            Transcribe)
```

1. **Import** (`sitetwin3d/importers/sitetwin.py`, `sitetwin3d/portfolio.py`). The site file gives the engineering data: sectors, antennas with the action of its latest SiteTwin application (retain / add / remove / replace), heights, azimuths, tilts, power per band and the structure (rooftop, tower, monopole). The result of that application (every antenna it keeps or adds) is the site **as it stands**: SiteTwin 3D checks it and plans the next change on top of it; the application itself is kept as history. From the site's coordinates the importer fetches the real roof outline and neighbouring buildings (Microsoft Global ML Building Footprints) and their uses (OpenStreetMap: schools, kindergartens, health facilities). Every value it has to assume is listed in the twin's notes. Address and coordinates are not copied into the twin; they stay in the portfolio index, for the action plan.
2. **EMF zones** (`sitetwin3d/emf.py`, `viewer/emf.js`). Conservative far-field safety distance per antenna, exposure ratios summed over its bands, with the Turkish single-device limit (20% of the ICNIRP field strength, 12.3 V/m above 2 GHz). Health facilities have their own limit, 3 V/m whatever the band; the field falls with distance, so it reaches two to four times as far as the single-device zone, depending on the band (`tests/test_health_limit.py`). Antennas whose zones overlap are summed: a building no single zone reaches can still be over the limit together (`tests/test_cumulative_emf.py`). The browser and Python versions are kept identical by `tests/test_emf_parity.py`.
3. **Checks** (`viewer/checks.js`). Which zones reach which neighbouring buildings (and whether they are sensitive), whether a health facility outside the drawn zone is still above 3 V/m, how much walkable roof is inside a zone at head height, estimated occupancy per building and per antenna (`viewer/population.js`). Results are worded as findings of a planning model ("No building found in an EMF zone"), not as guarantees: a field measurement has the last word.
   **Measured load** (`viewer/kpi.js`): a site file can carry its own optional `network_kpi` block (busy hour per cell: sector, band, `prb_dl_pct`, optionally `busy_hour`, `rrc_users`, `traffic_gb`); the importer copies it into the twin, so the measured load appears on the map and in 3D without any extra step. The measured load replaces the population estimate: the panel, the Expert Operator (70% PRB load balancing, 85% expansion) and the action plan use it.
4. **Portfolio map** (`viewer/portfolio.html`). Every site coloured by urgency: critical (a sensitive building in a zone, or a hospital above 3 V/m), action needed (a zone reaches a building, or a measured cell is full), review, change planned, OK; only the sites that need action pulse. Hovering a site opens a small screen on it: its general-view photo (taken from the site's previous BTK report when the file carries it, otherwise the site from the air) and its problem in one plain sentence, with what it means; a click opens its twin. The logo opens the **home view**: every site in view and the operator's short summary on the left (the sites that need action, the planned field work with one **combined action plan** for all of it, every site in a list). **Load file** adds a new site, or updates one with the same ID; **Remove from map** takes a loaded file off again.
5. **3D change planner** (`viewer/index.html`). Edit antennas (azimuth, tilt, height, position, power per band, add a band or an antenna), see zones, checks and the coverage area update live (each cell in the colour of the sector that serves it best, lighter where the signal is weaker, the selected antenna's area kept strong; indicative Hata model over the 1.2 km the view shows; the operator compares options on the 600 m around the site, as a relative measure between plans, not a service prediction). The right panel keeps the current state on top, then the plan, then the same points after the plan, marked as a simulation. The ground is the site from the air in pale grey (Esri World Imagery; the OpenStreetMap streets where a photo tile is missing, `viewer/groundmap.js`). Rooftops, lattice towers and monopoles are drawn; a tower's structure (legs and bracing, or a tapered tube, a platform at each antenna level, arms to the antennas) is built from the antennas' heights and follows the plan. Buildings within 150 m are analysed (EMF, sensitive uses, occupancy); those from 150 to 400 m are drawn lighter, for context only (`context` in the twin, `scripts/add_context.py` for older twins). On opening, the site is built up in front of the engineer (`viewer/intro.js`) and seen as a drone would film it; **Orbit** turns slowly around it until the view is touched. Undo and reset are always one click away.
6. **Expert Operator** (`viewer/agent.js`). Muse Spark Open, served on Baseten, with tools that run on the live twin: `evaluate_change` (up to four options in one call, each with its EMF conflicts, roof, coverage and field work), `apply_change`, `undo_last_change`, `set_view`, `get_field_work_order`, `open_site` and more. It starts from a briefing of the site and the people around it, so a goal ("fix the school issue with the smallest change") usually takes three or four model calls: compare options, apply the best, answer. It also carries out direct instructions ("remove S2-A", "add 5G on sector 1", "show N3500 coverage", "undo") and quotes only numbers the tools returned. Opened from the map, the twin says the site's problem again with one button to analyse it. While the model works, the chat lists what is being looked at with the site's own figures. The answer comes in plain language for a non-engineer (how the site works today, what happens in about a year if nothing changes, what would improve it), then one open card with the options it compared, the recommended one first. Applying one plays the change: the plan's steps first, then each step in the manual-adjustment card and on the 3D view (before, change, after), the operator replying once it has played. More power is not offered as more capacity: it widens the coverage, the cell has the same resource blocks. A band that loses 30% or more of its coverage is flagged as a heavy cost. **Voice:** push-to-talk audio goes to Muse Voice Transcribe; replies can be read aloud.
7. **Field crew and action plan** (`viewer/fieldwork.js`, `viewer/crew.js`, `viewer/actionplan.js`). Every applied change becomes physical work: remote (OSS/RET) or on site, headcount, days, tools, materials and precautions. **Action plan** puts the site (address, coordinates, map link), why the plan is made (a safety finding first; for a sector the plan adds capacity to, its measured load or the people it serves and when it gets busy), the work, the expected result (the capacity gained, then what is fixed or still open), crew, steps, tools, materials and precautions into one document to e-mail to the site chief, copy, print or share, with a **before / after** picture of the 3D view.
   On the map, "fix every site that needs action" starts a **portfolio tour**: the agent opens each problem site in turn (most urgent first), fixes it, and the map ends with one combined action plan.
8. **Photos** (`viewer/photo.js`, `sitetwin3d/extract.py`, `sitetwin3d/build_site.py`). The camera icon in the chat sends a site photo to Muse Spark 1.3; the Expert Operator compares what it saw with the twin. From the command line, whole survey folders can be read; drone photos with compass heading place neighbouring buildings. Results are cached by image hash.

## Quick start

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Windows; use .venv/bin on macOS/Linux
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m sitetwin3d.server          # http://localhost:8765
```

- Map of the five sample sites: http://localhost:8765/portfolio.html?portfolio=data/samples/portfolio.json
- Single synthetic twin: http://localhost:8765/
- The interface follows the browser language (Turkish or English); switch with the language button.
- Load your own file: **Load file** on the map, or `python -m sitetwin3d.portfolio FILE.json --out viewer/data/private`.

The Expert Operator needs `BASETEN_API_KEY`; voice and photo extraction need `MODEL_API_KEY` (Meta Model API). Put them in `.env` (see `.env.example`), never in the repo.

## Data

- `samples/sitetwin/`: five synthetic site files, each with an invented `network_kpi` block (`scripts/sample_kpi.py`; Adana's S2 L1800 is full in the busy hour, which the population estimate does not show). Antenna data is invented; positions are ordinary city blocks, not real base-station sites. `scripts/make_samples.py` regenerates them.
- Real operator site files and anything derived from them stay in `data/private/`, `viewer/data/private/` and `viewer/data/uploads/`, which git ignores.
- Building footprints © Microsoft (Global ML Building Footprints, ODbL). Building uses and map tiles © OpenStreetMap contributors (ODbL). Aerial imagery: Esri, Maxar, Earthstar Geographics (World Imagery).
- A site's general-view photo comes from the "GENEL GÖRÜNÜM" page of its previous BTK report (`sitetwin3d/btk_photo.py`): taken on import when the SiteTwin file names a report found on this machine, or added to older twins with `scripts/add_overview_photos.py`. Public samples never carry one.
- `docs/research/operator-change-planning.md`: sourced notes on why and how operators change sites, used to brief the Expert Operator.

## Privacy and data flow

- The public demo runs on the five synthetic sample sites only. Real operator site files, their photos and anything derived from them stay on the engineer's machine (`data/private/`, `viewer/data/private/`, `viewer/data/uploads/`, all git-ignored).
- What leaves the machine, and to whom: the Expert Operator's briefing and tool results (antenna data, neighbouring buildings and their uses, measured load) go to Muse Spark Open on Baseten; a photo sent from the chat and push-to-talk audio go to the Meta Model API; the site's coordinates reach the map tile servers (OpenStreetMap, Esri) as tile requests. Addresses stay in the portfolio index and the action plan, which is only sent when the engineer e-mails it.
- API keys live in `.env`, never in the repo.

## Limits

EMF zones are a screening estimate (far field, a fixed vertical slab, no near-field or tilt shrink) and do not replace an accredited on-site measurement. Coverage is indicative: Hata models extrapolated above 2 GHz, no terrain, clutter or building shadow. Without `network_kpi` in the site file, capacity is estimated from the people around the site; with it, it is the measured load before the plan (the effect of a change on PRB is not predicted). "Next year" and "gets busy in about N months" assume about 20% traffic growth a year, an indicative figure. Most Turkish buildings have no height in the open data; 5 storeys are assumed and flagged.

If the Expert Operator cannot be reached (no key, no network, quota), the chat says so and everything else keeps working: the map, the 3D twin, the checks, manual changes and the action plan.

## License

MIT
