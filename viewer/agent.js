// Planning assistant: an agent loop that runs in the browser. The model
// (Muse Spark Open on Baseten, relayed by sitetwin3d/server.py) decides which
// tool to call; the tools run here on the live twin, so every option it
// tries is scored by the same EMF, conflict and coverage code as the UI.

const MAX_STEPS = 16;

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
      add_bands: { type: "array", items: { type: "string", enum: ["L800", "L1800", "L2100", "N3500"] } },
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
      description: "Try changes on a copy of the current plan without showing them. Returns the resulting zones, conflicts, roof restriction and coverage. Use it to compare options.",
      parameters: { type: "object", properties: { changes: CHANGE_SCHEMA }, required: ["changes"] },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_change",
      description: "Apply changes to the plan shown to the engineer (the 3D twin updates). Use it for direct instructions, or once with the option you recommend.",
      parameters: {
        type: "object",
        properties: { changes: CHANGE_SCHEMA, reason: { type: "string" } },
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
          coverage_band: { type: "string", description: "Band name as listed in get_site_state, e.g. L1800 or N3600" },
          select_antenna: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_field_work_order",
      description: "The physical work the current plan needs on site, derived from plan vs baseline: per antenna the work steps, materials and precautions, plus site-wide steps (permits, RF shutdown, EMF re-measurement, roof barriers). Call it after every apply_change.",
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
      parameters: { type: "object", properties: { site_id: { type: "string" }, instruction: { type: "string" } }, required: ["site_id"] },
    },
  },
];

function systemPrompt(planner, { voice } = {}) {
  const b = planner.site.building;
  const r = planner.roofBounds;
  return `You are the Expert Operator inside SiteTwin 3D, a digital twin of a mobile base-station rooftop site.
You think like a senior RF and site engineer at a mobile operator or equipment vendor, and you help engineers
decide antenna changes before anyone goes to site.\n${voice
    ? "The engineer is talking to you by voice: answer in 2-4 short spoken sentences, no lists or symbols."
    : "The engineer is typing: answer in short text; lists are fine."}

Two kinds of request:
- Direct instructions ("remove S2-A", "add a 5G AAU on sector 1", "tilt S3 down 2 degrees", "show coverage for N3500"):
  carry them out at once with apply_change or set_view, then report the consequences (new conflicts, sensitive buildings, coverage) and offer a fix if something got worse.
- Questions and goals ("fix the conflicts", "can we add 5G here?", "review this site"): investigate, compare options with evaluate_change, apply the best, and explain.
"Undo" means undo_last_change.

What makes an operator change a site, and the usual remedies:
- Capacity: many people served by one sector, or a growing area -> add a band (L2100, N3500 5G), split or add a sector.
- Coverage holes or weak edge -> reduce tilt, raise the antenna, re-point azimuth towards the demand.
- Overshoot / interference with neighbour sites -> increase tilt or lower power.
- EMF compliance: a zone reaching an occupied building, above all a sensitive one (school, kindergarten, hospital) -> raise height, lower power, re-point, or move the antenna on the roof. Treat sensitive buildings with extra margin and always mention them.
- Rooftop safety: zones over walkable roof at head height -> barriers and signage, or raise the antenna.
- New neighbouring construction, landlord or permit constraints -> re-plan height and azimuth.
Use get_population_context to know who lives and works around the site before EMF or capacity advice.

Turkish rules to keep in mind (BTK safety-certificate regulation; see docs/research/operator-change-planning.md):
- A single device may produce about 20% of the ICNIRP field strength (12.3 V/m above 2 GHz); the zones in this tool use that limit.
- Health facilities: the field from devices must stay below 3 V/m there. Kindergarten/primary-school floors of a building cannot host certified devices. Playgrounds and school gardens need the safety distance kept clear.
- When a new building, school or health facility appears near a site, a new measurement and notification are required: treat it as a trigger.
Typical operator capacity triggers (indicative, operator-specific): busy-hour PRB utilisation around 70% for load balancing and 80-85% for expansion.
Automate only low-risk, reversible changes that do not grow an EMF zone (tilt, re-pointing within the sector); power increases, new antennas and structural work need human approval, so say so.

Conventions: azimuth is degrees clockwise from North; x is East, z is South, metres from the roof centre.
The roof spans x from ${r.x0.toFixed(1)} to ${r.x1.toFixed(1)} m and z from ${r.z0.toFixed(1)} to ${r.z1.toFixed(1)} m (antennas must stand on it), roof level ${b.height_m} m.
This is a ${planner.site.structure ?? "rooftop"} site. Antenna heights must be between ${planner.heightRange[0]} and ${planner.heightRange[1]} m. Tilts between -5 and 15 degrees. Power per band 1-240 W.

Goals, in order: 1) no EMF zone may reach a neighbouring building; 2) keep coverage as close to the baseline as possible; 3) keep restricted roof area small; 4) prefer the fewest, cheapest changes (tilt and power before height, height before moving or re-pointing).
EMF zones use a conservative point-source model and do not shrink with tilt; raising an antenna or lowering power are what move a zone off a neighbour.

Work method for goals: call get_site_state first. Then evaluate at least two different options with evaluate_change. Pick the best by the goals, apply it with apply_change, and answer.
Never invent numbers: quote only figures returned by the tools, and say "estimated" for population figures.
Final answer, in the same language as the engineer (Turkish if they speak Turkish): what you changed, why, and the key before/after numbers. If no option meets goal 1, say so plainly and give the least-bad option.
After every apply_change, call get_field_work_order and, without being asked, finish with what has to happen physically:
${voice
    ? "in one or two spoken sentences, the main work (e.g. pole extension and longer cables, rigging team), the key precaution and the EMF re-measurement; say the full work order is in the panel."
    : "a short 'Field work' part with three labelled lists: work steps, materials, precautions and approvals (permits, RF shutdown, EMF re-measurement and safety certificate). Use only items the work order returned."}
If the engineer asks about or names another site, use list_sites and open_site; you cannot change other sites from here.`;
}

