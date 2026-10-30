# UI design implementation

30 October 2026 · branch `design-phases`

The four implementation phases were carried out in order. Code is present in
the working tree. **Acceptance and commits are incomplete:** this environment
denied Git index writes and execution of the installed Node/Python binaries;
Chrome UI access was also rejected. No commit hashes or passing pytest result
are claimed below. Nothing was pushed, no branch was switched, and history was
not rewritten.

## Phase 1 — visible foundation

- Applied the plan's tokens, pinned Inter 400/500/600 (Latin and Latin Extended,
  Fontsource 5.0.16), tabular metrics, readable controls, and projector contrast.
- Added the shared 56px shell, site/portfolio breadcrumb, simulation context,
  real layer/suggestion buttons, six portfolio count cells and status filters.
- Replaced stacked panes with inspector/chat drawers at 1180/900px and mobile
  navigation below 768px. Drawers trap focus, make the background inert, close
  with Escape, and restore trigger focus. The composer stays in the chat pane.
- Added sticky inspector counts and Summary / Antennas / Work order tabs,
  grouped findings, Locate actions, expandable notes and numeric slider pairs.
- Kept Leaflet 1.9.4 and standard OSM tiles; filtering affects only the tile
  pane. Pins retain severity when selected and have 32px targets. Critical rings
  run twice, on at most three entry pins. Cards use safe DOM text.
- Applied the scene palette, standard materials, illustrative lighting, fog,
  45° camera and 1.5 DPR cap. Both envelope lobes use the checker's half-height.

`ui.js` owns the shared shell, tokens, tabs, focus behavior and reduced-motion
preference. Its addition avoids duplicating the same controls across pages.

## Phase 2 — explain the action

- `createAgent()` serializes requests with separate voice modes, emits actual
  queued/start/end events, and retains `ui.tool()` compatibility. Both agents
  keep all their existing tool definitions and handlers.
- `conversation.js` provides keyed run activity, real elapsed times, exact
  expandable arguments/results, grouped evaluations, failure states, waiting
  dots, the ten-second waiting caption, polite announcements, and conditional
  autoscroll with a New activity button. Assistant text still uses `replyHtml()`.
- `scene.js` keeps antenna/envelope objects and materials by ID. Apply and undo
  commit the model and final checks before animating; evaluation stays invisible.
  Applied transforms take 320ms, azimuth follows the shortest path, and tilt only
  rotates the panel. Final boundaries remain visible during interpolation.
- New conflicts turn red immediately. Cleared buildings remain red until the
  geometry settles, fade for 480ms, then receive a 900ms acknowledgement. Other
  conflicts stay red. Reduced motion applies endpoints and static confirmation.
- Added cancellable, bounds-fitted camera travel, Overview / Selected antenna,
  persistent finding labels, frame-coalesced direct edits, keyed antenna rows,
  native numeric steps, exact action deltas and undo snapshots.
- Map focus uses Leaflet's native 1.15-second flight, immediate selection,
  move-end cards, no repeated flight to the same site, and cancellation on drag
  or wheel. Stable keyed ranking uses FLIP, focus/scroll retention and an
  interaction lock with Ranking updated.
- Reworked voice around recording-local recorder/MIME/chunks/stream ownership;
  the existing recorder race fix is retained. Added pointer capture, hold/toggle
  and Space handling, early-release permission cancellation, real RMS bars,
  reduced-motion input text, visible failures, track/analyser/context cleanup,
  read-aloud control and Stop speaking. Only spoken requests invoke TTS.
- Navigation waits for speech start/end/error or explicit stop, rather than a
  four-second delay. Manual page departure prevents a late navigation callback.

`motion.js` supplies the specified easing curves. Scene animation uses one
renderer loop and stops when controls, edits and motion settle.

## Phase 3 — continuity and review

- Added native cross-document brand/map transitions and ordinary navigation
  fallback. The useful loading shell and drawers initialize before data fetch.
- `session.js` stores map bounds, selection/filter/actions, a short display
  transcript, explicit handoff IDs and source-bound proposed plans. It never
  restores model execution history. Restored transcript text is labelled as
  display continuity.
- Handoffs are consumed before the first model call. Both `ask` and `auto=review`
  carry `voice=1`. When storage is unavailable, the consumed command is removed
  from the history URL so refresh still cannot replay it.
- Proposed plans are keyed by canonical twin URL, site ID and regime, validated
  against an exact source/baseline fingerprint and source geography. The map
  reruns the shared checks under each site's displayed regime, including on
  bfcache return. Stale/unreadable context loads the original assessment with an
  explanation. Pins, rows and counts derive from that assessment.
