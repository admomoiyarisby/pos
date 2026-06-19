/**
 * Indonesian address parser for Detail POS - List Cabang.csv.
 *
 * Source addresses look like:
 *   "Griya Babatan Mukti VI
 *    Blok F no 20,
 *    Desa/Kelurahan Babatan,
 *    Kec. Wiyung, Kota
 *    Surabaya, Provinsi Jawa
 *    Timur
 *    Kode Pos: 60227"
 *
 * Goal: keep street + kelurahan + kecamatan + kota, drop everything else
 * (province, postcode, "Kec." / "Desa/Kelurahan" / "Kota" / "Provinsi"
 * prefix markers, RT/RW info).
 *
 * Strategy: regex-based absorption. Each "marker" is a regex that
 * matches both the marker word and its following value (e.g.
 * "Kec. Wiyung"), so we can drop the marker while preserving the value.
 * Province phrases are matched whole (including newline-split forms like
 * "Jawa\nTimur") and removed entirely. Bare 5-digit postcodes fall out.
 *
 * The remaining segments, in order, are: [street..., kelurahan,
 * kecamatan, kota]. We assume the last 3 are the [kel, kec, kota] trio;
 * this held for all 7 rows in the source CSV.
 */

const PROVINCE_PHRASES: RegExp[] = [
  /Jawa\s+Timur/gi,
  /Jawa\s+Tengah/gi,
  /Jawa\s+Barat/gi,
  /DKI\s+Jakarta/gi,
  /DI\s+Yogyakarta/gi,
  /East\s+Java/gi,
];

// Words that, when they appear as a standalone segment, are always a
// fragment of a multi-word province (e.g. "Jawa\nTimur" → "Jawa", "Timur").
// "DKI" is a province prefix that often stands alone when "Jakarta"
// trails on a later line.
const PROVINCE_FRAGMENTS = ["Timur", "Tengah", "Barat", "DKI", "Jawa"];

export type ParsedAddress = {
  street: string;
  kelurahan: string;
  kecamatan: string;
  kota: string;
};

