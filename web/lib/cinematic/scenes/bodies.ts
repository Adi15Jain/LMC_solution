/**
 * Earth and Sun, in scene units of 1000 km.
 *
 * The Earth is a custom shader rather than MeshStandardMaterial for one reason: the
 * day/night terminator. A standard material lit by a directional light goes to black
 * on the night side, and the night side of Earth is the most recognisable image there
 * is - city lights on black. Blending two albedo maps across the terminator needs
 * access to dot(normal, sunDir) at fragment level, which is exactly what a standard
 * material hides from you.
 */

import * as THREE from "three";
import { EARTH_RADIUS_KM, EARTH_TILT_RAD, KM, SUN_RADIUS_KM } from "../astro";

/**
 * Stop a body from shrinking below a readable size on screen.
 *
 * The scales in this sequence are brutal: pulling back from Earth to the whole
 * Sun-Earth system takes the Earth from filling the frame to roughly a hundredth of
 * a pixel. Rendered honestly it does not fade out gracefully, it simply stops
 * existing, and the viewer loses the one object the whole shot is anchored on.
 *
 * So bodies are given a floor on their apparent size. This is a lie, and it is
 * handled the way every other lie in this project is handled: it is measured, it is
 * returned, and the HUD puts the number on screen. A body at true scale returns 1.
 *
 * `radiusUnits` is the body's real radius in scene units; `minPx` is the smallest
 * radius in device-independent pixels it is allowed to occupy.
 */
export function enforceMinAngularSize(
  obj: THREE.Object3D,
  radiusUnits: number,
  camera: THREE.PerspectiveCamera,
  viewportHeight: number,
  minPx: number,
): number {
  const distance = camera.position.distanceTo(obj.getWorldPosition(_scratch));
  if (distance <= 0) return 1;

  // Half-height of the view frustum at the body's distance, in world units.
  const halfHeightWorld = Math.tan((camera.fov * Math.PI) / 360) * distance;
  const pxPerUnit = viewportHeight / 2 / halfHeightWorld;
  const apparentPx = radiusUnits * pxPerUnit;

  const factor = apparentPx >= minPx ? 1 : minPx / apparentPx;
  obj.scale.setScalar(factor);
  return factor;
}

const _scratch = new THREE.Vector3();

export interface EarthTextures {
  day: THREE.Texture;
  night: THREE.Texture;
  normal: THREE.Texture;
  clouds: THREE.Texture;
}

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;

  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);

    // Analytic tangent frame for a UV sphere. Cheaper and more stable than
    // computeTangents(): on a sphere the tangent is simply the direction of
    // increasing longitude, which we know in closed form.
    vec3 up = vec3(0.0, 1.0, 0.0);
    vTangentW = normalize(cross(up, vNormalW));
    vBitangentW = cross(vNormalW, vTangentW);

    vec4 world = modelMatrix * vec4(position, 1.0);
    vViewW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uNormal;
  uniform vec3 uSunDir;      // world space, pointing from Earth toward the Sun
  uniform float uNormalScale;
  uniform float uExposure;

  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  varying vec3 vTangentW;
  varying vec3 vBitangentW;

  void main() {
    vec3 nTex = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    nTex.xy *= uNormalScale;
    vec3 n = normalize(
      vTangentW * nTex.x + vBitangentW * nTex.y + vNormalW * nTex.z
    );

    // Lambert against the *geometric* normal for the terminator, so bump detail
    // cannot punch spurious lit pixels through onto the night side.
    float lambertGeo = dot(vNormalW, uSunDir);
    float lambert = max(dot(n, uSunDir), 0.0);

    vec3 day = texture2D(uDay, vUv).rgb;
    vec3 night = texture2D(uNight, vUv).rgb;

    // Terminator width. Earth's real penumbra is about 0.5 degrees, but a knife edge
    // reads as a rendering artefact. Narrowed from the first pass: a wide blend put
    // half the disc in a grey no-man's-land that made the planet look translucent
    // rather than lit.
    float t = smoothstep(-0.045, 0.055, lambertGeo);

    // Sunset reddening: strongest exactly at the terminator, gone by full day.
    float rim = exp(-abs(lambertGeo) * 14.0);
    vec3 sunset = vec3(1.0, 0.42, 0.18) * rim * 0.55;

    // Ambient floor on the lit side. Pure Lambert drives the terminator limb to zero
    // and the planet reads as a translucent shell fading into space; real Earth has
    // atmospheric scattering filling that in.
    vec3 lit = day * (lambert * 0.88 + 0.12);

    // Saturation lift. The Blue Marble composite is radiometrically honest and
    // therefore fairly desaturated; on a black background that reads as grey-brown
    // rather than as the blue planet everyone recognises.
    float lum = dot(lit, vec3(0.2126, 0.7152, 0.0722));
    lit = mix(vec3(lum), lit, 1.35) * 1.18;

    // City lights only where genuinely dark, and never overpowering.
    vec3 dark = night * 1.5 * pow(1.0 - t, 2.0);

    vec3 col = mix(dark, lit, t) + sunset * t * (1.0 - t) * 4.0;

    // Specular glint off water. The ocean mask comes free: the elevation-derived
    // normal map is flat over water, so a near-unperturbed normal means sea.
    float flat_ = smoothstep(0.985, 1.0, nTex.z);
    vec3 h = normalize(uSunDir + vViewW);
    float spec = pow(max(dot(n, h), 0.0), 60.0) * flat_ * t;
    col += vec3(0.55, 0.62, 0.72) * spec * 0.5;

    gl_FragColor = vec4(col * uExposure, 1.0);
  }