- Added exact timestamped plan actions with before/after counts, baseline
  comparison, the sequential coverage legend and alpha 0.48, transparent values
  below −110 dBm, and explicit missing-result text. The texture uses sRGB and is
  untone-mapped. A pending new result hides the obsolete heatmap instead of
  relabelling it. Hidden coverage does not trigger texture uploads.
- Work orders have grouped work/material/precaution cards. Export retains the
  existing plan fields and adds the action ledger and derived work order.
  Saving a session proposal never writes the source twin.

## Phase 4 — scene refinement and recording support

- Added the plan's r160 Fresnel envelope shader, selected boundary emphasis,
  sparse site/selected/affected outlines (at most eight neighbouring outlines),
  simple generic mounting details, projected north and target-plane scale.
- Added one frozen 1024² PCF soft shadow map, the specified bounds/bias, at most
  40 neighbouring casters, and receiving context. The pinned directional-light
  shader retains at least 78% of direct light in shadows; lighting still needs
  visual review. Grid lines fade by 150m. Transparent ordering is approximate
  back-to-front ordering with opaque depth testing retained.
- Data notes contain a real 20-second orbit/edit profiler: p95 frame interval,
  peak main-pass calls/triangles, estimated texture memory and DPR. A failed
  frame budget reduces DPR to 1; a subsequent failure disables optional shadows
  and unselected neighbour outlines. A final redraw follows a quality change.
  A hidden/interrupted profile is marked incomplete.
- A CPU-only 12-antenna, 150×150 coverage experiment in the validation runtime
  took about 667–717ms synchronously. This justified the plan's scheduling
  exception: display coverage now yields between antenna rows after a 3ms
  budget, cancels obsolete work and starts the final calculation on release.
  The shared row formula, antenna order and Float32 writes are unchanged.
  All 22,500 cells matched the pre-change implementation exactly, synchronously
  and asynchronously. This CPU observation is not a browser/GPU benchmark.

