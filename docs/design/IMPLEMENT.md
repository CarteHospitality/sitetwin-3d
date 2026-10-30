# Task: implement the design plan, all four phases

Implement `docs/design/ui-plan.md` in this repository, Phase 1 through Phase 4, in order. Read the
plan first, then the current code (`viewer/*.html`, `viewer/*.js`, `viewer/ui.css`). You wrote the
plan; now build it carefully and completely.

## Ground rules

- You are on git branch `design-phases`. **Commit after each phase** (and more often if useful) with a
  clear message, e.g. `Design phase 1: tokens, type, layout, map and scene palette`. End every commit
  message with the line `Co-Authored-By: Codex (gpt-6.1-sol) <noreply@openai.com>`. Do not push, do
  not switch branches, do not rewrite history.
- No build step, no framework. CDN libraries only from cdnjs / jsDelivr / unpkg with pinned versions.
  Keep three.js `0.160.0` and Leaflet `1.9.4`. Keep ES modules as they are organised now.
- Only touch `viewer/` and, if a phase needs it, `docs/design/`. Do **not** touch `sitetwin3d/`
  (Python), `tests/`, `samples/`, `scripts/`, `.env`, `data/`, `viewer/data/`.
- Keep every existing feature working. In particular:
  - Both agents (map and 3D) and all their tools: `get_site_state`, `evaluate_change`,
    `apply_change`, `undo_last_change`, `get_population_context`, `set_view`,
    `get_field_work_order`, `list_sites`, `open_site` (3D) and `list_sites`, `focus_site`,
    `open_site` (map). `evaluate_change` must never change the visible scene.
  - Voice: push-to-talk -> `api/transcribe`; replies are spoken **only** when the request was
    spoken (`ask(text, { voice: true })`); the voice flag is carried across pages via `voice=1`.
    The recorder race is already fixed in `voice.js` (each recording keeps its own recorder);
    keep that fix.
  - URL parameters: `twin`, `ask`, `auto=review`, `from`, `portfolio`, `voice`. The handoff
    instruction must run once only (plan section on sessionStorage) and never re-apply on reload.
  - Portfolio: Load SiteTwin file (`api/import`), ranking, Actions taken log, open twin button.
  - Planner: sliders editor, add/remove antenna and band, baseline layer, coverage layer and band
    picker, EMF regime select, export plan, field work order panel, checks, antennas table, notes.
  - `replyHtml()` safe rendering of assistant text.
  - Shared logic stays shared: `checks.js`, `emf.js`, `population.js`, `fieldwork.js`,
    `coverage.js`. Do not change EMF/coverage maths (only display colours/alpha for coverage).
- Respect `prefers-reduced-motion` everywhere, as the plan says.
- Turkish text must render (Inter latin-ext).

## Checks you must run before each commit

- `node --check` on every changed `.js` file.
- `node --input-type=module -e "import('./viewer/agent.js')"` (and the other pure modules) must import.
- `.venv\Scripts\python -m pytest -q` must stay green (7 tests; includes JS/Python EMF parity).
- A local server is normally running at http://127.0.0.1:8766 (`python -m sitetwin3d.server`). Use
  it with curl to confirm pages and modules are served (HTTP 200). If you can drive a browser, open
  `/portfolio.html?portfolio=data/samples/portfolio.json` and
  `/index.html?twin=data/samples/sites/sample-01_ankara.twin.json&portfolio=data/samples/portfolio.json`
  and look for console errors.

## When done

Write `docs/design/IMPLEMENTATION-NOTES.md`: what you implemented per phase, what you deliberately
skipped or simplified and why, anything not verified, and a short manual test script for a human
(10-15 steps covering map, voice, agent apply, cleared-conflict animation, transitions, field work,
reduced motion). Commit it. Your final message: a summary of the commits.
