# SiteTwin 3D — design and motion plan

30 October 2026 · Demo target: 4 November · Design specification, not implementation

## 1. Direction and priorities

Make SiteTwin feel like a precision planning instrument: a large, legible geographic workspace framed by blue-black surfaces, clear typography, restrained cyan selection, and explicit operational status. Geography establishes context; the selected antenna and its consequences command attention. The Expert Operator speaks through a calm conversation and a compact record of actual tool activity. Movement explains where the operator is looking, what changed, and which modelled conflict cleared. The signature image is a pale rooftop above a subdued city, a sharply bounded translucent safety envelope, and a labelled neighbour returning to neutral after a verified plan change. Every attractive moment must preserve the distinction between a simulation, an applied planning change, and physical field work.

Three mood references:

1. **Palantir Foundry/Gotham:** geographic workspace with anchored selection details. Borrow the relationship between map objects, evidence, and actions. [Foundry interface](https://www.palantir.com/docs/foundry/map/getting-started), [Gotham Europa](https://www.palantir.com/platforms/gotham/europa/).
2. **Linear:** quiet navigation, consistent headers, and deliberate information density. Borrow its hierarchy and reduce competing surfaces. [Published redesign](https://linear.app/changelog/2024-03-20-new-linear-ui).
3. **Apple Maps 3D:** readable building massing and a clear geographic focal point. Borrow the separation of the subject from surrounding context. [Detailed city experience](https://www.apple.com/maps/).

### What the current implementation needs

Reviewed both supplied screenshots and `portfolio.html`, `portfolio.js`, `index.html`, `app.js`, `ui.css`, `agent.js`, and `voice.js`; also checked `coverage.js` and `emf.js` for display semantics.

- The two fixed 380px side columns and the 1100px stacking breakpoint constrain the scene. At the screenshot width, the inspector takes the lower part of the workspace.
- Default 13px typography and 11–12px metadata lose hierarchy in compressed video.
- The critical pin already pulses, using an infinite animated box-shadow. Other changes are abrupt.
- `update()` disposes and rebuilds antenna and zone groups, including on selection. Persistent objects are needed before smooth geometry changes.
- `ui.tool()` arrives after a tool finishes. A truthful running timeline needs a start event around the existing handler call.
- `setPixelRatio(devicePixelRatio)` has no cap. Coverage calculation remains synchronous despite its debounce.
- Voice recording needs a reliability check: `stop()` clears `recorder` before its asynchronous `onstop` callback reads `recorder.mimeType`.

The recommendations below are design decisions and performance targets, not claims that this app has already achieved them. Reference research uses public product pages, documented interfaces, screenshots, and demo descriptions; it is not a hands-on audit of proprietary products.

## 2. Colour and typography

### Ready-to-paste tokens

Replace the existing root token definitions with this block when implementation begins. Existing names remain available as aliases; also remove conflicting hard-coded colours in JavaScript and inline HTML styles.

```css
:root {
  color-scheme: dark;
  --bg: #0B1118;
  --stage: #0C151E;
  --surface-0: #101A25;
  --surface-1: #131F2C;
  --surface-2: #1A2938;
  --surface-hover: #22364A;
  --surface-selected: #173A52;
  --panel: var(--surface-1);
  --text: #EEF4FA;
  --text-secondary: #B8C7D6;
  --muted: #93A7BA;
  --border: #2C4053;
  --border-control: #71889F;
  --line: var(--border);
  --accent: #63CFFF;
  --on-accent: #071521;
  --critical: #FF7B86;
  --high: #FFB168;
  --medium: #F4D675;
  --planned: #82ADFF;
  --ok: #74DCAC;
  --bad: var(--critical);
  --warn: var(--high);

  --scene-ground: #172330;
  --scene-building: #52667B;
  --scene-site: #A8BACB;
  --scene-edge: #8297AA;
  --scene-antenna: #E7EDF4;
  --scene-pole: #738697;
  --emf-front: #FF6678;
  --emf-back: #FFB168;
  --building-hit: #934858;
  --building-hit-edge: #FF7B86;
  --baseline-wire: #B5C5D5;
  --coverage-weak: #253B70;
  --coverage-fair: #66788B;
  --coverage-good: #AFAD7E;
  --coverage-excellent: #F0D568;

  --font-sans: "Inter", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  --font-mono: "Cascadia Code", Consolas, ui-monospace, monospace;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 15px;
  --text-lg: 18px;
  --text-title: 22px;
  --text-metric: 28px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --radius-control: 6px;
  --radius-card: 10px;
  --radius-panel: 12px;
  --radius-pill: 999px;
  --shadow-card: 0 4px 16px rgb(0 0 0 / 18%);
  --shadow-float: 0 12px 32px rgb(0 0 0 / 32%);
  --focus-ring: 0 0 0 2px #0B1118, 0 0 0 4px #63CFFF;
  --topbar-h: 56px;
  --chat-w: clamp(304px, 22vw, 352px);
  --inspector-w: clamp(304px, 23vw, 360px);
  --duration-fast: 120ms;
  --duration-ui: 180ms;
  --duration-panel: 240ms;
  --duration-change: 320ms;
  --duration-camera: 800ms;
  --ease-out: cubic-bezier(.16, 1, .3, 1);
  --ease-standard: cubic-bezier(.2, 0, 0, 1);
  --ease-travel: cubic-bezier(.22, 1, .36, 1);
  --ease-pulse: cubic-bezier(.4, 0, .6, 1);
}
```

Status mapping remains `critical`, `high` = Action needed, `medium` = Review, `planned` = Change planned, `ok` = OK. Use status colour for a small icon, label, and edge; selection always uses cyan. Never let selection erase the severity badge. Read CSS tokens into three.js and Leaflet rather than maintaining another hex palette.

### Contrast checks

Calculated using WCAG sRGB relative luminance and `(Llighter + .05)/(Ldarker + .05)`. Values below are rounded for reporting; pass decisions use unrounded results. All proposed normal text/status foregrounds exceed 4.5:1 on these surfaces. [WCAG text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

| Foreground | Panel `#131F2C` | Selected `#173A52` |
|---|---:|---:|
| Primary text | 15.04:1 | 10.75:1 |
| Secondary text | 9.67:1 | 6.91:1 |
| Muted text | 6.73:1 | 4.81:1 |
| Cyan accent | 9.44:1 | 6.75:1 |
| Critical | 6.69:1 | 4.78:1 |
| Action needed | 9.32:1 | 6.66:1 |
| Review | 11.68:1 | 8.35:1 |
| Change planned | 7.44:1 | 5.31:1 |
| OK | 9.98:1 | 7.13:1 |

Also checked hover `#22364A`: the lowest text/status ratio is 4.97:1. Control borders have at least 3.25:1 across these three surfaces; decorative separators may use the quieter border token. Primary buttons use dark `--on-accent` text on cyan. Labels on coloured scene overlays sit on opaque panel backgrounds. These checks do not establish contrast for translucent 3D pixels under lighting; meaningful scene states also need outlines, labels, and equivalent inspector findings. [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

Coverage uses the existing four thresholds: excellent ≥−80 dBm, good −90 to <−80, fair −100 to <−90, weak −110 to <−100. Use the sequential slate-to-yellow tokens above, alpha 0.48, with an explicit numeric legend. Below −110 is transparent and labelled “Below displayed range”; absent results say “No coverage result.” Coverage colour must not masquerade as a compliance status.

**Light mode:** defer a second complete theme until after the demo. Provide an explicit “Projector contrast” setting instead: opaque surfaces, 16px conversation text, 14px metadata, stronger outlines. Do not follow OS light mode automatically. A future light theme must separately retest text, statuses, tiles, and scene materials; CSS inversion is insufficient.

### Type specification

Use Inter 400/500/600, supplied by pinned `@fontsource/inter@5.0.16` CSS through jsDelivr, including its Latin and Latin Extended subsets for Turkish. Load `400.css`, `500.css`, and `600.css` beneath `https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.16/`. Set `font-display: swap`; the system stack must remain usable if fonts fail. Use native monospace only for IDs and compact technical deltas. The [Fontsource package/version history](https://www.npmjs.com/package/%40fontsource/inter?activeTab=versions) is the font distribution reference.

| Role | Size / line-height | Weight |
|---|---|---:|
| Conversation and findings | 15 / 22px; projector 16 / 24px | 400 |
| Site title | 22 / 28px | 600 |
| Section heading | 13 / 18px, sentence case | 600 |
| Site row title, controls, tables | 14 / 20px | 500 |
| Metadata | 13 / 18px | 400 |
| Metrics | 28 / 32px | 600 |
| Nonessential timestamp/model caption | 12 / 16px | 400 |

Apply `font-variant-numeric: tabular-nums lining-nums` to metrics, antenna tables, outputs, and deltas. Right-align comparable numbers; retain units in column headings or beside values. Show azimuths at whole degrees, power at whole watts, and heights at the existing 0.5m editing precision. Keep calculation precision in details; do not imply measurement accuracy through extra decimals.

## 3. Layout and components

### Workspace

Add a shared 56px top bar: SiteTwin wordmark, Portfolio/site breadcrumb, “Planning simulation” context, and one primary task action. Keep “Expert Operator · Muse Spark Open” in the chat header; move raw provider/model identifiers into details. Do not add partner logos implying endorsement.

At 1920×1080, use 352px chat + 1208px stage + 360px inspector below the top bar. At 1440px, the token widths leave approximately 792px for the stage. At 1280px, retain approximately 672px. Preserve the current two-page ES-module architecture and existing DOM IDs where practical.

Below 1180px, move the inspector into a 320px right drawer with a persistent “Inspect” button. Below 900px, make chat a drawer too, leaving one full-width workspace. Below 768px, expose Workspace / Operator / Inspect navigation; avoid simultaneously stacked scroll regions. Drawers close with Escape, restore trigger focus, and trap focus while modal. Desktop chat and inspector each scroll independently; the stage never scrolls. Keep composers and inspector summaries visible.

Use 16px panel padding, 24px section gaps, 8px internal gaps. Structural panes are opaque and square against the viewport; floating HUD cards use 10px corners, a 1px border, and the floating shadow. No full-panel backdrop blur. A small HUD may use 96% opaque fill, but opaque backgrounds are the default for video legibility.

### Portfolio and inspector

- **Stats:** one total and five status counts, including zero counts, arranged in a two-row grid. Values occupy fixed tabular cells. Click a status to filter; show the active filter and a clear reset.
- **Site rows:** 80px minimum height, 12px padding, status glyph + exact site ID, structure/status line, and one highest-priority issue. Expand the selected row for remaining issues and “Open 3D twin.” Use a 2px cyan selection edge and quiet background; keep the severity glyph. Distinguish warning finding counts from unique affected buildings.
- **3D inspector:** a sticky summary shows selected site, active regime, unique hit-building count, roof restriction count, and plan delta. Tabs are Summary / Antennas / Work order. Summary opens first; unresolved findings remain visible as counts in every tab. Put Data notes in an expandable disclosure.
- **Findings:** group sensitive-building conflicts, other conflicts, and roof restrictions. Use 16px icons, readable sentences, and a “Locate” action. Clicking one selects the corresponding object and retains its identity in the scene.
- **Tables/editor:** 36px antenna rows with stable widths and a selected-row indicator. Sliders have a 4px track, 16px visible thumb, and 32px interaction area; pair each with a labelled numeric input and units. Preserve existing ranges and step sizes. Keyboard arrows use the native step.
- **Buttons:** 36px desktop height, 44px in touch layouts; 14px/600 labels; 16px icons with 8px gap. One cyan primary action per region, outlined secondary actions, and labelled destructive actions. Focus uses the two-ring token. Layer chips become real buttons with `aria-pressed`; suggestions become buttons too.
- **Actions taken:** compact chronological entries with time, antenna/site ID, exact delta, and result. Label planning changes “Applied to plan.” Export remains a plan download; the work order describes physical follow-up.

### Conversation and live activity

Use a conversation timeline. User requests have a quiet raised bubble, maximum 92% width; assistant answers use the full column without a competing bubble. Give each answer a short outcome line, two or three decisive measurements, then expandable detail. Preserve `replyHtml()` escaping; activity labels and tool arguments must also use safe text rendering.

Under the current request, show one expandable “Run activity” group with a 1px vertical rail and 16px state icons. States are Queued / Running / Completed / Failed. Examples: “Reading site state,” “Checking nearby occupancy,” “Testing option 3,” “Applying recommended change,” “Preparing field work.” Show real elapsed time and returned findings; collapse repeated evaluations to “8 options tested” with expandable exact results. These are observable actions, not invented private reasoning or a fake percentage complete.

Extend `createAgent()` to emit `toolStart(call.id, name, args)` immediately before awaiting the handler and complete the same keyed row afterward. Keep current `ui.tool()` compatibility while migrating both pages. `evaluate_change` never moves visible geometry. Only `apply_change`, undo, direct editing, and view selection update the scene.

While waiting for a model response, use three 4px dots with a 900ms opacity cycle and 120ms staggering. After 10 seconds, show actual elapsed time and “Waiting for operator response.” Do not simulate streaming: the current transport returns whole responses. Announce concise changes through a polite live region, not every trial. Autoscroll only when within 48px of the bottom; otherwise show “New activity.”

### Voice

The composer has a prominent microphone, Send, and a labelled read-aloud control. Voice states are Idle → Listening → Transcribing → Running → Speaking. Recording uses a red microphone and “Listening”; transcribing uses a static microphone plus status text; speech playback has a visible Stop action.

Use 12 level bars in a 72×20px area, updated from an `AnalyserNode` at 30Hz: heights 3–18px from measured RMS energy, attack 60ms/release 180ms. It is a microphone level meter, not a synthetic waveform. In reduced-motion mode replace moving bars with “Input detected”/“Quiet” text, updated at most twice per second. Stop tracks and disconnect the analyser on stop, cancel, error, or navigation.

Support hold-to-talk with pointer capture and keyboard Space when the mic is focused, plus an accessible click-to-record toggle. Handle release before microphone permission resolves. Capture each recorder and its MIME type locally before clearing shared state; verify WAV conversion and one Turkish round trip before recording. Keep microphone denial and transcription failures visible without blocking typed input. Coordinate TTS `start`/`end` events with navigation rather than the current fixed four-second voice delay.

## 4. Motion system

Use CSS transitions/Web Animations for DOM elements and one existing three.js animation loop for scene motion. Add no animation dependency. Cancellation starts from the current displayed state; it never snaps to an obsolete start point.

| Motion | Duration | Easing | Reduced motion |
|---|---:|---|---|
| Hover/focus colour | 120ms | `cubic-bezier(.2,0,0,1)` | Instant |
| Message/tooltip entry, opacity + 6px translation | 180ms | `cubic-bezier(.16,1,.3,1)` | Instant |
| Drawer/panel entry, maximum 12px translation | 240ms | `cubic-bezier(.16,1,.3,1)` | Instant |
| Keyed site-row reorder | 240ms | `cubic-bezier(.2,0,0,1)` | Instant |
| Page stage crossfade | 180ms | `cubic-bezier(.2,0,0,1)` | No transition |
| Applied antenna/envelope change | 320ms | `cubic-bezier(.2,0,0,1)` | Instant |
| Cleared neighbour colour | 480ms | `cubic-bezier(.2,0,0,1)` | Instant |
| Camera selection flight | 800ms | `cubic-bezier(.22,1,.36,1)` | Snap |
| Optional reveal orbit, maximum 12° | 1600ms | `cubic-bezier(.22,1,.36,1)` | Disabled |
| Critical pin ring | 2400ms × 2 | `cubic-bezier(.4,0,.6,1)` | Static core |
| Leaflet focus flight | 1150ms | Leaflet native fly-to trajectory | `setView`, no animation |

Leaflet's trajectory is an explicit exception: its `flyTo()` does not accept a CSS cubic-bezier. Do not claim otherwise or add a competing CSS map transform. [Leaflet 1.9.4 API](https://leafletjs.com/reference.html#map-flyto).

### Navigation and camera

Use native **cross-document** View Transitions on the same-origin HTML pages. Both opt in through shared CSS; retain real links and `location.href`. `document.startViewTransition(() => location.href = ...)` is the wrong mechanism for this architecture. Share only the stable brand header; crossfade the stage without pretending a raster map morphs into accurate 3D. [Chrome implementation guidance](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document).

```css
@view-transition { navigation: auto; }
.app-brand { view-transition-name: site-twin-brand; }
.stage { view-transition-name: site-twin-stage; }
::view-transition-old(root), ::view-transition-new(root) { animation: none; }
::view-transition-group(*) {
  animation-duration: 180ms;
  animation-timing-function: cubic-bezier(.2, 0, 0, 1);
}
@media (prefers-reduced-motion: reduce) {
  @view-transition { navigation: none; }
  ::view-transition-group(*) { animation-duration: 0s; }
  .pin::after, .typing-dot { animation: none !important; }
}
```

Without support, navigate normally into the same-colour shell and a static “Loading twin” state. Do not enable `preserveDrawingBuffer` just for transitions. Test WebGL capture in Windows Chrome; skip the stage transition if it produces an empty snapshot. Top-level data fetching must not postpone the useful loading shell indefinitely.

Store the selected site, map bounds, display transcript summary, and explicit handoff ID in `sessionStorage`. Consume the handoff instruction once. Returning or reloading must not silently repeat `ask`/automatic review and apply another change. Display continuity must not be confused with restored agent execution history.

For map focus, call `map.stop()` then `map.flyTo(latLng, 15, {duration: 1.15})`; use zoom 17 only for a user-requested site-level inspection. Update selection immediately and reveal the hover card on `moveend`. Repeated focus on the same site does not restart travel. User dragging cancels motion and automatic following.

Fit the 3D camera to the selected antenna plus the relevant neighbour/envelope bounds, with 20% padding and 45° field of view. Aim at the relationship being explained, not merely the antenna centre. Interpolate camera position and `controls.target` using the travel curve, preferably through a spherical path around the target to avoid clipping buildings. Clamp pitch to 35–65° above ground and distance to a bounds-derived minimum. Update projection after resize.

One “Overview” action restores the site framing. A 12° reveal orbit is allowed once after initial entry; no perpetual autorotation. Do not refly after each slider tick or repeatedly while an agent changes the same antenna. Pointer/wheel interaction cancels camera tweens immediately. New focus requests replace earlier tweens; camera and user controls never compete.

### Changes, clearing, and reordering

Maintain antenna/zone objects keyed by ID. Power changes interpolate to returned radii and thickness; height changes translate the volume; azimuth takes the shortest angular path. In this model, tilt changes the panel orientation but does **not** shrink or pitch the conservative safety envelope. Beamwidth changes may rebuild geometry once. The displayed front and back volumes must use the checker's actual vertical extent, including `half_height_m`.

Commit the model and compute final findings first. During the 320ms visual interpolation, show “Updating view” and the final boundary as a thin outline. Never run checks on intermediate animation states. New conflicts turn red immediately; a cleared neighbour stays red until the final result is confirmed and geometry has settled. Then return its material to neutral over 480ms, show one 900ms check-label acknowledgement, and retain the before/after delta in the inspector. Use a static confirmation under reduced motion. Other unresolved conflicts remain red.

Manual slider changes track the pointer directly, without easing lag. Coalesce geometry updates once per frame; debounce coverage by 120ms and run a final update on release. Do not rebuild tables, recompile shaders, or recreate materials on every input event.

Reorder site rows only after an assessment batch completes, using stable keyed nodes and a 240ms FLIP transform. Preserve keyboard focus, selected identity, and scroll anchor. Freeze ranking under a hovered/focused row; offer “Ranking updated” until interaction ends. Replace inspector text in place, with a 120ms background acknowledgement on changed values. Counts, engineering numbers, warnings, and slider thumbs never roll, bounce, or interpolate through invented readings.

Respect `prefers-reduced-motion` in **both CSS and JavaScript**, including preference changes during a run: cancel active camera/geometry tweens and apply endpoints, use nonanimated Leaflet options, stop pulses/orbits, and replace typing animation with static status text. Pause decorative animation in hidden tabs.

## 5. The 3D scene

### Lighting and materials

Use illustrative clear afternoon lighting, not a claimed solar study. Keep real geometry dimensions and the existing East/Up/South coordinate convention.

- Background `#0C151E`; linear fog of the same colour from 160m to 420m, keeping nearby findings unobscured.
- Hemisphere sky `#D8EBFF`, ground `#273744`, intensity 1.6. Directional sun `#FFF1DE`, intensity 2.2, position `(-60,100,40)` metres, approximately 54° elevation.
- `renderer.outputColorSpace = THREE.SRGBColorSpace`; `ACESFilmicToneMapping`, exposure 1.0. Tune exposure globally during visual QA, never per sample site.
- Buildings use `MeshStandardMaterial`, roughness 0.93, metalness 0. Neutral context `#52667B`, site `#A8BACB`; site roof edges are brighter. No random building colours, photo textures, or artificial windows.
- Ground is matte `#172330`, 600m square. Replace the dense grid with 10m minor/50m major lines at approximately 0.06/0.12 opacity, faded by 150m. Include a north indicator and a scale; no invented roads.
- One 1024² PCF soft shadow map, orthographic bounds ±80m around the site, near 1/far 240m, bias −0.0001, normal bias 0.04m. Site, equipment, and at most 40 nearby buildings cast; context receives. Freeze shadow updates until geometry changes. Keep shadow darkness below 25% visually.

Use sparse `EdgesGeometry` outlines on the site, selected antenna, and affected buildings, maximum eight outlined neighbours at once. One-pixel WebGL lines are acceptable for context, but selected boundaries need projected HTML labels or a small mesh outline because Windows line-width support is limited. A cyan 2px screen-space selection marker and opaque 14px label survive video compression better than bloom.

Antenna panels retain measured length and existing dimensions; add two simple mounting brackets and a cap only where geometry supports them. Poles use eight radial segments. Avoid vendor-specific ports or textures unsupported by data. Hit buildings use `#934858` plus a red edge and a labelled finding, so lighting cannot conceal the state.

### Safety volumes

Keep the existing sector-slab model. Fresnel edge emphasis communicates the boundary while a low-opacity interior preserves context. It is an illustration of the conservative envelope, not a sampled field-strength gradient. Front alpha is 0.045–0.18; back alpha 0.035–0.12; selected front edge may reach 0.22. Baseline uses `#B5C5D5` at 0.30 opacity with boundary wireframe, avoiding every triangulation diagonal.

This r160-compatible material is a starting point for `zoneMat()`; the back material uses lower alpha uniforms:

```js
const zoneMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, depthTest: true,
  side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
  uniforms: {
    tint: { value: new THREE.Color("#FF6678") },
    bodyAlpha: { value: 0.045 }, edgeAlpha: { value: 0.18 }
  },
  vertexShader: `
    varying vec3 vNormalView, vEye;
    void main() {
      vec4 p = modelViewMatrix * vec4(position, 1.0);
      vNormalView = normalMatrix * normal;
      vEye = -p.xyz;
      gl_Position = projectionMatrix * p;
    }`,
  fragmentShader: `
    uniform vec3 tint;
    uniform float bodyAlpha, edgeAlpha;
    varying vec3 vNormalView, vEye;
    void main() {
      float f = pow(1.0 - abs(dot(normalize(vNormalView),
                                normalize(vEye))), 2.2);
      gl_FragColor = vec4(tint, mix(bodyAlpha, edgeAlpha, f));
      #include <colorspace_fragment>
    }`
});
```

Keep opaque buildings depth-tested in front of volumes. Sort transparent volumes back-to-front by camera distance and verify overlaps from three camera angles; this is approximate transparency, not order-independent rendering. Prefer lower opacity and selected-sector isolation over another render pass. Shared materials must have explicit ownership: the current `clearGroup()` disposes every material, which would invalidate a shared palette.

Animated radio-wave rings are **off by default**. If rehearsal needs one selection cue, allow a single clipped arc on the selected envelope, 1200ms, opacity ≤0.10, then remove it. It carries no measurement meaning and disappears under reduced motion. Coverage stays on the ground with its existing 150×150 canvas; set its colour texture to sRGB and keep it untone-mapped. No texture upload while the coverage layer is hidden.

### Performance contract

Target Windows Chrome on an integrated-GPU mid-range laptop, 1440×900 viewport, approximately 250 footprints and up to 12 antenna envelopes. These are acceptance budgets to measure:

| Item | Budget / decision |
|---|---|
| Interaction | Aim 60fps; 95th-percentile frame interval ≤22ms during a 20-second orbit/edit recording |
| Pixel ratio | Cap at 1.5; drop to 1.0 if the frame budget fails |
| Main-pass draw calls / triangles | ≤350 / ≤180,000; inspect `renderer.info` |
| Texture allocation | ≤96MB estimated, excluding browser/video capture |
| Update work | ≤8ms main-thread batches; split longer coverage work into ≤4ms row batches if profiling requires it |
| Idle | Stop rendering once controls, loading, and tweens settle; invalidate on change/resize |
| Post-processing | Native MSAA (`antialias:true`); no composer in the demo default |

Skip bloom, SSAO, screen-space reflections, depth of field, volumetric fog, transmission materials, and HDR environment downloads. Contact shadows and roof-edge contrast supply enough depth. FXAA is an optional single-pass alternative only if MSAA fails the budget; do not stack it with MSAA. Defer SMAA and its textures. If performance fails, remove optional outlines, shadow casting, and decorative arcs before reducing geometry accuracy. Merge neutral geometry only if draw calls are actually the bottleneck; preserve building IDs and independent conflict colouring.

## 6. Map design

**Keep Leaflet 1.9.4 for the demo.** Five sample pins do not justify replacing map events, bounds, tooltips, selection, and navigation before the deadline. Keep the existing OSM HTTPS tiles and apply this calmer treatment only to the raster tiles:

```css
#map .leaflet-tile-pane {
  filter: grayscale(1) invert(1) brightness(.82) contrast(.90);
}
```

Check Turkish city labels at overview and zoom 15. Pins, labels, controls, and attribution stay outside the filtered pane. This remains a raster compromise: it cannot remove POIs or independently restyle labels. Keep city/site names in opaque app labels so they do not depend on tile contrast. Use 36px zoom buttons and an unobscured 12px attribution strip.

OSM standard tiles are key-free and best-effort, with visible attribution, ordinary browser caching, and no bulk prefetch/offline download. Serve through the existing HTTP app, retaining browser Referer behaviour. [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/).

**Do not substitute a supposedly key-free CARTO URL.** Current CARTO documentation requires a key, including raster basemaps. Dark Matter remains a useful visual reference, but does not meet this brief's no-key requirement. [Current CARTO repository guidance](https://github.com/CartoDB/basemap-styles), [basemap terms](https://carto.com/legal/basemap-terms/).

After the demo, MapLibre GL with **OpenFreeMap Dark** is the preferred upgrade for vector label control, sharper zooming, and later geographic extrusion. OpenFreeMap currently permits commercial use without registration/API keys and requires attribution; its public instance has no SLA. Allow 1–2 days for migration and parity verification. A free style JSON is not itself a free tile service; inspect its sources, glyphs, sprites, and terms. Avoid MapLibre demo tiles as an application dependency. [OpenFreeMap service and styles](https://openfreemap.org/).

Pins have a 16px status core, 2px dark separation ring, 32px interaction target, and 24px cyan selection halo. Add a small white severity glyph: exclamation/triangle/review dot/plan diamond/check, with the full status in accessible text. Hover or keyboard focus opens a 240px card after 150ms: site ID, status, highest-priority issue, and Open twin. Escape dismisses it; click pins to persist selection.

Animate an inner pseudo-element, leaving Leaflet's positioned marker transform alone:

```css
.pin { position: relative; color: var(--critical); }
.pin.critical::after {
  content: ""; position: absolute; inset: -5px;
  border: 1px solid currentColor; border-radius: 50%;
  pointer-events: none;
  animation: attention-ring 2400ms cubic-bezier(.4,0,.6,1) 2 both;
}
@keyframes attention-ring {
  from { transform: scale(1); opacity: .5; }
  to { transform: scale(1.8); opacity: 0; }
}
```

Pulse at most three critical pins on entry/focus; after 4.8 seconds retain static severity. No clustering for the five-site demo. Above 100 sites, use [leaflet.markercluster 1.5.3](https://github.com/Leaflet/Leaflet.markercluster/releases/tag/v1.5.3) from a permitted pinned CDN, 48px clustering radius, disable clustering at zoom 16. Cluster badges show total plus critical count; the highest severity determines the edge. Never present an average severity. Keyboard users retain access through the ranked list.

## 7. Three-minute demo choreography

Record at 1920×1080, 30fps, with browser chrome hidden and projector contrast enabled. Check a 720p compressed export. Use the live model and real result values; shorten waits with clearly disclosed editorial cuts, not fabricated progress. Seven moments:

| Time | Visual moment | Direction |
|---|---|---|
| 0:00–0:18 | Portfolio establishes scale | Hold for three seconds. Let counts and one critical ring identify the priority; show the top issue beside its site. |
| 0:18–0:38 | Spoken intent becomes action | Show the real mic level, a concise Turkish request, transcript, and two actual activity steps. Retain the typed path as a recording fallback. |
| 0:38–0:58 | Geographic handoff | One 1150ms focus flight, then the 180ms page transition. Arrive at a composed rooftop view; let it settle before narration continues. |
| 0:58–1:25 | The problem is visible | Select a real sensitive-building finding. Frame its labelled building, antenna, and boundary together; keep the active regime and remaining-conflict count readable. |
| 1:25–2:00 | The operator compares and applies | Collapse repeated trials into a live count. Hold the camera while the chosen antenna/envelope changes, then let the cleared neighbour return to neutral. Retain actual before/after numbers for at least four seconds. |
| 2:00–2:30 | The change is reviewable | Toggle baseline once and coverage once, showing the same band and threshold on both sides. State any remaining conflicts and coverage tradeoff plainly. |
| 2:30–3:00 | Planning becomes field work | Open the derived work order, highlight real work/material/precaution entries, then start the plan download. Finish on the stable rooftop plus concise plan summary. |

If only the school conflict clears, say exactly that. Keep other affected buildings red and retain Action needed where appropriate. A green scene is never evidence of field certification. Do not return to an apparently improved portfolio unless the updated proposed plan is actually reassessed there: current portfolio loading otherwise reads the original twin.

## 8. Implementation sequence and acceptance

Order phases by expected visible improvement per engineering hour, with dependencies explicit. Estimates assume one developer familiar with the current files; they are not measured delivery times. Do not add a framework, build pipeline, or replacement scene engine.

### Phase 1 — visible foundation, 4 hours

**Files:** `viewer/ui.css`, `viewer/portfolio.html`, `viewer/index.html`, `viewer/portfolio.js`, `viewer/app.js`.

Allocate 90 minutes to tokens/type/components, 60 to workspace sizing and inspector hierarchy, 45 to map treatment and basic scene palette/lighting/DPR cap, and 45 to Windows visual checks. Keep the first pass to solid materials and static layout; defer shaders and the new activity lifecycle.

**Result:** both pages look cohesive, the workspace dominates, important text survives capture, and the rooftop reads clearly. This is the highest-return half-day. **Risks:** inline styles and JS hex values bypass tokens; drawer sizing can leave a zero-sized canvas. Preserve IDs, invalidate map size, and exercise the existing `ResizeObserver` paths. **Acceptance:** readable at 1440×900 and 1920×1080, no clipped composer, five statuses distinguishable, all existing primary actions reachable.

### Phase 2 — explain the action, 6–8 hours

**Files:** `viewer/agent.js`, `viewer/voice.js`, `viewer/app.js`, `viewer/portfolio.js`, both HTML pages, `viewer/ui.css`.

Implement keyed activity events and grouped results first, then persistent scene objects, camera cancellation, envelope interpolation, and clearing acknowledgement. Fix the recorder lifecycle before adding its real meter. Add reduced-motion handling with every feature.

**Result:** spoken intent, testing, application, and the cleared-conflict moment form a coherent sequence. **Risks:** overlapping requests, material disposal, recording permission races, and misleading intermediate geometry. **Acceptance:** tests never alter the scene; one apply produces one plan delta; undo restores geometry and findings; dragging cancels camera motion; reduced motion snaps cleanly; a Turkish voice round trip completes without a stale microphone stream.

### Phase 3 — continuity and review, 4–6 hours

**Files:** `viewer/portfolio.js`, `viewer/app.js`, both HTML pages, `viewer/ui.css`; `viewer/coverage.js` only for display colours/alpha.

Add native page transitions with fallback, one-time handoff consumption, map/selection restoration, baseline comparison, sequential coverage colours, and the polished work-order view. For a changed portfolio status, retain the proposed plan in session storage keyed by twin URL/site ID, baseline fingerprint, and regime; validate that context on return and rerun the same checks. If context is stale, load the original assessment and explain it. Do not simply repaint the pin green.

**Risks:** instruction replay, stale baseline, and confusing planning updates with source-file persistence. **Acceptance:** Back retains context; refresh does not reapply the instruction; source twins remain unchanged; counts/pin/list agree with reassessment under the displayed regime; model limitations remain visible.

### Phase 4 — scene refinement and recording, 3–5 hours

**Files:** `viewer/app.js`, `viewer/ui.css`; `viewer/coverage.js` only if profiling requires chunked computation. No new runtime dependency by default.

Add the Fresnel material, sparse outlines and shadow tuning only after the interaction sequence works. Profile the 250-building case while recording. Rehearse all seven shots, microphone denial, a slow response, and a partially successful fix. **Risks:** transparency sorting and GPU load under capture. **Acceptance:** meet the frame budget, readable 720p export, no fabricated success, and a complete plan/work-order finish. Drop optional effects if they threaten the recording; keep the foundation and evidence sequence.

Target completion is approximately 17–23 engineering hours plus final editorial work. Freeze the UI before the final recording session. MapLibre, full light mode, SSAO, and photorealistic tiles belong after the deadline.

### Do not do

- Neon rainbow dashboards, pulsing everything, oversized glass panels, decorative gradients, or animated grid floors.
- Spinning globes, continuous orbits, camera moves during every edit, springs, bounce, and celebratory particles.
- Fake reasoning, synthetic mic bars, progress percentages without a denominator, or green success before actual checks.
- Hide unresolved findings, remove attribution for framing, or label indicative coverage as a measured prediction.
- Add photogrammetry, high-detail vendor assets, new model libraries, or post-processing before profiling.
- Shrink type to fit more controls, animate engineering numbers, or rebuild the entire UI for every slider event.

## 9. Reference study and sources

The borrowings below are SiteTwin design interpretations, not claims of identical features or capabilities. Product references inform presentation; they do not establish SiteTwin's simulation accuracy.

| Reference inspected | Concrete borrowing for SiteTwin |
|---|---|
| [Palantir Foundry Map](https://www.palantir.com/docs/foundry/map/getting-started) and [Gotham Gaia planning example, p.5](https://www.palantir.com/assets/xrfr7uokpv1b/3A0y10xksgXENvRMNaAsUu/ed8f7f1ed534c0101f64536a85f7297b/Gotham_AI-Enabled_Operations_White_Paper.pdf#page=5) | Separate geographic workspace, layer controls, and selected-object evidence; keep an identifiable object attached to every consequential action. |
| [CesiumJS / 3D Tiles examples](https://cesium.com/platform/cesiumjs/) | Object picking, restrained contextual geometry, and a clear selected-feature relationship. Borrow the interaction, retain three.js. |
| [Google Earth Studio camera templates](https://earth.google.com/studio/docs/the-basics/quick-starts/) and [Google Photorealistic 3D Tiles](https://developers.google.com/maps/documentation/tile/3d-tiles) | A deliberate approach followed by a settled view. Photorealistic tiles require billing/key setup and are outside this demo's dependency plan. |
| [Mapbox Studio](https://www.mapbox.com/mapbox-studio) and [GL JS building extrusion example](https://docs.mapbox.com/mapbox-gl-js/example/3d-buildings/) | Subdue base geography and make data layers purposeful; preserve readable height/massing instead of adding textures. |
| [kepler.gl / Foursquare Studio comparison](https://docs.foursquare.com/analytics-products/docs/keplergl-vs-studio) and [Studio layers](https://docs.foursquare.com/analytics-products/docs/what-is-studio) | Explicit layers, stable legends, and filters that explain the current map. Use a compact layer HUD with band/threshold labels. |
| [deck.gl showcase: Radiance and analytical maps](https://deck.gl/showcase) | Put analysis directly on geometry while allowing context to recede. Keep coverage and EMF as separately named layers. |
| [Linear's calmer interface refresh](https://linear.app/now/behind-the-latest-design-refresh) | Reduce navigation emphasis, standardize header placement, and reserve strong surfaces for current work. |
| [Vercel Geist colours](https://vercel.com/geist/colors) | Assign distinct surface, border, and foreground roles rather than colouring whole cards by severity. |
| [Raycast Action Panel](https://manual.raycast.com/action-panel) | Put a clear primary action on the selected object, with secondary actions and discoverable keyboard access. No new global command palette is needed for the demo. |
| [Arc's documented Focus Mode](https://start.arc.net/find-focus) | Let supporting chrome collapse while preserving workspace identity. Borrow a focus pattern, not browser branding or a browser dependency. |
| [Apple Maps 3D and place cards](https://www.apple.com/maps/) | Distinguish subject from context through massing, lighting, and one compact information card. |
| [Tesla Maps and Navigation](https://www.tesla.com/ownersmanual/model3/en_ma/GUID-01F1A582-99D1-4933-B5FB-B2F0203FFE6F.html) | Stable map orientation controls and an explicit way to resume tracking after manual interaction; SiteTwin's equivalent is Overview/focus follow. |
| [Ericsson: Intelligent site deployment with Digital Twins](https://www.ericsson.com/en/campaigns/imagine-studio-unboxed) and [tower capture example](https://www.ericsson.com/en/blog/2022/12/drone-cell-tower-inspection-automation) | Connect inspectable physical assets to a deployment task. Show the work order as the outcome of a spatial decision, without borrowing vendor ROI claims. |
| [Nokia XR Network Visualizer](https://www.nokia.com/mobile-networks/services/design-and-optimize/) and [digital site engineering brief, p.5](https://www.nokia.com/asset/f/214482/#page=5) | Present coverage and physical engineering as related but distinct views; finish the scenario with an actionable site plan. |
| [Huawei T-BIM, site EMF evaluation, printed pp.26–27](https://carrier.huawei.com/~/media/CNBGV2/download/products/servies/huawei-telecom-building-information-modeling-technical-white-paper-en.pdf#page=15) | Parameter-linked 3D envelopes make antenna changes understandable. Keep SiteTwin's own conservative model limits explicit rather than implying parity with Huawei analysis. |
| [Bentley iTwin saved views](https://developer.bentley.com/apis/savedviews/overview/) | Deterministic Overview / Selected antenna / Conflict views that preserve camera and layer context, useful for repeatable explanations. |
| [NVIDIA Aerial Omniverse Digital Twin documented GUI, archived v1.4](https://docs.nvidia.com/aerial/aerial-dt/archive/1.4.0/text/gui.html) | Viewport plus configuration, explicit units and colour bars, and a visible distinction between scene content and simulation configuration. Do not import its renderer or ray-tracing expectations. |
| [ChatGPT agent's published narration UI](https://openai.com/index/introducing-chatgpt-agent/) | Observable action narration and user control, adapted to a compact actual-tool timeline. This is a historical UI reference, not current product-availability guidance. |
| [Claude Research](https://support.anthropic.com/en/articles/11088861-using-research-on-claude-ai) | A conversational answer with inspectable evidence; in SiteTwin, link the result to tool-returned findings and selected objects. |
| [Perplexity Deep Research demonstration](https://enterprise-prod.perplexity.ai/enterprise/videos/using-deep-research) | Group multiple investigations, then expose source details close to the resulting claim. Keep trials expandable and decisive measurements visible. |

Implementation references used above: [Leaflet 1.9.4](https://leafletjs.com/reference.html), [cross-document transitions](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document), [WCAG text](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [WCAG graphical controls](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [three.js r160 material source](https://github.com/mrdoob/three.js/blob/r160/src/materials/Material.js), and [r160 output-colour shader chunk](https://github.com/mrdoob/three.js/blob/r160/src/renderers/shaders/ShaderChunk/colorspace_fragment.glsl.js). Tile-service decisions use the current [OSMF policy](https://operations.osmfoundation.org/policies/tiles/), [CARTO guidance](https://github.com/CartoDB/basemap-styles), and [OpenFreeMap terms/service description](https://openfreemap.org/).

Retain the existing pinned three.js `0.160.0` jsDelivr import map and Leaflet `1.9.4` cdnjs URLs. If clustering is later needed, pin `leaflet.markercluster@1.5.3` on jsDelivr. Font CSS must also use the pinned package version above. No `latest`, version ranges, unpinned module helpers, or CDN origins outside cdnjs/jsDelivr/unpkg; tile-service URLs are data endpoints, not library CDNs.
