// app.js — UI orchestration. All work happens here in the browser; the app
// never makes a network request with your data.

import { parseVCards, serializeVCards, getProps, displayName } from "./vcard.js";
import { analyze, buildPlan } from "./dedupe.js";
import { proposeFixes, applyFixes, fixLabel, prettyValue } from "./format.js";

const state = {
  cards: [],
  originalText: "", // exact bytes as loaded, for the backup
  analysis: { auto: [], review: [] },
  reviewDecisions: [], // per review group: { merge: bool, primaryName: string }
  plan: [], // buildPlan output: merge/keep items
  mergedCards: [],
  fixes: [],
  enabledFixes: new Set(),
  backedUp: false,
};

// ---- tiny DOM helpers ---------------------------------------------------

const $ = (sel) => document.querySelector(sel);

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

function showScreen(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== id;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---- contact rendering helpers -----------------------------------------

const contactName = (card) => displayName(card) || "(no name)";
const phonesOf = (card) => getProps(card, "TEL").map((p) => prettyValue("TEL", p.value));
const emailsOf = (card) => getProps(card, "EMAIL").map((p) => prettyValue("EMAIL", p.value));

function contactRow(card) {
  const fields = [];
  const phones = phonesOf(card);
  const emails = emailsOf(card);
  if (phones.length) fields.push(el("div", { class: "field", text: "📞 " + phones.join(", ") }));
  if (emails.length) fields.push(el("div", { class: "field", text: "✉︎ " + emails.join(", ") }));
  return el("div", { class: "contact" }, [
    el("div", { class: "name", text: contactName(card) }),
    ...fields,
  ]);
}

function statLine(num, label) {
  return el("li", {}, [
    el("span", { text: label }),
    el("span", { class: "num", text: String(num) }),
  ]);
}

// ---- backup -------------------------------------------------------------

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function saveBlob(text, filename) {
  const blob = new Blob([text], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadBackup() {
  saveBlob(state.originalText, `contacts-backup-${dateStamp()}.vcf`);
  state.backedUp = true;
  updateBackupUI();
}

// Persistent, non-blocking reminder: reflects backup state everywhere it shows.
function updateBackupUI() {
  for (const btn of document.querySelectorAll(".backup-btn")) {
    btn.textContent = state.backedUp ? "✓ Backup saved" : "⬇︎ Download backup (original)";
    btn.disabled = state.backedUp;
  }
  for (const warn of document.querySelectorAll(".backup-warn")) {
    warn.textContent = state.backedUp
      ? "Your original contacts are safely backed up on this device."
      : "Recommended: save a backup of your original contacts before continuing.";
  }
  for (const banner of document.querySelectorAll(".backup-banner")) {
    banner.classList.toggle("done", state.backedUp);
  }
}

// ---- load ---------------------------------------------------------------

async function loadFiles(fileList) {
  const errEl = $("#load-error");
  errEl.hidden = true;
  try {
    const texts = await Promise.all([...fileList].map((f) => f.text()));
    const joined = texts.join("\n");
    const cards = parseVCards(joined);
    if (cards.length === 0) {
      errEl.textContent = "No contacts found in that file. Is it a .vcf (vCard) export?";
      errEl.hidden = false;
      return;
    }
    state.cards = cards;
    state.originalText = joined;
    state.backedUp = false;
    state.analysis = analyze(cards);
    state.reviewDecisions = state.analysis.review.map((g) => ({
      merge: true,
      primaryName: defaultPrimaryName(g.indices),
    }));
    updateBackupUI();
    renderSummary();
    showScreen("screen-summary");
  } catch (e) {
    errEl.textContent = "Couldn't read that file: " + e.message;
    errEl.hidden = false;
  }
}

function defaultPrimaryName(indices) {
  // Mirror mergeCards: the most complete contact provides the default name.
  let best = indices[0];
  for (const i of indices) {
    if (state.cards[i].properties.length > state.cards[best].properties.length) best = i;
  }
  return contactName(state.cards[best]);
}

// ---- step 2: summary ----------------------------------------------------

function renderSummary() {
  const { auto, review } = state.analysis;
  const autoRemoved = auto.reduce((n, g) => n + g.length - 1, 0);
  $("#summary-stats").replaceChildren(
    statLine(state.cards.length, "Contacts loaded"),
    statLine(auto.length, "Duplicate sets merged automatically"),
    statLine(autoRemoved, "Contacts this removes"),
    statLine(review.length, "Possible duplicates to review")
  );
  $("#summary-continue").textContent = review.length
    ? `Review ${review.length} set${review.length > 1 ? "s" : ""}`
    : "Preview changes";
}

// ---- step 3: review -----------------------------------------------------

function renderReview() {
  const wrap = $("#review-list");
  wrap.replaceChildren();
  state.analysis.review.forEach((group, gi) => {
    const decision = state.reviewDecisions[gi];
    const members = group.indices.map((i) => state.cards[i]);

    // Candidate display names (unique, non-empty).
    const names = [...new Set(members.map(contactName).filter((n) => n !== "(no name)"))];
    const namePick = el("div", { class: "namepick" });
    names.forEach((name) => {
      const id = `name-${gi}-${name.replace(/\W/g, "")}`;
      const radio = el("input", {
        type: "radio",
        name: `primary-${gi}`,
        id,
        onchange: () => (decision.primaryName = name),
      });
      if (name === decision.primaryName) radio.checked = true;
      namePick.appendChild(el("label", { for: id }, [radio, "Keep name: " + name]));
    });

    const mergeBtn = el("button", { class: "btn ghost merge", type: "button" }, "Merge into one");
    const keepBtn = el("button", { class: "btn ghost keep", type: "button" }, "Keep separate");
    const sync = () => {
      mergeBtn.setAttribute("aria-pressed", String(decision.merge));
      keepBtn.setAttribute("aria-pressed", String(!decision.merge));
      namePick.style.display = decision.merge && names.length > 1 ? "grid" : "none";
    };
    mergeBtn.addEventListener("click", () => {
      decision.merge = true;
      sync();
    });
    keepBtn.addEventListener("click", () => {
      decision.merge = false;
      sync();
    });

    wrap.appendChild(
      el("div", { class: "group" }, [
        el("p", { class: "reason", text: group.reason }),
        ...members.map(contactRow),
        namePick,
        el("div", { class: "segmented" }, [mergeBtn, keepBtn]),
      ])
    );
    sync();
  });
}

// ---- step 4: preview (dry-run report + formatting toggles) --------------

function buildGroups() {
  const groups = [];
  for (const g of state.analysis.auto) groups.push({ indices: g });
  state.analysis.review.forEach((rg, i) => {
    const d = state.reviewDecisions[i];
    if (d.merge) groups.push({ indices: rg.indices, primaryName: d.primaryName });
  });
  return groups;
}

function proceedToPreview() {
  state.plan = buildPlan(state.cards, buildGroups());
  state.mergedCards = state.plan.map((p) => (p.type === "merge" ? p.result : p.card));
  state.fixes = proposeFixes(state.mergedCards);
  state.enabledFixes = new Set(state.fixes.map((f) => f.id));
  renderPreview();
  updateBackupUI();
  showScreen("screen-preview");
}

function renderPreview() {
  const removed = state.cards.length - state.mergedCards.length;
  $("#preview-stats").replaceChildren(
    statLine(state.cards.length, "Contacts you started with"),
    statLine(state.mergedCards.length, "Contacts after cleanup"),
    statLine(removed, "Duplicates removed"),
    statLine(state.fixes.length, "Formatting fixes available")
  );
  renderMerges();
  renderFixes();
  const nothing = removed === 0 && state.fixes.length === 0;
  $("#preview-nothing").hidden = !nothing;
}

function renderMerges() {
  const wrap = $("#preview-merges");
  wrap.replaceChildren();
  const merges = state.plan.filter((p) => p.type === "merge");
  if (merges.length === 0) {
    wrap.appendChild(el("p", { class: "muted", text: "No duplicate contacts to merge." }));
    return;
  }
  for (const m of merges) {
    wrap.appendChild(
      el("div", { class: "group" }, [
        el("div", { class: "merge-head", text: `${m.sources.length} contacts → 1` }),
        el("div", { class: "merge-sources" }, m.sources.map(contactRow)),
        el("div", { class: "arrow", text: "↓ becomes" }),
        el("div", { class: "merge-result" }, [contactRow(m.result)]),
      ])
    );
  }
}

function renderFixes() {
  const wrap = $("#preview-fixes");
  wrap.replaceChildren();
  $("#format-controls").hidden = state.fixes.length === 0;
  if (state.fixes.length === 0) {
    wrap.appendChild(el("p", { class: "muted", text: "No formatting changes suggested." }));
    return;
  }
  for (const fix of state.fixes) {
    const cb = el("input", {
      type: "checkbox",
      id: `fix-${fix.id}`,
      onchange: (e) => {
        if (e.target.checked) state.enabledFixes.add(fix.id);
        else state.enabledFixes.delete(fix.id);
      },
    });
    cb.checked = state.enabledFixes.has(fix.id);
    const contact = contactName(state.mergedCards[fix.cardIndex]);
    wrap.appendChild(
      el("label", { class: "fix", for: `fix-${fix.id}` }, [
        el("div", { class: "fix-text" }, [
          el("div", { class: "kind", text: fixLabel(fix) + " · " + contact }),
          el("div", { class: "diff" }, [
            el("span", { class: "before", text: prettyValue(fix.name, fix.before) }),
            document.createTextNode("  →  "),
            el("span", { class: "after", text: prettyValue(fix.name, fix.after) }),
          ]),
        ]),
        cb,
      ])
    );
  }
}

function setAllFixes(on) {
  state.enabledFixes = on ? new Set(state.fixes.map((f) => f.id)) : new Set();
  for (const cb of document.querySelectorAll("#preview-fixes input[type=checkbox]"))
    cb.checked = on;
}

// ---- step 5: export -----------------------------------------------------

function renderExport() {
  applyFixes(state.fixes, state.enabledFixes);
  const removed = state.cards.length - state.mergedCards.length;
  $("#export-stats").replaceChildren(
    statLine(state.cards.length, "Contacts you started with"),
    statLine(state.mergedCards.length, "Contacts after cleanup"),
    statLine(removed, "Duplicates removed"),
    statLine(state.enabledFixes.size, "Formatting fixes applied")
  );
  updateBackupUI();
}

function reset() {
  state.cards = [];
  state.originalText = "";
  state.analysis = { auto: [], review: [] };
  state.reviewDecisions = [];
  state.plan = [];
  state.mergedCards = [];
  state.fixes = [];
  state.enabledFixes = new Set();
  state.backedUp = false;
  $("#file-input").value = "";
  updateBackupUI();
  showScreen("screen-landing");
}

// ---- wiring -------------------------------------------------------------

function wire() {
  const dropzone = $("#dropzone");
  const fileInput = $("#file-input");

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) loadFiles(fileInput.files);
  });
  ["dragover", "dragenter"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, () => dropzone.classList.remove("drag"))
  );
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
  });

  $("#summary-continue").addEventListener("click", () => {
    if (state.analysis.review.length) {
      renderReview();
      showScreen("screen-review");
    } else {
      proceedToPreview();
    }
  });
  $("#review-continue").addEventListener("click", proceedToPreview);
  $("#preview-continue").addEventListener("click", () => {
    renderExport();
    showScreen("screen-export");
  });
  $("#download-btn").addEventListener("click", () =>
    saveBlob(serializeVCards(state.mergedCards), "contacts-cleaned.vcf")
  );

  // Collapse the large title into the compact nav bar once it scrolls away.
  const navBar = $("#nav-bar");
  const syncNav = () => navBar.classList.toggle("scrolled", window.scrollY > 28);
  window.addEventListener("scroll", syncNav, { passive: true });
  syncNav();

  document.body.addEventListener("click", (e) => {
    const action = e.target.dataset?.action;
    if (action === "reset") reset();
    else if (action === "backup") downloadBackup();
    else if (action === "select-all-fixes") setAllFixes(true);
    else if (action === "select-no-fixes") setAllFixes(false);
  });
}

wire();

// Register the service worker for offline use (only when served over http/https).
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
