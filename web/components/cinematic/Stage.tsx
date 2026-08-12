"use client";

/**
 * The cinematic stage.
 *
 * Plain three.js rather than R3F. The whole point of this route is a deterministic
 * load-then-run pipeline: build the entire scene graph, hand it to compileAsync, and
 * only then start the clock. A declarative tree that mounts objects as React commits
 * fights that directly - objects would appear after compilation and stall on their
 * first frame, which is the exact hitch we are paying a long preload to avoid.
 *
 * Three worlds live in the scene at once and are toggled by visibility, never
 * rebuilt: the solar system (1 unit = 1000 km), the line-of-sight corridor, and the
 * abstract classification field. Building on demand would put a shader compile in
 * the middle of a cut.
 */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import {
  EARTH_RADIUS_KM, GAIA_TRUE_DIAMETER_M, KM, MISSION_DAYS,
} from "@/lib/cinematic/astro";
import { loadAll, type LoadProgress } from "@/lib/cinematic/assets";
import { parseBrightStars, type BrightStarMeta } from "@/lib/cinematic/brightStars";
import {
  enforceMinAngularSize, makeEarth, makeMarker, makeSun, spinEarth,
} from "@/lib/cinematic/scenes/bodies";
import { makeLagrangeField, makeLissajous, makeRing } from "@/lib/cinematic/scenes/lagrange";
import { makeSurvey } from "@/lib/cinematic/scenes/survey";
import { AXIS_Y, makeCorridor, type StarBlocks } from "@/lib/cinematic/scenes/corridor";
import {
  corridorDistanceKpc, L2_POS, sample, SUN_X, TOTAL_DURATION, type World,
} from "@/lib/cinematic/timeline";
import { starFragmentShader, starVertexShader } from "@/lib/shaders/starfield";
import type { StarMeta } from "@/lib/loadStars";

const SKY_RADIUS = 6000;

/**
 * The Gaia model is authored 10 units across, so at scene scale it is 10,000 km
 * wide against a real width of 10 m. That is a factor of a million, and the shot
 * says so on screen rather than hoping nobody works it out.
 */
const GAIA_EXAGGERATION = (10 * 1000 * 1000) / GAIA_TRUE_DIAMETER_M;

// Scratch, allocated once. Anything created inside the frame loop becomes garbage
// 60 times a second and shows up as periodic GC hitches.
const _eye = new THREE.Vector3();
const _focus = new THREE.Vector3();
const _sunDir = new THREE.Vector3();
const _proj = new THREE.Vector3();

export interface Telemetry {
  t: number;
  world: World;
  missionDays: number;
  revolutions: number;
  coveredFraction: number;
  /** Distance from Gaia along the corridor, kpc. Null outside the corridor act. */
  distanceKpc: number | null;
  /** Scale exaggeration currently on screen, or null if everything is true to scale. */
  exaggeration: number | null;
  /** How much the Earth is inflated to stay visible; null when true to scale. */
  earthScale: number | null;
}

/** Imperative handle so the transport UI can drive the clock without re-rendering. */
export interface Controller {
  seek: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  isPlaying: () => boolean;
}

// ---------------------------------------------------------------- backdrop --

/**
 * Real catalogued stars, rendered to look like stars rather than like particles.
 *
 * The previous version drew every star as the same soft round blob, which is what
 * made the backdrop read as floating dust. Three things fix it:
 *   - a hard, small core with a separate wide halo, so bright and faint stars differ
 *     in *shape* and not only in alpha
 *   - diffraction spikes on the brightest few, which is the cue the eye actually uses
 *     to read "star" rather than "dot"
 *   - a magnitude-driven size curve steep enough that the faint majority stay
 *     sub-pixel instead of forming a uniform grey haze
 */
const BRIGHT_VERT = /* glsl */ `
  attribute float aMag;
  attribute float aCI;
  uniform float uPixelRatio;
  uniform float uScale;
  varying float vBright;
  varying float vCI;

  void main() {
    // Magnitudes are logarithmic and inverted: 6.5 is the naked-eye limit, Sirius is
    // -1.46. Map to 0..1, then square to steepen the falloff.
    float b = clamp((6.5 - aMag) / 8.0, 0.0, 1.0);
    vBright = b;
    vCI = aCI;

    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // Fixed screen size: these sit at effectively infinite distance, so perspective
    // attenuation would be wrong.
    gl_PointSize = uScale * uPixelRatio * (0.55 + 5.5 * b * b * b);
  }
`;