export function initAgent(planner, ui) {
  return createAgent({
    definitions: TOOLS,
    handlers: {
      get_site_state: () => planner.state(),
      evaluate_change: ({ changes }) => planner.evaluate(changes),
      apply_change: ({ changes, reason }) => planner.apply(changes, reason),
      undo_last_change: () => planner.undo(),
      get_population_context: () => planner.population(),
      set_view: (args) => planner.setView(args),
      get_field_work_order: () => planner.fieldWork(),
      list_sites: () => planner.listSites(),
      open_site: (args) => planner.openSite(args),
    },
    systemPrompt: (mode) => systemPrompt(planner, mode),
    ui,
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
export function createAgent({ definitions, handlers, systemPrompt, ui }) {
  const history = [];
  const tools = handlers;
  let mode = { voice: false };

  async function callModel(messages, withTools = true) {
    const res = await fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools: withTools ? definitions : [] }),
    });
    if (!res.ok) throw new Error(`assistant unavailable (${res.status}): ${await res.text()}`);
    return res.json();
  }

  // `voice`: the request was spoken, so the answer is spoken back; typed requests get text only.
  async function ask(text, { voice = false } = {}) {
    mode = { voice };
    history.push({ role: "user", content: text });
    ui.user(text);
    ui.busy(true);
    try {
      let leaving = false;
      for (let step = 0; step < MAX_STEPS; step++) {
        // After a navigation tool (e.g. open_site) the page is about to change: one last answer, no more tools.
        const { message, model } = await callModel([{ role: "system", content: systemPrompt(mode) }, ...history], !leaving);
        ui.model(model);
        history.push(message);
        if (!message.tool_calls?.length) {
          ui.assistant(message.content || "(no answer)");
          if (mode.voice) ui.speak?.(message.content || "");
          return;
        }
        for (const call of message.tool_calls) {
          let args = {};
          let result;
          try {
            args = JSON.parse(call.function.arguments || "{}");
            result = (await tools[call.function.name]?.(args)) ?? { error: `unknown tool ${call.function.name}` };
          } catch (e) {
            result = { error: String(e.message ?? e) };
          }
          ui.tool(call.function.name, args, result);
          if (result?.opening) leaving = true;
          history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
      ui.assistant("Stopped after too many steps.");
    } catch (e) {
      ui.assistant(`⚠️ ${e.message ?? e}`);
    } finally {
      ui.busy(false, mode);
    }
  }

  return { ask, reset: () => (history.length = 0), get voice() { return mode.voice; } };
}
