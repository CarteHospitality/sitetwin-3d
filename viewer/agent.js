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
      description: "Apply changes to the plan shown to the engineer (the 3D twin updates). Call it once with the option you recommend.",
      parameters: {
        type: "object",
        properties: { changes: CHANGE_SCHEMA, reason: { type: "string" } },
        required: ["changes", "reason"],
      },
    },
  },
];

function systemPrompt(planner) {
  const b = planner.site.building;
  return `You are the planning assistant inside SiteTwin 3D, a digital twin of a mobile base-station rooftop site.
You help RF and site engineers decide antenna changes before anyone goes to site.

Conventions: azimuth is degrees clockwise from North; x is East, z is South, metres from the roof centre.
The roof is ${b.width_m} m (x from ${-b.width_m / 2} to ${b.width_m / 2}) by ${b.depth_m} m (z from ${-b.depth_m / 2} to ${b.depth_m / 2}), roof level ${b.height_m} m.
Antenna heights must be between ${b.height_m + 1} and ${b.height_m + 15} m. Tilts between -5 and 15 degrees. Power per band 1-240 W.

Goals, in order: 1) no EMF zone may reach a neighbouring building; 2) keep coverage as close to the baseline as possible; 3) keep restricted roof area small; 4) prefer the fewest, cheapest changes (tilt and power before height, height before moving or re-pointing).
EMF zones use a conservative point-source model and do not shrink with tilt; raising an antenna or lowering power are what move a zone off a neighbour.

Work method: call get_site_state first. Then evaluate at least two different options with evaluate_change. Pick the best by the goals, apply it with apply_change, and answer.
Never invent numbers: quote only figures returned by the tools. Final answer: 3-5 short sentences, in the same language as the engineer's message, saying what you changed, why, and the before/after numbers. If no option meets goal 1, say so plainly and give the least-bad option.`;
}

export function initAgent(planner, ui) {
  const history = [];

  const tools = {
    get_site_state: () => planner.state(),
    evaluate_change: ({ changes }) => planner.evaluate(changes),
    apply_change: ({ changes, reason }) => planner.apply(changes, reason),
  };

  async function callModel(messages) {
    const res = await fetch("api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, tools: TOOLS }),
    });
    if (!res.ok) throw new Error(`assistant unavailable (${res.status}): ${await res.text()}`);
    return res.json();
  }

  async function ask(text) {
    history.push({ role: "user", content: text });
    ui.user(text);
    ui.busy(true);
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const { message, model } = await callModel([{ role: "system", content: systemPrompt(planner) }, ...history]);
        ui.model(model);
        history.push(message);
        if (!message.tool_calls?.length) {
          ui.assistant(message.content || "(no answer)");
          return;
        }
        for (const call of message.tool_calls) {
          let args = {};
          let result;
          try {
            args = JSON.parse(call.function.arguments || "{}");
            result = tools[call.function.name]?.(args) ?? { error: `unknown tool ${call.function.name}` };
          } catch (e) {
            result = { error: String(e.message ?? e) };
          }
          ui.tool(call.function.name, args, result);
          history.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
      ui.assistant("Stopped after too many steps. The plan shows the last applied change.");
    } catch (e) {
      ui.assistant(`⚠️ ${e.message ?? e}`);
    } finally {
      ui.busy(false);
    }
  }

  return { ask, reset: () => (history.length = 0) };
}