const BRIGHT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying float vBright;
  varying float vCI;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    if (r > 0.5) discard;

    // Tight core, wide faint halo. The ratio between them is what separates a bright
    // star from a faint one at a glance.
    float core = smoothstep(0.16, 0.0, r);
    float halo = pow(max(0.0, 1.0 - r * 2.0), 3.0) * 0.30;

    // Diffraction spikes, only on the brightest. A real telescope's spider vanes
    // produce these; the eye reads them as "bright point source" instantly.
    float spikeAmt = smoothstep(0.55, 1.0, vBright);
    float spikes = 0.0;
    if (spikeAmt > 0.001) {
      float ax = abs(uv.x), ay = abs(uv.y);
      float horiz = exp(-ay * 90.0) * exp(-ax * 5.0);
      float vert  = exp(-ax * 90.0) * exp(-ay * 5.0);
      spikes = (horiz + vert) * spikeAmt * 0.55;
    }

    // B-V colour index to an approximate blackbody tint.
    float t = clamp((vCI + 0.4) / 2.4, 0.0, 1.0);
    vec3 tint = vec3(0.68 + 0.32 * t, 0.78 + 0.14 * t - 0.20 * t * t, 1.0 - 0.50 * t * t);

    float a = core + halo + spikes;
    gl_FragColor = vec4(tint * a, a * uOpacity);
  }
