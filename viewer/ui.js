// Shared shell and accessible controls. No model or engineering state lives here.
export const $ = (id) => document.getElementById(id);
export const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
export const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
export const reducedMotion = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: true, addEventListener() {} };
export function setText(node, value) {
  const text = String(value);
  if (node.textContent === text) return;
  const previous = node.textContent;
  node.textContent = text;
  if (previous && previous !== "–" && !reducedMotion.matches) node.animate(
    [{ backgroundColor: token("surface-selected") }, { backgroundColor: "transparent" }],
    { duration: 120, easing: "cubic-bezier(.2,0,0,1)" });
}

export function showTab(name) {
  for (const tab of document.querySelectorAll("[data-tab]")) {
    const active = tab.dataset.tab === name;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    $(tab.getAttribute("aria-controls")).hidden = !active;
  }
}

export function initShell() {
  let active = null, trigger = null;
  const backdrop = $("drawerBackdrop");
  const layout = document.querySelector(".layout");
  function close() {
    if (!active) return;
    active.classList.remove("drawer-open");
    active.removeAttribute("role");
    active.removeAttribute("aria-modal");
    for (const pane of layout.querySelectorAll(".chat, .work, .stage, .panel")) pane.inert = false;
    document.querySelector(".topbar").inert = false;
    const navigation = document.querySelector(".mobile-nav");
    if (navigation) navigation.inert = false;
    backdrop.hidden = true;
    for (const b of document.querySelectorAll("[data-pane]")) {
      b.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-pressed", String(b.dataset.pane === "workspace"));
    }
    active = null;
    if (trigger?.isConnected) trigger.focus();
  }
  function open(name, source) {
    close();
    if (name === "workspace") return;
    const pane = document.querySelector(name === "operator" ? ".chat" : ".panel");
    const drawer = matchMedia(name === "operator" ? "(max-width: 899px)" : "(max-width: 1179px)").matches;
    if (!drawer) { pane.querySelector("button, a, input")?.focus(); return; }
    active = pane;
    trigger = source;
    pane.classList.add("drawer-open");
    pane.setAttribute("role", "dialog");
    pane.setAttribute("aria-modal", "true");
    pane.setAttribute("aria-label", name === "operator" ? "Expert Operator" : "Inspector");
    if (name === "operator") document.querySelector(".work").inert = true;
    else {
      document.querySelector(".chat").inert = true;
      document.querySelector(".stage").inert = true;
    }
    backdrop.hidden = false;
    document.querySelector(".topbar").inert = true;
    const navigation = document.querySelector(".mobile-nav");
    if (navigation) navigation.inert = true;
    source?.setAttribute("aria-expanded", "true");
    source?.setAttribute("aria-pressed", "true");
    pane.querySelector(".drawer-close")?.focus();
  }
  for (const button of document.querySelectorAll("[data-pane]")) button.onclick = () => open(button.dataset.pane, button);
  for (const button of document.querySelectorAll(".drawer-close")) button.onclick = close;
  backdrop.onclick = close;
  document.addEventListener("keydown", (event) => {
    if (!active) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key !== "Tab") return;
    const focusable = [...active.querySelectorAll("button, a[href], input, select, textarea, summary, [tabindex='0']")].filter((n) => !n.disabled && n.getClientRects().length);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  for (const query of ["(max-width: 899px)", "(max-width: 1179px)"]) matchMedia(query).addEventListener("change", close);
  for (const tab of document.querySelectorAll("[data-tab]")) {
    tab.onclick = () => showTab(tab.dataset.tab);
    tab.onkeydown = (event) => {
      const tabs = [...document.querySelectorAll("[data-tab]")];
      let i = tabs.indexOf(tab);
      if (event.key === "ArrowRight") i = (i + 1) % tabs.length;
      else if (event.key === "ArrowLeft") i = (i + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") i = 0;
      else if (event.key === "End") i = tabs.length - 1;
      else return;
      event.preventDefault(); showTab(tabs[i].dataset.tab); tabs[i].focus();
    };
  }
  const contrast = $("projector");
  try { contrast.checked = sessionStorage.getItem("sitetwin:projector") === "1"; } catch { /* storage can be disabled */ }
  document.documentElement.classList.toggle("projector", contrast.checked);
  contrast.onchange = () => {
    document.documentElement.classList.toggle("projector", contrast.checked);
    try { sessionStorage.setItem("sitetwin:projector", contrast.checked ? "1" : "0"); } catch { /* optional preference */ }
  };
  document.addEventListener("visibilitychange", () => document.documentElement.classList.toggle("page-hidden", document.hidden));
  document.documentElement.classList.toggle("page-hidden", document.hidden);
  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) for (const animation of document.getAnimations?.() ?? []) animation.cancel();
  });
  return { open, close };
}
