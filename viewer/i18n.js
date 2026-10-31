// Turkish / English interface. The app renders English; in Turkish mode this
// module translates every visible text node and the placeholder / title /
// aria-label attributes, and keeps doing so as the app updates the page.
// English originals are kept, so switching back restores them exactly.
// The conversation itself is not translated: the Expert Operator already
// answers in the engineer's language.

import { EXACT, PHRASES, PATTERNS } from "./i18n-tr.js";

const KEY = "sitetwin:lang";
const ATTRS = ["placeholder", "title", "aria-label"];
const SKIP = ".msg.user, textarea, script, style, pre, code, .leaflet-tile-pane, [data-no-i18n]";

let stored = null;
try { stored = localStorage.getItem(KEY); } catch { /* storage may be disabled */ }
export let lang = stored ?? ((navigator.language || "en").toLowerCase().startsWith("tr") ? "tr" : "en");

const phrases = Object.entries(PHRASES).sort((a, b) => b[0].length - a[0].length);
const patterns = PATTERNS.map(([source, flags, replacement]) => [new RegExp(source, flags), replacement, source.startsWith("^") && source.endsWith("$")]);

export function tr(text) {
  if (lang !== "tr" || !text) return text;
  const core = text.trim();
  if (!core) return text;
  const lead = text.slice(0, text.indexOf(core)), trail = text.slice(text.indexOf(core) + core.length);
  if (Object.hasOwn(EXACT, core)) return lead + EXACT[core] + trail;
  // A line a pattern knows as a whole stays whole, even when a name in it holds "; "
  // (OpenStreetMap lists several values that way).
  const whole = patterns.find(([re, , anchored]) => anchored && (re.lastIndex = 0, re.test(core)));
  // Lists of changes are joined with "; ": translate each item on its own.
  if (!whole && core.includes("; ")) return lead + core.split("; ").map(tr).join("; ") + trail;
  let out = core;
  for (const [re, replacement] of whole ? [whole] : patterns) {
    re.lastIndex = 0;
    if (re.test(out)) { re.lastIndex = 0; out = out.replace(re, replacement); break; }
  }
  for (const [en, trText] of phrases) if (out.includes(en)) out = out.split(en).join(trText);
  return lead + out + trail;
}

// Per node: the English original and the value we last wrote, so our own
// writes are not mistaken for new English text from the app.
const original = new WeakMap(), written = new WeakMap();
const attrOriginal = new WeakMap(), attrWritten = new WeakMap();

function skipped(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  if (!element || element.closest(SKIP)) return true;
  // The operator's answers are already in the engineer's language; only their "details" toggle is UI.
  return Boolean(element.closest(".msg.assistant") && !element.closest("summary"));
}

function text(node) {
  if (skipped(node)) return;
  if (written.get(node) !== node.data) original.set(node, node.data);
  const en = original.get(node) ?? node.data;
  const next = lang === "tr" ? tr(en) : en;
  if (node.data !== next) { written.set(node, next); node.data = next; } else written.set(node, next);
}

function attrs(element) {
  // Attributes of inputs (placeholder, labels) are UI even where their text content is not.
  if (element.closest(".msg.user, script, style, pre, code, .leaflet-tile-pane, [data-no-i18n]")) return;
  let o = attrOriginal.get(element), w = attrWritten.get(element);
  if (!o) { attrOriginal.set(element, o = {}); attrWritten.set(element, w = {}); }
  for (const name of ATTRS) {
    const value = element.getAttribute(name);
    if (value == null) continue;
    if (w[name] !== value) o[name] = value;
    const next = lang === "tr" ? tr(o[name]) : o[name];
    w[name] = next;
    if (value !== next) element.setAttribute(name, next);
  }
}

function walk(root) {
  if (root.nodeType === 3) return text(root);
  if (root.nodeType !== 1 && root.nodeType !== 9) return;
  if (root.nodeType === 1) attrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? text(n) : attrs(n);
}

const titleEn = document.title;
function applyAll() {
  document.documentElement.lang = lang;
  document.title = lang === "tr" ? tr(titleEn) : titleEn;
  walk(document.body);
  if (toggle) toggle.textContent = lang === "tr" ? "EN" : "TR";
}

const observer = new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "characterData") text(r.target);
    else if (r.type === "attributes") attrs(r.target);
    else for (const n of r.addedNodes) walk(n);
  }
});

export function setLang(next) {
  lang = next;
  try { localStorage.setItem(KEY, next); } catch { /* optional */ }
  applyAll();
  dispatchEvent(new CustomEvent("sitetwin:lang", { detail: lang }));
}

// Language switch in the top bar.
let toggle = null;
const bar = document.querySelector(".topbar");
if (bar) {
  toggle = Object.assign(document.createElement("button"), { className: "lang-toggle", title: "Türkçe / English" });
  toggle.setAttribute("data-no-i18n", "");
  toggle.onclick = () => setLang(lang === "tr" ? "en" : "tr");
  (bar.querySelector(".contrast-control") ?? bar.lastElementChild).before(toggle);
}

applyAll();
observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
