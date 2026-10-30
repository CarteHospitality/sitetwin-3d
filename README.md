# SiteTwin 3D

Turn a telecom site survey (photos and walk-around video) into an interactive **3D digital twin** with **EMF safety zones** drawn as 3D volumes, using Meta models.

Built for the Meta Global AI Developer Hackathon (Indie track).

## What existed before vs. what is new

- **Pre-existing (not in this repo):** SiteTwin, my private site-engineering tool. It produces regulatory EMF reports and site-survey documents from field data.
- **Built during the hackathon (everything in this repo):** this standalone 3D digital-twin module. It does not import or contain SiteTwin code, and it runs on its own with the synthetic sample site included here. The EMF calculation here was written from scratch for this module.

## How it works

1. **Photos → structured observations.** Each survey photo goes to Muse Spark Open (open weights, served on Baseten), which returns equipment data as JSON: antenna type, labels, radios, cabinets.
2. **Video → tracked equipment.** SAM 3.1 segments and tracks antennas and radios across the walk-around video.
3. **Observations → site model.** An agent merges the per-photo findings into one `SiteModel` (`sitetwin3d/schema.py`) and lists what is still unknown.
4. **Site model → EMF zones.** `sitetwin3d/emf.py` computes a conservative far-field safety distance for each antenna, summing the exposure ratios of all its bands.
5. **3D change planner.** `viewer/` (three.js) renders the twin and lets an engineer plan a change on one screen:
   - select an antenna, change azimuth, tilt, height, position and per-band power, add a 5G band or a new antenna;
   - EMF zones recompute live (`viewer/emf.js`, kept identical to the Python code by `tests/test_emf_parity.py`);
   - checks flag zones that reach a neighbouring building and roof area that needs restricted access;
   - an indicative coverage layer (Hata models, no terrain) compares bands and plans;
   - the baseline stays visible as a wireframe, the change list is generated, and the plan exports as JSON.

6. **Planning assistant (agent on open weights).** Ask in plain language: *"Fix the neighbour conflicts with the smallest change"* or *"Add 5G N3500 to sector 2 without new conflicts"*. Muse Spark Open (served on Baseten) plans the work and calls three tools that run in the browser on the live twin: `get_site_state`, `evaluate_change` (try an option on a copy) and `apply_change`. It compares options with the same EMF, conflict and coverage code the engineer sees, applies the best one and reports before/after figures taken from the tools. The API key stays on the server (`sitetwin3d/server.py`).

Steps 1-3 are in progress. Steps 4-6 work today with the sample site.

## Quick start

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt     # Windows; use .venv/bin on macOS/Linux
.venv/Scripts/python -m pytest -q
.venv/Scripts/python -m sitetwin3d.export samples/demo-site/site.json -o viewer/data/site.twin.json
.venv/Scripts/python -m sitetwin3d.server
```

Then open http://localhost:8765. The viewer and planner also work as static files (`python -m http.server --directory viewer`); only the assistant needs the server and a `BASETEN_API_KEY`.

API keys go in `.env` (see `.env.example`), never in the repo.

## Data

Only synthetic or anonymised data is committed. Real operator site data stays in `data/private/`, which git ignores.

## EMF method and limits

Far-field point-source model, `S = EIRP / (4πr²)`, with ICNIRP general-public reference levels. The default `tr` regime allows a single device 20% of the ICNIRP field strength (12.3 V/m above 2 GHz), as Turkish BTK rules do. This is a screening estimate and does not replace an accredited on-site measurement.

## License

MIT
