import { $, el } from "./ui.js";
import { replyHtml } from "./agent.js";
import { readSession, writeSession } from "./session.js";

const LABELS = {
  get_site_state: "Reading site state", get_population_context: "Checking nearby occupancy",
  evaluate_change: "Testing option", apply_change: "Applying recommended change",
  undo_last_change: "Undoing plan change", get_field_work_order: "Preparing field work",
  set_view: "Adjusting view", list_sites: "Reading portfolio", focus_site: "Focusing site", open_site: "Opening twin",
};

export function initConversation({ onBusy = () => {}, onComplete = () => {}, speak = () => {}, transcriptKey = "default" } = {}) {
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
    for (const b of document.querySelectorAll(".suggest")) b.disabled = on;
    if (on) {
      rows = new Map(); trialCount = completedTrials = failedTrials = 0;
      runFailed = false;
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
      if (name === "evaluate_change") {
        const n = result?.options?.length ?? 1;
        completedTrials += n; failedTrials += failed ? n : (result?.options ?? []).filter((o) => o.errors?.length).length;
        trialTitle.textContent = `${completedTrials} options tested${failedTrials ? ` · ${failedTrials} failed` : ""}`;
      } else announce(text);
    });
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
  return { user: (text) => say("user", text), assistant: (text) => say("assistant", text), photo,
    queued: (id, text) => { const row = el("div", { className: "msg tool", textContent: `◷ Queued · ${text}` }); queuedRequests.set(id, row); change(() => log.append(row)); },
    requestStart: (id) => { queuedRequests.get(id)?.remove(); queuedRequests.delete(id); },
    failed: () => { runFailed = true; },
    model: (model) => { $("chatModel").textContent = model; }, busy, waiting, toolStart, toolEnd, speak, say };
}
