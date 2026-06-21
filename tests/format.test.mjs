import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVCards, getProps, displayName } from "../js/vcard.js";
import { proposeFixes, applyFixes, prettyValue } from "../js/format.js";

function cardsFrom(...vcards) {
  return parseVCards(vcards.map((v) => `BEGIN:VCARD\nVERSION:3.0\n${v}\nEND:VCARD`).join("\n"));
}

test("title-cases an all-caps name", () => {
  const cards = cardsFrom("FN:JOHN SMITH\nN:SMITH;JOHN;;;");
  const fixes = proposeFixes(cards);
  applyFixes(fixes);
  assert.equal(displayName(cards[0]), "John Smith");
});

test("title-cases an all-lowercase name", () => {
  const cards = cardsFrom("FN:jane doe");
  applyFixes(proposeFixes(cards));
  assert.equal(displayName(cards[0]), "Jane Doe");
});

test("leaves intentional mixed-case names alone (McDonald)", () => {
  const cards = cardsFrom("FN:Ronald McDonald");
  const fixes = proposeFixes(cards);
  assert.equal(fixes.length, 0);
  assert.equal(displayName(cards[0]), "Ronald McDonald");
});

test("trims and collapses stray whitespace in names", () => {
  const cards = cardsFrom("FN:  John   Smith  ");
  applyFixes(proposeFixes(cards));
  assert.equal(displayName(cards[0]), "John Smith");
});

test("tidies phone spacing without changing the digits", () => {
  const cards = cardsFrom("FN:Jane Doe\nTEL:  555   123  4567 ");
  applyFixes(proposeFixes(cards));
  assert.equal(getProps(cards[0], "TEL")[0].value, "555 123 4567");
});

test("only enabled fixes are applied", () => {
  const cards = cardsFrom("FN:JOHN SMITH");
  const fixes = proposeFixes(cards);
  applyFixes(fixes, new Set()); // enable nothing
  assert.equal(displayName(cards[0]), "JOHN SMITH");
});

test("preserves capitalization in initials like a proper name", () => {
  const cards = cardsFrom("FN:mary-jane o'brien");
  applyFixes(proposeFixes(cards));
  assert.equal(displayName(cards[0]), "Mary-Jane O'Brien");
});

test("prettyValue renders structured N nicely", () => {
  assert.equal(prettyValue("N", "Smith;John;;;"), "Smith, John");
});
