// dedupe.js — find duplicate contacts, classify them, and merge them.
//
// Strategy:
//   * STRONG match: two contacts share a normalized phone number or email.
//     These are real duplicates. They auto-merge unless something looks risky
//     (clearly different names, or conflicting birthdays) -> then they go to
//     manual review instead.
//   * WEAK match: contacts that don't share a phone/email but have the same or
//     a very similar name. These are only ever *suggested* for review, never
//     auto-merged.

import { getProps, getProp, unescapeValue, escapeValue, displayName } from "./vcard.js";

// ---- Normalization ------------------------------------------------------

/** Digits-only phone with an optional leading "+". */
export function normalizePhone(value) {
  const v = unescapeValue(value).trim();
  const plus = v.startsWith("+");
  const digits = v.replace(/\D/g, "");
  return (plus ? "+" : "") + digits;
}

/**
 * Comparison key for a phone number: the last 10 digits, so "+1 (555) 123-4567"
 * and "555-123-4567" collapse to the same key. Short numbers use all digits.
 */
export function phoneKey(value) {
  const digits = normalizePhone(value).replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(value) {
  return unescapeValue(value).trim().toLowerCase();
}

export function normalizeName(card) {
  return displayName(card).toLowerCase().replace(/\s+/g, " ").trim();
}

function strongKeys(card) {
  const keys = [];
  for (const p of getProps(card, "TEL")) {
    const k = phoneKey(p.value);
    if (k) keys.push("tel:" + k);
  }
  for (const p of getProps(card, "EMAIL")) {
    const k = normalizeEmail(p.value);
    if (k) keys.push("email:" + k);
  }
  return keys;
}

// ---- Union-find ---------------------------------------------------------

function makeUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

// ---- Similarity ---------------------------------------------------------

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

/** Whether two contacts' names are compatible enough to auto-merge. */
function namesCompatible(cardA, cardB) {
  const a = normalizeName(cardA);
  const b = normalizeName(cardB);
  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const tokens = new Set(a.split(/\s+/).filter((t) => t.length > 1));
  return b.split(/\s+/).some((t) => t.length > 1 && tokens.has(t));
}

function birthdayConflict(cards) {
  const bdays = new Set();
  for (const card of cards) {
    const b = getProp(card, "BDAY");
    if (b && b.value.trim()) bdays.add(b.value.trim());
  }
  return bdays.size > 1;
}

// ---- Analysis -----------------------------------------------------------

/**
 * Analyze contacts and return merge groups.
 * @returns {{ auto: number[][], review: {indices:number[], reason:string}[] }}
 *   auto:   groups of indices safe to merge automatically.
 *   review: groups the user should confirm, each with a human-readable reason.
 */
export function analyze(cards) {
  const uf = makeUnionFind(cards.length);
  const keyToIndex = new Map();
  cards.forEach((card, i) => {
    for (const key of strongKeys(card)) {
      if (keyToIndex.has(key)) uf.union(keyToIndex.get(key), i);
      else keyToIndex.set(key, i);
    }
  });

  // Collect strong-key groups.
  const groupsByRoot = new Map();
  cards.forEach((_, i) => {
    const root = uf.find(i);
    if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
    groupsByRoot.get(root).push(i);
  });

  const auto = [];
  const review = [];
  const inStrongGroup = new Set();

  for (const indices of groupsByRoot.values()) {
    if (indices.length < 2) continue;
    indices.forEach((i) => inStrongGroup.add(i));
    const members = indices.map((i) => cards[i]);

    let compatible = true;
    for (let a = 0; a < members.length && compatible; a++) {
      for (let b = a + 1; b < members.length; b++) {
        if (!namesCompatible(members[a], members[b])) {
          compatible = false;
          break;
        }
      }
    }

    if (compatible && !birthdayConflict(members)) {
      auto.push(indices);
    } else {
      review.push({
        indices,
        reason: !compatible
          ? "Shares a phone or email but the names differ — confirm these are the same person."
          : "Shares a phone or email but birthdays differ — confirm before merging.",
      });
    }
  }

  // Weak (name-based) suggestions among contacts not already strongly grouped.
  const loose = cards
    .map((card, i) => ({ i, name: normalizeName(card) }))
    .filter((x) => x.name.length >= 3 && !inStrongGroup.has(x.i));
  const usedInReview = new Set();
  for (let a = 0; a < loose.length; a++) {
    if (usedInReview.has(loose[a].i)) continue;
    const cluster = [loose[a].i];
    for (let b = a + 1; b < loose.length; b++) {
      if (usedInReview.has(loose[b].i)) continue;
      const exact = loose[a].name === loose[b].name;
      const sim = nameSimilarity(loose[a].name, loose[b].name);
      if (exact || sim >= 0.85) cluster.push(loose[b].i);
    }
    if (cluster.length >= 2) {
      cluster.forEach((i) => usedInReview.add(i));
      const allExact = cluster.every((i) => normalizeName(cards[i]) === loose[a].name);
      review.push({
        indices: cluster,
        reason: allExact
          ? "Same name but no shared phone or email — confirm these are duplicates."
          : "Similar names — possible duplicates worth checking.",
      });
    }
  }

  return { auto, review };
}

// ---- Merge --------------------------------------------------------------

// Fields that hold a single value; on merge we keep the first non-empty one.
const SINGLE = new Set([
  "FN",
  "N",
  "NICKNAME",
  "BDAY",
  "ANNIVERSARY",
  "GENDER",
  "PHOTO",
  "ORG",
  "TITLE",
  "ROLE",
  "KIND",
  "UID",
  "PRODID",
  "REV",
]);

/** Dedup key for repeatable identity fields; null means "never dedup". */
function dedupKey(prop) {
  switch (prop.name) {
    case "TEL":
      return "TEL|" + phoneKey(prop.value);
    case "EMAIL":
      return "EMAIL|" + normalizeEmail(prop.value);
    case "URL":
      return "URL|" + unescapeValue(prop.value).trim().toLowerCase();
    case "ADR":
      return "ADR|" + unescapeValue(prop.value).toLowerCase().replace(/\s+/g, "");
    default:
      return null;
  }
}

function completeness(card) {
  return card.properties.length;
}

/**
 * Merge a list of contacts into one. The most complete contact wins
 * single-valued fields; phones/emails/addresses/URLs are unioned (deduped);
 * notes are combined; everything else is preserved.
 * @param {object} [opts] - { primaryName: string } to force the display name.
 */
export function mergeCards(cards, opts = {}) {
  if (cards.length === 1) return cards[0];

  let primaryIdx = 0;
  for (let i = 1; i < cards.length; i++) {
    if (completeness(cards[i]) > completeness(cards[primaryIdx])) primaryIdx = i;
  }
  const ordered = [cards[primaryIdx], ...cards.filter((_, i) => i !== primaryIdx)];

  const result = { version: "3.0", properties: [] };
  const singleTaken = new Set();
  const seen = new Set();
  const notes = [];
  let groupCounter = 0;

  for (const card of ordered) {
    const groupMap = new Map();
    const remap = (g) => {
      if (!g) return null;
      if (!groupMap.has(g)) groupMap.set(g, "item" + ++groupCounter);
      return groupMap.get(g);
    };
    for (const prop of card.properties) {
      if (prop.name === "NOTE") {
        const t = unescapeValue(prop.value).trim();
        if (t && !notes.includes(t)) notes.push(t);
        continue;
      }
      if (SINGLE.has(prop.name)) {
        if (singleTaken.has(prop.name)) continue;
        if (prop.name !== "PHOTO" && !prop.value.trim()) continue;
        result.properties.push({ ...prop, group: remap(prop.group), params: { ...prop.params } });
        singleTaken.add(prop.name);
        continue;
      }
      const key = dedupKey(prop);
      if (key !== null) {
        if (seen.has(key)) continue;
        seen.add(key);
      }
      result.properties.push({ ...prop, group: remap(prop.group), params: { ...prop.params } });
    }
  }

  if (notes.length) {
    result.properties.push({
      group: null,
      name: "NOTE",
      params: {},
      value: escapeValue(notes.join("\n")),
    });
  }

  if (opts.primaryName) {
    const fn = result.properties.find((p) => p.name === "FN");
    if (fn) fn.value = escapeValue(opts.primaryName);
    else
      result.properties.unshift({
        group: null,
        name: "FN",
        params: {},
        value: escapeValue(opts.primaryName),
      });
  }

  return result;
}

/**
 * Build an ordered plan describing what would happen to a contact list.
 * @param {object[]} cards
 * @param {{indices:number[], primaryName?:string}[]} groups - sets to merge.
 * @returns {({type:"merge", sources:object[], result:object}
 *           | {type:"keep", card:object})[]}
 *   One item per output contact, in order of each group's lowest index.
 *   Ungrouped contacts pass through as "keep".
 */
export function buildPlan(cards, groups) {
  const groupOf = new Map(); // card index -> group id
  groups.forEach((g, gi) => g.indices.forEach((i) => groupOf.set(i, gi)));
  const plan = [];
  const emitted = new Set();
  cards.forEach((card, i) => {
    if (!groupOf.has(i)) {
      plan.push({ type: "keep", card });
      return;
    }
    const gi = groupOf.get(i);
    if (emitted.has(gi)) return;
    emitted.add(gi);
    const g = groups[gi];
    const sources = g.indices.map((idx) => cards[idx]);
    plan.push({
      type: "merge",
      sources,
      result: mergeCards(sources, g.primaryName ? { primaryName: g.primaryName } : {}),
    });
  });
  return plan;
}

/**
 * Apply merge groups (arrays of indices) to a contact list, returning the
 * merged contacts. Thin wrapper over buildPlan.
 */
export function applyMerges(cards, groups) {
  return buildPlan(
    cards,
    groups.map((indices) => ({ indices }))
  ).map((p) => (p.type === "merge" ? p.result : p.card));
}
