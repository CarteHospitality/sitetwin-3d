import { $, el } from "./ui.js";
import { replyHtml } from "./agent.js";
import { readSession, writeSession } from "./session.js";
import { tr } from "./i18n.js";

const LABELS = {
  get_site_state: "Reading site state", get_population_context: "Checking nearby occupancy",
  evaluate_change: "Testing option", apply_change: "Applying recommended change",
  undo_last_change: "Undoing plan change", get_field_work_order: "Preparing field work",
  set_view: "Adjusting view", list_sites: "Reading portfolio", focus_site: "Focusing site", open_site: "Opening twin",
};

// `onApplyOption`: when given, options the agent compared but did not apply can be applied
// from the chat: its choices ("▸ " lines) become buttons, and a folded technical table lists them.
// `onChoice`: a choice that matches no compared option is sent back to the agent as a request.
// `scanLines(asked)`: facts the page knows at once about the site, shown one per line while the
// operator works on a question about it ([{ step } | { text, level }]); none for instructions.
// What each tool is doing, in the live account.
const STEP_TEXT = {
  get_site_state: "Reading the site state", get_population_context: "Counting the people nearby",
  evaluate_change: "Comparing options", apply_change: "Applying the change to the plan",
  get_field_work_order: "Preparing the field work", set_view: "Adjusting the view",
};
// The account's lines follow each other quickly (they are known at once); paragraphs appear together.
const SCAN_MS = 0, REVEAL_MS = 0;
// The card ranks options by a fixed rule, so the same options always come out in the same order:
// sensitive buildings in a zone, then other buildings, heavy coverage loss (how many bands, how
// much), roof restrictions, then the field work (remote before a site visit, fewer people-days).
const MAX_CARD_OPTIONS = 4;
// The model that answered, by name; "(fallback)" when the configured provider failed and the other one
// answered (sitetwin3d/server.py).
const MODEL_NAMES = { "meta-models/muse-spark-open-1026": "Muse Spark Open · Baseten", "muse-spark-1.3": "Muse Spark 1.3 · Meta Model API", "muse-wonder-1.0": "Muse Wonder · Meta Model API" };
function optionScore(r) {
  const sensitive = r.neighbour_conflicts.filter((t) => t.includes("SENSITIVE")).length;
  const loss = r.heavy_coverage_loss ?? [];
  // No visit (a remote change, or no change at all) is no field work.
  const work = !r.field_work?.people || r.field_work.remote ? 0 : r.field_work.people * Math.max(1, r.field_work.days);
  return [sensitive, r.neighbour_conflicts.length - sensitive, loss.length, loss.reduce((s, l) => s + Math.abs(l.change_pct), 0), r.roof_restrictions.length, work];
}
function byScore(p, q) {
  const bad = (o) => Boolean(o.result?.errors?.length);
  if (bad(p) !== bad(q)) return bad(p) ? 1 : -1;
  if (bad(p)) return 0;
  const a = optionScore(p.result), b = optionScore(q.result);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  // On a tie the smaller change goes first; then the label keeps one order whatever order they came in.
  return changeSize(p) - changeSize(q) || p.label.localeCompare(q.label);
}
// The size of an option: every parameter it sets (a height, a tilt, a band's power, a band added or
// removed), an added or removed antenna counting one more. Raising alone is smaller than raising and
// lowering the power of three bands, though both are one change of one antenna.
const PARAMS = ["azimuth_deg", "mechanical_tilt_deg", "electrical_tilt_deg", "height_agl_m", "x_m", "z_m"];
function changeSize(o) {
  return (o.changes ?? []).reduce((n, c) => n + (c.action === "modify" ? 0 : 1) + PARAMS.filter((k) => typeof c[k] === "number").length
    + (c.add_bands?.length ?? 0) + (c.remove_bands?.length ?? 0) + Object.keys(c.band_power_w ?? {}).length, 0);
}
// `stateNow()`: today's figures ({ conflicts }) shown beside each option's in the decision card.
// `describeOption(changes)`: an option's changes as lines from today's values to the new ones.
// `planSignature()`: the plan as a string, to tell whether it changed since options were drawn.
export function initConversation({ onBusy = () => {}, onComplete = () => {}, speak = () => {}, transcriptKey = "default", onApplyOption = null, onChoice = null, scanLines = null, stateNow = null, describeOption = null, planSignature = null } = {}) {
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
  let compared = [], appliedInRun = false, liveButtons = [], choices = [];
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight <= 48;
  function change(fn) {
    const follow = nearBottom();
    fn();
    if (follow) log.scrollTop = log.scrollHeight; else notice.hidden = false;
  }
  function announce(text) { $("liveStatus").textContent = text; }
  // The live account: lines come out one at a time; a step shows ◌ while it runs and ✓ when the next
  // line arrives. The answer and the choices wait until every queued line is out.
  let scanList = null, scanQueue = [], scanTimer = null, scanWaiting = [], scanSteps = new Set(), lastAsked = "", revealEnd = 0;
  function finishStep(li) {
    li.className = "done";
    li.textContent = li.doneText?.() ?? li.dataset.step;
  }
  function scanPush(line) {
    if (!scanList) return;
    scanQueue.push(line);
    if (!scanTimer) scanNext();
  }
  function scanNext() {
    // A run that ended with lines still queued drops them; what waited on them still runs.
    const line = scanList ? scanQueue.shift() : null;
    if (!line) {
      scanQueue = [];
      scanTimer = null;
      const waiting = scanWaiting;
      scanWaiting = [];
      for (const fn of waiting) fn();
      return;
    }
    change(() => {
      const running = scanList.querySelector("li.running");
      if (running) finishStep(running);
      const li = el("li", { className: line.step ? "running" : line.level ?? "ok", textContent: line.step ? `${line.step}…` : line.text });
      li.dataset.noI18n = "";
      if (line.step) { li.dataset.step = line.step; li.doneText = line.done; }
      scanList.append(li);
    });
    scanTimer = setTimeout(scanNext, SCAN_MS);
  }
  function afterScan(fn) {
    if (scanTimer || scanQueue.length) scanWaiting.push(fn); else fn();
  }
  function say(role, text) {
    if (role === "user") lastAsked = text;
    if (role === "assistant" && !restoring) return afterScan(() => show(role, text));
    show(role, text);
  }
  function show(role, text) {
    change(() => {
      if (role !== "assistant") return log.append(el("div", { className: `msg ${role}`, textContent: text }));
      // The agent's choices ("▸ " lines) are shown as buttons after the run, not as text.
      const all = text.split("\n");
      const lines = all.filter((line) => !line.trim().startsWith("▸"));
      if (!restoring) choices = all.filter((line) => line.trim().startsWith("▸")).map((line) => line.trim().replace(/^▸\s*/, "")).filter(Boolean);
      const message = el("div", { className: "msg assistant" });
      // Preserve all safely escaped content; only really long answers fold their tail (blank lines do not count).
      if (lines.filter((line) => line.trim()).length > 10) {
        message.append(el("div", { innerHTML: replyHtml(lines.slice(0, 3).join("\n")) }),
          el("details", {}, el("summary", { textContent: "Answer details" }), el("div", { innerHTML: replyHtml(lines.slice(3).join("\n")) })));
      } else if (restoring) message.innerHTML = replyHtml(lines.join("\n"));
      else {
        // A fresh answer arrives paragraph by paragraph, softly.
        const paragraphs = lines.join("\n").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
        paragraphs.forEach((p, i) => {
          const para = el("div", { className: "para reveal", innerHTML: replyHtml(p) });
          para.style.animationDelay = `${i * REVEAL_MS}ms`;
          message.append(para);
        });
        revealEnd = paragraphs.length * REVEAL_MS;
      }
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
    // The model is really thinking now: one step for it in the account, ended by the next real event.
    if (on && scanList && !scanSteps.has("thinking")) { scanSteps.add("thinking"); scanPush({ step: tr("The operator is thinking") }); }
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
      compared = []; appliedInRun = false; choices = [];
      for (const b of liveButtons) b.disabled = true;
      liveButtons = [];
      runStart = performance.now(); trials = null; revealEnd = 0;
      rail = el("div", { className: "activity-rail" });
      const lines = scanLines?.(lastAsked) ?? [];
      scanQueue = []; scanSteps = new Set();
      if (lines.length) {
        // A question about the site: the clean account on top, the technical steps folded under it.
        scanList = el("ol", { className: "scan-lines" });
        groupTitle = el("summary", { textContent: "Analysing the site…" });
        // The facts are the page's own calculation, said as such; the steps below them are the operator's real work.
        group = el("details", { className: "run-activity scanning", open: true }, groupTitle,
          el("div", { className: "scan-caption", textContent: "Site summary, calculated in this page" }), scanList,
          el("details", { className: "tech-steps" }, el("summary", { textContent: "Technical steps" }), rail));
      } else {
        scanList = null;
        groupTitle = el("summary", { textContent: "Working…" });
        group = el("details", { className: "run-activity" }, groupTitle, rail);
      }
      change(() => log.append(group));
      for (const line of lines) scanPush(line);
      announce("Operator running");
    } else {
      waiting(false);
      const failed = [...rows.values()].some((r) => r.failed);
      const seconds = Math.round((performance.now() - runStart) / 1000);
      const scanned = scanList, run = group, title = groupTitle;
      afterScan(() => {
        // A plain answer with no tool steps and no account needs no activity row.
        if (scanned) {
          const running = scanned.querySelector("li.running");
          if (running) finishStep(running);
          title.textContent = runFailed ? "✕ Failed" : `✓ Analysis done · ${seconds}s`;
          run.open = false;
        } else if (!rows.size && !runFailed) run?.remove();
        else if (title) title.textContent = `${runFailed ? "✕ Failed" : failed ? "✓ Done, some steps failed" : "✓ Done"} · ${rows.size} steps · ${seconds}s`;
        // After the answer's last paragraph: the options the operator compared, as one open card with
        // the recommended one first; then any other choice (a question for the operator) as a button.
        const later = (node) => { node.classList.add("reveal"); node.style.animationDelay = `${revealEnd}ms`; return node; };
        const card = !runFailed && onApplyOption && !appliedInRun && compared.length ? decisionCard(choices, compared) : null;
        if (card) change(() => log.append(later(card.element)));
        const rest = card ? choices.filter((c) => !card.used.has(c)) : choices;
        if (!runFailed && (rest.length || card) && (onApplyOption || onChoice)) change(() => log.append(later(choiceButtons(rest, card ? [] : compared))));
      });
      scanList = null;
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
    if (scanList && STEP_TEXT[name] && !scanSteps.has(name)) {
      scanSteps.add(name);
      // Comparing options ends as how many were compared.
      scanPush({ step: tr(STEP_TEXT[name]), done: name === "evaluate_change" ? () => tr(`${completedTrials} options compared`) : null });
    }
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
        : name === "apply_change" ? "Added to plan"
        : report?.summary ?? result?.opening ?? result?.focused ?? "Completed";
      if (result?.options) text = result.options.map((o) => `${o.label}: ${o.errors?.length ? "✕" : `${o.neighbour_conflicts.length} conflict findings`}`).join(" · ");
      if (report?.neighbour_conflicts) text += ` · ${report.neighbour_conflicts.length} conflict findings · ${report.roof_restrictions.length} roof restrictions`;
      entry.row.append(el("div", { className: "activity-result", textContent: text }), el("pre", { textContent: JSON.stringify(result, null, 2) }));
      if (name === "apply_change" && !failed) appliedInRun = true;
      if (name === "evaluate_change" && !failed) {
        const at = planSignature?.();  // the plan and regime these figures were computed on
        const tried = result?.options ? result.options.map((r, i) => ({ label: r.label, changes: args.options?.[i]?.changes ?? [], result: r, at }))
          : [{ label: "Option", changes: args.changes ?? [], result, at }];
        for (const o of tried) { compared = compared.filter((c) => c.label !== o.label); compared.push(o); }
      }
      if (name === "evaluate_change") {
        const n = result?.options?.length ?? 1;
        completedTrials += n; failedTrials += failed ? n : (result?.options ?? []).filter((o) => o.errors?.length).length;
        trialTitle.textContent = `${completedTrials} options tested${failedTrials ? ` · ${failedTrials} failed` : ""}`;
      } else announce(text);
    });
  }
  // The agent's choices as buttons: one the agent compared is applied at once (no model call, the
  // antennas move on the 3D view); anything else goes back to the agent. Then a way to the details.
  // A choice applies an option only when it is that option's label exactly (the operator is told to
  // repeat it): a near match could apply a different change from the one the engineer read.
  const plain = (text) => text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  function closestOption(text, options) {
    return options.find((o) => plain(o.label) === plain(text)) ?? null;
  }
  // Options were scored on the plan and EMF regime as they stood when the operator compared them.
  // Once either has moved on (a manual edit, an undo, another regime), applying one would show old
  // figures for a new state: a card refuses, a choice goes back to the operator to compare again.
  const stale = (at) => planSignature != null && planSignature() !== at;
  function choiceButtons(list, options) {
    const buttons = [];
    const pick = (fn) => () => { for (const b of buttons) b.disabled = true; fn(); };
    for (const text of list) {
      const option = closestOption(text, options);
      const button = el("button", { type: "button", className: "choice", textContent: text });
      button.dataset.noI18n = "";
      button.onclick = pick(() => (option && onApplyOption && !stale(option.at) ? onApplyOption(option) : onChoice?.(text)));
      buttons.push(button);
    }
    if (onChoice) {
      const details = el("button", { type: "button", className: "choice quiet", textContent: "Explain the technical details" });
      details.onclick = pick(() => onChoice(tr("Explain the technical details of this")));
      buttons.push(details);
    }
    liveButtons.push(...buttons);
    return el("div", { className: "choices" }, ...buttons);
  }
  // The options the operator compared, open: what each one does to the EMF conflicts (beside today's),
  // the roof, the coverage and the field work, each with its own Apply. They are ranked by the fixed
  // rule above; the top one is "Recommended", and the operator's own first choice is marked too when
  // it differs, so nothing is hidden. `used`: the choices the card answers.
  function decisionCard(choiceList, options) {
    const used = new Set();
    for (const text of choiceList) if (closestOption(text, options)) used.add(text);
    const operatorPick = choiceList.length ? closestOption(choiceList[0], options) : null;
    const rows = [...options].sort(byScore).slice(0, MAX_CARD_OPTIONS);
    if (operatorPick && !rows.includes(operatorPick)) rows[rows.length - 1] = operatorPick;
    const today = stateNow?.();
    const buttons = [];
    const metric = (label, value, tone = "", note = "") => el("span", { className: `metric ${tone}` },
      el("span", { className: "metric-label", textContent: label }), el("span", { textContent: value }), ...(note ? [el("span", { className: "metric-note", textContent: note })] : []));
    const items = rows.map((o, i) => {
      const r = o.result, recommended = i === 0 && !r?.errors?.length, operators = o === operatorPick && !recommended;
      const name = el("span", { className: "option-name", textContent: o.label });
      name.dataset.noI18n = "";
      if (r?.errors?.length) return el("li", { className: "option impossible" }, el("div", { className: "option-head" }, name), el("div", { className: "muted", textContent: "Not possible" }));
      const loss = r.heavy_coverage_loss ?? [], work = r.field_work;
      // It adds the option to the simulated plan; nothing reaches the network. An option that keeps
      // the site as it is ("keep and monitor") has nothing to add.
      const empty = changeSize(o) === 0;
      const apply = el("button", { type: "button", className: recommended && !empty ? "primary" : "", textContent: empty ? "Nothing to add" : "Add to plan (simulation)", disabled: empty });
      apply.onclick = () => {
        for (const b of buttons) b.disabled = true;
        if (stale(o.at)) { apply.textContent = "Plan changed: compare again"; return; }
        apply.textContent = "Added to plan";
        onApplyOption(o);
      };
      const changes = describeOption?.(o.changes) ?? [];
      buttons.push(apply);
      return el("li", { className: recommended ? "option recommended" : "option" },
        el("div", { className: "option-head" }, name, ...(recommended ? [el("span", { className: "badge", textContent: "Recommended" })] : []),
          ...(operators ? [el("span", { className: "badge quiet", textContent: "Operator's choice" })] : []), apply),
        el("div", { className: "metrics" },
          metric("EMF conflicts", String(r.neighbour_conflicts.length), r.neighbour_conflicts.length ? "bad" : "ok", today ? `today ${today.conflicts}` : ""),
          metric("Roof", String(r.roof_restrictions.length), r.roof_restrictions.length ? "warn" : "ok"),
          metric("Coverage", loss.length ? loss.map((l) => `${l.band} ${l.change_pct}%`).join(", ") : "no heavy loss", loss.length ? "warn" : "ok"),
          metric("Field work", !work ? "–" : work.remote ? (work.measurement ? "remote · EMF measurement on site" : "remote only")
            : work.people ? `${work.people} people · ${work.days} day(s)` : "none")),
        ...(changes.length ? [el("ul", { className: "option-changes" }, ...changes.map((line) => el("li", { textContent: line })))] : []));
    });
    liveButtons.push(...buttons);
    const more = options.length - rows.length;
    return { used, element: el("section", { className: "decision-card" },
      el("div", { className: "decision-title", textContent: "Options the operator compared" }),
      el("div", { className: "decision-rule", textContent: "Ranked by sensitive buildings, then other buildings, coverage loss, roof, field work and the size of the change" }),
      el("ol", {}, ...items),
      ...(more > 0 ? [el("div", { className: "decision-rule", textContent: `${more} more compared` })] : [])) };
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
    // A failed run says so at once: the account's remaining lines are dropped.
    failed: () => { runFailed = true; scanQueue = []; },
    model: (model, fallback = false) => { $("chatModel").textContent = `${MODEL_NAMES[model] ?? model}${fallback ? " (fallback)" : ""}`; }, busy, waiting, toolStart, toolEnd, speak, say };
}
