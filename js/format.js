// format.js — conservative, reviewable formatting fixes.
//
// Each fix is proposed (not applied) with a before/after preview so the UI can
// show it with a toggle. Fixes are intentionally cautious: we only re-case
// names that are entirely upper- or lower-case (so "McDonald" is left alone),
// trim/collapse stray whitespace, and tidy phone spacing without touching the
// digits.

import { structuredComponents } from "./vcard.js";

const TEXT_FIELDS = new Set(["FN", "N", "ORG", "TITLE", "ROLE", "NICKNAME"]);
const STRUCTURED = new Set(["N", "ADR"]);

/** Collapse runs of spaces/tabs; for structured fields, tidy around the ";". */
function tidyWhitespace(name, value) {
  let v = value.replace(/[ \t]+/g, " ");
  if (STRUCTURED.has(name)) v = v.replace(/[ \t]*(?<!\\);[ \t]*/g, ";");
  return v.trim();
}

function recaseComponent(v) {
  if (!v) return v;
  const hasUpper = /\p{Lu}/u.test(v);
  const hasLower = /\p{Ll}/u.test(v);
  const isAllUpper = hasUpper && !hasLower;
  const isAllLower = hasLower && !hasUpper;
  if (!isAllUpper && !isAllLower) return v; // mixed case: leave intentional casing alone
  return v.toLowerCase().replace(/(^|[\s'\-/])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

function recase(name, value) {
  if (name === "N") {
    return value
      .split(/(?<!\\);/)
      .map(recaseComponent)
      .join(";");
  }
  return recaseComponent(value);
}

/**
 * Propose formatting fixes across all contacts.
 * @returns {{id:number, cardIndex:number, prop:object, name:string,
 *            before:string, after:string, kinds:string[]}[]}
 */
export function proposeFixes(cards) {
  const fixes = [];
  let id = 0;
  cards.forEach((card, cardIndex) => {
    for (const prop of card.properties) {
      let after = prop.value;
      const kinds = [];
      if (TEXT_FIELDS.has(prop.name)) {
        const w = tidyWhitespace(prop.name, after);
        if (w !== after) {
          after = w;
          kinds.push("spacing");
        }
      }
      if (prop.name === "FN" || prop.name === "N") {
        const c = recase(prop.name, after);
        if (c !== after) {
          after = c;
          kinds.push("capitalization");
        }
      }
      if (prop.name === "TEL") {
        const t = after.replace(/[ \t]+/g, " ").trim();
        if (t !== after) {
          after = t;
          kinds.push("phone");
        }
      }
      if (after !== prop.value) {
        fixes.push({
          id: ++id,
          cardIndex,
          prop,
          name: prop.name,
          before: prop.value,
          after,
          kinds,
        });
      }
    }
  });
  return fixes;
}

/** Apply fixes whose id is in enabledIds (or all fixes if enabledIds is null). */
export function applyFixes(fixes, enabledIds = null) {
  for (const fix of fixes) {
    if (enabledIds === null || enabledIds.has(fix.id)) fix.prop.value = fix.after;
  }
}

/** Short human label describing what a fix changes. */
export function fixLabel(fix) {
  const parts = [];
  if (fix.kinds.includes("spacing")) parts.push("Trimmed spacing");
  if (fix.kinds.includes("capitalization")) parts.push("Fixed capitalization");
  if (fix.kinds.includes("phone")) parts.push("Tidied phone");
  return parts.join(" · ");
}

/** Human-readable rendering of a property value for previews. */
export function prettyValue(name, value) {
  if (STRUCTURED.has(name)) {
    return structuredComponents(value)
      .filter((c) => c.trim())
      .join(", ");
  }
  return value
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\n/gi, " ")
    .replace(/\\\\/g, "\\");
}
