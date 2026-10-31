// Photo mode: Muse Spark 1.3 (Meta Model API, relayed by sitetwin3d/server.py)
// reads a site photo into equipment, label text and safety notes; the Expert
// Operator then compares what was seen with the twin.

import { tr } from "./i18n.js";

const kind = (k) => k.replaceAll("_", " ");

// What the vision model saw, in one short line for the conversation.
export function seenLine(obs) {
  return obs.items.map((i) => `${i.count} × ${tr(kind(i.kind))}`).join(", ");
}

// The request the agent receives: the full observation, and what to do with it. Buildings seen and
// direction hints go too: the agent can hold them against the twin's neighbours and azimuths.
export function photoRequest(obs, lang = "en") {
  const items = obs.items.map((i) => `- ${i.count} × ${kind(i.kind)}${i.manufacturer ? `, ${i.manufacturer}${i.model ? ` ${i.model}` : ""}` : ""}${i.label_text ? `, label "${i.label_text}"` : ""}${i.position ? ` (${i.position})` : ""}`);
  const side = (deg) => (Math.round(deg) === 0 ? "at the image centre" : `${Math.abs(Math.round(deg))}° ${deg < 0 ? "left" : "right"} of the image centre`);
  const structures = (obs.visible_structures ?? []).map((s) => `- ${s.description}: about ${Math.round(s.approx_distance_m)} m away, ${Math.round(s.approx_height_m)} m high${s.storeys ? ` (${s.storeys} storeys)` : ""}, ${side(s.bearing_offset_deg)}`);
  const hints = obs.direction_hints ?? [];
  return [`Site photo read by Muse Spark 1.3 (${kind(obs.photo_kind)}, confidence ${obs.confidence}): ${obs.summary}`,
    ...(items.length ? ["Equipment seen:", ...items] : []),
    ...(structures.length ? ["Buildings seen (estimated from the photo):", ...structures] : []),
    ...(hints.length ? [`Direction hints: ${hints.join("; ")}`] : []),
    ...(obs.safety_notes?.length ? [`Safety notes: ${obs.safety_notes.join("; ")}`] : []),
    `Compare the photo with this twin in at most 3 short lines: what matches, what is missing or different (equipment${structures.length ? ", buildings seen against the twin's neighbours" : ""}${hints.length ? ", direction hints against the antennas' azimuths" : ""}), and anything to check on site. Do not change the plan.${lang === "tr" ? " Answer in Turkish." : ""}`].join("\n");
}

export function initPhoto({ button, status, onRead }) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
  button.after(input);
  button.onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files[0];
    input.value = "";
    if (!file) return;
    button.disabled = true;
    status("Reading photo with Muse Spark 1.3…");
    try {
      const res = await fetch("api/photo", { method: "POST", headers: { "Content-Type": file.type || "image/jpeg" }, body: file });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const record = await res.json();
      status("");
      onRead(record.observation, URL.createObjectURL(file));
    } catch (e) {
      status(`Photo could not be read: ${e.message ?? e}`);
    } finally {
      button.disabled = false;
    }
  };
}
