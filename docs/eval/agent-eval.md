# Expert Operator: measured runs

Fourteen requests on the five sample sites, each on a fresh twin page, against the real models
(31 Oct 2026, local server, English interface). Measured with `scripts/agent_eval.js`: model calls
and which model answered, time to the answer, failed tool calls, the decision card, whether the plan
changed, and the twin's own status after it. One run per request: the model's wording and options
vary between runs.

## Summary

| | Result |
|---|---|
| Requests answered without an error | 14 / 14 |
| Failed tool calls | 0 |
| Analyses (Analyse button) that left the plan unchanged | 6 / 6, each with a decision card of 3–4 options |
| Instructions and goals carried out | 7 / 7, plus one "already done" answered without a change (G5a) |
| School or hospital out of the zone after a safety goal | 3 / 3 (G1, G2, G7) |
| Model calls per request | 2–3 |
| Time to the answer | median 18 s, longest 61 s |
| Calls answered by the fallback (Muse Spark 1.3) | 1: in R5 a Baseten call ran past 30 s; the request still completed |

## Runs

| # | Site | Request | Calls · time | Outcome |
|---|---|---|---|---|
| R1 | Ankara | Analyse button | 2 · 20 s | Card of 4 options, recommended "Raise the southwest antenna much higher" (EMF conflicts 4 → 3); plan unchanged |
| R2 | Bursa | Analyse button | 2 · 16 s | Card of 4 options, every one clears the hospital (conflicts 1 → 0); plan unchanged |
| R3 | Adana | Analyse button | 2 · 21 s | Card of 3 capacity options; plan unchanged |
| R4 | Istanbul | Analyse button | 2 · 16 s | Card of 3 options for the roof restriction; the recommended one clears the roof at the cost of L1800 coverage −31%, shown on the card; plan unchanged |
| R5 | Izmir | Analyse button | 2 · 61 s | Card of 3 capacity options; one Baseten call timed out and **Muse Spark 1.3 answered it**; plan unchanged |
| R6 | Adana | Analyse button (again) | 2 · 13 s | Card of 3 capacity options; plan unchanged |
| G1 | Ankara | "Fix the school issue with the smallest change." | 3 · 20 s | S3-1 power 40 → 18 W on three bands; the school is out of the zone |
| G2 | Bursa | "Bring the hospital below 3 V/m and keep as much coverage as you can." | 3 · 20 s | S1-1 raised 28 → 39 m; no building in a zone |
| G3 | Adana | "Add capacity on sector 2." | 3 · 20 s | L2100 added on S2-1; the busy cell's sector gains capacity |
| G4 | Izmir | "Add N3500 on sector 1." | 3 · 17 s | N3500 added on S1-1; the status then shows a new roof restriction and that the 3 V/m distance reaches 217 m, beyond the 150 m check |
| G5a | Istanbul | "Lower S3-1 to 20 W on every band." | 2 · 12 s | S3-1 was already at 20 W on every band: the operator said so and changed nothing |
| G5 | Istanbul | "Lower S3-1 to 10 W on every band." | 2 · 15 s | Power 20 → 10 W on three bands |
| G6 | Istanbul | "Undo that." (after G5) | 2 · 5 s | Plan back to baseline |
| G7 | Ankara | "Okulu etkilemeden, en az saha işiyle güney kapasitesini artır; kapsama kaybı olursa söyle" | 3 · 33 s | S3-1 raised 17.5 → 25 m, power 40 → 20 W, N3500 added; the school is out of the zone; it answered the coverage question (no heavy loss). It took "south" as the south-west sector, the one with the busy cell, and said so |
