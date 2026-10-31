# Expert Operator: measured runs

Thirteen requests on the five sample sites, **three runs each** (39 runs), every run on a fresh twin
page with no stored plan, against the real models (31 Oct 2026, local server, English interface).
Measured with `scripts/agent_eval.js`: every model call and which model answered, time to the
answer, every tool step of the run and which failed, the decision card, whether the plan changed,
and the twin's own status after it. All 39 records, with the full answers, are in
[runs-2026-10-31.json](runs-2026-10-31.json).

Each request has a pass rule, fixed before the runs (below). The model's wording and options vary
between runs; three runs show how much.

## Summary

| | Result |
|---|---|
| Runs answered without an error | 39 / 39 |
| Runs that met their request's pass rule | 37 / 39: 12 of the 13 requests in all three runs, G7 in one |
| Analyses (Analyse button) | 15 / 15 left the plan unchanged, each with a decision card of 3–4 options |
| Direct instructions (G3–G6, including the "already done" G5a) | 15 / 15 carried out as asked |
| Safety goals | G1 (school) 3 / 3, G2 (hospital) 3 / 3, G7 (school and capacity) 1 / 3 |
| Tool steps | 55, of which 1 failed: one tested option in G7 run 2 came back with an error (its message was not recorded) |
| Model calls per request | 2–4, 94 in all |
| Time to the answer | median 22 s, longest 66 s |
| Calls answered by the fallback (Muse Spark 1.3) | 5 of 94, each when Baseten failed or ran past its 30 s; every one of those runs completed |

No run left a school or hospital in a zone after a change it made itself.

## Pass rules

| Request | Passes when |
|---|---|
| R1–R5, Analyse button | No error, the plan is unchanged, a decision card with at least 2 options |
| G1 | The plan changed and no school or hospital is in an EMF zone after it |
| G2 | The plan changed and no hospital is above 3 V/m after it |
| G3 | The plan changed on a sector-2 antenna |
| G4 | N3500 added on a sector-1 antenna |
| G5a | The plan is unchanged and the answer says it already was so |
| G5 | S3-1 at 10 W on all three of its bands |
| G6 (after G5, same page) | The plan is back to the baseline |
| G7 | The plan changed, the school is out of the zone, and a band was added |

## Runs

| # | Site | Request | Passed | Calls | Time (s) | What happened |
|---|---|---|---|---|---|---|
| R1 | Ankara | Analyse button | 3 / 3 | 2 | 14–19 | Cards of 3–4 options; recommended each time: raise the antenna facing the school (EMF conflicts 4 → 3) |
| R2 | Bursa | Analyse button | 3 / 3 | 2 | 18–22 | Cards of 4 options; recommended: raise the east antenna (EMF conflicts 1 → 0, the one being the hospital) |
| R3 | Adana | Analyse button | 3 / 3 | 2 | 15–17 | Cards of 3 capacity options; recommended: add 5G facing south |
| R4 | Istanbul | Analyse button | 3 / 3 | 2 | 14–50 | Cards of 3–4 options for the roof restriction; in run 2 the recommended one costs L1800 −31% coverage, shown on the card. Run 3: Baseten ran past 30 s and Muse Spark 1.3 answered |
| R5 | Izmir | Analyse button | 3 / 3 | 2 | 18–22 | Cards of 3 capacity options; recommended: a new layer facing west or south-west |
| G1 | Ankara | "Fix the school issue with the smallest change." | 3 / 3 | 3 | 33–35 | S3-1 power 40 → 15 W on its three bands each time; the school is out of the zone |
| G2 | Bursa | "Bring the hospital below 3 V/m and keep as much coverage as you can." | 3 / 3 | 3 | 29–40 | S1-1 raised 28 → 39 m (runs 1, 2), or turned 90° → 60° and raised to 32 m (run 3); no building in a zone |
| G3 | Adana | "Add capacity on sector 2." | 3 / 3 | 3 | 38–66 | L2100 added on S2-1, and N3500 too in runs 2 and 3 |
| G4 | Izmir | "Add N3500 on sector 1." | 3 / 3 | 3 | 25–30 | N3500 added on S1-2, one of sector 1's two antennas |
| G5a | Istanbul | "Lower S3-1 to 20 W on every band." | 3 / 3 | 2 | 7–11 | S3-1 was already at 20 W on every band: the operator said so and changed nothing |
| G5 | Istanbul | "Lower S3-1 to 10 W on every band." | 3 / 3 | 2 | 24–29 | Power 20 → 10 W on the three bands |
| G6 | Istanbul | "Undo that." (after G5) | 3 / 3 | 2 | 4–5 | Plan back to the baseline |
| G7 | Ankara | "Okulu etkilemeden, en az saha işiyle güney kapasitesini artır; kapsama kaybı olursa söyle" | 1 / 3 | 3–4 | 32–49 | See below |

### G7: three constraints at once

The request asks for capacity in the south, the school left out of the zone, and the least field
work. The three runs ended differently:

1. **Applied:** S3-1 raised 17.5 → 22 m, power 40 → 15 W, N3500 added. The school is out of the zone,
   the busy sector gains capacity, no heavy coverage loss.
2. **No change:** four options tested, none of them both added capacity and cleared the school. The
   operator said so, explained that lowering the power clears the school but adds no capacity, and
   left the plan as it was; the card lists the four options.
3. **Recommended, not applied:** it found the same kind of option as run 1 (S3-1 raised, power down,
   5G added; EMF conflicts 4 → 3, which its answer says is the school) and recommended it first on
   the card, but left adding it to the operator instead of adding it itself.

In none of the three did it apply a change that left the school in the zone. Runs 2 and 3 also
said that the school's height is assumed (5 storeys) and should be measured first.
