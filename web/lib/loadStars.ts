/**
 * Loader for the packed binary star cloud.
 *
 * The layout is *planar* — each attribute is one contiguous block — so every
 * typed-array view below is a zero-copy cast over the ArrayBuffer, not a parse.
 * 250k stars land in GPU-ready form in single-digit milliseconds.
 *
 * MUST stay byte-for-byte in sync with scripts/export_web_data.py.
 */

const INT16_BLOCKS = ["skyX", "skyY", "pmra", "pmdec", "bp_rp", "gmag", "plx", "depth"] as const;
const UINT8_BLOCKS = ["type", "prob", "isTest"] as const;

type Int16Block = (typeof INT16_BLOCKS)[number];

export const BYTES_PER_STAR = INT16_BLOCKS.length * 2 + UINT8_BLOCKS.length; // 19

export interface StarMeta {
  counts: { full: number; preview: number };
  int16Blocks: string[];
  uint8Blocks: string[];
  bytesPerStar: number;
  ranges: Record<string, { lo: number; hi: number }>;
  lmcFraction: number;
  testFraction: number;
  sourceRows: number;
  projection: { kind: string; ra0: number; dec0: number };
}

export interface StarData {
  count: number;
  /** Interleaved pairs, ready for a vec2 attribute. */
  sky: Int16Array;   // gnomonic x, y
  pm: Int16Array;    // pmra, pmdec
  cmd: Int16Array;   // bp_rp, gmag
  depth: Int16Array;
  plx: Int16Array;
  type: Uint8Array;   // 0 or 255
  prob: Uint8Array;   // P(LMC) * 255
  isTest: Uint8Array; // 255 if in the held-out split
  meta: StarMeta;
}

/** Zip two planar int16 blocks into one interleaved buffer for a vec2 attribute. */
function interleave(a: Int16Array, b: Int16Array, count: number): Int16Array {
  const out = new Int16Array(count * 2);
  for (let i = 0; i < count; i++) {
    out[i * 2] = a[i];
    out[i * 2 + 1] = b[i];
  }
  return out;
}

export async function loadStars(
  url: string,
  meta: StarMeta,
  expectedCount: number,
): Promise<StarData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  const buf = await res.arrayBuffer();

  const n = expectedCount;
  const need = n * BYTES_PER_STAR;
  if (buf.byteLength !== need) {
    throw new Error(
      `${url}: expected ${need} bytes for ${n} stars, got ${buf.byteLength}. ` +
        `Re-run scripts/export_web_data.py — the binary layout is out of sync.`,
    );
  }

  const blocks = {} as Record<Int16Block, Int16Array>;
  INT16_BLOCKS.forEach((name, i) => {
    blocks[name] = new Int16Array(buf, i * n * 2, n);
  });

  const base = INT16_BLOCKS.length * n * 2;

  return {
    count: n,
    sky: interleave(blocks.skyX, blocks.skyY, n),
    pm: interleave(blocks.pmra, blocks.pmdec, n),
    cmd: interleave(blocks.bp_rp, blocks.gmag, n),
    depth: blocks.depth,
    plx: blocks.plx,
    type: new Uint8Array(buf, base, n),
    prob: new Uint8Array(buf, base + n, n),
    isTest: new Uint8Array(buf, base + 2 * n, n),
    meta,
  };
}

export async function loadMeta(baseUrl = "/data"): Promise<StarMeta> {
  const res = await fetch(`${baseUrl}/stars.meta.json`);
  if (!res.ok) throw new Error("Missing stars.meta.json — run scripts/export_web_data.py");
  return res.json();
}

/**
 * Turn a quantised int16 back into its real physical value.
 * Only needed for tooltips and readouts — the *geometry* uses the normalized
 * [-1,1] value directly, so the GPU never pays for this.
 */
export function dequantise(q: number, range: { lo: number; hi: number }): number {
  const t = q / 32767; // [-1, 1]
  return ((t + 1) / 2) * (range.hi - range.lo) + range.lo;
}
