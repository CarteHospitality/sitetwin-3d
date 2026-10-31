import { $, el } from "./ui.js";
import { replyHtml } from "./agent.js";
import { readSession, writeSession } from "./session.js";

const LABELS = {
  get_site_state: "Reading site state", get_population_context: "Checking nearby occupancy",
  evaluate_change: "Testing option", apply_change: "Applying recommended change",
  undo_last_change: "Undoing plan change", get_field_work_order: "Preparing field work",
  set_view: "Adjusting view", list_sites: "Reading portfolio", focus_site: "Focusing site", open_site: "Opening twin",
};

// `onApplyOption`: when given, options the agent compared but did not apply are shown
// as a table under its answer, each with an Apply button that calls it.
export function initConversation({ onBusy = () => {}, onComplete = () => {}, speak = () => {}, transcriptKey = "default", onApplyOption = null } = {}) {
  const log = $("chatLog");
  const stored = readSession(`transcript:${transcriptKey}`, []);
  const transcript = Array.isArray(stored) ? stored.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.text === "string").slice(-12) : [];
  let restoring = false;
  const notice = el("button", { className: "new-activity", textContent: "New activity ↓", hidden: true });
  log.after(notice);
  notice.onclick = () => { log.scrollTop = log.scrollHeight; notice.hidden = true; };
  log.addEventListener("scroll", () => { if (log.scrollHeight - log.scrollTop - log.clientHeight <= 48) notice.hidden = true; });
  let group, rail, groupTitle, trials, trialTitle, waitRow, waitTimer, runStart;
  let rows = new Map(), trialCount = 0, completedTrials = 0, failedTrials = 0;
  const queuedRequests = new Map();
  let runFailed = false;
  // Options compared in the current run, and Apply buttons of earlier tables (stale once the plan moves on).
  let compared = [], appliedInRun = false, liveButtons = [];
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight <= 48;
  function change(fn) {
    const follow = nearBottom();
    fn();
    if (follow) log.scrollTop = log.scrollHeight; else notice.hidden = false;
  }
  function announce(text) { $("liveStatus").textContent = text; }
  function say(role, text) {
    change(() => {
      if (role !== "assistant") return log.append(el("div", { className: `msg ${role}`, textContent: text }));
      const lines = text.split("\n");
      const message = el("div", { className: "msg assistant" });
      // Preserve all safely escaped content; long answers retain expandable detail.
      if (lines.length > 5) {
        message.append(el("div", { innerHTML: replyHtml(lines.slice(0, 3).join("\n")) }),
          el("details", {}, el("summary", { textContent: "Answer details" }), el("div", { innerHTML: replyHtml(lines.slice(3).join("\n")) })));
      } else message.innerHTML = replyHtml(text);
      log.append(message);
    });
    if (role === "assistant") announce(text.split("\n")[0]);
    if (!restoring && ["user", "assistant"].includes(role)) {
      transcript.push({ role, text });
      if (transcript.length > 12) transcript.shift();
      writeSession(`transcript:${transcriptKey}`, transcript);
    }
  }
  function waiting(on) {
    clearInterval(waitTimer);
    if (waitRow) waitRow.remove();
    waitRow = null;
    if (!on || !rail) return;
    const started = performance.now();
    const label = el("span", { textContent: "Waiting for operator response" });
    waitRow = el("div", { className: "waiting" }, el("span", { className: "typing", ariaHidden: "true" }, ...Array.from({ length: 3 }, () => el("i", { className: "typing-dot" }))), label);
    change(() => rail.append(waitRow));
    waitTimer = setInterval(() => {
      const seconds = Math.floor((performance.now() - started) / 1000);
      if (seconds >= 10) label.textContent = `Waiting for operator response · ${seconds}s`;
    }, 1000);
  }
  function busy(on, mode) {
    $("chatSend").disabled = on;
    $("chatInput").disabled = on;
    if (document.getElementById("photoButton")) $("photoButton").disabled = on;
    for (const b of document.querySelectorAll(".suggest")) b.disabled = on;
    if (on) {
      rows = new Map(); trialCount = completedTrials = failedTrials = 0;
      runFailed = false;
      compared = []; appliedInRun = false;
      for (const b of liveButtons) b.disabled = true;
      liveButtons = [];
      runStart = performance.now(); trials = null;
      groupTitle = el("summary", { textContent: "Working…" });
      rail = el("div", { className: "activity-rail" });
      group = el("details", { className: "run-activity" }, groupTitle, rail);
      change(() => log.append(group));
      announce("Operator running");
    } else {
      waiting(false);
      const failed = [...rows.values()].some((r) => r.failed);
      // A plain answer with no tool steps needs no activity row.
      if (!rows.size && !runFailed) group?.remove();
      else if (groupTitle) groupTitle.textContent =`${runFailed ? "✕ Failed" : failed ? "✓ Done, some steps failed" : "✓ Done"} · ${rows.size} steps · ${Math.round((performance.now() - runStart) / 1000)}s`;
      if (onApplyOption && !runFailed && !appliedInRun && compared.length) change(() => log.append(optionsTable(compared)));
    }
    onBusy(on, mode);
    if (!on) onComplete(mode);
  }
  function toolStart(id, name, args) {
    // One evaluate_change call can carry several options; count each as a trial.
    if (name === "evaluate_change") trialCount += Math.max(1, args.options?.length ?? 1) - 1;
    const heading = el("summary", { textContent: `◌ ${LABELS[name] ?? name}${name === "evaluate_change" ? ` ${++trialCount}` : ""} · Running` });
    const row = el("details", { className: "activity-step running" }, heading,
      el("pre", { textContent: JSON.stringify(args, null, 2) }));
    rows.set(id, { row, heading, name, started: performance.now() });
    if (groupTitle) groupTitle.textContent = `${LABELS[name] ?? name}${name === "evaluate_change" ? ` ${trialCount}` : ""}…`;
    change(() => {
      if (name === "evaluate_change") {
        if (!trials) {
          trialTitle = el("summary", { textContent: "Options being tested" });
          trials = el("details", { className: "trial-group" }, trialTitle);
          rail.append(trials);
        }
        trials.append(row);
      } else rail.append(row);
    });
  }
  function toolEnd(id, name, args, result) {
    if (!rows.has(id)) toolStart(id, name, args);
    const entry = rows.get(id);
    const failed = Boolean(result?.error || result?.errors?.length);
    entry.failed = failed;
    change(() => {
      entry.row.className = `activity-step ${failed ? "failed" : "completed"}`;
      entry.heading.textContent = `${failed ? "✕" : "✓"} ${LABELS[name] ?? name} · ${failed ? "Failed" : "Completed"} · ${((performance.now() - entry.started) / 1000).toFixed(1)}s`;
      const report = result?.result ?? result;
      let text = failed ? result.error ?? result.errors.join(", ")
        : name === "apply_change" ? "Applied to plan"
        : report?.summary ?? result?.opening ?? result?.focused ?? "Completed";
      if (result?.options) text = result.options.map((o) => `${o.label}: ${o.errors?.length ? "✕" : `${o.neighbour_conflicts.length} conflict findings`}`).join(" · ");
      if (report?.neighbour_conflicts) text += ` · ${report.neighbour_conflicts.length} conflict findings · ${report.roof_restrictions.length} roof restrictions`;
      entry.row.append(el("div", { className: "activity-result", textContent: text }), el("pre", { textContent: JSON.stringify(result, null, 2) }));
      if (name === "apply_change" && !failed) appliedInRun = true;
      if (name === "evaluate_change" && !failed) {
        const tried = result?.options ? result.options.map((r, i) => ({ label: r.label, changes: args.options?.[i]?.changes ?? [], result: r }))
          : [{ label: "Option", changes: args.changes ?? [], result }];
        for (const o of tried) { compared = compared.filter((c) => c.label !== o.label); compared.push(o); }
      }
      if (name === "evaluate_change") {
        const n = result?.options?.length ?? 1;
        completedTrials += n; failedTrials += failed ? n : (result?.options ?? []).filter((o) => o.errors?.length).length;
        trialTitle.textContent = `${completedTrials} options tested${failedTrials ? ` · ${failedTrials} failed` : ""}`;
      } else announce(text);
    });
  }
  // The compared options side by side; nothing changes until the engineer picks one.
  function optionsTable(options) {
    const buttons = [];
    const cell = (text, className = "") => el("td", { className, textContent: text });
    const rowsOut = options.map((o) => {
      const r = o.result;
      const label = el("td", { className: "option-label", textContent: o.label });
      label.dataset.noI18n = "";
      if (r?.errors?.length) return el("tr", { className: "impossible" }, label, el("td", { colSpan: 4, className: "muted", textContent: "Not possible" }));
      const loss = r.heavy_coverage_loss ?? [];
      const apply = el("button", { type: "button", className: "apply-option", textContent: "Apply" });
      apply.onclick = () => {
        for (const b of buttons) b.disabled = true;
        apply.textContent = "Applied";
        onApplyOption(o);
      };
      buttons.push(apply);
      return el("tr", {}, label,
        cell(String(r.neighbour_conflicts.length), r.neighbour_conflicts.length ? "bad" : "ok"),
        cell(String(r.roof_restrictions.length), r.roof_restrictions.length ? "warn" : "ok"),
        cell(loss.length ? loss.map((l) => `${l.band} ${l.change_pct}%`).join("\n") : "No heavy loss", `coverage ${loss.length ? "warn" : "ok"}`),
        el("td", {}, apply));
    });
    liveButtons.push(...buttons);
    return el("div", { className: "options-card" },
      el("div", { className: "options-title", textContent: "Options compared · nothing changes until you apply one" }),
      el("table", {},
        el("thead", {}, el("tr", {}, ...["Option", "Conflicts", "Roof", "Coverage", ""].map((h) => el("th", { textContent: h })))),
        el("tbody", {}, ...rowsOut)));
  }
  if (transcript.length) {
    restoring = true;
    log.replaceChildren(el("div", { className: "muted", textContent: "Previous conversation · display only. The operator starts fresh on this page." }));
    for (const message of transcript) say(message.role, message.text);
    restoring = false;
  }
  // A photo the engineer sent: thumbnail and what the vision model read (not kept in the transcript).
  function photo(src, caption) {
    change(() => log.append(el("div", { className: "msg user photo" }, el("img", { src, alt: "" }), el("div", { textContent: caption }))));
  }
  // A fresh start: empties the log and forgets the stored transcript.
  function clear() {
    transcript.length = 0;
    writeSession(`transcript:${transcriptKey}`, transcript);
    log.replaceChildren();
    notice.hidden = true;
  }
  return { user: (text) => say("user", text), assistant: (text) => say("assistant", text), photo, clear,
    queued: (id, text) => { const row = el("div", { className: "msg tool", textContent: `◷ Queued · ${text}` }); queuedRequests.set(id, row); change(() => log.append(row)); },
    requestStart: (id) => { queuedRequests.get(id)?.remove(); queuedRequests.delete(id); },
    failed: () => { runFailed = true; },
    model: (model) => { $("chatModel").textContent = model; }, busy, waiting, toolStart, toolEnd, speak, say };
}
