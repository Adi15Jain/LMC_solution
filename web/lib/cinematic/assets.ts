/**
 * Asset manager for the cinematic.
 *
 * Deliberately front-loaded: the user presses a button, we spend as long as we need
 * getting *everything* onto the GPU, and then the sequence runs without a single
 * hitch. Nothing is fetched, decoded, or compiled after playback starts.
 *
 * The part that actually matters is step 3 — `renderer.compileAsync()`.
 *
 * Three.js compiles a shader the first time a material becomes visible. On a scene
 * this size that means the first frame of every new shot stalls for tens of
 * milliseconds while the driver compiles and links — the classic "it stutters the
 * first time through, then it's fine" symptom. Precompiling during the preloader
 * moves every one of those stalls into the loading bar, where nobody minds.
 *
 * `compileAsync` uses KHR_parallel_shader_compile where available, so it compiles
 * off the main thread instead of blocking it.
 */

import type * as THREE from "three";

export interface AssetSpec {
  key: string;
  url: string;
  kind: "texture" | "gltf" | "binary" | "json";
  /** Rough share of total load time, used to weight the progress bar honestly. */
  weight: number;
  label: string;
}

/** Everything the cinematic needs, declared up front. */
export const MANIFEST: AssetSpec[] = [
  { key: "earthDay", url: "/earth/earth_day.webp", kind: "texture", weight: 12,
    label: "Earth — surface" },
  { key: "earthNight", url: "/earth/earth_night.webp", kind: "texture", weight: 4,
    label: "Earth — city lights" },
  { key: "earthNormal", url: "/earth/earth_normal.webp", kind: "texture", weight: 10,
    label: "Earth — terrain relief" },
  { key: "earthClouds", url: "/earth/earth_clouds.webp", kind: "texture", weight: 6,
    label: "Earth — cloud layer" },
  { key: "milkyway", url: "/sky/milkyway_4k.webp", kind: "texture", weight: 30,
    label: "Milky Way panorama" },
  { key: "gaia", url: "/models/gaia_esa.glb", kind: "gltf", weight: 22,
    label: "Gaia spacecraft" },
  { key: "starsMeta", url: "/data/stars.meta.json", kind: "json", weight: 1,
    label: "Catalogue index" },
  { key: "stars", url: "/data/stars.bin", kind: "binary", weight: 26,
    label: "LMC field — 250,000 stars" },
  { key: "brightMeta", url: "/sky/brightstars.meta.json", kind: "json", weight: 2,
    label: "Named stars" },
  { key: "bright", url: "/sky/brightstars.bin", kind: "binary", weight: 4,
    label: "Bright star catalogue" },
  { key: "analysis", url: "/data/analysis.json", kind: "json", weight: 3,
    label: "Model metrics" },
];

export type LoadedAssets = Record<string, unknown>;

export interface LoadProgress {
  /** 0..1 across the whole manifest, weighted. */
  fraction: number;
  /** What is happening right now — shown under the bar. */
  label: string;
  /** Set once every asset is on the GPU and every shader is compiled. */
  done: boolean;
}

type OnProgress = (p: LoadProgress) => void;

/**
 * Fetch one asset. Textures and glTF go through three's loaders so they land
 * decoded and GPU-ready rather than as raw bytes we would have to decode later.
 */
async function loadOne(spec: AssetSpec, THREE_NS: typeof THREE): Promise<unknown> {
  switch (spec.kind) {
    case "json": {
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`${spec.url}: ${res.status}`);
      return res.json();
    }
    case "binary": {
      const res = await fetch(spec.url);
      if (!res.ok) throw new Error(`${spec.url}: ${res.status}`);
      return res.arrayBuffer();
    }
    case "texture": {
      const { TextureLoader } = THREE_NS;
      const tex = await new TextureLoader().loadAsync(spec.url);
      // Only the panorama is an environment map. The Earth maps are UV-mapped onto a
      // sphere, and giving them equirect *reflection* mapping makes three sample them
      // by view direction instead of by uv - the texture then slides across the
      // surface as the camera moves. Colour space is set per-map by the consumer,
      // since the normal map must not be decoded as sRGB.
      if (spec.key === "milkyway") {
        tex.mapping = THREE_NS.EquirectangularReflectionMapping;
        tex.colorSpace = THREE_NS.SRGBColorSpace;
      }
      return tex;
    }
    case "gltf": {
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/loaders/DRACOLoader.js"),
      ]);
      const loader = new GLTFLoader();
      // The model is Draco-compressed; without this the load fails outright.
      // Decoder is self-hosted from three's own bundle rather than a CDN: an
      // external fetch here is a single point of failure for the whole scene, and
      // it has to match the three version we ship against.
      const draco = new DRACOLoader();
      draco.setDecoderPath("/draco/");
      loader.setDRACOLoader(draco);
      return loader.loadAsync(spec.url);
    }
  }
}

/**
 * Run the whole load. Resolves only when the scene is genuinely ready to render.
 *
 * `prepareScene` is where the caller builds the scene graph from the loaded assets;
 * it runs *before* shader compilation so that compileAsync sees every material.
 */
export async function loadAll(
  THREE_NS: typeof THREE,
  onProgress: OnProgress,
  prepareScene?: (assets: LoadedAssets) => { scene: THREE.Scene; camera: THREE.Camera } | null,
  renderer?: THREE.WebGLRenderer,
): Promise<LoadedAssets> {
  const assets: LoadedAssets = {};
  const totalWeight = MANIFEST.reduce((s, a) => s + a.weight, 0);
  // Reserve the last slice of the bar for scene build + shader compilation, so the
  // bar does not sit at 100% while the GPU is still working.
  const FETCH_SHARE = 0.82;
  let done = 0;

  onProgress({ fraction: 0, label: "Contacting the archive", done: false });

  // Sequential on purpose. Parallel fetches would finish sooner in wall-clock terms
  // but make the progress bar lurch, and on a slow link they starve each other.
  for (const spec of MANIFEST) {
    onProgress({
      fraction: (done / totalWeight) * FETCH_SHARE,
      label: spec.label,
      done: false,
    });
    assets[spec.key] = await loadOne(spec, THREE_NS);
    done += spec.weight;
  }

  onProgress({ fraction: FETCH_SHARE, label: "Building the scene", done: false });
  const prepared = prepareScene?.(assets) ?? null;

  if (prepared && renderer) {
    onProgress({ fraction: 0.9, label: "Compiling shaders", done: false });
    // The whole point of the long preload. See the file header.
    await renderer.compileAsync(prepared.scene, prepared.camera);
  }

  onProgress({ fraction: 1, label: "Ready", done: true });
  return assets;
}

/** Human-readable total, shown on the start screen so the wait is not a surprise. */
export function estimatedBytes(): number {
  // Matches the shipped files; update if the manifest changes materially.
  const earth = 0.90e6 + 0.17e6 + 0.89e6 + 0.54e6;
  return earth + 2.18e6 + 1.27e6 + 4.75e6 + 0.18e6 + 0.02e6;
}
