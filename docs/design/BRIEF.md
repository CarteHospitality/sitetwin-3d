# Design brief: make SiteTwin 3D look and feel world-class

You are a senior product designer and creative technologist. Research, think hard, look at excellent
reference products, and write a **design and motion plan** for this web app. Do **not** change any code
or any file except the one deliverable below.

## The product

SiteTwin 3D is a 3D digital twin and change planner for mobile base-station sites (antennas on rooftops
and towers). It will be pitched to an equipment vendor (Huawei) and a mobile operator (Türk Telekom),
and shown in a 3-minute hackathon demo video (Meta Global AI Developer Hackathon, deadline 4 Nov).
The AI "Expert Operator" (Meta's Muse Spark Open model) is driven by chat or voice.

Two pages, both plain HTML + ES modules, no build step (keep it that way):

- `viewer/portfolio.html` + `viewer/portfolio.js`: left column = chat with the Expert Operator
  (text or push-to-talk voice); right = Leaflet 1.9.4 map with every site as a coloured pin
  (critical pulses red, action needed orange, review yellow, change planned blue, ok green), a side
  panel with stats, a ranked site list with issues, and an "Actions taken" log.
- `viewer/index.html` + `viewer/app.js`: left = the same chat; right = a three.js r160 scene of one
  site (extruded real building footprints, the site building, antennas on poles, translucent red
  EMF safety-zone sectors, orange back lobes, neighbour buildings turning dark red when a zone reaches
  them, optional coverage heat-map on the ground, baseline zones as wireframe) and a side panel
  (EMF limit, layers, checks, antennas table, sliders editor, actions taken, field work order, notes).
- Shared styles: `viewer/ui.css`. Agent loop: `viewer/agent.js`. Voice: `viewer/voice.js`.

Read these files to understand the current UI. Two screenshots of the current state are attached.
The look today is a functional dark dashboard: flat greys, default fonts, no motion, abrupt page
changes, a plain chat, a plain three.js scene with no atmosphere.

Audience and tone: telecom engineers and executives. It must feel precise, trustworthy, calm and
premium, like a mission-control tool, not a game and not a toy. It must stay readable on a projector
and in a compressed demo video.

## What to research

Look at real examples (search the web) and say what to borrow from each, concretely:
Palantir (Foundry/Gotham map UIs), Cesium and Google Earth/3D Tiles viewers, Mapbox Studio and
Mapbox GL 3D buildings, kepler.gl / Foursquare Studio, deck.gl showcases, Linear, Vercel, Raycast,
Arc, Apple Maps 3D, Tesla UI, Ericsson/Nokia/Huawei network digital-twin demos, Bentley iTwin,
NVIDIA Omniverse digital twins, and the best AI chat UIs (ChatGPT, Claude, Perplexity) for how agent
steps and tool calls are shown. Use more if useful.

## What the plan must decide (be specific: values, not adjectives)

1. **Visual direction** in one paragraph, plus 3 mood references.
2. **Colour system**: CSS custom properties for backgrounds/surfaces/elevation, text, borders, accent,
   and the five status colours; check contrast (WCAG AA) on dark; colours for EMF zones, back lobes,
   hit buildings, coverage bins, baseline wireframe; light-mode fallback if worth it.
3. **Typography**: font families (Google Fonts allowed), sizes, weights, numeric tabular figures.
4. **Layout and components**: spacing scale, radii, shadows/glass, panel and card styles, the chat
   (bubbles vs. timeline, how agent tool steps should look as a live "thinking" timeline, typing
   indicator, voice mode with a waveform/level meter), site list rows, stats, badges, buttons, sliders.
5. **Motion system**: durations and easing curves (exact cubic-beziers), what animates and what never
   does, reduced-motion behaviour. Page transitions between map and 3D (View Transitions API?), map
   fly-to when the agent focuses a site, camera fly-to and orbit when the agent selects or changes an
   antenna, EMF zone grow/shrink when power or height changes, the "fixed" moment when a red
   neighbour turns back to neutral, pins pulsing, list re-ordering, panel content updates.
6. **3D scene look**: lighting (time of day, hemisphere/sun, shadows), fog/atmosphere, ground,
   building materials (edge lines? ambient occlusion?), EMF volumes (fresnel/gradient shader, animated
   radio-wave rings, opacity), antenna and pole detail level, selection outlines, post-processing
   (bloom, SSAO, FXAA/SMAA) with a performance budget: must stay smooth with ~250 extruded buildings
   on a mid-range laptop; say what to skip.
7. **Map look**: tile style (free, no API key: e.g. OSM/CARTO alternatives, MapLibre with free style?
   say whether switching from Leaflet to MapLibre GL is worth it and why), pin design, clustering,
   pulse, hover cards.
8. **Demo-video choreography**: the 5-7 visual moments that should look best on camera and how.

## Deliverable

Write one Markdown file: `docs/design/ui-plan.md` (English), about 3,000-6,000 words, containing:

- The decisions above, with exact tokens (a ready-to-paste `:root { ... }` block), easing/duration
  table, and short code snippets where they make a decision concrete (e.g. a three.js fresnel
  material, a camera tween, a View Transition, a CSS keyframe).
- **An implementation plan** in phases ordered by impact on the demo video per hour of work, with
  effort estimates, the files each phase touches, and risks. Phase 1 must be doable in about half a
  day and give the biggest visible improvement.
- A short "do not do" list (things that would make it look cheap or slow).
- Sources: links for every reference you used.

Constraints: no build step, CDN libraries only from cdnjs / jsdelivr / unpkg with pinned versions,
keep three.js r160 and the existing module structure, keep the app working on Windows Chrome,
respect `prefers-reduced-motion`. Do not edit, create or delete any other file.