`;

function makeBrightStars(buf: ArrayBuffer, meta: BrightStarMeta) {
  const data = parseBrightStars(buf, meta);
  const geo = new THREE.BufferGeometry();

  const scaled = new Float32Array(data.position.length);
  for (let i = 0; i < data.position.length; i++) {
    scaled[i] = data.position[i] * (SKY_RADIUS * 0.94);
  }

  geo.setAttribute("position", new THREE.BufferAttribute(scaled, 3));
  geo.setAttribute("aMag", new THREE.BufferAttribute(data.mag, 1));
  geo.setAttribute("aCI", new THREE.BufferAttribute(data.ci, 1));

  const uniforms = {
    uPixelRatio: { value: 1 },
    uScale: { value: 3.2 },
    uOpacity: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: BRIGHT_VERT,
    fragmentShader: BRIGHT_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -500;
  return { points, uniforms };
}

/** The LMC field - same shader as the explorer, so both views stay in step. */
function makeField(buf: ArrayBuffer, meta: StarMeta) {
  const n = meta.counts.full;
  const blocks: Record<string, Int16Array> = {};
  ["skyX", "skyY", "pmra", "pmdec", "bp_rp", "gmag", "plx", "depth"].forEach((name, i) => {
    blocks[name] = new Int16Array(buf, i * n * 2, n);
  });
  const base = 8 * n * 2;

  const inter = (a: Int16Array, b: Int16Array) => {
    const out = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      out[i * 2] = a[i];
      out[i * 2 + 1] = b[i];
    }
    return out;
  };

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aSky", new THREE.BufferAttribute(inter(blocks.skyX, blocks.skyY), 2, true));
  geo.setAttribute("aPm", new THREE.BufferAttribute(inter(blocks.pmra, blocks.pmdec), 2, true));
  geo.setAttribute("aCmd", new THREE.BufferAttribute(inter(blocks.bp_rp, blocks.gmag), 2, true));
  geo.setAttribute("aDepth", new THREE.BufferAttribute(blocks.depth, 1, true));

  const type = new Uint8Array(buf, base, n);
  const prob = new Uint8Array(buf, base + n, n);
  const isTest = new Uint8Array(buf, base + 2 * n, n);
  geo.setAttribute("aType", new THREE.BufferAttribute(type, 1, true));
  geo.setAttribute("aProb", new THREE.BufferAttribute(prob, 1, true));
  geo.setAttribute("aIsTest", new THREE.BufferAttribute(isTest, 1, true));

  const uniforms = {
    uSpaceWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
    uColorWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
    uExtent: { value: new THREE.Vector3(140, 140, 140) },
    uDepthScale: { value: 90 },
    uTruthDepth: { value: 0 },
    uPointScale: { value: 2.2 },
    uPixelRatio: { value: 1 },
    uThreshold: { value: 0.5 },
    uOpacity: { value: 0 },
    uExposure: { value: 0.34 },
    uCell: { value: -1 },
    uTestOnly: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: starVertexShader,
    fragmentShader: starFragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const starBlocks: StarBlocks = {
    count: n,
    skyX: blocks.skyX, skyY: blocks.skyY, depth: blocks.depth,
    gmag: blocks.gmag, bpRp: blocks.bp_rp, type,
    ranges: meta.ranges as unknown as Record<string, { lo: number; hi: number }>,
  };

  return { points, uniforms, starBlocks };
}

// ------------------------------------------------------------------- stage --

interface Rig {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  worlds: Record<World, THREE.Group>;
  earth: ReturnType<typeof makeEarth>;
  sun: ReturnType<typeof makeSun>;
  lagrange: ReturnType<typeof makeLagrangeField>;
  survey: ReturnType<typeof makeSurvey>;
  corridor: ReturnType<typeof makeCorridor>;
  gaiaHolder: THREE.Group;
  earthMarker: THREE.Points;
  sunMarker: THREE.Points;
  orbitMat: { opacity: number; resolution: THREE.Vector2 };
  lissMat: { opacity: number; resolution: THREE.Vector2 };
  skybox: THREE.Mesh;
  brightUniforms: Record<string, { value: unknown }>;
  fieldUniforms: Record<string, { value: unknown }>;
  labelLayer: HTMLDivElement;
}

export function Stage({
  onProgress,
  autoStart,
  onReady,
  onTime,
  onTelemetry,
  onController,
}: {
  onProgress: (p: LoadProgress) => void;
  autoStart: boolean;
  onReady: () => void;
  onTime: (t: number) => void;
  onTelemetry?: (tel: Telemetry) => void;
  onController?: (c: Controller) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<Rig | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Callbacks go through refs so the setup effect can depend on `autoStart` alone.
  //
  // This is not a micro-optimisation. The parent passes inline arrows, so their
  // identity changes on every render; with them in the dependency array, each
  // progress update re-rendered the page, invalidated the effect, disposed the
  // renderer and restarted the whole load - an infinite reload loop that never
  // reaches the first frame.
  const cbRef = useRef({ onProgress, onReady, onTime, onTelemetry, onController });
  useEffect(() => {
    cbRef.current = { onProgress, onReady, onTime, onTelemetry, onController };
  }, [onProgress, onReady, onTime, onTelemetry, onController]);

  useEffect(() => {
    if (!autoStart) return;
    const host = hostRef.current;
    if (!host || rigRef.current) return;

    let disposed = false;
    let raf = 0;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      // The system act spans from a 6,371-unit Earth to a 149,598-unit Sun in one
      // frame. A conventional depth buffer distributes its precision hyperbolically
      // and would z-fight the Earth's own surface against itself at that far plane.
      logarithmicDepthBuffer: true,
    });
    const dpr = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.setClearColor(0x03050a, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    host.appendChild(renderer.domElement);

    const labelLayer = document.createElement("div");
    labelLayer.className = "stage-labels";
    host.appendChild(labelLayer);

    const scene = new THREE.Scene();
    // Near plane at 0.02 units (20 km) so the Earth close-up does not clip. Far plane
    // at 1.2 million units: the widest shot puts the camera 360,000 units from the
    // system centre, and the Sun has to stay visible from there. Only viable with the
    // logarithmic depth buffer above.
    const camera = new THREE.PerspectiveCamera(46, host.clientWidth / host.clientHeight, 0.02, 1.2e6);

    // Sunlight comes from -X, matching where the Sun is placed. One directional light
    // plus a faint fill; there is no bounce light in space, and faking a lot of it is
    // what makes space renders look like studio renders.
    // Sunlight comes from -X, matching where the Sun is placed. Bright, because at
    // 1 AU it is: this is the only real light source in the entire act.
    const key = new THREE.DirectionalLight(0xfff6ec, 5.5);
    key.position.set(-1, 0.06, 0).multiplyScalar(1000);
    scene.add(key);
    // A cool, weak fill standing in for starlight and Earthshine. Kept low - the
    // giveaway of a fake space render is a shadow side that is comfortably visible.
    scene.add(new THREE.AmbientLight(0x223049, 0.9));

    (async () => {
      try {
        await loadAll(
          THREE,
          (p) => cbRef.current.onProgress(p),
          (assets) => {
            const worlds: Record<World, THREE.Group> = {
              system: new THREE.Group(),
              corridor: new THREE.Group(),
              field: new THREE.Group(),
            };
            scene.add(worlds.system, worlds.corridor, worlds.field);

            // --- backdrop, shared by every world -------------------------
            const skyTex = assets.milkyway as THREE.Texture;
            const skybox = new THREE.Mesh(
              new THREE.SphereGeometry(SKY_RADIUS, 64, 32),
              new THREE.MeshBasicMaterial({
                map: skyTex, side: THREE.BackSide, depthWrite: false,
                depthTest: false, transparent: true, opacity: 0.3,
              }),
            );
            skybox.renderOrder = -1000;
            skybox.frustumCulled = false;
            scene.add(skybox);

            // Image-based lighting from the panorama itself.
            //
            // This is not a polish pass, it is the difference between seeing the
            // spacecraft and not. Gaia's hull is modelled as near-pure metal, and a
            // metal has no diffuse response at all - it can only show what is around
            // it to reflect. Lit by directional lights alone in an empty scene it
            // renders essentially black, which is exactly how the first pass looked.
            // Convolving the sky into a PMREM gives it something to reflect.
            const pmrem = new THREE.PMREMGenerator(renderer);
            pmrem.compileEquirectangularShader();
            const envRT = pmrem.fromEquirectangular(skyTex);
            scene.environment = envRT.texture;
            // The Milky Way is a dim source; without a healthy multiplier the
            // reflections are technically correct and practically invisible.
            scene.environmentIntensity = 2.6;
            pmrem.dispose();

            const bright = makeBrightStars(
              assets.bright as ArrayBuffer,
              assets.brightMeta as BrightStarMeta,
            );
            bright.uniforms.uPixelRatio.value = dpr;
            scene.add(bright.points);

            // --- system world --------------------------------------------
            const earth = makeEarth({
              day: assets.earthDay as THREE.Texture,
              night: assets.earthNight as THREE.Texture,
              normal: assets.earthNormal as THREE.Texture,
              clouds: assets.earthClouds as THREE.Texture,
            });
            worlds.system.add(earth.group);

            const sun = makeSun();
            sun.sprite.position.set(SUN_X, 0, 0);
            worlds.system.add(sun.sprite);

            const lagrange = makeLagrangeField();
            worlds.system.add(lagrange.group);

            // Earth's orbit, drawn around the Sun.
            const orbit = makeRing(Math.abs(SUN_X), 0x2c4a72, 720, 1.0);
            orbit.line.position.set(SUN_X, 0, 0);
            worlds.system.add(orbit.line);

            const liss = makeLissajous();
            worlds.system.add(liss.line);

            const earthMarker = makeMarker(0x8fc6ff, 8);
            worlds.system.add(earthMarker);
            const sunMarker = makeMarker(0xffd9a0, 14);
            sunMarker.position.set(SUN_X, 0, 0);
            worlds.system.add(sunMarker);

            const gltf = assets.gaia as GLTF;
            const gaia = gltf.scene;
            gaia.traverse((o) => {
              const m = o as THREE.Mesh;
              if (!m.isMesh) return;
              m.frustumCulled = false;

              // Make the hull readable.
              //
              // Both ESA materials ship metallicFactor = 1 and roughnessFactor = 1,
              // and those are *multipliers* on a metallicRoughness texture, not
              // absolute values. So the obvious fix - clamping roughness up - is a
              // no-op: max(1, 0.32) is 1. The first attempt at this did exactly that
              // and changed nothing.
              //
              // What actually matters is metalness. A pure metal has no diffuse
              // response whatsoever; it can only show what it reflects, and at L2
              // there is nothing to reflect but empty sky. Halving the metallic
              // multiplier lets the base-colour texture contribute directly, which is
              // what turns the spacecraft from a silhouette into an object. It is a
              // presentation choice, and it is the same one every published render of
              // this spacecraft makes.
              const mat = m.material as THREE.MeshStandardMaterial;
              if (mat && "metalness" in mat) {
                mat.metalness = (mat.metalness ?? 1) * 0.45;
                mat.envMapIntensity = 3.0;
              }
            });
            const gaiaHolder = new THREE.Group();
            gaiaHolder.position.set(...L2_POS);
            const survey = makeSurvey(gaia, 300);
            gaiaHolder.add(survey.group);
            gaiaHolder.add(survey.coverage);
            worlds.system.add(gaiaHolder);

            // --- corridor + field worlds ---------------------------------
            const field = makeField(
              assets.stars as ArrayBuffer,
              assets.starsMeta as StarMeta,
            );
            field.uniforms.uPixelRatio.value = dpr;
            worlds.field.add(field.points);

            // Stride 6, not 3. The corridor is flown *through*, so what matters is
            // local density along the path rather than total count; 42k sprites read
            // as a star field where 83k read as a wall.
            const corridor = makeCorridor(field.starBlocks, 6);
            corridor.setPixelRatio(dpr);
            worlds.corridor.add(corridor.points, corridor.axis);

            const w = host.clientWidth;
            const h = host.clientHeight;
            lagrange.setResolution(w, h);
            orbit.material.resolution.set(w, h);
            liss.material.resolution.set(w, h);

            rigRef.current = {
              renderer, scene, camera, worlds, earth, sun, lagrange, survey, corridor,
              gaiaHolder, earthMarker, sunMarker,
              orbitMat: orbit.material as unknown as Rig["orbitMat"],
              lissMat: liss.material as unknown as Rig["lissMat"],
              skybox,
              brightUniforms: bright.uniforms,
              fieldUniforms: field.uniforms,
              labelLayer,
            };
            return { scene, camera };
          },
          renderer,
        );

        if (disposed) return;
        cbRef.current.onReady();

        // Accumulated clock rather than (now - start): pausing and seeking have to
        // move the timeline itself, not just where we sample a fixed wall clock.
        const clock = { t: 0, playing: true, speed: 1 };
        cbRef.current.onController?.({
          seek: (t) => {
            clock.t = Math.max(0, Math.min(TOTAL_DURATION - 0.01, t));
            // Seeking backwards past the survey has to clear the coverage map, or
            // the sky stays painted from a future it has not reached yet.
            rigRef.current?.survey.reset();
          },
          setPlaying: (p) => { clock.playing = p; },
          setSpeed: (v) => { clock.speed = v; },
          isPlaying: () => clock.playing,
        });

        const labelEls = new Map<string, HTMLDivElement>();
        let lastTelemetry = 0;
        let earthScale = 1;
        let last = performance.now();

        const loop = () => {
          raf = requestAnimationFrame(loop);
          const rig = rigRef.current;
          if (!rig) return;

          const now = performance.now();
          // Clamp dt so a background tab does not jump the sequence forward on return.
          const dt = Math.min(0.1, (now - last) / 1000);
          last = now;
          if (clock.playing) {
            const next = clock.t + dt * clock.speed;
            if (next >= TOTAL_DURATION) rig.survey.reset();
            clock.t = next % TOTAL_DURATION;
          }

          const t = clock.t;
          const s = sample(t);
          cbRef.current.onTime(t);

          // --- camera ------------------------------------------------------
          _eye.set(...s.camera.eye);
          _focus.set(...s.camera.focus);
          rig.camera.position.copy(_eye);
          rig.camera.lookAt(_focus);
          if (Math.abs(rig.camera.fov - s.camera.fov) > 0.01) {
            rig.camera.fov = s.camera.fov;
            rig.camera.updateProjectionMatrix();
          }

          // --- world switching ---------------------------------------------
          rig.worlds.system.visible = s.world === "system";
          rig.worlds.corridor.visible = s.world === "corridor";
          rig.worlds.field.visible = s.world === "field";

          // The backdrop follows the camera so it stays at infinity - without this
          // the corridor flight would fly straight through the sky sphere.
          rig.skybox.position.copy(_eye);
          (rig.skybox.material as THREE.MeshBasicMaterial).opacity = s.skyboxOpacity;
          (rig.brightUniforms.uOpacity as { value: number }).value = s.brightStarsOpacity;

          // --- system ------------------------------------------------------
          if (s.world === "system") {
            rig.earth.setOpacity(s.earthOpacity);
            spinEarth(rig.earth, s.earthSpin);
            // Sunlight direction at the Earth: the Sun sits on -X.
            _sunDir.set(-1, 0, 0);
            rig.earth.setSunDir(_sunDir);

            rig.sun.setOpacity(s.sunOpacity);
            rig.sun.update(rig.camera, host.clientHeight);

            // Hold a floor on the Earth's apparent size. Without it the planet is
            // sub-pixel for most of the wide shot and simply disappears, taking the
            // viewer's only reference point with it. The factor is reported so the
            // HUD can say by how much.
            earthScale = enforceMinAngularSize(
              rig.earth.group, rig.earth.radiusUnits, rig.camera, host.clientHeight, 7,
            );

            rig.lagrange.setOpacity(s.contourOpacity, s.markerOpacity);
            rig.orbitMat.opacity = s.orbitOpacity;
            rig.lissMat.opacity = s.lissajousOpacity;

            // Markers stand in for bodies that are sub-pixel at this distance. They
            // appear only once the real geometry has faded, never on top of it.
            const markerFade = s.markerOpacity;
            (rig.earthMarker.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
              markerFade * (1 - s.earthOpacity);
            (rig.sunMarker.material as THREE.ShaderMaterial).uniforms.uOpacity.value =
              s.sunOpacity * 0.9;

            rig.gaiaHolder.visible = s.gaiaOpacity > 0.01 || s.coverageOpacity > 0.01;
            rig.survey.setBeamOpacity(s.beamOpacity);
            rig.survey.setCoverageOpacity(s.coverageOpacity);
            rig.survey.update(s.missionDays);
            rig.survey.group.visible = s.gaiaOpacity > 0.01;
          }

          // --- corridor ----------------------------------------------------
          if (s.world === "corridor") {
            rig.corridor.setFade(s.corridorFade);
            rig.corridor.setReveal(s.corridorReveal);
            rig.corridor.setHighlight(s.corridorHighlight);
          }

          // --- field -------------------------------------------------------
          if (s.world === "field") {
            const fu = rig.fieldUniforms;
            (fu.uOpacity as { value: number }).value = s.fieldOpacity;
            (fu.uSpaceWeights.value as THREE.Vector4).set(...s.spaceWeights);
            (fu.uColorWeights.value as THREE.Vector4).set(...s.colorWeights);
            (fu.uTruthDepth as { value: number }).value = s.inferredDepth;
          }

          // --- labels ------------------------------------------------------
          // Positioned imperatively, outside React. Projecting five anchors and
          // committing them through setState would re-render the HUD 60x a second.
          updateLabels(rig, s.labelSet, labelEls, host.clientWidth, host.clientHeight);

          rig.renderer.render(rig.scene, rig.camera);

          // --- telemetry ---------------------------------------------------
          // Throttled hard: these are numbers a person reads, and nobody can read a
          // 60 Hz counter. 8 Hz looks live and costs almost nothing.
          if (cbRef.current.onTelemetry && now - lastTelemetry > 125) {
            lastTelemetry = now;
            const cov = rig.survey.update(s.missionDays);
            cbRef.current.onTelemetry({
              t,
              world: s.world,
              missionDays: s.missionDays,
              revolutions: cov.revolutions,
              coveredFraction: cov.coveredFraction,
              distanceKpc: s.world === "corridor" ? corridorDistanceKpc(_eye.z) : null,
              exaggeration:
                s.world === "system" && s.gaiaOpacity > 0.3 ? GAIA_EXAGGERATION : null,
              earthScale: s.world === "system" && earthScale > 1.5 ? earthScale : null,
            });
          }
        };
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    const onResize = () => {
      const rig = rigRef.current;
      if (!host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (rig) {
        rig.lagrange.setResolution(w, h);
        rig.orbitMat.resolution.set(w, h);
        rig.lissMat.resolution.set(w, h);
      }
    };
    window.addEventListener("resize", onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      rigRef.current?.lagrange.dispose();
      rigRef.current?.survey.dispose();
      rigRef.current?.corridor.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.remove();
      rigRef.current = null;
    };
  }, [autoStart]);

  if (error) {
    return (
      <div className="stage-error">
        <p>Could not build the scene.</p>
        <code>{error}</code>
        <p>
          Run <code>python scripts/prepare_sky.py</code>,{" "}
          <code>scripts/prepare_earth.py</code> and{" "}
          <code>scripts/export_web_data.py</code>.
        </p>
      </div>
    );
  }

  return <div ref={hostRef} className="stage" />;
}

/**
 * Project world-space anchors to screen and move the DOM labels there.
 *
 * DOM rather than sprites, because these are typography: hairline rules, tabular
 * figures and a second line of detail. A canvas-drawn sprite at this size is soft on
 * a high-DPI display and cannot inherit the page's type styling.
 */
function updateLabels(
  rig: Rig,
  set: "none" | "lagrange" | "corridor",
  els: Map<string, HTMLDivElement>,
  w: number,
  h: number,
): void {
  const wanted =
    set === "lagrange"
      // The two bodies are labelled alongside the five points. Without them the wide
      // shot is a scatter of unexplained dots: nothing on screen says which one is
      // the Sun, and the Earth is a single pixel on a very large ring.
      ? [
          {
            id: "sun", text: "Sun", sub: "1 AU",
            position: new THREE.Vector3(SUN_X, 0, 0),
          },
          {
            id: "earth", text: "Earth", sub: "",
            position: new THREE.Vector3(0, 0, 0),
          },
          ...rig.lagrange.anchors,
        ]
      : set === "corridor"
        ? rig.corridor.ticks.map((tk) => ({
            id: `tick-${tk.kpc}`,
            text: tk.label,
            sub: "",
            // Anchored on the rule itself, not on the corridor axis - otherwise
            // every label floats a few units above the tick it belongs to.
            position: new THREE.Vector3(0, AXIS_Y, tk.z),
          }))
        : [];

  const seen = new Set<string>();
  const placed: { id: string; x: number; y: number; visible: boolean }[] = [];

  for (const a of wanted) {
    seen.add(a.id);
    let el = els.get(a.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "stage-label";
      el.innerHTML = `<b></b><i></i>`;
      rig.labelLayer.appendChild(el);
      els.set(a.id, el);
    }
    (el.querySelector("b") as HTMLElement).textContent = a.text;
    (el.querySelector("i") as HTMLElement).textContent = a.sub;

    _proj.copy(a.position).project(rig.camera);
    // z > 1 means behind the camera; project() wraps those to the opposite side of
    // the screen, which would pin labels to the wrong edge.
    const visible = _proj.z < 1 && Math.abs(_proj.x) < 1.4 && Math.abs(_proj.y) < 1.4;
    placed.push({
      id: a.id,
      x: (_proj.x * 0.5 + 0.5) * w,
      y: (-_proj.y * 0.5 + 0.5) * h,
      visible,
    });
  }

  // Declutter vertically.
  //
  // In the wide shot L1 and L2 are 3 million km apart and a couple of pixels apart on
  // screen, so their labels land on top of each other and neither is readable. Sort by
  // y and push any pair closer than one label-height apart. One pass in sorted order
  // is enough for the handful of anchors this ever has to place, and it is stable -
  // labels do not swap sides between frames.
  const MIN_GAP = 34;
  const order = placed.filter((p) => p.visible).sort((a, b) => a.y - b.y);
  for (let i = 1; i < order.length; i++) {
    const gap = order[i].y - order[i - 1].y;
    if (gap < MIN_GAP) order[i].y = order[i - 1].y + MIN_GAP;
  }

  for (const p of placed) {
    const el = els.get(p.id);
    if (!el) continue;
    el.style.opacity = p.visible ? "1" : "0";
    if (p.visible) {
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    }
  }

  for (const [id, el] of els) {
    if (!seen.has(id)) {
      el.remove();
      els.delete(id);
    }
  }
}

export { GAIA_EXAGGERATION, EARTH_RADIUS_KM, MISSION_DAYS };
