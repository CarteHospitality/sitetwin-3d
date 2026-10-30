# SiteTwin 3D

A **3D digital twin and change planner for mobile base-station sites**, built on Meta models. Load a site file, and every site is checked automatically on a map; open one and an **Expert Operator** agent (Muse Spark Open, by text or voice) finds the problem and simulates the fix: EMF safety zones against real neighbouring buildings, sensitive buildings like schools and hospitals, rooftop safety, capacity and coverage.

Built for the Meta Global AI Developer Hackathon (Indie track). Demo video: _link to be added_.

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
planned add/remove/replace         Microsoft footprints,       capacity, pending         voice via Muse Voice
                                   OpenStreetMap uses          changes)                  Transcribe)
```

1. **Import** (`sitetwin3d/importers/sitetwin.py`, `sitetwin3d/portfolio.py`). The site file gives the engineering data: sectors, antennas with their planned action (retain / add / remove / replace), heights, azimuths, tilts, power per band and the structure (rooftop, tower, monopole). From the site's coordinates the importer fetches the real roof outline and neighbouring buildings (Microsoft Global ML Building Footprints) and their uses (OpenStreetMap: schools, kindergartens, health facilities). Every value it has to assume is listed in the twin's notes. Address and coordinates are not copied into the twin; they stay in the portfolio index, for the action plan.
2. **EMF zones** (`sitetwin3d/emf.py`, `viewer/emf.js`). Conservative far-field safety distance per antenna, exposure ratios summed over its bands, with the Turkish single-device limit (20% of the ICNIRP field strength, 12.3 V/m above 2 GHz). The browser and Python versions are kept identical by `tests/test_emf_parity.py`.
3. **Checks** (`viewer/checks.js`). Which zones reach which neighbouring buildings (and whether they are sensitive), how much walkable roof is inside a zone at head height, estimated occupancy per building and per antenna (`viewer/population.js`).
4. **Portfolio map** (`viewer/portfolio.html`). Every site coloured by urgency: critical (sensitive building in a zone), action needed, review, change planned, OK. Click a site for its issues and open its twin. **Load file** adds a new site.
5. **3D change planner** (`viewer/index.html`). Edit antennas (azimuth, tilt, height, position, power per band, add a band or an antenna), see zones, checks and an indicative coverage layer update live, compare with the baseline. Undo and reset are always one click away.
6. **Expert Operator** (`viewer/agent.js`). Muse Spark Open, served on Baseten, with tools that run on the live twin: `evaluate_change` (up to four options in one call), `apply_change`, `undo_last_change`, `set_view`, `get_field_work_order`, `open_site` and more. It starts from a briefing of the site and the people around it, so a goal ("fix the school issue with the smallest change") usually takes three or four model calls: compare options, apply the best, answer. It also carries out direct instructions ("remove S2-A", "add 5G on sector 1", "show N3500 coverage", "undo") and quotes only numbers the tools returned. Opened from the map, it reviews the site on arrival. **Voice:** push-to-talk audio goes to Muse Voice Transcribe; replies can be read aloud.
7. **Field crew and action plan** (`viewer/fieldwork.js`, `viewer/crew.js`, `viewer/actionplan.js`). Every applied change becomes physical work: remote (OSS/RET) or on site, headcount, days, tools, materials and precautions. **Action plan** puts the site (address, coordinates, map link), the reason, the work, the expected result, crew, steps, tools, materials and precautions into one document to e-mail to the site chief, copy, print or share, with a **before / after** picture of the 3D view to share.
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

- `samples/sitetwin/`: five synthetic site files. Antenna data is invented; positions are ordinary city blocks, not real base-station sites. `scripts/make_samples.py` regenerates them.
- Real operator site files and anything derived from them stay in `data/private/`, `viewer/data/private/` and `viewer/data/uploads/`, which git ignores.
- Building footprints © Microsoft (Global ML Building Footprints, ODbL). Building uses and map tiles © OpenStreetMap contributors (ODbL).
- `docs/research/operator-change-planning.md`: sourced notes on why and how operators change sites, used to brief the Expert Operator.

## Limits

EMF zones are a screening estimate and do not replace an accredited on-site measurement. Coverage is indicative (Hata models, no terrain or clutter). Most Turkish buildings have no height in the open data; 5 storeys are assumed and flagged.

## License

MIT
