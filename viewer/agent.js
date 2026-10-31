// Planning assistant: an agent loop that runs in the browser. The model
// (Muse Spark Open on Baseten, relayed by sitetwin3d/server.py) decides which
// tool to call; the tools run here on the live twin, so every option it
// tries is scored by the same EMF, conflict and coverage code as the UI.

import { tr } from "./i18n.js";

// A goal usually takes three model calls: compare options, apply one, answer.
const MAX_STEPS = 12;
// One model call that has not answered by then is treated as an outage (a normal call takes 2-15 s).
const MODEL_TIMEOUT_MS = 60000;
// Steps left at which the agent is told to stop exploring and commit to its best option.
const DECIDE_AT = 4;
// Served as static files (the online demo), the page has no model server: what to say instead.
export const STATIC_NOTE = "This online demo has no model server: the Expert Operator answers when SiteTwin 3D runs on your machine with a model key (see the README). The 3D twin, the checks, manual changes and the action plan work here.";

// The online demo has no server: the chat keeps its welcome and the note, and drops the input, the
// question chips, voice and photo, and the map's Load file, which could only fail there.
export function staticChat() {
  const composer = document.querySelector(".composer");
  if (composer) composer.hidden = true;
  // Loading a site file needs the server's importer (/api/import): not offered here either.
  const load = document.getElementById("loadTwin");
  if (load) load.hidden = true;
  const model = document.getElementById("chatModel");
  if (model) model.textContent = tr("none in the online demo");
}

// Set once the page is being left: a model call cut off by it is not an outage.
let unloading = false;
addEventListener("pagehide", () => { unloading = true; });
// A page-to-page transition the browser skips (a hidden tab, a quick second navigation) rejects its
// promises: not an error.
for (const type of ["pageswap", "pagereveal"]) {
  addEventListener(type, (e) => {
    for (const step of ["updateCallbackDone", "ready", "finished"]) e.viewTransition?.[step]?.catch(() => {});
  });
}

// Whether the page has its own server: it answers api/health; a static host does not know the address.
// The online demo on GitHub Pages is known to have none, so it is not asked (no 404 in its console).
export async function hasServer() {
  if (location.hostname.endsWith(".github.io")) return false;
  try {
    return (await fetch("api/health")).ok;
  } catch { return false; }
}

const CHANGE_SCHEMA = {
  type: "array",
  description: "List of changes. Each item changes one antenna.",
  items: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["modify", "add_antenna", "remove_antenna"] },
      antenna_id: { type: "string" },
      azimuth_deg: { type: "number" },
      mechanical_tilt_deg: { type: "number" },
      electrical_tilt_deg: { type: "number" },
      height_agl_m: { type: "number" },
      x_m: { type: "number", description: "East position on the roof" },
      z_m: { type: "number", description: "South position on the roof" },
      band_power_w: { type: "object", description: "Band name -> total power in W, e.g. {\"L1800\": 15}", additionalProperties: { type: "number" } },
      add_bands: { type: "array", items: { type: "string", enum: ["N700", "L800", "L1800", "L2100", "L2600", "N3500", "N3600"] } },
      remove_bands: { type: "array", items: { type: "string" } },
    },
    required: ["action", "antenna_id"],
  },
};