`;

/** Fresnel shell for the atmosphere - the blue limb you only see from space. */
const ATMO_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vViewW = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMO_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uSunDir;
  uniform float uOpacity;
  varying vec3 vNormalW;
  varying vec3 vViewW;

  void main() {
    // Rendered on the back faces, so the shell reads as a halo around the limb
    // rather than a film over the disc.
    float fres = pow(1.0 - abs(dot(vNormalW, vViewW)), 3.2);
    float lit = smoothstep(-0.35, 0.5, dot(vNormalW, uSunDir));

    // Rayleigh-ish: blue where the air is thin and lit straight on, warming toward
    // the terminator where the light has travelled through much more atmosphere.
    vec3 col = mix(vec3(0.20, 0.42, 0.95), vec3(1.0, 0.55, 0.30),
                   smoothstep(0.45, 0.0, lit));

    gl_FragColor = vec4(col, fres * lit * uOpacity);
  }
`;

export interface EarthRig {
  group: THREE.Group;
  /** Spun for the diurnal rotation; the tilt lives on `group`. */
  surface: THREE.Mesh;
  clouds: THREE.Mesh;
  setSunDir: (dir: THREE.Vector3) => void;
  setOpacity: (v: number) => void;
  /** True radius in scene units, for the minimum-size logic. */
  radiusUnits: number;
}

