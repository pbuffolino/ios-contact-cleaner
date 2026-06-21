import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseVCards,
  serializeVCards,
  unescapeValue,
  escapeValue,
  structuredComponents,
  displayName,
  getProps,
} from "../js/vcard.js";

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

test("parses the expected number of contacts", () => {
  const cards = parseVCards(fixture("sample.vcf"));
  assert.equal(cards.length, 5);
});

test("preserves grouped properties (item1.TEL / item1.X-ABLabel)", () => {
  const [john] = parseVCards(fixture("sample.vcf"));
  const grouped = john.properties.filter((p) => p.group === "item1");
  assert.equal(grouped.length, 2);
  assert.ok(grouped.some((p) => p.name === "TEL"));
  assert.ok(grouped.some((p) => p.name === "X-ABLABEL"));
});

test("parses params including bare (valueless) params as TYPE", () => {
  const cards = parseVCards(fixture("quoted-printable-2.1.vcf"));
  const tel = getProps(cards[0], "TEL")[0];
  assert.deepEqual(tel.params.TYPE, ["CELL"]);
});

test("decodes quoted-printable values to UTF-8 and drops encoding params", () => {
  const cards = parseVCards(fixture("quoted-printable-2.1.vcf"));
  assert.equal(displayName(cards[0]), "Émile");
  const fn = getProps(cards[0], "FN")[0];
  assert.equal(fn.params.ENCODING, undefined);
  assert.equal(fn.params.CHARSET, undefined);
});

test("always serializes VERSION:3.0", () => {
  const cards = parseVCards(fixture("quoted-printable-2.1.vcf"));
  const out = serializeVCards(cards);
  assert.match(out, /VERSION:3\.0/);
  assert.doesNotMatch(out, /VERSION:2\.1/);
});

test("round-trips untouched contacts (parse -> serialize -> parse is stable)", () => {
  const once = parseVCards(fixture("sample.vcf"));
  const twice = parseVCards(serializeVCards(once));
  assert.equal(twice.length, once.length);
  for (let i = 0; i < once.length; i++) {
    assert.equal(twice[i].properties.length, once[i].properties.length);
    assert.equal(displayName(twice[i]), displayName(once[i]));
  }
});

test("folds long lines to <=75 octets and unfolds back losslessly", () => {
  const longValue = "A".repeat(400);
  const card = {
    version: "3.0",
    properties: [
      { group: null, name: "FN", params: {}, value: "Long Photo" },
      { group: null, name: "PHOTO", params: { ENCODING: ["b"], TYPE: ["JPEG"] }, value: longValue },
    ],
  };
  const text = serializeVCards([card]);
  for (const line of text.split("\r\n")) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line too long: ${line.length}`);
  }
  const [reparsed] = parseVCards(text);
  const photo = getProps(reparsed, "PHOTO")[0];
  assert.equal(photo.value, longValue);
});

test("does not split multi-byte characters when folding", () => {
  const value = "é".repeat(100);
  const text = serializeVCards([
    { version: "3.0", properties: [{ group: null, name: "NOTE", params: {}, value }] },
  ]);
  const [reparsed] = parseVCards(text);
  assert.equal(getProps(reparsed, "NOTE")[0].value, value);
});

test("escape/unescape round-trips text values", () => {
  const raw = "Doe, John; A\\B\nline2";
  assert.equal(unescapeValue(escapeValue(raw)), raw);
});

test("splits structured values on unescaped semicolons", () => {
  const comps = structuredComponents("Smith;John\\;Jr;;Dr.;");
  assert.deepEqual(comps, ["Smith", "John;Jr", "", "Dr.", ""]);
});
