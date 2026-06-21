// vcard.js — round-trip-safe vCard (.vcf) parsing and serialization.
//
// Design goals:
//   * Never silently drop data. Every property is preserved as an ordered
//     { group, name, params, value } record, including ones we don't understand.
//   * Properties we don't modify are written back verbatim (value untouched),
//     so untouched contacts survive a parse -> serialize round trip unchanged.
//   * We always serialize to vCard 3.0 (Apple's default export format), with
//     correct line unfolding on input and 75-octet folding on output.
//
// Supported on input: vCard 3.0 and 2.1, standard line folding, quoted param
// values, bare (valueless) params, QUOTED-PRINTABLE soft line breaks, and
// base64 PHOTO blobs (kept as-is — never decoded).

const encoder = new TextEncoder();

/** Number of UTF-8 bytes in a single character (code point). */
function byteLength(ch) {
  return encoder.encode(ch).length;
}

/**
 * Unfold physical lines into logical lines.
 * Handles RFC folding (continuation lines begin with space/tab) and the
 * vCard 2.1 QUOTED-PRINTABLE soft line break (logical line ends with "=").
 */
function unfold(text) {
  const physical = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const logical = [];
  for (const line of physical) {
    const prev = logical.length > 0 ? logical[logical.length - 1] : null;
    if (prev !== null && (line.startsWith(" ") || line.startsWith("\t"))) {
      // Standard folding: drop the single leading whitespace char.
      logical[logical.length - 1] = prev + line.slice(1);
    } else if (prev !== null && /quoted-printable/i.test(prev) && prev.endsWith("=")) {
      // QP soft break: strip trailing "=" and append the next physical line.
      logical[logical.length - 1] = prev.slice(0, -1) + line;
    } else {
      logical.push(line);
    }
  }
  return logical;
}

/** Split a string on a delimiter, ignoring delimiters preceded by a backslash. */
function splitUnescaped(str, delim) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === "\\" && i + 1 < str.length) {
      cur += ch + str[i + 1];
      i++;
    } else if (ch === delim) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

/**
 * Split the "head:value" of a property at the first colon that is not inside
 * a double-quoted param value. Returns [head, value].
 */
function splitHeadValue(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) return [line.slice(0, i), line.slice(i + 1)];
  }
  return [line, ""];
}

/** Split a property head on ";" while respecting double-quoted segments. */
function splitParams(head) {
  const segs = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === ";" && !inQuotes) {
      segs.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  segs.push(cur);
  return segs;
}

function stripQuotes(s) {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function decodeQuotedPrintable(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "=" && i + 2 < str.length) {
      const hex = str.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(str.charCodeAt(i));
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

/** Parse a single logical property line into a structured record. */
function parseLine(line) {
  const [head, rawValue] = splitHeadValue(line);
  const segs = splitParams(head);
  let nameSeg = segs[0];

  let group = null;
  const dot = nameSeg.indexOf(".");
  if (dot !== -1) {
    group = nameSeg.slice(0, dot);
    nameSeg = nameSeg.slice(dot + 1);
  }
  const name = nameSeg.toUpperCase();

  // params: { KEY: [values...] }. Bare params (vCard 2.1) fold into TYPE.
  const params = {};
  const addParam = (key, values) => {
    if (!params[key]) params[key] = [];
    params[key].push(...values);
  };
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    const eq = seg.indexOf("=");
    if (eq === -1) {
      addParam("TYPE", [stripQuotes(seg)]);
    } else {
      const key = seg.slice(0, eq).toUpperCase();
      const values = seg
        .slice(eq + 1)
        .split(",")
        .map((v) => stripQuotes(v));
      addParam(key, values);
    }
  }

  // Decode quoted-printable into plain UTF-8 and drop the now-irrelevant params,
  // since we always emit plain vCard 3.0.
  let value = rawValue;
  const encoding = (params.ENCODING || []).map((e) => e.toUpperCase());
  if (encoding.includes("QUOTED-PRINTABLE")) {
    value = decodeQuotedPrintable(value);
    delete params.ENCODING;
    delete params.CHARSET;
  }

  return { group, name, params, value };
}

/**
 * Parse vCard text into an array of contacts.
 * Each contact: { version, properties: [{ group, name, params, value }] }.
 */
export function parseVCards(text) {
  const lines = unfold(text);
  const cards = [];
  let current = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:VCARD")) {
      current = { version: "3.0", properties: [] };
    } else if (upper.startsWith("END:VCARD")) {
      if (current) cards.push(current);
      current = null;
    } else if (current) {
      const prop = parseLine(line);
      if (prop.name === "VERSION") {
        current.version = prop.value.trim();
      } else {
        current.properties.push(prop);
      }
    }
  }
  return cards;
}

/** Fold a logical line to 75 octets per segment, continuations led by a space. */
function foldLine(line) {
  const out = [];
  let cur = "";
  let curBytes = 0;
  for (const ch of line) {
    const b = byteLength(ch);
    if (curBytes + b > 75) {
      out.push(cur);
      cur = " " + ch; // continuation begins with a single space
      curBytes = 1 + b;
    } else {
      cur += ch;
      curBytes += b;
    }
  }
  out.push(cur);
  return out.join("\r\n");
}

/** Whether a param value needs to be double-quoted on output. */
function quoteParam(v) {
  return /[;:,]/.test(v) ? `"${v}"` : v;
}

function serializeProp(prop) {
  let head = prop.group ? `${prop.group}.${prop.name}` : prop.name;
  for (const [key, values] of Object.entries(prop.params || {})) {
    head += `;${key}=${values.map(quoteParam).join(",")}`;
  }
  return foldLine(`${head}:${prop.value}`);
}

/** Serialize contacts back to vCard 3.0 text (CRLF line endings). */
export function serializeVCards(cards) {
  const blocks = [];
  for (const card of cards) {
    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    for (const prop of card.properties) lines.push(serializeProp(prop));
    lines.push("END:VCARD");
    blocks.push(lines.join("\r\n"));
  }
  return blocks.join("\r\n") + "\r\n";
}

// ---- Value helpers (used by dedupe/format) ------------------------------

/** Unescape a vCard text value: \\n \\, \\; \\\\ -> literal characters. */
export function unescapeValue(v) {
  return v.replace(/\\([\\,;nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

/** Escape a literal string for use as a vCard text value. */
export function escapeValue(v) {
  return v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

/** Components of a structured value (e.g. N, ADR), split on unescaped ";". */
export function structuredComponents(value) {
  return splitUnescaped(value, ";").map((c) => unescapeValue(c));
}

/** All properties on a contact with the given (case-insensitive) name. */
export function getProps(card, name) {
  const upper = name.toUpperCase();
  return card.properties.filter((p) => p.name === upper);
}

/** First property with the given name, or null. */
export function getProp(card, name) {
  return getProps(card, name)[0] || null;
}

/** Display name (FN) of a contact, unescaped; "" if absent. */
export function displayName(card) {
  const fn = getProp(card, "FN");
  return fn ? unescapeValue(fn.value).trim() : "";
}
