import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseVCards, getProps, displayName, unescapeValue } from "../js/vcard.js";
import {
  phoneKey,
  normalizeEmail,
  nameSimilarity,
  analyze,
  mergeCards,
  applyMerges,
  buildPlan,
} from "../js/dedupe.js";

const sample = () =>
  parseVCards(
    readFileSync(fileURLToPath(new URL("./fixtures/sample.vcf", import.meta.url)), "utf8")
  );

const telKeys = (card) =>
  getProps(card, "TEL")
    .map((p) => phoneKey(p.value))
    .sort();
const emails = (card) =>
  getProps(card, "EMAIL")
    .map((p) => normalizeEmail(p.value))
    .sort();

test("phoneKey collapses different formats of the same number", () => {
  assert.equal(phoneKey("+1 (555) 123-4567"), phoneKey("555.123.4567"));
  assert.equal(phoneKey("555-123-4567"), "5551234567");
});

test("nameSimilarity rates identical names 1 and differing names lower", () => {
  assert.equal(nameSimilarity("john smith", "john smith"), 1);
  assert.ok(nameSimilarity("john smith", "jon smith") > 0.85);
  assert.ok(nameSimilarity("john smith", "jane doe") < 0.5);
});

test("analyze auto-merges contacts that share a phone with compatible names", () => {
  const cards = sample();
  const { auto, review } = analyze(cards);
  // Two auto groups: the two Johns and the two Janes.
  assert.equal(auto.length, 2);
  assert.equal(review.length, 0);
  for (const group of auto) assert.equal(group.length, 2);
});

test("merge unions phones and emails and keeps note + org", () => {
  const cards = sample();
  const merged = mergeCards([cards[0], cards[1]]);
  // Phones: shared 5551234567 (deduped) + the item1 555-987-6543 => 2 distinct.
  assert.deepEqual(telKeys(merged), ["5559876543", "5551234567"].sort());
  assert.deepEqual(emails(merged), ["john.smith@work.com", "john@example.com"].sort());
  assert.equal(getProps(merged, "ORG")[0].value, "Acme Inc.");
  assert.equal(unescapeValue(getProps(merged, "NOTE")[0].value), "Met at the conference");
  // Most-complete contact (card 0) wins the display name.
  assert.equal(displayName(merged), "John Smith");
});

test("primaryName option overrides the merged display name", () => {
  const cards = sample();
  const merged = mergeCards([cards[0], cards[1]], { primaryName: "Johnny Smith" });
  assert.equal(displayName(merged), "Johnny Smith");
});

test("applyMerges reduces the contact count and preserves singletons", () => {
  const cards = sample();
  const { auto } = analyze(cards);
  const result = applyMerges(cards, auto);
  // 5 contacts -> 2 merged pairs + 1 singleton (Han Solo) = 3.
  assert.equal(result.length, 3);
  assert.ok(result.some((c) => displayName(c) === "Han Solo"));
});

test("merge remaps grouped property names so they stay unique", () => {
  const cards = sample();
  const merged = mergeCards([cards[0], cards[1]]);
  const groups = merged.properties.filter((p) => p.group).map((p) => p.group);
  // The single grouped pair from card 0 should remain internally consistent.
  assert.ok(groups.every((g) => /^item\d+$/.test(g)));
});

test("conflicting names that share a phone are sent to review, not auto", () => {
  const text = [
    "BEGIN:VCARD\nVERSION:3.0\nFN:Alice Johnson\nTEL:555-9\nEND:VCARD",
    "BEGIN:VCARD\nVERSION:3.0\nFN:Bob Williams\nTEL:555-9\nEND:VCARD",
  ].join("\n");
  const cards = parseVCards(text);
  const { auto, review } = analyze(cards);
  assert.equal(auto.length, 0);
  assert.equal(review.length, 1);
  assert.equal(review[0].indices.length, 2);
});

test("same name with no shared phone/email is a review suggestion", () => {
  const text = [
    "BEGIN:VCARD\nVERSION:3.0\nFN:Maria Garcia\nTEL:111-1111\nEND:VCARD",
    "BEGIN:VCARD\nVERSION:3.0\nFN:Maria Garcia\nTEL:222-2222\nEND:VCARD",
  ].join("\n");
  const cards = parseVCards(text);
  const { auto, review } = analyze(cards);
  assert.equal(auto.length, 0);
  assert.equal(review.length, 1);
});

test("buildPlan emits merge items with their source contacts", () => {
  const cards = sample();
  const { auto } = analyze(cards);
  const plan = buildPlan(
    cards,
    auto.map((indices) => ({ indices }))
  );
  const merges = plan.filter((p) => p.type === "merge");
  assert.equal(merges.length, 2); // the two Johns and the two Janes
  for (const m of merges) {
    assert.equal(m.sources.length, 2);
    assert.ok(m.result.properties.length > 0);
  }
});

test("buildPlan passes singletons through as keep items, preserving order", () => {
  const cards = sample();
  const { auto } = analyze(cards);
  const plan = buildPlan(
    cards,
    auto.map((indices) => ({ indices }))
  );
  const kept = plan.filter((p) => p.type === "keep");
  assert.ok(kept.some((p) => displayName(p.card) === "Han Solo"));
  // Plan order follows lowest index: first item covers card 0 (a John).
  assert.equal(plan[0].type, "merge");
  assert.ok(plan[0].sources.includes(cards[0]));
});

test("buildPlan honors a per-group primaryName", () => {
  const cards = sample();
  const plan = buildPlan(cards, [{ indices: [0, 1], primaryName: "Johnny Smith" }]);
  const merge = plan.find((p) => p.type === "merge");
  assert.equal(displayName(merge.result), "Johnny Smith");
});

test("applyMerges result matches buildPlan output (same primitive)", () => {
  const cards = sample();
  const { auto } = analyze(cards);
  const viaApply = applyMerges(cards, auto);
  const viaPlan = buildPlan(
    cards,
    auto.map((indices) => ({ indices }))
  ).map((p) => (p.type === "merge" ? p.result : p.card));
  assert.equal(viaApply.length, viaPlan.length);
  assert.deepEqual(viaApply.map(displayName), viaPlan.map(displayName));
});