Shadow implementation reference: [three.js r160 lighting chunk](https://github.com/mrdoob/three.js/blob/r160/src/renderers/shaders/ShaderChunk/lights_fragment_begin.glsl.js).

## Deliberate simplifications

- The 3D stage itself does not opt into a WebGL snapshot transition until Windows
  Chrome capture can be inspected. Brand continuity and the loading-shell
  fallback work without that snapshot; the map stage opts in. This avoids
  accepting an unverified blank WebGL transition.
- Reveal orbit and decorative radio arcs remain off. No light theme,
  post-processing, replacement map engine or runtime animation dependency was
  introduced. No clustering dependency is loaded for the five-site demo;
  portfolios over 100 sites still need the plan's conditional clustering work.
- Geometry and conversation responsibilities were extracted into small viewer
  modules instead of growing two duplicated page controllers. Existing EMF,
  checks, occupancy and field-work rules remain shared and unchanged. Coverage
  changes are display palette/alpha and measured scheduling only.
- Session plan/action persistence does not restore the old agent tool history
  or its undo stack. New changes in the current page remain undoable; the
  restored proposed plan and baseline remain reviewable/exportable.

## Verification and outstanding acceptance

Completed:

- Every changed/new JS module parsed with Node `vm.SourceTextModule`. Shared
  modules imported through the available Node REPL.
- An isolated DOM/renderer harness using real three.js **r160 geometry** booted
  both pages. It checked invisible evaluation; persistent objects/materials;
  apply/undo; exact slab heights; reduced-motion endpoints; idle rendering;
  before/after action counts; partial conflict clearing (four buildings to two,
  with the remaining two red); the 900ms acknowledgement; export/work-order
  data; source-bound reload; and redraw after a DPR fallback. Rendering was
  mocked: these are behavioral checks, not visual or GPU acceptance.
- The map harness checked all five assessments, six counts including zeros,
  filters/reset, keyed row identity, native flight options, repeat selection,
  reduced-motion focus, all three map-agent tools and instruction/voice handoff.
- Voice resource mocks checked early permission release, denial/typed fallback,
  RMS/reduced-motion meter, recording-local MIME ownership, WAV/transcription
  plumbing and cleanup. Speech mocks checked start/end promise coordination.
- Agent checks covered real start/handler/end ordering, queued voice isolation,
  typed silence and safe rendering. Session checks covered stale rejection,
  exact-once handoff, disabled-storage fallback and unchanged source data.
- Coverage matched HEAD's numerical results cell-for-cell; cancellation and
  threshold/alpha painting were checked.
- Both requested sample page URLs and all viewer modules/styles returned HTTP
  200 from `http://127.0.0.1:8766`. `git diff --check` passed.

Not verified:

- The requested CLI `node --check` / CLI import commands were attempted before
  phase commit attempts, but the shell could not execute the installed Node.
  `.venv\Scripts\python -m pytest -q` could not start its base Python executable
  (access denied). **The seven pytest tests, including JS/Python EMF parity,
  have not been run successfully in this session.** REPL checks do not replace
  those required checks.
- Automatic approval rejected Chrome Computer Use with “Computer Use was not
  approved to use Google Chrome”; the browser host was unavailable too. Actual
  console errors, desktop/touch layouts, fonts, three-angle transparency, WebGL
  transition capture, live Turkish microphone/provider round trip, real import,
  250-building GPU/recording budget and compressed 720p readability need human
  verification. No recording or successful demo rehearsal is claimed.
- Source data was left intact. In the sample fixture, an existing antenna
  position can be outside the source roof polygon; the existing planner
  validation rejects such an edit unless it also specifies a valid position.
  No source-data correction or site-specific exception was added.

Git add/commit attempts after phases 1–4 failed with
`Unable to create .../.git/index.lock: Permission denied`. The notes commit was
also attempted under the same restriction. Intended commit subjects were:

1. `Design phase 1: tokens, type, layout, map and scene palette`
2. `Design phase 2: real activity, reliable voice and persistent scene motion`
3. `Design phase 3: one-time handoff, source-bound plans and review continuity`
4. `Design phase 4: Fresnel scene, bounded shadows and recording performance`
5. `Document design implementation and manual acceptance checks`

Every attempted message ended with
`Co-Authored-By: Codex (gpt-6.1-sol) <noreply@openai.com>`.
An unrelated untracked `viewer/crew.js` appeared during work and was left intact.
It was not included in the explicit final staging attempts.

## Manual test script

1. Open `/portfolio.html?portfolio=data/samples/portfolio.json` at 1440×900 and
   1920×1080. Enable Projector contrast; inspect Turkish glyphs and six counts.
2. Tab through pins and site rows; check the delayed card, severity/selection,
   status filters and Clear filter. Confirm zero counts remain visible.
3. Test inspector/chat breakpoints and mobile navigation. Trap Tab in a drawer,
   press Escape and verify trigger focus returns; check composer reachability.
4. Load a disposable SiteTwin JSON through Load SiteTwin file. Verify import
   status, one ranked entry, pin, actions log and Open 3D twin.
5. Ask a typed portfolio question. Check actual activity/results and no speech.
   Scroll up during a slow request: retain position and show New activity; after
   ten seconds verify actual elapsed waiting text.
6. Deny microphone permission, then type successfully. Try a long hold released
   before granting permission; ensure no stream remains active. Test click toggle
   and focused-mic Space hold/release.
7. Speak Turkish: “Ankara'yı aç ve okul çakışmasını incele.” Check measured input,
   transcription, spoken reply/Stop speaking and the instruction/voice handoff.
8. Refresh the opened twin and use Back. Confirm no second automatic instruction
   or extra apply. Verify map bounds/selection and reassessed proposal counts;
   previous conversation must be labelled display-only.
9. Locate a sensitive finding. Confirm its identity, antenna and boundary fit in
   view. Drag/wheel during travel to cancel; test Overview and Selected antenna.
10. Ask for two evaluated options and one applied fix. Evaluations must not move
    geometry. Check one plan action, final outline, Updating view, settled
    geometry, 480ms clearing and the 900ms acknowledgement. Keep unresolved
    buildings red and compare the exact before/after counts.
11. Undo; compare original geometry and findings. Edit sliders/numeric inputs
    with keyboard arrows (height step 0.5m), add/remove a band and antenna, and
    verify checks, band picker and undo remain usable.
12. Toggle baseline and coverage; change coverage band and EMF regime. Confirm
    numeric same-band/threshold comparison, neutral-to-yellow legend, transparent
    below-range/no-result behavior, and correct per-site regime on map return.
13. Open Work order; inspect steps/materials/precautions, remaining counts and
    limitations. Export the plan; inspect baseline, proposed, zones, checks,
    actions and field work. Confirm source twin files were not overwritten.
14. Change reduced-motion preference before and during camera/apply activity.
    Verify instant endpoints, static pins/typing/input text and no page animation.
15. With a 250-building/12-antenna case, run the 20-second profiler while recording
    orbit/edit actions. Inspect real budgets and any fallback, three envelope
    angles, and a 720p compressed export. Rehearse the seven plan shots through
    the final work order/download; report partial results plainly.