export function parseAddress(raw: string): ParsedAddress {
  // 1. Collapse newlines to comma-separated, normalise whitespace.
  //    Newlines inside parentheses become a single space (they're just
  //    a wrapped parenthetical); newlines outside parens become ", "
  //    because they separate address components.
  let s = "";
  let parenDepth = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === "(") {
      parenDepth++;
      s += c;
    } else if (c === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      s += c;
    } else if ((c === "\n" || c === "\r") && parenDepth === 0) {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      s += ", ";
    } else if ((c === "\n" || c === "\r") && parenDepth > 0) {
      if (c === "\r" && raw[i + 1] === "\n") i++;
      s += " ";
    } else {
      s += c;
    }
  }
  s = s
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  // 2. Marker absorption: merge marker-only segments (e.g. "Kec.",
  //    "Desa/Kelurahan", "Kota") with the segment that FOLLOWS them.
  //    The CSV sometimes splits a marker and its value across two lines,
  //    e.g. "Desa/Kelurahan\nSonokwijenan" → "Desa/Kelurahan, Sonokwijenan"
  //    after step 1. We re-join them here (attaching to the NEXT
  //    segment) so the regex drops in step 3 can match the whole
  //    marker+value phrase.
  const MARKER_ONLY = /^(Kec\.?|Kelurahan|Desa(?:\s*\/?\s*Kelurahan)?|Kota|Provinsi|Kode\s*Pos)$/i;
  const segments0 = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const absorbed: string[] = [];
  for (let i = 0; i < segments0.length; i++) {
    const seg = segments0[i]!;
    if (MARKER_ONLY.test(seg)) {
      if (i + 1 < segments0.length) {
        absorbed.push(`${seg} ${segments0[i + 1]}`);
        i++; // consume the value segment too
      }
      // else: marker at the tail with no value, drop it.
    } else {
      absorbed.push(seg);
    }
  }
  s = absorbed.join(", ");

  // 3. Drop complete junk phrases (marker + value).
  s = s
    .replace(/Kode\s*Pos\s*[:.]?\s*\d{5}/gi, "") // "Kode Pos: 60227"
    .replace(/RT\.?\s*\d+\s*\/?\s*RW\.?\s*\d+/gi, "") // "RT.005/RW.10"
    .replace(/Kec\.?\s+/gi, "") // "Kec. Wiyung" → "Wiyung"
    .replace(/Desa\s*\/?\s*Kelurahan\s+/gi, "") // "Desa/Kelurahan X" → "X"
    .replace(/(?:^|,\s*)Kelurahan\s+/gi, ", ") // "Kelurahan X" → "X"
    .replace(/Kota\s+/gi, "") // "Kota Surabaya" → "Surabaya"
    .replace(/Provinsi\s+[A-Za-z]+(?:\s+[A-Za-z]+)*/gi, ""); // "Provinsi X Y"

  // 4. Drop provinces (full phrases first, then standalone fragments).
  for (const re of PROVINCE_PHRASES) s = s.replace(re, "");
  for (const frag of PROVINCE_FRAGMENTS) {
    s = s.replace(new RegExp(`(?:^|,)\\s*${frag}\\s*(?=,|$)`, "gi"), "");
  }

  // 4. Drop bare 5-digit postcodes that survived.
  s = s.replace(/\b\d{5}\b/g, "");

  // 5. Re-clean: split, trim, drop empties, rejoin.
  s = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");

  const segments = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (segments.length < 3) {
    return {
      street: segments.join(", "),
      kelurahan: "-",
      kecamatan: "-",
      kota: "-",
    };
  }

  const kota = segments[segments.length - 1]!;
  const kecamatan = segments[segments.length - 2]!;
  const kelurahan = segments[segments.length - 3]!;
  const street = segments.slice(0, segments.length - 3).join(", ");

  return { street, kelurahan, kecamatan, kota };
}

/**
 * Compose the final `branches.location` string per our chosen format
 * (street + kelurahan + kecamatan + kota).
 *
 * The CSV is noisy: addresses are sometimes written twice (with
 * different spellings), multi-word values like "Pucang Sewu" can be
 * soft-wrapped across newlines into "Pucang" + "Sewu", and landmark
 * mentions ("Dekat Pukis & Bikang") can sneak in.
 *
 * Cleanup applied here:
 *   1. Drop street segments that match kel/kec/kota (normalised, so
 *      "Kali Rungkut" matches "Kalirungkut").
 *   2. Merge adjacent soft-wrap fragments whose concatenation matches
 *      kel/kec/kota ("Pucang" + "Sewu" → "Pucang Sewu" matches kel).
 *   3. Then compose: street + kel + kec + kota.
 */
export function formatLocation(parsed: ParsedAddress): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const structured = new Set(
    [parsed.kelurahan, parsed.kecamatan, parsed.kota]
      .map((s) => s.trim())
      .filter(Boolean)
      .map(norm),
  );

  let streetSegs = parsed.street
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Step 1: drop street segments that match a structured value.
  streetSegs = streetSegs.filter((s) => !structured.has(norm(s)));

  // Step 2: merge adjacent fragments whose join matches a structured value.
  const merged: string[] = [];
  for (let i = 0; i < streetSegs.length; i++) {
    if (i + 1 < streetSegs.length) {
      const joined = norm(`${streetSegs[i]} ${streetSegs[i + 1]}`);
      if (structured.has(joined)) {
        // Skip the next segment — we matched a structured value, drop both.
        i++;
        continue;
      }
    }
    merged.push(streetSegs[i]!);
  }

  const parts = [...merged, parsed.kelurahan, parsed.kecamatan, parsed.kota]
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== "-");

  return parts.join(", ");
}
