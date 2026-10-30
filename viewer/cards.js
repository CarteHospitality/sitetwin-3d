// Inspector cards: each card has one job, can be folded, and appears only when
// it has something to say. A card's header carries a one-line summary so it
// stays useful when folded. Fold state is remembered for the session.

import { reducedMotion } from "./ui.js";

const KEY = "sitetwin:cards";
let folded = {};
try { folded = JSON.parse(sessionStorage.getItem(KEY) ?? "{}"); } catch { /* storage may be disabled */ }
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(folded)); } catch { /* optional */ } };

function setFolded(card, value) {
  card.classList.toggle("folded", value);
  card.querySelector(".card-head").setAttribute("aria-expanded", String(!value));
  folded[card.dataset.card] = value;
  persist();
}

export function initCards(root = document) {
  for (const card of root.querySelectorAll(".card[data-card]")) {
    const head = card.querySelector(".card-head");
    head.onclick = () => setFolded(card, !card.classList.contains("folded"));
    const start = folded[card.dataset.card] ?? card.hasAttribute("data-folded");
    setFolded(card, start);
  }
}

const card = (name) => document.querySelector(`.card[data-card="${name}"]`);

// Show a card that was hidden. `reveal` also unfolds it, scrolls it into view
// and briefly highlights it: used when the agent's action produced it.
export function showCard(name, { reveal = false } = {}) {
  const c = card(name);
  if (!c) return;
  const appearing = c.hidden;
  c.hidden = false;
  if (reveal) setFolded(c, false);
  if ((appearing || reveal) && !reducedMotion.matches) {
    c.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }],
      { duration: 240, easing: "cubic-bezier(.16,1,.3,1)" });
    if (reveal) c.querySelector(".card-head").animate(
      [{ backgroundColor: "var(--surface-selected)" }, { backgroundColor: "transparent" }],
      { duration: 900, easing: "cubic-bezier(.2,0,0,1)" });
  }
  if (reveal) c.scrollIntoView({ block: "nearest", behavior: reducedMotion.matches ? "auto" : "smooth" });
}

export function hideCard(name) {
  const c = card(name);
  if (c) c.hidden = true;
}

export function setCardSummary(name, text, tone = "") {
  const s = card(name)?.querySelector(".card-summary");
  if (!s) return;
  s.textContent = text;
  s.dataset.tone = tone;
}
