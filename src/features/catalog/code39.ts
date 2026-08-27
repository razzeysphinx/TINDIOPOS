export type Code39Barcode = {
  bars: Array<{ x: number; width: number }>;
  value: string;
  width: number;
};

const code39Patterns: Record<string, string> = {
  "0": "nnnwwnwnn",
  "1": "wnnwnnnnw",
  "2": "nnwwnnnnw",
  "3": "wnwwnnnnn",
  "4": "nnnwwnnnw",
  "5": "wnnwwnnnn",
  "6": "nnwwwnnnn",
  "7": "nnnwnnwnw",
  "8": "wnnwnnwnn",
  "9": "nnwwnnwnn",
  A: "wnnnnwnnw",
  B: "nnwnnwnnw",
  C: "wnwnnwnnn",
  D: "nnnnwwnnw",
  E: "wnnnwwnnn",
  F: "nnwnwwnnn",
  G: "nnnnnwwnw",
  H: "wnnnnwwnn",
  I: "nnwnnwwnn",
  J: "nnnnwwwnn",
  K: "wnnnnnnww",
  L: "nnwnnnnww",
  M: "wnwnnnnwn",
  N: "nnnnwnnww",
  O: "wnnnwnnwn",
  P: "nnwnwnnwn",
  Q: "nnnnnnwww",
  R: "wnnnnnwwn",
  S: "nnwnnnwwn",
  T: "nnnnwnwwn",
  U: "wwnnnnnnw",
  V: "nwwnnnnnw",
  W: "wwwnnnnnn",
  X: "nwnnwnnnw",
  Y: "wwnnwnnnn",
  Z: "nwwnwnnnn",
  "-": "nwnnnnwnw",
  ".": "wwnnnnwnn",
  " ": "nwwnnnwnn",
  $: "nwnwnwnnn",
  "/": "nwnwnnnwn",
  "+": "nwnnnwnwn",
  "%": "nnnwnwnwn",
  "*": "nwnnwnwnn",
};

/**
 * Converts a catalog identifier into a simple Code 39 bar model. TINDIO's
 * generated identifiers stay inside Code 39's character set, while existing
 * UPC/EAN digit strings are also representable for internal scanner labels.
 */
export function createCode39Barcode(value: string): Code39Barcode | null {
  const normalizedValue = value.trim().toUpperCase();
  if (!normalizedValue || [...normalizedValue].some((character) => !code39Patterns[character])) {
    return null;
  }

  let cursor = 10;
  const bars: Array<{ x: number; width: number }> = [];

  for (const character of `*${normalizedValue}*`) {
    const pattern = code39Patterns[character];
    for (let index = 0; index < pattern.length; index += 1) {
      const width = pattern[index] === "w" ? 3 : 1;
      if (index % 2 === 0) bars.push({ x: cursor, width });
      cursor += width;
    }
    cursor += 1;
  }

  return { bars, value: normalizedValue, width: cursor + 10 };
}

export function code39SvgMarkup(barcode: Code39Barcode): string {
  const bars = barcode.bars
    .map(({ x, width }) => `<rect x="${x}" y="0" width="${width}" height="100" />`)
    .join("");

  return `<svg aria-label="Barcode ${barcode.value}" role="img" viewBox="0 0 ${barcode.width} 100" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
}
