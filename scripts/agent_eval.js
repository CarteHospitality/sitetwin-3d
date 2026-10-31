// Agent evaluation: one scenario per fresh twin page, run against the real model.
//
// Open a sample twin with a fresh session, e.g.
//   http://localhost:8765/index.html?twin=data%2Fsamples%2Fsites%2Fsample-01_ankara.twin.json&fresh=1
// with the interface in English (localStorage "sitetwin:lang" = "en"), paste this file into the
// browser console and run, for example:
//   await evaluate({ ask: "analyse" })                                   // the Analyse button: a review
//   await evaluate({ ask: "Fix the school issue with the smallest change." })
// It returns what docs/eval/agent-eval.md tabulates: model calls and which model answered, time,
// tool calls and failures, whether the decision card came, whether the plan changed, and the
// status after the plan. Measurement only: it wraps fetch to count model calls, nothing else.

async function evaluate({ ask, timeoutMs = 180000 }) {
  const calls = [];
  const realFetch = window.fetch;
  window.fetch = async (url, options) => {
    const response = await realFetch(url, options);
    if (String(url).includes("api/chat")) response.clone().json().then((j) => calls.push(j.model ?? `HTTP ${response.status}`)).catch(() => calls.push(`HTTP ${response.status}`));
    return response;
  };
  const answers = () => document.querySelectorAll("#chatLog .msg.assistant:not(.welcome)").length;
  const before = answers();
  const started = performance.now();
  try {
    if (ask === "analyse") document.querySelector(".primary-ask").click();
    else {
      document.getElementById("chatInput").value = ask;
      document.getElementById("chatSend").click();
    }
    // Done: a new answer is out and the chat takes input again. A playing change is skipped.
    while (performance.now() - started < timeoutMs) {
      const skip = document.getElementById("skipPlay");
      if (skip && !skip.hidden) skip.click();
      if (answers() > before && !document.getElementById("chatInput").disabled) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    window.fetch = realFetch;
  }
  const steps = [...document.querySelectorAll(".tech-steps .activity-step")];
  const card = document.querySelector(".decision-card");
  const answer = [...document.querySelectorAll("#chatLog .msg.assistant")].at(-1)?.innerText ?? "";
  return {
    ask, seconds: Math.round((performance.now() - started) / 100) / 10, timedOut: performance.now() - started >= timeoutMs,
    modelCalls: calls.length, models: [...new Set(calls)],
    tools: steps.map((s) => s.querySelector(".activity-heading, strong, summary")?.textContent ?? s.textContent.slice(0, 60)),
    failedTools: steps.filter((s) => s.classList.contains("failed")).map((s) => s.innerText.slice(0, 200)),
    error: answer.startsWith("⚠️") ? answer.slice(0, 200) : null,
    // The card's options in its own order (recommended first), each with its metrics as shown.
    card: card ? [...card.querySelectorAll(".option-head")].map((head) => {
      const option = head.parentElement;
      return { name: head.querySelector(".option-name")?.textContent ?? "", badges: [...head.querySelectorAll(".badge")].map((b) => b.textContent),
        metrics: [...option.querySelectorAll(".metric")].map((m) => m.innerText.replace(/\s+/g, " ")) };
    }) : null,
    plan: document.getElementById("planDelta")?.textContent ?? "",
    steps: [...document.querySelectorAll("#operatorSteps li")].map((li) => li.textContent),
    after: document.getElementById("afterLines")?.innerText ?? "",
    answerChars: answer.length,
  };
}