const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_site_state",
      description: "Current plan: antennas, EMF zone sizes, conflicts with neighbouring buildings, restricted roof area and coverage, plus the same figures for the baseline.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "evaluate_change",
      description: "Try 2-4 alternative options at once, each on its own copy of the current plan, without showing them. Returns per option the resulting zones, conflicts, roof restriction and coverage. Put every option you want to compare in one call.",
      parameters: {
        type: "object",
        properties: {
          options: {
            type: "array", maxItems: 4,
            items: { type: "object", properties: { label: { type: "string", description: "Short name, e.g. 'S3 power 18 W'" }, changes: CHANGE_SCHEMA }, required: ["label", "changes"] },
          },
        },
        required: ["options"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_change",
      description: "Apply changes to the plan shown to the engineer (the 3D twin updates). Use it for direct instructions, or once with the option you recommend. The result includes the field crew the change needs.",
      parameters: {
        type: "object",
        properties: { changes: CHANGE_SCHEMA, reason: { type: "string", description: "One plain sentence for the action plan the field team reads, in the same language as your answer." } },
        required: ["changes", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "undo_last_change",
      description: "Revert the most recent apply_change.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_population_context",
      description: "People around the site: occupancy and use of each neighbouring building (schools, hospitals and kindergartens are sensitive), distance, and how many people each antenna's main lobe serves. Use for EMF sensitivity and capacity decisions.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "set_view",
      description: "Change what the engineer sees: toggle layers, pick the coverage band, select an antenna to highlight.",
      parameters: {
        type: "object",
        properties: {
          zones: { type: "boolean" },
          coverage: { type: "boolean" },
          baseline: { type: "boolean" },
          coverage_band: { type: "string", description: "Band name as listed in get_site_state, e.g. L1800 or N3500" },
          select_antenna: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_field_work_order",
      description: "Full detail of the physical work the current plan needs on site: per antenna the work steps, materials and precautions, site-wide steps (permits, RF shutdown, EMF re-measurement, roof barriers), and `crew`. apply_change already returns the crew; call this only when the engineer asks for the details.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_sites",
      description: "Other sites in the portfolio (id, structure, technology, pending SiteTwin change), to switch to another site.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "open_site",
      description: "Leave this site and open another site's 3D twin, where `instruction` (or a full review) is carried out. Use when the engineer names another site.",
      parameters: { type: "object", properties: { site_id: { type: "string" }, instruction: { type: "string", description: "What to do there, in the engineer's own words and language" } }, required: ["site_id"] },
    },
  },
];

function systemPrompt(planner, { voice } = {}) {
  const b = planner.site.building;
  const r = planner.roofBounds;
  // A tower or a mast stands in a fenced ground compound: there is no roof to walk on.
  const structure = (planner.site.structure ?? "rooftop").replace(/_/g, " ");
  const rooftop = structure === "rooftop";
  return `You are the Expert Operator inside SiteTwin 3D, a digital twin of one mobile base-station site (on a rooftop, a tower or a mast).
You think like a senior RF and site engineer at a mobile operator or equipment vendor, and you help engineers
decide antenna changes before anyone goes to site. You only work on this: the site, its network, its safety and its field work.
For anything else (a poem, a joke, general questions), say in one sentence that you help with the site, and offer one thing you can look at on it.\n${voice
    ? "The engineer is talking to you by voice: at most four short spoken sentences in total (about 20 seconds aloud), field work included; round numbers, no lists or symbols."
    : "The engineer is typing: short plain sentences, no headings, no tables. The side panel already shows the checks, the changes and the field crew, so do not repeat those details."}

How to speak. The person in front of you may not be a radio engineer (a manager, a jury), so by default speak plainly:
- No jargon or units: no dBm, km², PRB, W, dBi, V/m, azimuth or tilt degrees, cell or band codes (say "5G" or "the 4G layer" if needed).
  Say what it means: the signal reaches farther or not, is strong or weak, how many people a sector serves (estimated), whether homes, schools or hospitals keep a safe distance.
- Numbers only when they help and in plain form: people ("about 2,300 people"), shares ("about a third more area with a strong signal"), time ("in about 8 months").
- An analysis ("analyse this site", "is capacity enough", "is there a risk") has this shape, a sentence or two each:
  1. Today: how the site works now (reach, people served, safety).
  2. Next year: what happens if nothing changes, from capacity_outlook in the briefing (say it is an estimate); skip it when there is no outlook.
  3. What would improve it, with the expected effect in plain words.
  4. Two or three choices, each alone on its own line starting with "▸ " (they become buttons). Use exactly the label you gave that option in evaluate_change.
  5. Last line: offer the technical details, in the answer's language (English: "I can also explain the technical details."; Turkish: "İstersen teknik ayrıntılarını da anlatabilirim.").
- Label every option you evaluate the way the engineer would click it, in the engineer's language, with no units, band names (L2100, N3500) or antenna and sector codes (S2, S1-1):
  name the direction and the effect, e.g. "Add a 4G layer facing south", "Add 5G facing south", "Raise the antennas a little". The same goes for your sentences.
  Name an antenna's direction as its "facing" in the briefing (in the answer's language), so it is the same every time.
- When the engineer asks for the technical details, give them: parameters, numbers and units from the tools.

Two kinds of request:
- Direct instructions ("remove S2-A", "add a 5G AAU on sector 1", "tilt S3 down 2 degrees", "show coverage for N3500"):
  carry them out at once with apply_change or set_view, then report the consequences (new conflicts, sensitive buildings, coverage) and offer a fix if something got worse.
- Goals ("fix the conflicts", "add capacity on sector 2"): investigate, compare options with evaluate_change, apply the best, and explain.
- The engineer's card ranks your compared options by a fixed rule (sensitive buildings, other buildings, coverage loss, roof, field work, then the smaller change). If the option you prefer is not the one it puts first, say in one sentence why you prefer it.
- Reviews and questions ("analyse this site", "review this site", "can we add 5G here?"): investigate and compare options with evaluate_change, but do not apply: answer in the analysis shape above, with your options as "▸ " choices, best first. The engineer clicks one to apply it.
  When the engineer then approves in words ("apply", "uygula", "yes"), apply that option with apply_change.
"Undo" means undo_last_change.

What makes an operator change a site, and the usual remedies:
- Capacity: many people served by one sector, or a growing area -> add a band (L2100, N3500 5G), split or add a sector.
  More power widens the coverage; it does not add capacity (the cell has the same resource blocks), so never offer it as a capacity fix.
- Coverage holes or weak edge -> reduce tilt, raise the antenna, re-point azimuth towards the demand.
- Overshoot / interference with neighbour sites -> increase tilt or lower power.
- EMF compliance: a zone reaching an occupied building, above all a sensitive one (school, kindergarten, hospital) -> raise height, lower power, re-point, or move the antenna on the roof. Treat sensitive buildings with extra margin and always mention them.
- Rooftop safety: zones over walkable roof at head height -> barriers and signage, or raise the antenna.
- New neighbouring construction, landlord or permit constraints -> re-plan height and azimuth.
The briefing at the end already gives the site state and who lives and works around it.

Turkish rules to keep in mind (BTK safety-certificate regulation):
- BTK Elektronik Haberleşme Cihazları Güvenlik Sertifikası Yönetmeliği, Article 16(2): a single device may produce 20% of the ICNIRP field strength (12.3 V/m above 2 GHz) and all devices together 70%.
  The zones follow the regime in the briefing, which the engineer can switch: "TR single device (20% field)" draws them at that 20% and sums overlapping antennas against the 70%; "ICNIRP general public" draws them at the full ICNIRP limit, a looser screen than the Turkish rule, so say so when it is active.
- Health facilities (Article 6(8)): the field from devices installed there must stay below 3 V/m; this tool applies it to health facilities near the site as a conservative screen. Kindergarten/primary-school floors of a building cannot host certified devices. Playgrounds and school gardens need the safety distance kept clear.
- When a new building, school or health facility appears near a site, a new measurement and notification are required: treat it as a trigger.
Typical operator capacity triggers (indicative, operator-specific): busy-hour PRB utilisation around 70% for load balancing and 80-85% for expansion.
Assumed heights: most buildings have no height in the open data, so 5 storeys are assumed. The briefing's height_checks list each school or hospital in a zone with an assumed height and from how many storeys up the finding holds. When it holds only from about the assumed height, say in one sentence that its height must be measured first: if the building is lower, the fix may not be needed.
If the engineer tells you a measured height, say from height_checks what it would mean, but you cannot record it: the twin and the action plan keep the assumed height and the finding (this tool has no field for a measured height yet; the measurement report is filed with the operator, outside it). Never call the finding cleared on a reported figure alone.
Capacity data: when the briefing has network_kpi, it is busy-hour load per cell (sector + band), before the plan; its source says whether it was measured on the operator's network or is sample data.
Use it for capacity instead of the population estimate, and when you quote it say what its source says: "measured" or "sample data", never "measured" for sample data. A cell at 85% PRB or more needs expansion on that sector (a new band or carrier such as L2100 or N3500, or a split);
70-85% needs load balancing or a plan for growth. Without network_kpi, capacity is only estimated from the people around the site: say so if capacity matters.
The plan is a simulation: the engineer's goal or instruction is enough to add a change to it. Power increases, new antennas and structural work still need the operator's approval and a field check before anything is built: when you add one, say so in a few words.

Conventions: azimuth is degrees clockwise from North; x is East, z is South, metres from the roof centre.
${rooftop
    ? `This is a rooftop site. The roof spans x from ${r.x0.toFixed(1)} to ${r.x1.toFixed(1)} m and z from ${r.z0.toFixed(1)} to ${r.z1.toFixed(1)} m (antennas must stand on it), roof level ${b.height_m} m.`
    : `This is a ${structure} site: the antennas are on the ${structure}, in a ground compound spanning x from ${r.x0.toFixed(1)} to ${r.x1.toFixed(1)} m and z from ${r.z0.toFixed(1)} to ${r.z1.toFixed(1)} m. There is no roof to walk on: never call it a rooftop site or talk about its roof.`} Antenna heights must be between ${planner.heightRange[0]} and ${planner.heightRange[1]} m. Mechanical tilt -5 to 15 degrees, electrical tilt 0 to 15 degrees. Power per band 1-80 W below 3 GHz, up to 240 W above (5G mid-band).
These ranges are the equipment limits of this planning tool, not regulatory ones: never call them a regulation.

Goals, in order: 1) no EMF zone may reach a neighbouring building; 2) keep coverage as close to the baseline as possible; 3) keep restricted roof area small; 4) prefer the fewest, cheapest changes (tilt and power before height, height before moving or re-pointing).
EMF zones use a conservative point-source model and do not shrink with tilt; raising an antenna or lowering power are what move a zone off a neighbour.
Raising keeps more coverage than lowering power, though raising too high costs coverage too: whenever a zone reaches a building, two of the options you compare only raise the antennas (power unchanged), one moderately (a few metres) and one higher.
Coverage cost: every result lists heavy_coverage_loss, the bands that lose 30% or more of their area at -90 dBm or better against the baseline. That is a heavy cost for subscribers:
prefer an option without it; always say it in the answer, plainly ("the strong signal would shrink by about a third"); if every option has it, say the fix costs coverage and how to win it back (e.g. add a new layer on that sector).
The baseline is the site as it stands, the result of its latest SiteTwin application; the plan is the next change on top of it.

Work method for goals, in as few turns as possible: read the briefing (do not call get_site_state or get_population_context for it).
Compare two to four different options in ONE evaluate_change call. Pick the best by the goals, apply it with apply_change (for a review: recommend it and wait for approval), and answer.
Never invent numbers: quote only figures returned by the tools, and say "estimated" for population figures.
Final answer, in the same language as the engineer (Turkish if they speak Turkish). ${document.documentElement.lang === "tr" ? "The engineer's screen is in Turkish: always answer in Turkish, even when an instruction arrives in English." : ""}
Final answer content: what you changed (or recommend), why, and what it brings, in plain words (technical numbers only when asked). If no option meets goal 1, say so plainly and give the least-bad option. Speak of the options you compared ("none of the options I compared..."), never that it cannot be done at all.
After every apply_change, without being asked, finish with what has to happen physically, using the field_crew it returned:
${voice
    ? "in one spoken sentence: how many people go to site and for how long (from crew), and that the action plan is ready in the panel."
    : "one last line with the field work: how many people go to site and for how long (estimated, from the crew), and that the action plan can be sent to the team from the right panel."}
If the engineer asks about or names another site, use list_sites and open_site; you cannot change other sites from here.

Briefing (current figures, refreshed every turn):
${JSON.stringify(planner.briefing())}`;
}

export function initAgent(planner, ui) {
  return createAgent({
    definitions: TOOLS,
    handlers: {
      get_site_state: () => planner.state(),
      evaluate_change: ({ options, changes }) => options?.length
        ? { options: options.slice(0, 4).map((o) => ({ label: o.label, ...planner.evaluate(o.changes ?? []) })) }
        : planner.evaluate(changes ?? []),
      // The page plays the change step by step; the reply comes once the engineer has seen it.
      apply_change: async ({ changes, reason }) => {
        const result = planner.apply(changes, reason);
        await planner.settled?.();
        return result;
      },
      undo_last_change: () => planner.undo(),
      get_population_context: () => planner.population(),
      set_view: (args) => planner.setView(args),
      get_field_work_order: () => planner.fieldWork(),
      list_sites: () => planner.listSites(),
      open_site: (args) => planner.openSite(args),
    },
    systemPrompt: (mode) => systemPrompt(planner, mode),
    ui,
    // Each call compares up to four options; a third round adds time, rarely a better answer.
    limits: { evaluate_change: 2 },
  });
}

// Replies use light Markdown (bold, italics, bullet lines). Render it safely:
// escape everything, then turn only ** and * markers into tags.
export function replyHtml(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,:;!?]|$)/gm, "$1<i>$2</i>")
    .replace(/^- /gm, "• ")
    .replace(/^#{1,4} (.+)$/gm, "<b>$1</b>");
}

// The agent loop itself, shared by the 3D planner and the portfolio map:
// the model picks tools, the handlers run them in this page, results go back.
// `limits`: most calls of a tool per request, e.g. { evaluate_change: 3 }.
export function createAgent({ definitions, handlers, systemPrompt, ui, limits = {} }) {
  const history = [];
  const tools = handlers;
  let mode = { voice: false };
  let queue = Promise.resolve();
  let requestCount = 0;

  async function callModel(messages, withTools = true) {
    ui.waiting?.(true);
    // A model call that hangs ends after MODEL_TIMEOUT_MS like any other outage: the page stays usable.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), MODEL_TIMEOUT_MS);
    try {
      const res = await fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools: withTools ? definitions : [] }),
      signal: timeout.signal,
      }).catch((error) => {
        if (error.name === "AbortError") throw new Error(tr(`The Expert Operator did not answer within ${MODEL_TIMEOUT_MS / 1000} s. The 3D twin, the checks and manual changes still work.`));
        // No answer at all: the local server stopped or the connection dropped.
        console.warn("assistant unreachable", error);
        throw new Error(tr("The Expert Operator cannot be reached: the server does not answer. The 3D twin, the checks and manual changes still work."));
      });
      // Said plainly, with what still works; the server's own text goes to the console.
      if (!res.ok) {
        console.warn("assistant unavailable", res.status, await res.text());
        // 503: the server has no model key (a fresh clone). 404/405/501: no server at all (the page is
        // served as static files, as in the online demo). Neither is an outage: say what is missing.
        throw new Error(tr(res.status === 503
          ? "The Expert Operator needs a model API key on the server (BASETEN_API_KEY or MODEL_API_KEY in .env, see the README). The 3D twin, the checks and manual changes still work."
          : [404, 405, 501].includes(res.status) ? STATIC_NOTE
          : `The Expert Operator cannot be reached right now (${res.status}). The 3D twin, the checks and manual changes still work.`));
      }
      return await res.json();
    } finally { clearTimeout(timer); ui.waiting?.(false); }
  }

  // `voice`: the request was spoken, so the answer is spoken back; typed requests get text only.
  // `silent`: the page already showed the request its own way (e.g. a photo).
  // `review`: the request asks for an analysis, so the plan is not changed (no apply, no undo): the
  // engineer adds an option to the plan from the decision card or says so in a later request.
  async function runAsk(text, { voice = false, silent = false, review = false } = {}, requestId) {
    mode = { voice };
    const used = {};
    ui.requestStart?.(requestId);
    history.push({ role: "user", content: text });
    if (!silent) ui.user(text);
    ui.busy(true);
    try {
      let leaving = false;
      for (let step = 0; step < MAX_STEPS; step++) {
        // After a navigation tool (e.g. open_site) the page is about to change: one last answer, no more tools.
        const nudge = MAX_STEPS - step <= DECIDE_AT
          ? [{ role: "system", content: `Step budget nearly used. Stop testing: ${review ? "recommend" : "apply"} the best option you have evaluated (or say none is acceptable), then answer.` }]
          : [];
        const { message, model, fallback } = await callModel([{ role: "system", content: systemPrompt(mode) }, ...history, ...nudge], !leaving);
        ui.model(model, fallback);
        history.push(message);
        if (!message.tool_calls?.length) {
          ui.assistant(message.content || "(no answer)");
          if (mode.voice) await ui.speak?.(message.content || "");
          return;
        }
        for (const call of message.tool_calls) {
          let args = {};
          let result;
          let started = false;
          try {
            args = JSON.parse(call.function.arguments || "{}");
            ui.toolStart?.(call.id, call.function.name, args);
            started = true;
            // A tool with a budget (e.g. comparing options) answers with a nudge once it is used up.
            used[call.function.name] = (used[call.function.name] ?? 0) + 1;
            result = review && ["apply_change", "undo_last_change"].includes(call.function.name)
              ? { error: "This request is a review: the plan is not changed. Recommend the best option you compared; the engineer adds it to the plan from the decision card." }
              : used[call.function.name] > (limits[call.function.name] ?? Infinity)
              ? { error: `Comparison budget used. ${review ? "Recommend" : "Apply"} the best option you have already evaluated, or say none is acceptable.` }
              : (await tools[call.function.name]?.(args)) ?? { error: `unknown tool ${call.function.name}` };
          } catch (e) {
            if (!started) ui.toolStart?.(call.id, call.function.name, args);
            result = { error: String(e.message ?? e) };
          }
          ui.tool?.(call.function.name, args, result, call.id);
          ui.toolEnd?.(call.id, call.function.name, args, result);
          if (result?.opening) leaving = true;
          history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
      ui.failed?.();
      ui.assistant("Stopped after too many steps.");
    } catch (e) {
      // A reload or a navigation cuts the call off: not an outage, nothing to tell the next page.
      if (unloading) return;
      ui.failed?.();
      ui.assistant(`⚠️ ${e.message ?? e}`);
    } finally {
      ui.busy(false, mode);
    }
  }

  // Each request owns its voice mode and tool timeline until it finishes.
  function ask(text, options) {
    const requestId = ++requestCount;
    ui.queued?.(requestId, text);
    const run = queue.then(() => runAsk(text, options, requestId));
    queue = run.catch(() => {});
    return run;
  }

  // `note`: something the engineer did outside the chat (e.g. applied an option from the table), so later turns know it.
  return { ask, note: (text) => history.push({ role: "user", content: text }), reset: () => (history.length = 0), get voice() { return mode.voice; } };
}
