// Before / after picture of a site: the 3D view with the source plan and with
// the proposed plan, side by side with one line each. Made to be shared.

import { el } from "./ui.js";
import { tr } from "./i18n.js";

const COLORS = { bad: "#C4320A", warn: "#B54708", ok: "#067647" };
const load = (src) => new Promise((resolve, reject) => Object.assign(new Image(), { onload() { resolve(this); }, onerror: reject, src }));

// `before` / `after`: { image (data URL), headline: { level, text } }.
export async function composeBeforeAfter({ site, before, after }) {
  const [a, b] = await Promise.all([load(before.image), load(after.image)]);
  const w = 800, h = Math.round(w * a.height / a.width), top = 76, bottom = 44, gap = 8;
  const canvas = Object.assign(document.createElement("canvas"), { width: w * 2 + gap, height: h + top + bottom });
  const g = canvas.getContext("2d");
  g.fillStyle = "#FFFFFF"; g.fillRect(0, 0, canvas.width, canvas.height);
  [[before, a, tr("Before")], [after, b, tr("After")]].forEach(([side, img, label], i) => {
    const x = i * (w + gap);
    g.drawImage(img, x, top, w, h);
    g.fillStyle = "#344054"; g.font = "600 15px system-ui, sans-serif"; g.fillText(label.toLocaleUpperCase(document.documentElement.lang), x + 20, 28);
    g.fillStyle = COLORS[side.headline.level] ?? "#101828"; g.font = "600 22px system-ui, sans-serif"; g.fillText(tr(side.headline.text), x + 20, 58);
  });
  g.fillStyle = "#5D6B7E"; g.font = "14px system-ui, sans-serif";
  g.fillText(`${site} · SiteTwin 3D · Expert Operator on Muse Spark Open`, 20, top + h + 28);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

export function openSnapshot(blob, site) {
  if (document.querySelector(".snapshot-dialog[open]")) return;
  const url = URL.createObjectURL(blob);
  const name = `${site}-before-after.png`;
  const status = el("span", { className: "muted", role: "status" });
  const action = (label, onclick, primary = false) => Object.assign(el("button", { className: primary ? "primary" : "", textContent: tr(label) }), { onclick });
  const file = new File([blob], name, { type: "image/png" });
  const actions = [action("Download", () => Object.assign(el("a", { href: url, download: name })).click(), true)];
  if (navigator.canShare?.({ files: [file] })) actions.push(action("Share", () => navigator.share({ files: [file], title: name }).catch(() => {})));
  if (window.ClipboardItem) actions.push(action("Copy", async () => {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    status.textContent = tr("Copied");
  }));
  const close = Object.assign(el("button", { className: "icon-btn close", title: tr("Close"), ariaLabel: tr("Close") }), { onclick: () => dialog.close() });
  const dialog = el("dialog", { className: "plan-dialog snapshot-dialog" },
    el("header", {}, el("h1", { textContent: tr("Before / after") }), close),
    el("div", { className: "plan-body" }, el("img", { src: url, alt: tr("Before / after") })),
    el("footer", {}, ...actions, status));
  dialog.setAttribute("data-no-i18n", "");
  dialog.addEventListener("close", () => { dialog.remove(); URL.revokeObjectURL(url); });
  document.body.append(dialog);
  dialog.showModal();
}
