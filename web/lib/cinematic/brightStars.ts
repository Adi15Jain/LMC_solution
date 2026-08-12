/**
 * Real catalogued stars for the backdrop — HYG v4.0, CC BY-SA 4.0.
 *
 * These are genuine observed stars with IAU proper names, kept strictly separate
 * from the simulated LMC field. The backdrop is real sky; the science is simulation;
 * the UI says which is which.
 */

export interface NamedStar {
  name: string;
  ra: number;
  dec: number;
  mag: number;
  xyz: [number, number, number];
}

export interface BrightStarMeta {
  count: number;
  blocks: string[];
  bytesPerStar: number;
  magLimit: number;
  named: NamedStar[];
  source: string;
}

export interface BrightStarData {
  count: number;
  /** Unit-sphere direction, interleaved xyz for a vec3 attribute. */
  position: Float32Array;
  /** Apparent magnitude — smaller is brighter. */
  mag: Float32Array;
  /** B–V colour index, drives the star's tint. */
  ci: Float32Array;
  named: NamedStar[];
}

/**
 * Planar blocks (x, y, z, mag, ci) written by scripts/prepare_sky.py.
 * Interleaving xyz here costs one pass and saves three attribute buffers.
 */
export function parseBrightStars(buf: ArrayBuffer, meta: BrightStarMeta): BrightStarData {
  const n = meta.count;
  const expect = n * 20;
  if (buf.byteLength !== expect) {
    throw new Error(
      `brightstars.bin: expected ${expect} bytes for ${n} stars, got ${buf.byteLength}. `
      + "Re-run scripts/prepare_sky.py.",
    );
  }

  const x = new Float32Array(buf, 0, n);
  const y = new Float32Array(buf, n * 4, n);
  const z = new Float32Array(buf, n * 8, n);
  const mag = new Float32Array(buf, n * 12, n);
  const ci = new Float32Array(buf, n * 16, n);

  const position = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    position[i * 3] = x[i];
    position[i * 3 + 1] = z[i];      // equatorial z -> scene up (three.js is Y-up)
    position[i * 3 + 2] = -y[i];
  }

  return { count: n, position, mag, ci, named: meta.named };
}

/**
 * B–V colour index to RGB, roughly following the blackbody sequence.
 * Hot blue stars sit near -0.3, the Sun at 0.65, cool red giants past 1.5.
 */
export function colourFromCI(ci: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, (ci + 0.4) / 2.4));
  // blue-white -> white -> amber
  const r = 0.62 + 0.38 * t;
  const g = 0.74 + 0.20 * t - 0.22 * t * t;
  const b = 1.0 - 0.55 * t * t;
  return [r, g, b];
}