export function makeEarth(tex: EarthTextures): EarthRig {
  const R = EARTH_RADIUS_KM * KM;

  for (const t of [tex.day, tex.night, tex.clouds]) {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
  }
  // A normal map is data, not colour: decoding it through sRGB skews every vector.
  tex.normal.colorSpace = THREE.NoColorSpace;
  tex.normal.anisotropy = 8;

  const sunDir = new THREE.Vector3(-1, 0, 0);

  const surfMat = new THREE.ShaderMaterial({
    uniforms: {
      uDay: { value: tex.day },
      uNight: { value: tex.night },
      uNormal: { value: tex.normal },
      uSunDir: { value: sunDir },
      uNormalScale: { value: 1.35 },
      uExposure: { value: 1.0 },
    },
    vertexShader: EARTH_VERT,
    fragmentShader: EARTH_FRAG,
  });

  // 128x64 segments: the silhouette is what gives a planet away, and at the closest
  // approach in Shot 1 the limb fills the frame. Faceting there is unmissable.
  const surface = new THREE.Mesh(new THREE.SphereGeometry(R, 128, 64), surfMat);

  // Clouds use the default (normal) blending with the luminance promoted to alpha in
  // a tiny shader, not additive blending.
  //
  // Additive was the cause of the "see-through" look: additive cloud over dark ocean
  // brightens it, but additive cloud can never *occlude* what is behind it, so the
  // continents showed through every cloud deck and the whole planet read as a
  // translucent shell. Clouds are opaque; they have to be able to hide things.
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex.clouds },
      uSunDir: { value: sunDir },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUvC;
      varying vec3 vNC;
      void main() {
        vUvC = uv;
        vNC = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uMap;
      uniform vec3 uSunDir;
      uniform float uOpacity;
      varying vec2 vUvC;
      varying vec3 vNC;
      void main() {
        vec3 c = texture2D(uMap, vUvC).rgb;
        // White-on-black composite: luminance is the cloud mask.
        float a = clamp(dot(c, vec3(0.33)) * 1.25, 0.0, 1.0);
        float lit = max(dot(vNC, uSunDir), 0.0) * 0.9 + 0.1;
        gl_FragColor = vec4(vec3(1.0) * lit, a * uOpacity * 0.9);
      }
    `,
    transparent: true,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.006, 96, 48), cloudMat);

  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: sunDir }, uOpacity: { value: 1 } },
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.025, 64, 32), atmoMat);

  const spin = new THREE.Group();
  spin.add(surface, clouds, atmo);

  const group = new THREE.Group();
  group.rotation.z = EARTH_TILT_RAD;
  group.add(spin);
  group.userData.spin = spin;

  return {
    group,
    surface,
    clouds,
    setSunDir: (d) => {
      sunDir.copy(d).normalize();
    },
    radiusUnits: R,
    setOpacity: (v) => {
      surfMat.uniforms.uExposure.value = v;
      cloudMat.uniforms.uOpacity.value = v;
      atmoMat.uniforms.uOpacity.value = v;
      group.visible = v > 0.01;
    },
  };
}

/** Rotate the Earth's surface to a given fraction of a sidereal day. */
export function spinEarth(rig: EarthRig, turns: number): void {
  const spin = rig.group.userData.spin as THREE.Group;
  spin.rotation.y = turns * Math.PI * 2;
  // Clouds drift slightly slower than the ground, which sells the separation of the
  // two shells far more cheaply than any amount of extra geometry.
  rig.clouds.rotation.y = turns * Math.PI * 2 * -0.03;
}

const SUN_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  uniform float uDiscFrac;   // photosphere radius as a fraction of the billboard
  varying vec2 vUvS;

  void main() {
    vec2 p = (vUvS - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;

    // The photosphere: a small, hard, white disc. Its edge is nearly a step - the Sun
    // has a sharp limb, and softening it is what made the first version read as a
    // vague glowing blob rather than a star.
    float disc = 1.0 - smoothstep(uDiscFrac * 0.88, uDiscFrac * 1.12, r);

    // Inner corona, falling off steeply, then an outer halo that carries much further.
    // Two exponentials rather than one: a single falloff cannot be both tight enough
    // at the limb and wide enough to feel like glare.
    float inner = exp(-pow(max(0.0, r - uDiscFrac) / (uDiscFrac * 1.6), 1.15)) * 0.55;
    float outer = pow(max(0.0, 1.0 - r), 3.0) * 0.30;

    // Faint radial striation in the corona. Real coronal streamers are not uniform,
    // and a perfectly smooth halo looks like a lens artefact.
    float ang = atan(p.y, p.x);
    float streak = 0.06 * (sin(ang * 9.0) * 0.5 + 0.5) * exp(-r * 2.2);

    vec3 core  = vec3(1.0, 0.99, 0.96);
    vec3 warm  = vec3(1.0, 0.83, 0.55);
    vec3 amber = vec3(1.0, 0.60, 0.26);

    vec3 col = core * disc
             + warm * inner
             + amber * (outer + streak);

    float a = clamp(disc + inner + outer + streak, 0.0, 1.0);
    gl_FragColor = vec4(col, a * uOpacity);
  }
`;

const SUN_VERT = /* glsl */ `
  varying vec2 vUvS;
  void main() {
    vUvS = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export interface SunRig {
  sprite: THREE.Mesh;
  setOpacity: (v: number) => void;
  /** Keep the billboard square-on to the camera and hold a readable size. */
  update: (camera: THREE.PerspectiveCamera, viewportHeight: number) => void;
}

/**
 * The Sun as a camera-facing billboard sized from its real angular diameter.
 *
 * At 1 AU the Sun subtends half a degree - about 13 pixels across in a 40-degree
 * field on a 1080-line frame. The first version simply scaled the sprite up by 26x
 * so it would be easy to see, which is why it read as "a random dot that is too
 * big": an eight-degree Sun is not a Sun, it is a lamp.
 *
 * Instead the photosphere is drawn at its true angular size with a floor so it never
 * disappears, and everything that makes it *look* like the Sun - corona, glare,
 * streamers - lives outside the disc where it belongs. Glare in a real image extends
 * far past the source; the disc itself does not.
 */
export function makeSun(): SunRig {
  const trueRadius = SUN_RADIUS_KM * KM;
  // The billboard is much larger than the photosphere so the corona has somewhere to
  // go; uDiscFrac tells the shader where the actual edge of the star is.
  const HALO_MULTIPLE = 9;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 1 },
      uDiscFrac: { value: 1 / HALO_MULTIPLE },
    },
    vertexShader: SUN_VERT,
    fragmentShader: SUN_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  sprite.renderOrder = -100;
  sprite.frustumCulled = false;

  return {
    sprite,
    setOpacity: (v) => {
      mat.uniforms.uOpacity.value = v;
      sprite.visible = v > 0.01;
    },
    update: (camera, viewportHeight) => {
      sprite.quaternion.copy(camera.quaternion);

      const distance = camera.position.distanceTo(sprite.getWorldPosition(_scratch));
      const halfHeightWorld = Math.tan((camera.fov * Math.PI) / 360) * distance;
      const pxPerUnit = viewportHeight / 2 / halfHeightWorld;

      // Photosphere radius in pixels, floored so it stays visible from anywhere in
      // the sequence, then converted back into a billboard scale.
      const truePx = trueRadius * pxPerUnit;
      const discPx = Math.max(truePx, 7);
      const haloWorld = (discPx * HALO_MULTIPLE) / pxPerUnit;
      sprite.scale.setScalar(haloWorld);
    },
  };
}

/**
 * A body that would be sub-pixel at the current camera distance, drawn as a marker
 * so it stays findable.
 *
 * Used for the Earth in the 1-AU wide shot, where its true angular size is about a
 * thousandth of a pixel. The shot displays the exaggeration factor while this is on
 * screen - the marker is a label, not a claim about size.
 */
export function makeMarker(color: number, sizePx = 9): THREE.Points {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uSize: { value: sizePx },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uSize;
      uniform float uPixelRatio;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = smoothstep(0.55, 0.0, r);
        float halo = pow(max(0.0, 1.0 - r), 2.0) * 0.4;
        gl_FragColor = vec4(uColor * (core + halo), (core + halo) * uOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(geo, mat);
  p.frustumCulled = false;
  p.renderOrder = 900;
  return p;
}
