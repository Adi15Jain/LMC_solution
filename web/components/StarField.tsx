"use client";

/**
 * The point cloud — 250,000 stars as ONE imperative THREE.Points object.
 *
 * Deliberately not 250,000 React components, and not a `<points>` whose props
 * change. React owns the page; it does not own the particles. Everything that
 * changes per frame is a uniform mutated inside useFrame.
 */

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { ACTS, SPACE_INDEX, COLOR_MODE_INDEX, type Space, type ColorMode } from "@/lib/spaces";
import { createStarUniforms, starFragmentShader, starVertexShader } from "@/lib/shaders/starfield";
import { useStore } from "@/lib/store";
import type { StarData } from "@/lib/loadStars";

// Scratch objects allocated once at module scope. Allocating inside useFrame
// would generate garbage 60 times a second and cause visible GC hitches.
const targetSpace = new THREE.Vector4();
const targetColor = new THREE.Vector4();

function buildGeometry(data: StarData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const n = data.count;

  // three.js derives the draw count from `position`, so it has to exist even
  // though the vertex shader computes position from scratch. Zeros are fine;
  // we disable frustum culling below since the bounding box is meaningless.
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));

  // `normalized: true` is what makes this cheap — the GPU rescales int16 to
  // [-1, 1] in hardware, and that range is already our plotting coordinate.
  g.setAttribute("aSky", new THREE.BufferAttribute(data.sky, 2, true));
  g.setAttribute("aPm", new THREE.BufferAttribute(data.pm, 2, true));
  g.setAttribute("aCmd", new THREE.BufferAttribute(data.cmd, 2, true));
  g.setAttribute("aDepth", new THREE.BufferAttribute(data.depth, 1, true));
  g.setAttribute("aType", new THREE.BufferAttribute(data.type, 1, true));
  g.setAttribute("aProb", new THREE.BufferAttribute(data.prob, 1, true));
  g.setAttribute("aIsTest", new THREE.BufferAttribute(data.isTest, 1, true));

  return g;
}

/** Resolve the space/colour the scene should currently be showing. */
function resolveTargets(
  progress: number,
  spaceOverride: Space | null,
  colorOverride: ColorMode | null,
) {
  targetSpace.set(0, 0, 0, 0);
  targetColor.set(0, 0, 0, 0);

  if (spaceOverride && colorOverride) {
    targetSpace.setComponent(SPACE_INDEX[spaceOverride], 1);
    targetColor.setComponent(COLOR_MODE_INDEX[colorOverride], 1);
    return;
  }

  // Cross-fade between the two acts the scroll position sits between, so the
  // morph is continuous rather than snapping at act boundaries.
  const lo = Math.floor(progress);
  const hi = Math.min(ACTS.length - 1, lo + 1);
  const t = progress - lo;

  const a = ACTS[lo];
  const b = ACTS[hi];

  targetSpace.setComponent(SPACE_INDEX[a.space], targetSpace.getComponent(SPACE_INDEX[a.space]) + (1 - t));
  targetSpace.setComponent(SPACE_INDEX[b.space], targetSpace.getComponent(SPACE_INDEX[b.space]) + t);

  targetColor.setComponent(COLOR_MODE_INDEX[a.color], targetColor.getComponent(COLOR_MODE_INDEX[a.color]) + (1 - t));
  targetColor.setComponent(COLOR_MODE_INDEX[b.color], targetColor.getComponent(COLOR_MODE_INDEX[b.color]) + t);

  if (spaceOverride) {
    targetSpace.set(0, 0, 0, 0).setComponent(SPACE_INDEX[spaceOverride], 1);
  }
  if (colorOverride) {
    targetColor.set(0, 0, 0, 0).setComponent(COLOR_MODE_INDEX[colorOverride], 1);
  }
}

export function StarField({ data }: { data: StarData }) {
  const pointsRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  const uniforms = useMemo(() => createStarUniforms(), []);
  const geometry = useMemo(() => buildGeometry(data), [data]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: starVertexShader,
        fragmentShader: starFragmentShader,
        transparent: true,
        depthWrite: false,
        // Additive makes overlapping stars build up brightness, which is both
        // physically right and what makes the LMC clump glow when it forms.
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  useEffect(() => {
    uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 2);
  }, [gl, uniforms]);

  // Dispose GPU resources when the tier swaps (preview -> full).
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  useFrame((_, delta) => {
    // getState(), not the hook — subscribing here would re-render every frame.
    const s = useStore.getState();
    resolveTargets(s.progress, s.spaceOverride, s.colorOverride);

    // Frame-rate-independent easing. Stars ease toward the target rather than
    // snapping, which is what makes the morph read as motion rather than a cut.
    const k = s.reducedMotion ? 1 : 1 - Math.exp(-6 * delta);

    uniforms.uSpaceWeights.value.lerp(targetSpace, k);
    uniforms.uColorWeights.value.lerp(targetColor, k);
    uniforms.uThreshold.value = s.threshold;
    uniforms.uExposure.value = s.exposure;
    uniforms.uCell.value = s.cell ?? -1;
    uniforms.uTruthDepth.value += ((s.truthDepth ? 1 : 0) - uniforms.uTruthDepth.value) * k;
    uniforms.uTestOnly.value += ((s.testOnly ? 1 : 0) - uniforms.uTestOnly.value) * k;
  });

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />
  );
}
