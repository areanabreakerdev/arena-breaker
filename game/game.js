import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/* =====================================================================
   ARENA BREAKER - 3-minute free-for-all physics shooter
   - you + 7 bots, every fighter has its own avatar, look and kill count
   - bots fight EACH OTHER (they target whoever is closest and visible)
   - slide + slide-jump, view bobbing, pickups, kill streaks
   - cannon-es rigid bodies: ballistics, ragdolls, destructibles, explosions
   ===================================================================== */

const $ = (id) => document.getElementById(id);
const GRAV = 9.82;
const GRP = { STATIC: 1, PLAYER: 2, ENEMY: 4, PROP: 8, DEBRIS: 16, RAG: 32 };
const ALL = 0xffff;
const BULLET_IMPULSE = 32; // kg*m/s a rifle round gives to physics props
let ROUND_TIME = 180;    // seconds (menu can change it)
const RESPAWN_TIME = 3;
const SLIDE_TIME = 0.95;
const BOB_STRENGTH = 1.0;  // 1 = medium. Lower = calmer, higher = stronger
const rand = (a, b) => a + Math.random() * (b - a);
const hexCss = (c) => '#' + c.toString(16).padStart(6, '0');
const lerpAngle = (a, b, t) => {
  const d = ((((b - a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  return a + d * t;
};

/* ------------------------------ roster / avatars ------------------------------ */
const HALLOWEEN = (() => { const d = new Date(), m = d.getMonth(), day = d.getDate(); return (m === 9 && day >= 20) || (m === 10 && day <= 7); })(); // limited-time event: Oct 20 - Nov 7
const ROSTER_DEF = [
  { id: 'you', name: 'YOU', emoji: '🎯', color: 0xe8862a, accent: 0xffc266, skin: 0xe0b090, legs: 0x3a2f25, hat: 'cap', skill: 1, isPlayer: true },
  { id: 'rex', name: 'Rex', emoji: '🦖', color: 0x3f8f3a, accent: 0x9dff7a, skin: 0x7fbf5a, legs: 0x23422a, hat: 'horns', skill: 0.75 },
  { id: 'nova', name: 'Nova', emoji: '🚀', color: 0x6c3fc4, accent: 0xc9a6ff, skin: 0xd9a77f, legs: 0x2a2147, hat: 'visor', skill: 0.9 },
  { id: 'blaze', name: 'Blaze', emoji: '🔥', color: 0xc23b22, accent: 0xffb347, skin: 0xc98e6b, legs: 0x3a1a14, hat: 'mohawk', skill: 0.8 },
  { id: 'frost', name: 'Frost', emoji: '❄️', color: 0x2fa7c9, accent: 0xb5f1ff, skin: 0xf0d5c0, legs: 0x1d3d4a, hat: 'halo', skill: 0.85 },
  { id: 'shadow', name: 'Shadow', emoji: '🥷', color: 0x2a2c33, accent: 0x8f9bff, skin: 0x8d5a3b, legs: 0x111214, hat: 'helmet', skill: 0.95 },
  { id: 'goldie', name: 'Goldie', emoji: '👑', color: 0xd4a72c, accent: 0xfff0a0, skin: 0xe8c39e, legs: 0x5a4710, hat: 'crown', skill: 0.7 },
  { id: 'pixel', name: 'Pixel', emoji: '🤖', color: 0xd94f9a, accent: 0xff9bd2, skin: 0xb8c4cc, legs: 0x4a1e38, hat: 'antenna', skill: 1.0 },
];
if (HALLOWEEN) {
  const hw = { rex: ['Zombie', '🧟', 0x4f7a3a, 0x9dff7a, 0x6f9a52, 'bolts'], nova: ['Witch', '🧙', 0x4b2a82, 0xff9a2e, 0xa0c080, 'witch'], blaze: ['Jack', '🎃', 0xc2561a, 0xffd24a, 0xc98e6b, 'pumpkin'], frost: ['Ghost', '👻', 0xcfd8e8, 0xb5f1ff, 0xf4f6fa, 'halo'], shadow: ['Reaper', '💀', 0x1a1a24, 0xff4a4a, 0xe8e4d6, 'hood'], goldie: ['Vlad', '🧛', 0x5a1224, 0xff3b3b, 0xe9e0e0, 'vamp'], pixel: ['Batty', '🦇', 0x2a1d3a, 0xc06bff, 0x6a5a7a, 'batears'] };
  for (const d of ROSTER_DEF) { const h = hw[d.id]; if (h) Object.assign(d, { name: h[0], emoji: h[1], color: h[2], accent: h[3], skin: h[4], hat: h[5] }); }
}
const roster = ROSTER_DEF.map((d) => ({ ...d, kills: 0, deaths: 0, streak: 0, lastKillT: -99, multi: 0, enemy: null }));
const KIT_BY = ['rifle', 'smg', 'shotgun', 'rifle', 'sniper', 'smg', 'rifle', 'shotgun'];
roster.forEach((r, i) => { r.kit = KIT_BY[i] || 'rifle'; });
const playerInfo = roster[0];
const avHtml = (info, sm = false) =>
  `<span class="av${sm ? ' sm' : ''}" style="background:${hexCss(info.color)}">${info.emoji}</span>`;

/* ------------------------------ renderer ------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true });
const MAX_PR = Math.min(window.devicePixelRatio, 1.25);
let pixelRatio = MAX_PR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc3e6);
scene.fog = new THREE.Fog(0x9cc3e6, 35, 120);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xdfeeff, 0x4a4036, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
sun.position.set(25, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(1536, 1536);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 120 });
sun.shadow.bias = -0.0006;
scene.add(sun);

// Fixed pool of lights (changing the light count at runtime would recompile shaders)
const muzzleLight = new THREE.PointLight(0xffb060, 0, 9);
muzzleLight.position.set(0.2, -0.1, -0.8);
camera.add(muzzleLight);
const boomLights = [0, 1].map(() => {
  const l = new THREE.PointLight(0xff9040, 0, 30);
  scene.add(l);
  return l;
});
let boomLightIdx = 0;

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

/* ------------------------------ textures & materials ------------------------------ */
function canvasTex(size, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const groundTex = canvasTex(256, (g, s) => {
  g.fillStyle = '#6b6f66'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 3000; i++) {
    const v = (90 + Math.random() * 50) | 0;
    g.fillStyle = `rgb(${v},${v + 3},${v - 4})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
}, 31, 31);
const woodTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#9a6b3a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(60,35,10,${Math.random() * 0.25})`;
    g.beginPath();
    const y = Math.random() * s;
    g.moveTo(0, y); g.lineTo(s, y + Math.random() * 6 - 3); g.stroke();
  }
  g.strokeStyle = '#5a3a18'; g.lineWidth = 8; g.strokeRect(0, 0, s, s);
  g.lineWidth = 5; g.beginPath();
  g.moveTo(0, 0); g.lineTo(s, s); g.moveTo(s, 0); g.lineTo(0, s); g.stroke();
});

const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 });
const crateMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.85 });
const barrelMat = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.45, metalness: 0.45 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x74777b, roughness: 0.9 });
const coverMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.9 });
let coverTexSet = false;

/* ------------------------------ physics world ------------------------------ */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -GRAV, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 14;
world.defaultContactMaterial.friction = 0.45;
world.defaultContactMaterial.restitution = 0.08;

const matSlip = new CANNON.Material('slip');     // player + bots (no friction, they glide)
const matBouncy = new CANNON.Material('bouncy'); // grenades
const matProp = new CANNON.Material('prop');     // ground, walls, crates, barrels, debris, ragdolls
world.addContactMaterial(new CANNON.ContactMaterial(matProp, matProp, { friction: 0.45, restitution: 0.08 }));
world.addContactMaterial(new CANNON.ContactMaterial(matSlip, matProp, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(matSlip, matSlip, { friction: 0, restitution: 0 }));
world.addContactMaterial(new CANNON.ContactMaterial(matBouncy, matProp, { friction: 0.35, restitution: 0.55 }));
world.addContactMaterial(new CANNON.ContactMaterial(matBouncy, matSlip, { friction: 0, restitution: 0.3 }));

const synced = new Set(); // bodies whose mesh follows them
function track(body, mesh) {
  body.userData = body.userData || {};
  body.userData.mesh = mesh;
  synced.add(body);
  world.addBody(body);
  scene.add(mesh);
}
function untrack(body) {
  world.removeBody(body);
  const m = body.userData && body.userData.mesh;
  if (m) scene.remove(m);
  synced.delete(body);
}
function wakeNear(p, r) {
  for (const b of synced) if (b.sleepState === CANNON.Body.SLEEPING && b.position.distanceTo(p) < r) b.wakeUp();
}

const _ray = new CANNON.RaycastResult();
function rayCast(from, to, mask) {
  _ray.reset();
  const has = world.raycastClosest(from, to, { collisionFilterMask: mask, skipBackfaces: true }, _ray);
  if (!has || !_ray.hasHit) return null;
  return {
    body: _ray.body,
    point: _ray.hitPointWorld.clone(),
    normal: _ray.hitNormalWorld.clone(),
    dist: _ray.distance,
  };
}

/* ------------------------------ maps & level ------------------------------ */
const ARENA = 31;
const coverRects = [];   // oriented rectangles of all cover; keeps spawns, pickups and props clear of it
const propSpots = [];
const PICKUP_SPOTS = [];
const SPAWNS = [];

function makeGroundTex(g0) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = g0.base; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 3200; i++) {
      g.fillStyle = Math.random() < 0.5
        ? `rgba(255,255,255,${rand(0.03, 0.13).toFixed(3)})`
        : `rgba(0,0,0,${rand(0.03, 0.15).toFixed(3)})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    g.strokeStyle = g0.line; g.lineWidth = 3; g.strokeRect(0, 0, s, s);
  }, 31, 31);
}

function applyTheme(t) {
  scene.background.setHex(t.sky);
  scene.fog.color.setHex(t.sky);
  scene.fog.near = t.fogNear;
  scene.fog.far = t.fogFar;
  hemi.color.setHex(t.hemiSky);
  hemi.groundColor.setHex(t.hemiGround);
  hemi.intensity = t.hemiInt;
  sun.color.setHex(t.sunColor);
  sun.intensity = t.sunInt;
  sun.position.set(t.sunPos[0], t.sunPos[1], t.sunPos[2]);
  wallMat.color.setHex(t.wall);
  coverMat.color.setHex(t.cover);
}

const MAPS = [
  {
    id: 'yard', icon: '🏭', name: 'CONCRETE YARD',
    blurb: 'Open daylight arena. Scattered concrete cover, crate stacks and explosive barrels. Good at any range.',
    preview: ['#9cc3e6', '#6b6f66'],
    theme: {
      sky: 0x9cc3e6, fogNear: 35, fogFar: 120,
      hemiSky: 0xdfeeff, hemiGround: 0x4a4036, hemiInt: 1.0,
      sunColor: 0xfff1d6, sunInt: 2.4, sunPos: [25, 40, 15],
      wall: 0x74777b, cover: 0x8a8d90,
      ground: { base: '#6b6f66', line: 'rgba(0,0,0,.35)' },
    },
    crates: 9, barrels: 9, build: buildYard, decor: yardDecor,
  },
  {
    id: 'docks', icon: '🚢', name: 'SUNSET DOCKS',
    blurb: 'Shipping containers form long lanes and tight alleys. Close-quarters fights and lots of barrels.',
    preview: ['#e9a066', '#3d3d43'],
    theme: {
      sky: 0xe9a066, fogNear: 30, fogFar: 110,
      hemiSky: 0xffd9b0, hemiGround: 0x3a2e2a, hemiInt: 0.95,
      sunColor: 0xffa860, sunInt: 2.7, sunPos: [-38, 15, 22],
      wall: 0x5c4a42, cover: 0xa39a90,
      ground: { base: '#3d3d43', line: 'rgba(0,0,0,.3)' },
    },
    crates: 6, barrels: 12, build: buildDocks, decor: docksDecor,
  },
  {
    id: 'ruins', icon: '🏛️', name: 'FROZEN RUINS',
    blurb: 'Snowy ruins around a walled fort with four gates. Misty, with long sightlines outside and a brawl inside.',
    preview: ['#d2e0ec', '#dbe5ed'],
    theme: {
      sky: 0xd2e0ec, fogNear: 16, fogFar: 78,
      hemiSky: 0xeef6ff, hemiGround: 0x8da2b6, hemiInt: 1.2,
      sunColor: 0xeaf2ff, sunInt: 1.8, sunPos: [20, 36, -26],
      wall: 0x8d959d, cover: 0xa2a9b0,
      ground: { base: '#dbe5ed', line: 'rgba(110,135,160,.28)' },
    },
    crates: 5, barrels: 6, build: buildRuins, decor: ruinsDecor,
  },
  {
    id: 'factory', icon: '⚡', name: 'NEON FACTORY',
    blurb: 'Night shift. Glowing conveyor lanes, a pulsing reactor in the middle and tall neon towers in every corner.',
    preview: ['#0b1030', '#1b2236'],
    theme: {
      sky: 0x070a1a, fogNear: 18, fogFar: 88,
      hemiSky: 0x5a6cff, hemiGround: 0x1a1030, hemiInt: 0.75,
      sunColor: 0x7a8cff, sunInt: 0.7, sunPos: [-20, 40, 12],
      wall: 0x2a3148, cover: 0x434c6c,
      ground: { base: '#1b2030', line: 'rgba(61,224,255,.28)' },
    },
    crates: 7, barrels: 9, build: buildFactory, decor: factoryDecor,
  },
];

function addStaticBox(x, y, z, w, h, d, mat, rot = 0) {
  const b = new CANNON.Body({
    mass: 0,
    material: matProp,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
    position: new CANNON.Vec3(x, y, z),
    collisionFilterGroup: GRP.STATIC,
    collisionFilterMask: ALL,
  });
  if (rot) b.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), rot);
  world.addBody(b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = rot; // same rotation convention as the physics body
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return { body: b, mesh: m };
}
// a piece of cover standing on the ground; also registered so nothing spawns inside it
function addCover(x, z, w, h, d, mat, rot = 0) {
  coverRects.push({ x, z, hw: w / 2, hd: d / 2, c: Math.cos(rot), s: Math.sin(rot) });
  return addStaticBox(x, h / 2, z, w, h, d, mat, rot);
}
function clearSpot(x, z, clr) {
  if (Math.abs(x) > ARENA - 2 || Math.abs(z) > ARENA - 2) return false;
  for (const r of coverRects) {
    const dx = x - r.x, dz = z - r.z;
    const u = dx * r.c - dz * r.s, v = dx * r.s + dz * r.c; // world offset -> the box's local axes
    if (Math.max(Math.abs(u) - r.hw, Math.abs(v) - r.hd) < clr) return false;
  }
  for (const p of propSpots) if (Math.hypot(p.x - x, p.z - z) < clr + 1.2) return false;
  for (const p of PICKUP_SPOTS) if (Math.hypot(p[0] - x, p[1] - z) < clr + 1) return false;
  return true;
}
function randomSpot(clr, range = ARENA - 5) {
  for (let i = 0; i < 400; i++) {
    const x = rand(-range, range), z = rand(-range, range);
    if (clearSpot(x, z, clr)) return { x, z };
  }
  return null;
}

/* ---- map layouts ---- */
function buildYard() {
  for (let i = 0; i < 12; i++) {
    let x = 0, z = 0;
    for (let t = 0; t < 120; t++) {
      x = rand(-23, 23); z = rand(-23, 23);
      if (Math.hypot(x, z) > 6 && clearSpot(x, z, 1.5)) break;
    }
    addCover(x, z, rand(2.5, 5), rand(1.4, 2.6), rand(1, 1.6), coverMat, rand(0, Math.PI));
  }
}

let containerMats = null;
function getContainerMats() {
  if (!containerMats) {
    containerMats = [0xb23a2e, 0x2f6db5, 0x2e8b57, 0xd98a1f, 0xe0c53a, 0x7a4fb0, 0x4e5b66].map((c) =>
      new THREE.MeshStandardMaterial({
        map: canvasTex(128, (g, s) => {
          g.fillStyle = hexCss(c); g.fillRect(0, 0, s, s);
          for (let i = 0; i < 16; i++) {
            g.fillStyle = i % 2 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.06)';
            g.fillRect(i * 8, 0, 4, s);
          }
          g.fillStyle = 'rgba(0,0,0,0.35)';
          g.fillRect(0, 0, s, 5); g.fillRect(0, s - 5, s, 5);
        }, 3, 1),
        roughness: 0.6, metalness: 0.35,
      })
    );
  }
  return containerMats;
}
function buildDocks() {
  const mats = getContainerMats();
  const cells = [-21, -7, 7, 21];
  const pick = () => mats[(Math.random() * mats.length) | 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      if (Math.random() < 0.14) continue; // random gaps keep the lanes interesting
      const x = cells[i] + rand(-1.2, 1.2), z = cells[j] + rand(-1.2, 1.2);
      const rot = (i + j) % 2 === 0 ? 0 : Math.PI / 2;
      decorContainer(addCover(x, z, 7.2, 2.6, 2.5, pick(), rot).mesh, 7.2);
      if (Math.random() < 0.3) decorContainer(addStaticBox(x, 2.6 + 1.3, z, 7.2, 2.6, 2.5, pick(), rot).mesh, 7.2); // stacked
    }
  }
  for (let i = 0; i < 9; i++) { // low barriers you can jump over
    const s = randomSpot(1.4);
    if (s) addCover(s.x, s.z, 2.8, 1.0, 0.7, coverMat, rand(0, Math.PI));
  }
}

function buildRuins() {
  const H = 3.4, T = 1.2;
  for (let k = 0; k < 4; k++) { // fort walls with a gate in the middle of each side
    const a = (k * Math.PI) / 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (const u of [-5.4, 5.4]) {
      const v = 9;
      addCover(u * ca - v * sa, u * sa + v * ca, 6.6, H * rand(0.85, 1), T, coverMat, -a);
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCover(sx * 9.3, sz * 9.3, 1.8, 4.3, 1.8, coverMat, 0);
  for (let k = 0; k < 12; k++) { // ring of broken pillars
    const ang = (k / 12) * Math.PI * 2 + rand(-0.12, 0.12);
    const r = 21 + rand(-1.5, 1.5);
    const ph = rand(2.4, 5.2), pm = addCover(Math.cos(ang) * r, Math.sin(ang) * r, 1.5, ph, 1.5, coverMat, -ang).mesh;
    dbox(2, 0.35, 2, 0, -ph / 2 + 0.17, 0, coverMat, 0, false, pm); dbox(1.9, 0.3, 1.9, 0, ph / 2 + 0.1, 0, coverMat, 0, false, pm); dbox(1.6, 0.25, 0.4, 0.3, ph / 2 + 0.4, 0.3, coverMat, 0.5, false, pm);
  }
  for (let i = 0; i < 9; i++) { // low broken walls you can jump onto
    const s = randomSpot(1.6);
    if (s) addCover(s.x, s.z, rand(3.5, 6), rand(1.0, 1.3), 0.9, coverMat, rand(0, Math.PI));
  }
}

function buildFactory() {
  const H = 1.3;
  for (const sx of [-1, 1]) addCover(sx * 13, 0, 2.6, H, 22, coverMat, 0); // long conveyor blocks, jumpable
  for (const sz of [-1, 1]) addCover(0, sz * 13, 22, H, 2.6, coverMat, 0);
  addCover(0, 0, 5.4, 3.4, 5.4, coverMat, 0); // reactor housing
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCover(sx * 24, sz * 24, 3.4, 5.2, 3.4, coverMat, 0); // corner towers
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCover(sx * 6.5, sz * 6.5, 1.6, 2.2, 1.6, coverMat, 0); // pillars
  for (let i = 0; i < 9; i++) {
    const s = randomSpot(1.6);
    if (s) addCover(s.x, s.z, rand(2.2, 4.2), rand(1.2, 2.4), rand(1, 1.6), coverMat, rand(0, Math.PI));
  }
}
function factoryDecor() {
  const glow = (c, i = 2.2) => dmat(c, { emissive: c, emissiveIntensity: i, roughness: 0.3 });
  const cy = glow(0x3de0ff), mg = glow(0xff3de0), am = glow(0xffa22e, 1.8);
  const dark = dmat(0x1a1f2e, { roughness: 0.6, metalness: 0.5 });
  // glowing lane lines on the floor and strips along the boundary walls
  for (const sx of [-1, 1]) dbox(0.25, 0.04, 56, sx * 9.2, 0.03, 0, cy);
  for (const sz of [-1, 1]) dbox(56, 0.04, 0.25, 0, 0.03, sz * 9.2, mg);
  dbox(ARENA * 2, 0.16, 0.1, 0, 2.2, -ARENA + 0.05, cy); dbox(ARENA * 2, 0.16, 0.1, 0, 2.2, ARENA - 0.05, cy);
  dbox(0.1, 0.16, ARENA * 2, -ARENA + 0.05, 2.2, 0, mg); dbox(0.1, 0.16, ARENA * 2, ARENA - 0.05, 2.2, 0, mg);
  // conveyor belts: dark strip with moving-looking chevrons
  for (const sx of [-1, 1]) { dbox(2.2, 0.06, 21, sx * 13, H_TOP(1.3), 0, dark); for (let i = -4; i <= 4; i++) dbox(1.6, 0.03, 0.18, sx * 13, H_TOP(1.3) + 0.04, i * 2.2, am); }
  for (const sz of [-1, 1]) { dbox(21, 0.06, 2.2, 0, H_TOP(1.3), sz * 13, dark); for (let i = -4; i <= 4; i++) dbox(0.18, 0.03, 1.6, i * 2.2, H_TOP(1.3) + 0.04, sz * 13, am); }
  // reactor
  const core = dcyl(1.0, 3.6, 0, 3.9, 0, mg);
  const ring1 = dput(UC, cy, 0, 4.6, 0, 2.3, 0.14, 2.3), ring2 = dput(UC, cy, 0, 3.3, 0, 2.0, 0.14, 2.0);
  const rl = new THREE.PointLight(0xff3de0, 14, 26, 2); rl.position.set(0, 5.4, 0); scene.add(rl);
  mapAnim.push((dt) => { ring1.rotation.y += dt * 1.6; ring2.rotation.y -= dt * 1.1; rl.intensity = 12 + Math.sin(gameTime * 3) * 3.5; core.scale.set(1 + Math.sin(gameTime * 3) * 0.06, 1, 1 + Math.sin(gameTime * 3) * 0.06); });
  // towers: neon caps and coloured lights
  const tl = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    dbox(3.6, 0.22, 3.6, sx * 24, 5.3, sz * 24, (sx * sz > 0) ? cy : mg);
    const l = new THREE.PointLight((sx * sz > 0) ? 0x3de0ff : 0xff3de0, 9, 22, 2); l.position.set(sx * 22, 4.6, sz * 22); scene.add(l); tl.push(l);
  }
  for (const [x, z] of [[-6.5, -6.5], [6.5, -6.5], [-6.5, 6.5], [6.5, 6.5]]) dbox(1.8, 0.14, 1.8, x, 2.25, z, am);
  // overhead pipes and distant factory skyline
  const pipe = dmat(0x2b3348, { roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(58, 84), h = rand(14, 38), w = rand(8, 16);
    dput(UB, dark, Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r, w, h, w * 0.8, rand(0, 3));
    for (let k = 0; k < 5; k++) dput(UB, Math.random() < 0.5 ? cy : am, Math.cos(a) * (r - w * 0.42), rand(3, h - 2), Math.sin(a) * (r - w * 0.42), 0.8, 0.5, 0.8, 0);
    if (i % 4 === 0) dput(UC, pipe, Math.cos(a) * r, h + 3, Math.sin(a) * r, 1.1, 9, 1.1, 0);
  }
  // rising sparks
  const N = 420, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-36, 36); pos[i * 3 + 1] = rand(0, 20); pos[i * 3 + 2] = rand(-36, 36); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sp = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x66f0ff, size: 0.14, transparent: true, opacity: 0.8, depthWrite: false }));
  sp.frustumCulled = false; scene.add(sp);
  mapAnim.push((dt) => { const p = sg.attributes.position.array; for (let i = 0; i < N; i++) { p[i * 3 + 1] += dt * (0.8 + (i % 5) * 0.3); p[i * 3] += Math.sin(gameTime + i) * dt * 0.3; if (p[i * 3 + 1] > 20) p[i * 3 + 1] = 0; } sg.attributes.position.needsUpdate = true; });
}
const H_TOP = (h) => h + 0.04;

/* ---- HALLOWEEN event (turns itself off after Nov 7) ---- */
function pumpkin(x, z, s = 1, lit = false) {
  const body = dput(US, dmat(0xff7a1a, { emissive: 0xff4a00, emissiveIntensity: 0.5, roughness: 0.6 }), x, 0.4 * s, z, 0.55 * s, 0.45 * s, 0.55 * s, rand(0, 6.28), true);
  dput(UC, dmat(0x2f6a22), 0, 1.0, 0, 0.14, 0.32, 0.14, 0, false, body);
  const glow = dmat(0xffe066, { emissive: 0xffd24a, emissiveIntensity: 2 });
  for (const sx of [-1, 1]) dput(UB, glow, sx * 0.36, 0.18, 0.92, 0.2, 0.26, 0.12, 0, false, body);
  dput(UB, glow, 0, -0.28, 0.93, 0.6, 0.14, 0.12, 0, false, body);
  coverRects.push({ x, z, hw: 0.4 * s, hd: 0.4 * s, c: 1, s: 0 });
  addStaticBox(x, 0.4 * s, z, 0.7 * s, 0.8 * s, 0.7 * s, coverMat).mesh.visible = false;
  if (lit) { const l = new THREE.PointLight(0xff8a2a, 5, 10, 2); l.position.set(x, 1.1 * s, z); scene.add(l); return l; }
  return null;
}
function halloweenDecor(n) {
  const lights = [];
  for (let i = 0; i < n; i++) {
    const sp = randomSpot(1.2);
    if (!sp) continue;
    const l = pumpkin(sp.x, sp.z, rand(0.8, 1.5), i < 3);
    if (l) lights.push(l);
  }
  mapAnim.push(() => { for (const l of lights) l.intensity = 4 + Math.random() * 1.6; });
}
function buildGraveyard() {
  const H = 3.0, T = 1.0;
  for (let k = 0; k < 4; k++) { // crypt walls with a gate in the middle of each side
    const a = (k * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const u of [-3.3, 3.3]) { const v = 4.6; addCover(u * ca - v * sa, u * sa + v * ca, 3.4, H, T, coverMat, -a); }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addCover(sx * 16, sz * 11, 4.2, 1.5, 2, coverMat, 0.4 * sx * sz); // stone tombs
  for (let i = 0; i < 20; i++) { const s = randomSpot(1.2); if (s) addCover(s.x, s.z, rand(0.9, 1.4), rand(1.0, 1.8), 0.35, coverMat, rand(-0.5, 0.5)); } // tombstones
  for (let i = 0; i < 4; i++) { const s = randomSpot(1.8); if (s) addCover(s.x, s.z, rand(3, 5), rand(1.1, 1.4), 0.8, coverMat, rand(0, Math.PI)); } // broken walls
}
function graveyardDecor() {
  const wood = dmat(0x2a2018, { roughness: 1 }), stone = dmat(0x5a5868, { roughness: 1 });
  const tree = (x, z, h) => {
    dput(UC, wood, x, h / 2, z, 0.3, h, 0.3, 0, true);
    for (let i = 0; i < 6; i++) { const y = h * (0.4 + i * 0.09), a = i * 2.1; dput(UC, wood, x + Math.cos(a) * 0.7, y + 0.3, z + Math.sin(a) * 0.7, 0.09, 1.6, 0.09, 0, false, scene, Math.sin(a) * 1.0, -Math.cos(a) * 1.0); }
    coverRects.push({ x, z, hw: 0.45, hd: 0.45, c: 1, s: 0 }); addStaticBox(x, h / 2, z, 0.7, h, 0.7, coverMat).mesh.visible = false;
  };
  for (const [x, z] of [[-27, -25], [27, 26], [-28, 15], [26, -18], [-14, 27], [9, -28], [-8, 28], [28, 4], [-26, 2]]) tree(x, z, rand(5, 7.5));
  for (let i = 0; i < 9; i++) { const sp = randomSpot(0.8); if (sp) { dbox(0.16, 1.5, 0.16, sp.x, 0.75, sp.z, stone, 0, true); dbox(0.8, 0.16, 0.16, sp.x, 1.15, sp.z, stone, 0, true); } } // crosses
  const gate = dmat(0x15151c, { roughness: 0.7, metalness: 0.6 });
  for (let i = -6; i <= 6; i++) { dbox(0.1, 1.9, 0.1, i * 4.6, 0.95, -ARENA + 0.3, gate); dbox(0.1, 1.9, 0.1, i * 4.6, 0.95, ARENA - 0.3, gate); dbox(0.1, 1.9, 0.1, -ARENA + 0.3, 0.95, i * 4.6, gate); dbox(0.1, 1.9, 0.1, ARENA - 0.3, 0.95, i * 4.6, gate); }
  const crypt = new THREE.PointLight(0x55ff88, 8, 14, 2); crypt.position.set(0, 2.2, 0); scene.add(crypt);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf4efcf, fog: false }));
  moon.position.set(-55, 48, -70); scene.add(moon);
  dput(UC, dmat(0x14101c), 0, 4.2, 0, 3.2, 0.5, 3.2); // crypt roof slab
  halloweenDecor(9);
  const N = 380, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-36, 36); pos[i * 3 + 1] = rand(0, 7); pos[i * 3 + 2] = rand(-36, 36); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const wisps = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x7dffa0, size: 0.2, transparent: true, opacity: 0.75, depthWrite: false }));
  wisps.frustumCulled = false; scene.add(wisps);
  let flash = rand(6, 12);
  mapAnim.push((dt) => {
    const p = sg.attributes.position.array;
    for (let i = 0; i < N; i++) { p[i * 3 + 1] += dt * (0.3 + (i % 4) * 0.15); p[i * 3] += Math.sin(gameTime * 0.8 + i) * dt * 0.4; if (p[i * 3 + 1] > 7) p[i * 3 + 1] = 0; }
    sg.attributes.position.needsUpdate = true;
    flash -= dt; // distant lightning
    if (flash < 0) { hemi.intensity = 3.2; if (flash < -0.12) { hemi.intensity = 0.8; flash = rand(7, 15); } }
  });
}
if (HALLOWEEN) {
  MAPS.push({
    id: 'graveyard', icon: '🎃', name: 'HAUNTED GRAVEYARD',
    blurb: 'LIMITED TIME. A moonlit graveyard with a glowing crypt, crooked tombstones, lit pumpkins and lightning.',
    preview: ['#1a1030', '#26331f'],
    theme: {
      sky: 0x0e0a1e, fogNear: 14, fogFar: 72,
      hemiSky: 0x7a6ab0, hemiGround: 0x1a0f1a, hemiInt: 0.8,
      sunColor: 0x9ab0ff, sunInt: 0.9, sunPos: [-30, 38, -20],
      wall: 0x2b2a3a, cover: 0x4e4c60,
      ground: { base: '#1f2a1c', line: 'rgba(120,255,140,.14)' },
    },
    crates: 4, barrels: 5, build: buildGraveyard, decor: graveyardDecor,
  });
}

/* ---- props ---- */
const crateGeo = new THREE.BoxGeometry(1, 1, 1);
function addCrate(x, y, z, s = 1) {
  const body = new CANNON.Body({
    mass: 18 * s * s * s,
    material: matProp,
    shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)),
    position: new CANNON.Vec3(x, y, z),
    collisionFilterGroup: GRP.PROP,
    collisionFilterMask: ALL,
    sleepSpeedLimit: 0.2,
    sleepTimeLimit: 0.6,
    linearDamping: 0.05,
    angularDamping: 0.2,
  });
  body.userData = { type: 'crate', hp: 60 * s };
  const mesh = new THREE.Mesh(crateGeo, crateMat);
  mesh.scale.setScalar(s);
  mesh.castShadow = mesh.receiveShadow = true;
  track(body, mesh);
  return body;
}
const barrelGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.2, 16);
function addBarrel(x, z) {
  const body = new CANNON.Body({
    mass: 28,
    material: matProp,
    shape: new CANNON.Box(new CANNON.Vec3(0.42, 0.6, 0.42)),
    position: new CANNON.Vec3(x, 0.62, z),
    collisionFilterGroup: GRP.PROP,
    collisionFilterMask: ALL,
    sleepSpeedLimit: 0.2,
    sleepTimeLimit: 0.6,
    angularDamping: 0.3,
  });
  body.userData = { type: 'barrel', hp: 40 };
  const mesh = new THREE.Mesh(barrelGeo, barrelMat);
  mesh.castShadow = mesh.receiveShadow = true;
  track(body, mesh);
  return body;
}
function placeProps(clusters, barrels) {
  for (let c = 0; c < clusters; c++) {
    const s = randomSpot(2.2);
    if (!s) continue;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) addCrate(s.x + i * 1.03, 0.5, s.z + j * 1.03);
    addCrate(s.x + 0.52, 1.55, s.z + 0.52);
    propSpots.push({ x: s.x + 0.5, z: s.z + 0.5 });
  }
  for (let i = 0; i < barrels; i++) {
    const s = randomSpot(1.6);
    if (!s) continue;
    addBarrel(s.x, s.z);
    propSpots.push({ x: s.x, z: s.z });
  }
}

/* ---- pickups ---- */
const pickups = [];
const healthMat = new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x1faa59, emissiveIntensity: 0.9, roughness: 0.4 });
const ammoMat = new THREE.MeshStandardMaterial({ color: 0xf1c40f, emissive: 0xc99a08, emissiveIntensity: 0.9, roughness: 0.4 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false });
function makePickup(x, z, type) {
  const g = new THREE.Group();
  if (type === 'health') {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.17, 0.17), healthMat));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.55, 0.17), healthMat));
  } else {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.32), ammoMat));
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.34), darkMat));
  }
  g.position.set(x, 0.95, z);
  scene.add(g);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 24), ringMat);
  ring.position.set(x, 0.03, z);
  scene.add(ring);
  pickups.push({ type, x, z, group: g, active: true, t: 0, phase: Math.random() * 6 });
}
function placePickups() {
  if (clearSpot(0, 0, 1.2)) PICKUP_SPOTS.push([0, 0, 'health']); // a health pack in the middle of every map
  const types = ['ammo', 'health', 'ammo', 'health', 'ammo', 'health', 'ammo'];
  for (const type of types) {
    for (let t = 0; t < 500; t++) {
      const x = rand(-26, 26), z = rand(-26, 26);
      if (!clearSpot(x, z, 1.4)) continue;
      if (PICKUP_SPOTS.some((p) => Math.hypot(p[0] - x, p[1] - z) < 11)) continue;
      PICKUP_SPOTS.push([x, z, type]);
      break;
    }
  }
  for (const p of PICKUP_SPOTS) makePickup(p[0], p[1], p[2]);
}

/* ---- spawn points ---- */
function placeSpawns() {
  for (let tries = 0; tries < 1200 && SPAWNS.length < 14; tries++) {
    const x = rand(-27, 27), z = rand(-27, 27);
    if (!clearSpot(x, z, 1.8)) continue;
    if (SPAWNS.some((s) => Math.hypot(s.x - x, s.z - z) < 9)) continue;
    SPAWNS.push({ x, z });
  }
  for (let a = 0; SPAWNS.length < 8; a += 0.8) SPAWNS.push({ x: Math.cos(a) * 27, z: Math.sin(a) * 27 });
}

/* ---- map decoration: textured cover, painted ground, lamps, backdrops, weather (mostly visual, cheap shared geometry) ---- */
const mapAnim = [];
const UB = new THREE.BoxGeometry(1, 1, 1), UC = new THREE.CylinderGeometry(1, 1, 1, 12), US = new THREE.SphereGeometry(1, 10, 8), UK = new THREE.ConeGeometry(1, 1, 9);
const dmats = {};
function dmat(c, o) { const k = c + JSON.stringify(o || {}); return dmats[k] || (dmats[k] = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.85 }, o || {}))); }
function dput(geo, mat, x, y, z, sx, sy, sz, ry = 0, cast = false, parent = scene, rx = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  m.castShadow = cast; m.receiveShadow = true;
  parent.add(m);
  return m;
}
const dbox = (w, h, d, x, y, z, mat, ry = 0, cast = false, parent = scene) => dput(UB, mat, x, y, z, w, h, d, ry, cast, parent);
const dcyl = (r, h, x, y, z, mat, cast = false, parent = scene) => dput(UC, mat, x, y, z, r, h, r, 0, cast, parent);
const dtex = {};
function dTex(name, fn) { return dtex[name] || (dtex[name] = fn()); }
const noise = (g, s, n, a = 0.1) => { for (let i = 0; i < n; i++) { g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${rand(0.02, a).toFixed(3)})` : `rgba(255,255,255,${rand(0.02, a).toFixed(3)})`; g.fillRect(Math.random() * s, Math.random() * s, rand(1, 3), rand(1, 3)); } };
const concreteTex = () => dTex('concrete', () => canvasTex(256, (g, s) => {
  g.fillStyle = '#e4e4e2'; g.fillRect(0, 0, s, s); noise(g, s, 2600, 0.14);
  for (let i = 0; i < 7; i++) { g.fillStyle = `rgba(60,55,45,${rand(0.04, 0.1).toFixed(2)})`; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, rand(10, 40), rand(8, 30), Math.random() * 3, 0, 7); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2; g.strokeRect(1, 1, s - 2, s - 2);
  g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, s * 0.5); g.lineTo(s, s * 0.5); g.stroke();
  for (let i = 0; i < 3; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rand(-14, 14); y += rand(4, 16); g.lineTo(x, y); } g.stroke(); }
}));
const hazardTex = (rx) => { const t = canvasTex(64, (g, s) => { g.fillStyle = '#e8b81c'; g.fillRect(0, 0, s, s); g.fillStyle = '#141414'; for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(i * 16, s); g.lineTo(i * 16 + 8, s); g.lineTo(i * 16 + 40, 0); g.lineTo(i * 16 + 32, 0); g.fill(); } }, rx, 1); return t; };
const buildingTex = (lit) => dTex('bld' + lit, () => canvasTex(128, (g, s) => {
  g.fillStyle = '#d6d9de'; g.fillRect(0, 0, s, s); noise(g, s, 500, 0.08);
  for (let y = 8; y < s; y += 20) for (let x = 6; x < s; x += 18) { g.fillStyle = Math.random() < lit ? '#ffe9a8' : '#4b5662'; g.fillRect(x, y, 10, 11); }
}));
function decalPlane(tex, size, y = 0.02) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true;
  scene.add(m);
  return m;
}
function lampPost(x, z, col = 0xfff0c0, solid = true) {
  const pole = dmat(0x3a3d42, { metalness: 0.7, roughness: 0.4 });
  dcyl(0.08, 5.4, x, 2.7, z, pole, true);
  dbox(0.7, 0.12, 0.3, x, 5.45, z, pole);
  dbox(0.6, 0.06, 0.24, x, 5.37, z, dmat(col, { emissive: col, emissiveIntensity: 1.6 }));
  dcyl(0.18, 0.2, x, 0.1, z, dmat(0x2a2c30));
  if (solid) { coverRects.push({ x, z, hw: 0.2, hd: 0.2, c: 1, s: 0 }); addStaticBox(x, 1.5, z, 0.3, 3, 0.3, pole); }
}
function cone(x, z) { dput(UK, dmat(0xff6a1a, { roughness: 0.6 }), x, 0.28, z, 0.2, 0.56, 0.2, 0); dbox(0.4, 0.04, 0.4, x, 0.02, z, dmat(0x222222)); dcyl(0.13, 0.05, x, 0.33, z, dmat(0xffffff)); }
function perimeter(trimCol, pillarCol, lampEvery) {
  const A = ARENA, tm = dmat(trimCol, { roughness: 0.8 }), pm = dmat(pillarCol, { roughness: 0.8 }), hz = new THREE.MeshStandardMaterial({ map: hazardTex(30), roughness: 0.7 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, y, v, w, h, d, m, c) => dbox(w, h, d, u * ca - v * sa, y, u * sa + v * ca, m, -a, c);
    P(0, 0.35, A - 0.05, A * 2, 0.7, 0.3, tm); // plinth
    P(0, 0.9, A - 0.06, A * 2, 0.5, 0.08, hz); // hazard band
    P(0, 5.12, A, A * 2 + 4, 0.24, 2.3, tm); // cap
    for (let u = -A + 4; u <= A - 3; u += 8.5) { P(u, 2.6, A + 0.05, 1, 5.2, 0.8, pm, true); P(u, 5.3, A + 0.05, 1.3, 0.3, 1.1, tm); }
    if (lampEvery) for (let u = -A + 8; u <= A - 6; u += lampEvery) { const x = u * ca - (A - 1.1) * sa, z = u * sa + (A - 1.1) * ca; dbox(0.5, 0.2, 0.5, x, 4.2, z, pm); dbox(0.4, 0.1, 0.4, x, 4.08, z, dmat(0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 1.4 })); }
  }
}
function skyline(n, minD, maxD, hMin, hMax, tint, lit) {
  const tm = buildingTex(lit);
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + rand(-0.06, 0.06), r = rand(minD, maxD);
    const w = rand(6, 14), d = rand(6, 14), h = rand(hMin, hMax);
    const mat = new THREE.MeshStandardMaterial({ map: tm, color: tint[(Math.random() * tint.length) | 0], roughness: 0.9 });
    const b = dbox(w, h, d, Math.cos(ang) * r, h / 2 - 0.5, Math.sin(ang) * r, mat, -ang);
    b.material.map = tm.clone(); b.material.map.needsUpdate = true; b.material.map.repeat.set(Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 6)));
    if (Math.random() < 0.4) dbox(w * 0.5, 1.2, d * 0.5, Math.cos(ang) * r, h + 0.1, Math.sin(ang) * r, dmat(0x555a60), -ang); // roof unit
    if (Math.random() < 0.25) dcyl(0.7, 9, Math.cos(ang) * r, h + 4, Math.sin(ang) * r, dmat(0x7b6f66)); // chimney
  }
}
function yardDecor() {
  perimeter(0x55595e, 0x8b8f93, 15);
  const mk = dTex('yardmk', () => canvasTex(1024, (g, s) => {
    const P = (v) => (v + 31) * (s / 62);
    g.clearRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(25,22,18,${rand(0.05, 0.16).toFixed(2)})`; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, rand(8, 40), rand(6, 28), Math.random() * 3, 0, 7); g.fill(); }
    g.strokeStyle = 'rgba(245,200,40,.85)'; g.lineWidth = 7; g.setLineDash([46, 30]); g.strokeRect(P(-27), P(-27), P(27) - P(-27), P(27) - P(-27));
    g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 6;
    g.beginPath(); g.arc(P(0), P(0), 7 * s / 62, 0, 7); g.stroke(); g.beginPath(); g.arc(P(0), P(0), 2 * s / 62, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(P(-7), P(0)); g.lineTo(P(-2), P(0)); g.moveTo(P(2), P(0)); g.lineTo(P(7), P(0)); g.moveTo(P(0), P(-7)); g.lineTo(P(0), P(-2)); g.moveTo(P(0), P(2)); g.lineTo(P(0), P(7)); g.stroke();
    g.fillStyle = 'rgba(255,255,255,.7)';
    for (const [x, z, r] of [[0, -17, 0], [0, 17, Math.PI], [-17, 0, -Math.PI / 2], [17, 0, Math.PI / 2]]) { g.save(); g.translate(P(x), P(z)); g.rotate(r); g.beginPath(); g.moveTo(0, -30); g.lineTo(22, 6); g.lineTo(8, 6); g.lineTo(8, 30); g.lineTo(-8, 30); g.lineTo(-8, 6); g.lineTo(-22, 6); g.fill(); g.restore(); }
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) { g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += rand(-18, 18); y += rand(-18, 18); g.lineTo(x, y); } g.stroke(); }
  }));
  decalPlane(mk, ARENA * 2);
  for (const [x, z] of [[-15, -15], [15, -15], [-15, 15], [15, 15], [0, -24], [0, 24]]) if (clearSpot(x, z, 1)) lampPost(x, z);
  skyline(26, 48, 70, 10, 30, [0xcfd4da, 0xb9c0c8, 0xd9d2c4, 0xa9b4be], 0.15);
  for (const a of [0.5, 2.3, 4.1]) { // water towers / stacks on the horizon
    const x = Math.cos(a) * 58, z = Math.sin(a) * 58, m = dmat(0x8a6f5a);
    for (const [dx, dz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) dcyl(0.18, 14, x + dx, 7, z + dz, m);
    dcyl(3.4, 4.5, x, 16, z, dmat(0xb9b2a4)); dput(UK, dmat(0x6d5a4a), x, 19.5, z, 3.6, 2.4, 3.6);
  }
  // jersey barriers with hazard stripes, tyre stacks, cones and a wrecked car
  const hz = new THREE.MeshStandardMaterial({ map: hazardTex(3), roughness: 0.7 }), jm = dmat(0xb8b8b2, { roughness: 0.9 });
  const barrier = (x, z, r) => { const c = addCover(x, z, 3, 0.9, 0.6, jm, r); const m = c.mesh; dbox(3.02, 0.16, 0.62, 0, 0.1, 0, hz, 0, false, m); dbox(0.7, 0.9, 0.6, 0, 0, 0, jm, 0, false, m).visible = false; };
  const spots = [[-9, -4, 0.2], [9, 5, 1.6], [4, -11, 0], [-5, 12, 0.5], [12, -9, 1.2], [-12, 8, 2.1]];
  for (const [x, z, r] of spots) if (clearSpot(x, z, 1.8)) barrier(x, z, r);
  const tyre = dmat(0x161616, { roughness: 0.95 });
  for (const [x, z] of [[-20, 3], [19, -4], [-3, 20]]) if (clearSpot(x, z, 1.3)) {
    addCover(x, z, 1.5, 1.1, 1.5, tyre);
    for (let i = 0; i < 4; i++) dput(new THREE.TorusGeometry(0.55, 0.2, 8, 14), tyre, x + rand(-0.1, 0.1), 0.2 + i * 0.28, z + rand(-0.1, 0.1), 1, 1, 1, 0, true, scene, Math.PI / 2);
  }
  for (let i = 0; i < 14; i++) { const s = randomSpot(0.9); if (s) cone(s.x, s.z); }
  const car = (x, z, r, col) => { if (!clearSpot(x, z, 2.6)) return; const c = addCover(x, z, 4.2, 0.9, 1.8, dmat(col, { metalness: 0.5, roughness: 0.5 }), r); const m = c.mesh;
    dbox(2, 0.6, 1.6, -0.1, 0.72, 0, dmat(col, { metalness: 0.5, roughness: 0.5 }), 0, true, m); dbox(1.7, 0.45, 1.62, -0.1, 0.78, 0, dmat(0x2a3a4a, { metalness: 0.8, roughness: 0.15 }), 0, false, m);
    for (const [wx, wz] of [[-1.3, -0.9], [-1.3, 0.9], [1.3, -0.9], [1.3, 0.9]]) dput(UC, tyre, wx, -0.25, wz, 0.38, 0.3, 0.38, 0, false, m, Math.PI / 2);
    dbox(0.1, 0.18, 1.3, 2.12, 0.1, 0, dmat(0xfff0c0, { emissive: 0xfff0c0, emissiveIntensity: 0.8 }), 0, false, m); };
  car(-17, -9, 0.4, 0x8c2a2a); car(13, 14, -0.7, 0x2a4a7c);
  // guard hut with AC unit
  if (clearSpot(-4, -20, 3.5)) { const h = addCover(-4, -20, 4.2, 3, 3.2, dmat(0xcfc9b8, { roughness: 0.9 }), 0.2).mesh;
    dbox(4.8, 0.25, 3.8, 0, 1.6, 0, dmat(0x4a4f55), 0, true, h); dbox(1.2, 0.8, 0.9, 1, 2.1, 0, dmat(0xbfc4c9, { metalness: 0.4 }), 0, false, h);
    dbox(0.9, 1.9, 0.08, -1, -0.5, 1.64, dmat(0x3a2c20), 0, false, h); dbox(1.3, 0.8, 0.08, 0.9, 0.2, 1.64, dmat(0x7fb6d6, { metalness: 0.7, roughness: 0.15 }), 0, false, h); }
}
let docksWater = null;
function docksDecor() {
  perimeter(0x3a2f2a, 0x5a4a42, 14);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ map: dTex('ripple', () => canvasTex(256, (g, s) => { g.fillStyle = '#1f4a63'; g.fillRect(0, 0, s, s); for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(255,${180 + (Math.random() * 60) | 0},140,${rand(0.05, 0.22).toFixed(2)})`; g.lineWidth = 2; const x = Math.random() * s, y = Math.random() * s; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 4, x + 30, y); g.stroke(); } }, 60, 60)), roughness: 0.18, metalness: 0.55 }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.6; scene.add(water); docksWater = water;
  mapAnim.push((dt) => { water.material.map.offset.x += dt * 0.004; water.material.map.offset.y += dt * 0.006; });
  const pl = dTex('planks', () => canvasTex(256, (g, s) => { g.clearRect(0, 0, s, s); g.fillStyle = 'rgba(0,0,0,.2)'; for (let y = 0; y < s; y += 32) { g.fillRect(0, y, s, 2); for (let x = (y / 32 % 2) * 64 + 20; x < s; x += 128) g.fillRect(x, y, 2, 32); } noise(g, s, 900, 0.1); }, 8, 8));
  decalPlane(pl, ARENA * 2, 0.012);
  const rust = dmat(0xa84c2a, { metalness: 0.5, roughness: 0.6 });
  const crane = (x, z, ry) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    for (const sx of [-6, 6]) for (const sz of [-3, 3]) dbox(0.7, 26, 0.7, sx, 13, sz, rust, 0, false, g);
    for (const y of [8, 17, 25]) { dbox(13, 0.5, 0.5, 0, y, -3, rust, 0, false, g); dbox(13, 0.5, 0.5, 0, y, 3, rust, 0, false, g); dbox(0.5, 0.5, 6.5, -6, y, 0, rust, 0, false, g); dbox(0.5, 0.5, 6.5, 6, y, 0, rust, 0, false, g); }
    dbox(5, 1.6, 40, 0, 26.5, 8, dmat(0xd9a21f, { metalness: 0.4 }), 0, false, g); dbox(3.2, 2.4, 3.2, 0, 24.7, 0, dmat(0x444a50), 0, false, g);
    dbox(0.15, 14, 0.15, 0, 18, -9, dmat(0x222222), 0, false, g); dbox(2, 0.7, 2, 0, 11, -9, dmat(0x8a3a28), 0, false, g);
    dbox(0.5, 0.5, 0.5, 0, 27.5, 26, dmat(0xff3322, { emissive: 0xff2200, emissiveIntensity: 1.5 }), 0, false, g); };
  crane(-40, -34, 0.3); crane(42, 30, Math.PI + 0.3);
  const ship = new THREE.Group(); ship.position.set(0, 0, -62); scene.add(ship);
  dbox(120, 14, 22, 0, 6, 0, dmat(0x2c3238, { metalness: 0.4 }), 0, false, ship); dbox(120, 2, 22.4, 0, 0.5, 0, dmat(0x8a2e24), 0, false, ship);
  dbox(26, 16, 14, 40, 20, 0, dmat(0xe9e6e0), 0, false, ship); dbox(26, 3, 14.2, 40, 24, 0, dmat(0x2a4a6a, { metalness: 0.7, roughness: 0.2 }), 0, false, ship); dcyl(2.6, 8, 48, 31, 0, dmat(0xc43a2a), false, ship);
  const cm = getContainerMats();
  for (let i = -3; i <= 2; i++) for (let j = 0; j < 2; j++) dbox(14, 3.3, 3.2, i * 15, 14 + j * 3.4, (j ? 0.5 : -0.5) * 3.5, cm[(Math.abs(i * 3 + j) + 2) % cm.length], 0, false, ship);
  for (let i = 0; i < 8; i++) dbox(0.7, 0.9, 0.1, -50 + i * 14, 9, 11.1, dmat(0xffd98a, { emissive: 0xffc060, emissiveIntensity: 1 }), 0, false, ship);
  skyline(14, 55, 75, 12, 24, [0x6e5a52, 0x5a4a46, 0x7d6a5e], 0.5);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(16, 28), new THREE.MeshBasicMaterial({ color: 0xffd08a, fog: false }));
  sunDisc.position.set(-150, 18, 86); sunDisc.lookAt(0, 8, 0); scene.add(sunDisc);
  const bollard = dmat(0x2a2a2e, { metalness: 0.6 });
  for (let u = -26; u <= 26; u += 6.5) for (const [x, z] of [[u, ARENA - 1.4], [u, -ARENA + 1.4], [ARENA - 1.4, u], [-ARENA + 1.4, u]]) { dcyl(0.22, 0.6, x, 0.3, z, bollard); dcyl(0.28, 0.1, x, 0.62, z, dmat(0xe8b81c)); }
  for (const [x, z] of [[-14, 0], [14, 0], [0, -14], [0, 14], [-24, 24], [24, -24]]) if (clearSpot(x, z, 1)) lampPost(x, z, 0xffe0a0);
  for (let i = 0; i < 6; i++) { const s = randomSpot(1.2); if (s) { const p = dmat(0xb8935a, { roughness: 0.95 }); for (let k = 0; k < 4; k++) dbox(1.2, 0.1, 0.18, s.x, 0.1 + k * 0.01, s.z - 0.5 + k * 0.33, p, 0); dbox(1.2, 0.12, 1.2, s.x, 0.18, s.z, p, 0); dbox(1, 0.7, 1, s.x, 0.6, s.z, dmat(0x7a5b36), 0, true); } }
}
function decorContainer(mesh, w) {
  const dk = dmat(0x1a1a1c, { metalness: 0.5 }), st = dmat(0x8b8f93, { metalness: 0.8, roughness: 0.4 });
  for (const e of [-1, 1]) {
    dbox(0.05, 2.3, 0.05, e * (w / 2 + 0.005), 0, 0, dk, 0, false, mesh); // door seam
    for (const dz of [-0.5, 0.5]) dcyl(0.035, 2.1, e * (w / 2 + 0.04), 0, dz, st, false, mesh); // lock rods
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) dbox(0.2, 0.2, 0.2, e * (w / 2 - 0.1), sy * 1.2, sx * 1.1, dk, 0, false, mesh); // corner castings
  }
}
function ruinsDecor() {
  const snow = dmat(0xf4f8fc, { roughness: 1 }), rock = dmat(0x6f7a86, { roughness: 1 }), wood = dmat(0x3a2c22, { roughness: 1 });
  const drift = (x, z, s) => { const m = dput(US, snow, x, 0, z, s * 1.6, s * 0.38, s, rand(0, 3), false); m.position.y = 0.05; };
  for (const r of coverRects) if (Math.random() < 0.7) drift(r.x + rand(-1, 1), r.z + rand(-1, 1), rand(0.7, 1.5));
  for (let i = 0; i < 22; i++) { const x = rand(-30, 30), z = rand(-30, 30); if (clearSpot(x, z, 0.6)) drift(x, z, rand(0.5, 1.2)); }
  const tree = (x, z, h) => { dput(UC, wood, x, h / 2, z, 0.25, h, 0.25, 0, true); for (let i = 0; i < 5; i++) { const y = h * (0.45 + i * 0.1), a = i * 2.4; dput(UC, wood, x + Math.cos(a) * 0.5, y + 0.2, z + Math.sin(a) * 0.5, 0.07, 1.6 - i * 0.15, 0.07, 0, false, scene, Math.sin(a) * 1.0, -Math.cos(a) * 1.0); dput(US, snow, x + Math.cos(a) * 0.9, y + 0.5, z + Math.sin(a) * 0.9, 0.5, 0.18, 0.5); } };
  for (const [x, z] of [[-27, -26], [27, 26], [-28, 14], [26, -17], [-14, 27], [8, -28], [-8, 27], [28, 3]]) { tree(x, z, rand(5, 7)); coverRects.push({ x, z, hw: 0.4, hd: 0.4, c: 1, s: 0 }); addStaticBox(x, 2, z, 0.5, 4, 0.5, wood); }
  const flames = [];
  const brazier = (x, z) => { const m = dmat(0x2c2c30, { metalness: 0.6 }); dcyl(0.1, 1.1, x, 0.55, z, m); dput(UC, m, x, 1.15, z, 0.45, 0.35, 0.45); dput(UK, dmat(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 2.2 }), x, 1.55, z, 0.32, 0.7, 0.32);
    const l = new THREE.PointLight(0xff8a30, 6, 11, 2); l.position.set(x, 1.8, z); scene.add(l); flames.push(l); coverRects.push({ x, z, hw: 0.4, hd: 0.4, c: 1, s: 0 }); addStaticBox(x, 0.6, z, 0.5, 1.2, 0.5, m); };
  for (const [x, z] of [[-4, -13], [4, 13], [-13, 4], [13, -4]]) brazier(x, z);
  mapAnim.push(() => { for (const l of flames) l.intensity = 5 + Math.random() * 2.5; });
  const ice = new THREE.Mesh(new THREE.CircleGeometry(5.2, 30), new THREE.MeshStandardMaterial({ color: 0xbfe3f5, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
  ice.rotation.x = -Math.PI / 2; ice.position.y = 0.025; scene.add(ice);
  const bn = dmat(0xa8322c, { roughness: 0.9 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { dbox(0.9, 2.2, 0.06, sx * 9.3, 3.0, sz * 9.3 + sz * 0.95, bn); for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) dbox(0.45, 0.4, 0.45, sx * 9.3 + dx, 4.5, sz * 9.3 + dz, dmat(0x9aa2aa)); }
  for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2 + rand(-0.1, 0.1), r = rand(62, 82), h = rand(18, 40), w = rand(14, 26);
    dput(UK, rock, Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r, w, h, w * 0.8, rand(0, 3)); dput(UK, snow, Math.cos(a) * r, h * 0.78 - 1, Math.sin(a) * r, w * 0.5, h * 0.4, w * 0.4, 0); }
  const N = 700, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-45, 45); pos[i * 3 + 1] = rand(0, 28); pos[i * 3 + 2] = rand(-45, 45); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sp = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.85, depthWrite: false }));
  sp.frustumCulled = false; scene.add(sp);
  mapAnim.push((dt) => { const p = sg.attributes.position.array, t = gameTime; for (let i = 0; i < N; i++) { p[i * 3 + 1] -= dt * (1.4 + (i % 5) * 0.25); p[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.5; if (p[i * 3 + 1] < 0) p[i * 3 + 1] = 28; } sg.attributes.position.needsUpdate = true; });
}

function buildMap(def) {
  applyTheme(def.theme);
  groundMat.map = makeGroundTex(def.theme.ground);
  groundMat.needsUpdate = true;
  const ground = new CANNON.Body({ mass: 0, material: matProp, shape: new CANNON.Plane(), collisionFilterGroup: GRP.STATIC, collisionFilterMask: ALL });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(ground);
  const gm = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, ARENA * 2), groundMat);
  gm.rotation.x = -Math.PI / 2;
  gm.receiveShadow = true;
  scene.add(gm);
  // boundary walls
  addStaticBox(0, 2.5, -ARENA - 1, ARENA * 2 + 4, 5, 2, wallMat);
  addStaticBox(0, 2.5, ARENA + 1, ARENA * 2 + 4, 5, 2, wallMat);
  addStaticBox(-ARENA - 1, 2.5, 0, 2, 5, ARENA * 2, wallMat);
  addStaticBox(ARENA + 1, 2.5, 0, 2, 5, ARENA * 2, wallMat);
  if (!coverTexSet) { coverTexSet = true; coverMat.map = concreteTex(); coverMat.bumpMap = concreteTex(); coverMat.bumpScale = 0.6; coverMat.needsUpdate = true; }
  def.build();
  def.decor();
  if (HALLOWEEN && def.id !== 'graveyard') halloweenDecor(7);
  placePickups();
  placeProps(def.crates, def.barrels);
  placeSpawns();
}

function nearestPickup(x, z, type) {
  let best = null, bd = 45;
  for (const p of pickups) {
    if (!p.active || p.type !== type) continue;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function takePickup(p, msg) {
  p.active = false;
  p.group.visible = false;
  p.t = 18;
  sfx.pickup();
  if (msg) toast(msg);
}
function updatePickups(dt) {
  for (const p of pickups) {
    p.phase += dt;
    if (!p.active) {
      p.t -= dt;
      if (p.t <= 0) { p.active = true; p.group.visible = true; }
      continue;
    }
    p.group.rotation.y = p.phase * 2;
    p.group.position.y = 0.95 + Math.sin(p.phase * 3) * 0.1;
    if (!player.dead) {
      const b = player.body.position;
      if (Math.hypot(b.x - p.x, b.z - p.z) < 1.5) {
        if (p.type === 'health' && player.hp < player.maxHp) {
          player.hp = Math.min(player.maxHp, player.hp + 40);
          takePickup(p, '+40 HP');
          continue;
        }
        if (p.type === 'ammo') {
          const got = refillAmmo();
          if (!got && player.grenades >= 5) continue;
          player.grenades = Math.min(5, player.grenades + 2);
          takePickup(p, '+AMMO  +GRENADES');
          continue;
        }
      }
    }
    if (p.type === 'health') {
      for (const e of enemies) {
        if (e.hp < 100 && Math.hypot(e.body.position.x - p.x, e.body.position.z - p.z) < 1.5) {
          e.hp = Math.min(100, e.hp + 40);
          takePickup(p, null);
          break;
        }
      }
    }
  }
}

/* ------------------------------ debris & particles ------------------------------ */
const debrisList = [];
function spawnDebris(x, y, z, baseVel) {
  const s = rand(0.14, 0.32);
  const body = new CANNON.Body({
    mass: 0.8,
    material: matProp,
    shape: new CANNON.Box(new CANNON.Vec3(s / 2, s / 2, s / 2)),
    position: new CANNON.Vec3(x, y, z),
    collisionFilterGroup: GRP.DEBRIS,
    collisionFilterMask: GRP.STATIC | GRP.PROP | GRP.DEBRIS,
    sleepSpeedLimit: 0.3,
    sleepTimeLimit: 0.4,
  });
  body.velocity.set(baseVel.x + rand(-4, 4), baseVel.y + rand(1.5, 5.5), baseVel.z + rand(-4, 4));
  body.angularVelocity.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
  body.userData = { type: 'debris' };
  const mesh = new THREE.Mesh(crateGeo, crateMat);
  mesh.scale.setScalar(s);
  mesh.castShadow = true;
  track(body, mesh);
  debrisList.push({ body, t: rand(6, 9) });
  if (debrisList.length > 160) untrack(debrisList.shift().body);
}

const sparkGeo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
const sparkMats = {};
const sparks = [];
function spawnSparks(p, n, normal, speed, color, life = 0.5) {
  const mat = sparkMats[color] || (sparkMats[color] = new THREE.MeshBasicMaterial({ color }));
  for (let i = 0; i < n; i++) {
    if (sparks.length > 260) break;
    const m = new THREE.Mesh(sparkGeo, mat);
    m.position.set(p.x, p.y, p.z);
    scene.add(m);
    const v = new THREE.Vector3(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).multiplyScalar(speed * 0.6);
    if (normal) v.addScaledVector(new THREE.Vector3(normal.x, normal.y, normal.z), speed * rand(0.3, 1));
    sparks.push({ m, v, life: life * rand(0.6, 1.2), max: life });
  }
}

const decalGeo = new THREE.PlaneGeometry(0.14, 0.14);
const decalMat = new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false });
const decals = [];
function addDecal(p, n) {
  const d = new THREE.Mesh(decalGeo, decalMat);
  d.position.set(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01);
  d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(n.x, n.y, n.z));
  scene.add(d);
  decals.push(d);
  if (decals.length > 90) scene.remove(decals.shift());
}

const fx = []; // generic timed effects {t,dur,upd(k),end()}

/* ------------------------------ audio ------------------------------ */
let actx = null, master = null;
function ac() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain();
    master.gain.value = prefs.vol;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function burst({ dur = 0.1, freq = 1200, q = 0.7, vol = 0.5, type = 'lowpass', sweepTo = null, tone = 0, toneEnd = 0 }) {
  try {
    const a = ac();
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, a.currentTime);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, a.currentTime + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(vol, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start();
    if (tone) {
      const o = a.createOscillator();
      o.frequency.setValueAtTime(tone, a.currentTime);
      o.frequency.exponentialRampToValueAtTime(toneEnd || 40, a.currentTime + dur);
      const og = a.createGain();
      og.gain.setValueAtTime(vol * 0.8, a.currentTime);
      og.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
      o.connect(og); og.connect(master);
      o.start(); o.stop(a.currentTime + dur);
    }
  } catch (e) { /* audio is optional */ }
}
let lastEnemyShotSfx = 0;
const sfx = {
  shot: () => burst({ dur: 0.12, freq: 3000, sweepTo: 400, vol: 0.5, tone: 180, toneEnd: 50 }),
  enemyShot: () => {
    if (timeNow - lastEnemyShotSfx < 0.07) return;
    lastEnemyShotSfx = timeNow;
    burst({ dur: 0.1, freq: 1500, sweepTo: 300, vol: 0.16, tone: 120, toneEnd: 60 });
  },
  boom: () => burst({ dur: 1.0, freq: 900, sweepTo: 60, vol: 1, tone: 90, toneEnd: 25 }),
  hit: () => burst({ dur: 0.05, freq: 2500, type: 'bandpass', vol: 0.25, tone: 900, toneEnd: 600 }),
  crate: () => burst({ dur: 0.25, freq: 700, sweepTo: 200, vol: 0.4 }),
  reload: () => burst({ dur: 0.05, freq: 4000, type: 'highpass', vol: 0.3 }),
  hurt: () => burst({ dur: 0.2, freq: 400, sweepTo: 100, vol: 0.5, tone: 140, toneEnd: 70 }),
  throw: () => burst({ dur: 0.15, freq: 600, type: 'bandpass', vol: 0.2 }),
  step: () => burst({ dur: 0.06, freq: 500, sweepTo: 150, vol: 0.12 }),
  slide: () => burst({ dur: 0.55, freq: 2200, sweepTo: 500, type: 'bandpass', vol: 0.3, q: 0.5 }),
  pickup: () => burst({ dur: 0.18, freq: 1800, type: 'bandpass', vol: 0.3, tone: 600, toneEnd: 1400 }),
  tick: () => burst({ dur: 0.06, freq: 3000, type: 'bandpass', vol: 0.3, tone: 900, toneEnd: 900 }),
  kill: () => burst({ dur: 0.25, freq: 2500, type: 'bandpass', vol: 0.35, tone: 700, toneEnd: 1500 }),
};

/* ------------------------------ game state ------------------------------ */
let state = 'menu'; // menu | play | over
let timeNow = 0;    // real clock (s)
let gameTime = 0;   // time spent actually playing (s)
let roundT = ROUND_TIME;
let lastTickSec = -1;
let bestKills = 0;
try { bestKills = parseInt(localStorage.getItem('ab_best_kills') || '0', 10) || 0; } catch (e) { /* ignore */ }

const enemies = [];   // living bots
const respawns = [];  // {info, t}
const keys = {};
let firing = false;
let locked = false;

const player = {
  body: null, info: playerInfo, yaw: 0, pitch: 0, recoilDebt: 0,
  hp: 100, maxHp: 100, ammo: 30, mag: 30, reserve: 120, grenades: 3,
  reloadT: 0, fireCd: 0, throwCd: 0, heat: 0, onGround: false,
  shake: 0, flash: 0, kickBack: 0, vignette: 0, bob: 0, ads: false,
  sprinting: false, wasGround: true, lastVy: 0, landDip: 0, bobAmp: 0, lastStep: 0,
  sliding: false, slideT: 0, slideDirX: 0, slideDirZ: 0, slideSpeed: 0, slideCd: 0, slideBlend: 0, slideHeld: false, slideDust: 0,
  dead: false, deadT: 0, deathPos: new THREE.Vector3(), killer: null,
  invuln: 0, lastHurt: -99, dmgT: 0, dmgX: 0, dmgZ: 0,
};
{
  const b = new CANNON.Body({
    mass: 80,
    shape: new CANNON.Sphere(0.5),
    position: new CANNON.Vec3(0, 0.6, 0),
    fixedRotation: true,
    material: matSlip,
    linearDamping: 0.01,
    collisionFilterGroup: GRP.PLAYER,
    collisionFilterMask: GRP.STATIC | GRP.PROP | GRP.ENEMY,
    allowSleep: false,
  });
  b.userData = { type: 'player' };
  world.addBody(b);
  player.body = b;
}

/* ------------------------------ HUD ------------------------------ */
const hud = {
  hpfill: $('hpfill'), ability: $('ability'), hptext: $('hptext'), ammo: $('ammo'), nades: $('nades'),
  wave: $('wave'), score: $('score'), left: $('left'), vignette: $('vignette'),
  hit: $('hitmarker'), toast: $('toast'), banner: $('banner'), cross: $('crosshair'),
  overlay: $('overlay'), ovsub: $('ovsub'), ovcta: $('ovcta'),
  board: $('board'), feed: $('feed'), dmgdir: $('dmgdir'),
  results: $('results'), controls: $('controls'), slots: $('slots'), scope: $('scope'),
};

/* ---- weapons, inventory, difficulty, settings ---- */
const WEAPONS = {
  ar:       { slot: 0, name: 'Assault Rifle', rof: 0.095, dmg: 25,  mag: 30, res: 120, speed: 260, pellets: 1, spread: 0.002,  auto: true,  reload: 1.9, kick: 0.009, ads: 58 },
  neon:     { slot: 0, name: 'Neon Antler',   rof: 0.09,  dmg: 22,  mag: 32, res: 128, speed: 270, pellets: 1, spread: 0.002,  auto: true,  reload: 1.7, kick: 0.008, ads: 58 },
  smg:      { slot: 0, name: 'SMG',           rof: 0.06,  dmg: 15,  mag: 40, res: 160, speed: 230, pellets: 1, spread: 0.006,  auto: true,  reload: 1.6, kick: 0.006, ads: 62 },
  shotgun:  { slot: 0, name: 'Shotgun',       rof: 0.85,  dmg: 11,  mag: 6,  res: 36,  speed: 200, pellets: 8, spread: 0.04,   auto: false, reload: 2.4, kick: 0.05,  ads: 66 },
  sniper:   { slot: 0, name: 'Sniper Rifle',  rof: 1.25,  dmg: 105, mag: 5,  res: 25,  speed: 420, pellets: 1, spread: 0.0004, auto: false, reload: 2.6, kick: 0.06,  ads: 22 },
  pistol:   { slot: 1, name: 'Pistol',        rof: 0.2,   dmg: 22,  mag: 12, res: 72,  speed: 240, pellets: 1, spread: 0.003,  auto: false, reload: 1.2, kick: 0.014, ads: 62 },
  revolver: { slot: 1, name: 'Revolver',      rof: 0.55,  dmg: 58,  mag: 6,  res: 36,  speed: 280, pellets: 1, spread: 0.001,  auto: false, reload: 2.0, kick: 0.04,  ads: 60 },
  admin:    { slot: 3, name: 'ADMIN CANNON', rof: 0.12, dmg: 200, mag: 99, res: 999, speed: 500, pellets: 1, spread: 0.0005, auto: true, reload: 0.4, kick: 0.004, ads: 55 },
  katana:   { slot: 2, name: 'Katana',        melee: true, dmg: 75, range: 3.1, cd: 0.5,  arc: 0.5 },
  knife:    { slot: 2, name: 'Combat Knife',  melee: true, dmg: 45, range: 2.3, cd: 0.27, arc: 0.55 },
};

const mkGun = (slot, name, o) => ({ slot, name, pellets: 1, speed: 260, spread: 0.003, auto: false, reload: 1.8, kick: 0.01, ads: 58, col: 0x1a1b1f, glow: 0, model: 'rifle', ...o });
const mkBlade = (name, o) => ({ slot: 2, name, melee: true, kb: 5, arc: 0.5, col: 0xdfe6ee, glow: 0, model: 'sword', len: 0.8, ...o });
Object.assign(WEAPONS, {
  // ---- primary ----
  carbine:   mkGun(0, 'Carbine',         { rof: 0.08,  dmg: 20, mag: 30, res: 150, speed: 270, spread: 0.0025, auto: true, reload: 1.7, kick: 0.007, col: 0x3a4a3a, model: 'rifle' }),
  bullpup:   mkGun(0, 'Bullpup',         { rof: 0.085, dmg: 23, mag: 28, res: 140, speed: 270, spread: 0.002, auto: true, reload: 1.8, kick: 0.008, col: 0x4a3a2a, glow: 0xffaa33, model: 'bullpup' }),
  pdw:       mkGun(0, 'PDW',             { rof: 0.05,  dmg: 12, mag: 50, res: 200, speed: 230, spread: 0.007, auto: true, reload: 1.7, kick: 0.005, col: 0x2a3a4a, glow: 0x33aaff, model: 'smg' }),
  lmg:       mkGun(0, 'LMG',             { rof: 0.07,  dmg: 20, mag: 100, res: 200, speed: 260, spread: 0.008, auto: true, reload: 4.0, kick: 0.01, col: 0x3a3d33, model: 'lmg' }),
  hlmg:      mkGun(0, 'Heavy LMG',       { rof: 0.1,   dmg: 30, mag: 75, res: 150, speed: 270, spread: 0.01, auto: true, reload: 4.5, kick: 0.014, col: 0x4a3030, glow: 0xff3322, model: 'lmg' }),
  minigun:   mkGun(0, 'Minigun',         { rof: 0.035, dmg: 9,  mag: 200, res: 400, speed: 250, spread: 0.02, auto: true, reload: 5.5, kick: 0.004, col: 0x2b2b30, glow: 0xff8800, model: 'minigun' }),
  dmr:       mkGun(0, 'DMR',             { rof: 0.3,   dmg: 55, mag: 12, res: 60,  speed: 360, spread: 0.0008, reload: 2.2, kick: 0.025, ads: 30, col: 0x3a4036, model: 'dmr' }),
  amr:       mkGun(0, 'Anti-Material Rifle', { rof: 2.0, dmg: 190, mag: 3, res: 15, speed: 500, spread: 0.0003, reload: 3.2, kick: 0.09, ads: 22, col: 0x2a2a2e, glow: 0xff2222, model: 'sniper' }),
  autoshot:  mkGun(0, 'Auto Shotgun',    { rof: 0.22,  dmg: 8, pellets: 7, mag: 10, res: 50, speed: 200, spread: 0.045, auto: true, reload: 2.8, kick: 0.03, col: 0x3a2a1a, model: 'shotgun' }),
  dbl:       mkGun(0, 'Double Barrel',   { rof: 0.6,   dmg: 12, pellets: 12, mag: 2, res: 28, speed: 190, spread: 0.055, reload: 2.2, kick: 0.07, col: 0x5a3b22, model: 'dbl' }),
  plasma:    mkGun(0, 'Plasma Rifle',    { rof: 0.12,  dmg: 28, mag: 40, res: 160, speed: 140, spread: 0.002, auto: true, reload: 2.0, kick: 0.004, col: 0x1a2a4a, glow: 0x33ccff, model: 'plasma' }),
  viper:     mkGun(0, 'Viper',           { rof: 0.07,  dmg: 16, mag: 36, res: 180, speed: 280, spread: 0.0035, auto: true, reload: 1.6, kick: 0.006, col: 0x0b2a12, glow: 0x44ff55, model: 'smg' }),
  // ---- secondary ----
  deagle:    mkGun(1, 'Desert Hawk',     { rof: 0.4,  dmg: 48, mag: 7, res: 42, speed: 280, spread: 0.0015, reload: 1.8, kick: 0.035, col: 0x8a8a90, model: 'cannon' }),
  machpist:  mkGun(1, 'Machine Pistol',  { rof: 0.06, dmg: 10, mag: 25, res: 125, speed: 230, spread: 0.01, auto: true, reload: 1.4, kick: 0.007, col: 0x222226, model: 'machpist' }),
  magnum:    mkGun(1, 'Magnum',          { rof: 0.7,  dmg: 88, mag: 5, res: 30, speed: 300, spread: 0.001, reload: 2.4, kick: 0.05, col: 0x666a72, model: 'revolver' }),
  sawedoff:  mkGun(1, 'Sawed-Off',       { rof: 0.9,  dmg: 10, pellets: 8, mag: 2, res: 24, speed: 190, spread: 0.06, reload: 2.0, kick: 0.05, col: 0x5a3b22, model: 'sawed' }),
  tacpistol: mkGun(1, 'Tactical Pistol', { rof: 0.15, dmg: 18, mag: 15, res: 90, speed: 250, spread: 0.002, reload: 1.3, kick: 0.01, col: 0x1b2a3a, glow: 0x3399ff, model: 'pistol' }),
  uzi:       mkGun(1, 'Mini Uzi',        { rof: 0.05, dmg: 9,  mag: 32, res: 160, speed: 220, spread: 0.012, auto: true, reload: 1.5, kick: 0.006, col: 0x3a3a3e, model: 'machpist' }),
  handcannon:mkGun(1, 'Hand Cannon',     { rof: 1.0,  dmg: 130, mag: 4, res: 20, speed: 340, spread: 0.0008, reload: 2.6, kick: 0.08, col: 0x6a5a2a, glow: 0xffcc33, model: 'cannon' }),
  gold:      mkGun(1, 'Golden Pistol',   { rof: 0.18, dmg: 26, mag: 10, res: 70, speed: 260, spread: 0.002, reload: 1.3, kick: 0.012, col: 0xd4a72c, glow: 0xffcc33, model: 'pistol' }),
  laserpist: mkGun(1, 'Laser Pistol',    { rof: 0.12, dmg: 16, mag: 24, res: 120, speed: 160, spread: 0.002, auto: true, reload: 1.5, kick: 0.003, col: 0x2a1a4a, glow: 0xdd55ff, model: 'pistol' }),
  // ---- melee ----
  machete:   mkBlade('Machete',       { dmg: 62,  range: 2.8, cd: 0.38, len: 0.6, col: 0xb8bfc6, hilt: 0x4a3320 }),
  claymore:  mkBlade('Claymore',      { dmg: 100, range: 3.4, cd: 0.8,  len: 1.0, arc: 0.45, kb: 8, col: 0xcfd6dd, hilt: 0x222226, wide: 0.06 }),
  dagger:    mkBlade('Dagger',        { dmg: 36,  range: 2.0, cd: 0.2,  len: 0.3, arc: 0.6, col: 0xdfe6ee, hilt: 0x1a1a1f }),
  axe:       mkBlade('Battle Axe',    { dmg: 105, range: 2.9, cd: 0.85, kb: 9, model: 'axe', col: 0xaab0b8 }),
  hammer:    mkBlade('War Hammer',    { dmg: 125, range: 2.8, cd: 1.0,  kb: 14, arc: 0.45, model: 'hammer', col: 0x777b82 }),
  bat:       mkBlade('Baseball Bat',  { dmg: 58,  range: 3.0, cd: 0.45, kb: 12, model: 'bat', col: 0xb88a4a }),
  spear:     mkBlade('Spear',         { dmg: 70,  range: 4.3, cd: 0.6,  arc: 0.78, model: 'spear', col: 0xcfd6dd }),
  crowbar:   mkBlade('Crowbar',       { dmg: 50,  range: 2.7, cd: 0.34, kb: 7, model: 'crowbar', col: 0xaa2222 }),
  pan:       mkBlade('Frying Pan',    { dmg: 48,  range: 2.7, cd: 0.4,  kb: 10, model: 'pan', col: 0x2a2a2e }),
  energy:    mkBlade('Energy Blade',  { dmg: 85,  range: 3.2, cd: 0.33, len: 0.9, col: 0x66ddff, glow: 0x33bbff, hilt: 0x222226 }),
  scythe:    mkBlade('Scythe',        { dmg: 95,  range: 3.6, cd: 0.7,  kb: 8, arc: 0.4, model: 'scythe', col: 0xb0b6bd }),
  nunchucks: mkBlade('Nunchucks',     { dmg: 44,  range: 2.5, cd: 0.22, kb: 5, model: 'bat', col: 0x2a2a2e, len: 0.5 }),
});

/* ---- weapon abilities (press E / SKILL button) - only some weapons have one ---- */
const ABILITIES = {
  overdrive: { name: 'OVERDRIVE', dur: 4, cd: 16 },
  overcharge: { name: 'OVERCHARGE', dur: 5, cd: 18 },
  adrenaline: { name: 'ADRENALINE', dur: 5, cd: 22 },
  shield: { name: 'BARRIER', dur: 3, cd: 30 },
  shockwave: { name: 'SHOCKWAVE', dur: 0, cd: 12 },
  dash: { name: 'DASH', dur: 0, cd: 6 },
  bloodlust: { name: 'BLOODLUST', dur: 6, cd: 20 },
};
const ABIL_OF = {
  ar: 'overdrive', minigun: 'overdrive', pdw: 'overdrive',
  plasma: 'overcharge', dmr: 'overcharge', revolver: 'overcharge', handcannon: 'overcharge',
  bullpup: 'adrenaline', machpist: 'adrenaline',
  lmg: 'shield', hlmg: 'shield', gold: 'shield',
  katana: 'dash', dagger: 'dash', spear: 'dash', energy: 'dash',
  hammer: 'shockwave', axe: 'shockwave',
  scythe: 'bloodlust', claymore: 'bloodlust',
};
for (const k in ABIL_OF) WEAPONS[k].ability = ABIL_OF[k];
const SLOTN = ['primary', 'secondary', 'melee', 'admin'];
const DIFFS = { easy: { skill: 0.6, dmg: 0.7 }, normal: { skill: 1, dmg: 1 }, hard: { skill: 1.35, dmg: 1.3 } };
/* ---- weapon wraps: pick one per gun in the loadout options ---- */
const skinTexCache = {};
function skinTex(id) {
  if (skinTexCache[id]) return skinTexCache[id];
  const blob = (g, s, cols, n, rmin, rmax) => { for (let i = 0; i < n; i++) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, rand(rmin, rmax), rand(rmin * 0.6, rmax * 0.8), Math.random() * 3, 0, 7); g.fill(); } };
  const draw = {
    woodland: (g, s) => { g.fillStyle = '#6a7a46'; g.fillRect(0, 0, s, s); blob(g, s, ['#3e4d2a', '#8a8a52', '#2a331d', '#55623a'], 60, 8, 26); },
    desert: (g, s) => { g.fillStyle = '#c9ab72'; g.fillRect(0, 0, s, s); blob(g, s, ['#a98a56', '#e0c590', '#8f7449', '#b99a62'], 60, 8, 26); },
    arctic: (g, s) => { g.fillStyle = '#e8f0f6'; g.fillRect(0, 0, s, s); blob(g, s, ['#b9cfe0', '#ffffff', '#9fb8cc', '#d3e2ee'], 50, 8, 24); },
    gold: (g, s) => { const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, '#fff2a8'); gr.addColorStop(0.5, '#e8b020'); gr.addColorStop(1, '#a8760c'); g.fillStyle = gr; g.fillRect(0, 0, s, s); for (let i = 0; i < 120; i++) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(Math.random() * s, Math.random() * s, rand(8, 40), 1); } },
    circuit: (g, s) => { g.fillStyle = '#05070b'; g.fillRect(0, 0, s, s); g.strokeStyle = '#ffffff'; g.lineWidth = 2; for (let i = 0; i < 26; i++) { let x = Math.round(Math.random() * 8) * (s / 8), y = Math.round(Math.random() * 8) * (s / 8); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { if (Math.random() < 0.5) x += (Math.random() < 0.5 ? -1 : 1) * (s / 8); else y += (Math.random() < 0.5 ? -1 : 1) * (s / 8); g.lineTo(x, y); } g.stroke(); g.fillStyle = '#fff'; g.fillRect(x - 3, y - 3, 6, 6); } },
    carbon: (g, s) => { g.fillStyle = '#7a0f16'; g.fillRect(0, 0, s, s); for (let y = 0; y < s; y += 8) for (let x = 0; x < s; x += 8) { g.fillStyle = ((x + y) / 8) % 2 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.10)'; g.fillRect(x, y, 8, 4); g.fillStyle = ((x + y) / 8) % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.5)'; g.fillRect(x, y + 4, 8, 4); } },
    galaxy: (g, s) => { const gr = g.createLinearGradient(0, 0, s, s); gr.addColorStop(0, '#1b0b4a'); gr.addColorStop(0.5, '#5a1a8c'); gr.addColorStop(1, '#0c1a5a'); g.fillStyle = gr; g.fillRect(0, 0, s, s); blob(g, s, ['rgba(255,80,200,0.25)', 'rgba(80,160,255,0.25)'], 12, 14, 36); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${rand(0.4, 1).toFixed(2)})`; const r = Math.random() < 0.1 ? 2.5 : 1.2; g.fillRect(Math.random() * s, Math.random() * s, r, r); } },
    magma: (g, s) => { g.fillStyle = '#120807'; g.fillRect(0, 0, s, s); g.strokeStyle = '#ff7a1a'; g.lineWidth = 3; for (let i = 0; i < 16; i++) { let x = Math.random() * s, y = Math.random() * s; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += rand(-22, 22); y += rand(-22, 22); g.lineTo(x, y); } g.stroke(); } },
  }[id];
  return (skinTexCache[id] = canvasTex(128, draw, 1, 1));
}
const SKINS = {
  default: { name: 'Default' },
  woodland: { name: 'Woodland Camo', body: 0xffffff, mid: 0x7d8c5a, tex: 'woodland', metal: 0.2, rough: 0.8 },
  desert: { name: 'Desert Dune', body: 0xffffff, mid: 0xb8a070, tex: 'desert', metal: 0.2, rough: 0.8 },
  arctic: { name: 'Arctic Ghost', body: 0xffffff, mid: 0xc6d8e6, tex: 'arctic', metal: 0.3, rough: 0.6, glow: 0x7fd3ff },
  gold: { name: 'Royal Gold', body: 0xffffff, mid: 0xd9a21f, tex: 'gold', metal: 1, rough: 0.2, glow: 0xffd24a },
  circuit: { name: 'Neon Circuit', body: 0xffffff, mid: 0x1a2230, tex: 'circuit', metal: 0.6, rough: 0.35, glow: 0x00e5ff, emissiveMap: true },
  carbon: { name: 'Crimson Carbon', body: 0xffffff, mid: 0x1b1b1f, tex: 'carbon', metal: 0.5, rough: 0.35, glow: 0xff3030 },
  galaxy: { name: 'Galaxy', body: 0xffffff, mid: 0x2b1a5a, tex: 'galaxy', metal: 0.6, rough: 0.3, glow: 0xc86bff },
  magma: { name: 'Magma', body: 0xffffff, mid: 0x261310, tex: 'magma', metal: 0.4, rough: 0.5, glow: 0xff7a1a, emissiveMap: true },
};
/* ---- gun SKINS (whole-model redesigns, only for the main guns). Wraps above are just materials. ---- */
const RARITY = { rare: ['RARE', '#4aa3ff'], epic: ['EPIC', '#c06bff'], legendary: ['LEGENDARY', '#ffb020'] };
const GSKINS = {
  ar: [
    { id: 'dragon', name: 'Dragonfang', rar: 'legendary', col: 0xa31a1f, glow: 0xff3a1a, pal: { mid: 0x2a0a0c, steel: 0x5a1a1a, dark: 0x120506 },
      extra: () => {
        for (let i = 0; i < 6; i++) gcone(0.014, 0.06 - i * 0.003, 0, 0.082, -0.1 - i * 0.045, 0x120506);
        for (let i = 0; i < 4; i++) gcone(0.012, 0.05, 0, 0.108, 0.02 + i * 0.06, 0x120506, 'metal', -0.35);
        for (const sx of [-1, 1]) { gcone(0.014, 0.14, sx * 0.034, 0.06, -0.5, 0x1a0b0c, 'metal', -1.25, sx * 0.25); gcone(0.01, 0.06, sx * 0.016, -0.02, -0.52, 0xe8e0d0, 'metal', Math.PI); gbox(0.004, 0.022, 0.06, sx * 0.037, 0.03, 0.1, 0xff3a1a, 'glow'); for (let i = 0; i < 3; i++) gbox(0.004, 0.012, 0.05, sx * 0.034, 0.022, -0.12 - i * 0.07, 0xff6a2a, 'glow'); }
        gcone(0.018, 0.12, 0, -0.08, 0.5, 0x120506, 'metal', Math.PI + 0.5);
      } },
    { id: 'cyber', name: 'Cyber Core', rar: 'epic', col: 0x101a24, glow: 0x00e5ff, pal: { mid: 0x0c1118, steel: 0x7fa2b8, dark: 0x05080c },
      extra: () => {
        for (const [z, r] of [[-0.16, 0.05], [-0.26, 0.045], [-0.38, 0.04], [-0.5, 0.034]]) gtorus(r, 0.004, 0, 0.018, z, 0x00e5ff, 'glow');
        for (const sx of [-1, 1]) { gbox(0.004, 0.06, 0.2, sx * 0.046, 0.0, -0.2, 0x00e5ff, 'glow'); gbox(0.003, 0.006, 0.3, sx * 0.036, 0.045, 0.12, 0x00e5ff, 'glow'); }
        gbox(0.018, 0.1, 0.018, 0, -0.13, 0.07, 0x00e5ff, 'glow'); gbox(0.07, 0.01, 0.07, 0, 0.1, 0.0, 0x0c1118); gbox(0.05, 0.002, 0.05, 0, 0.106, 0.0, 0x00e5ff, 'glow');
      } },
    { id: 'steam', name: 'Steamwork', rar: 'rare', col: 0x9a6a2a, glow: 0xffb347, pal: { mid: 0x4a2f16, steel: 0xc08a4a, dark: 0x24160a, grip: 0x3a2410 },
      extra: () => {
        gcyl(0.011, 0.32, -0.048, 0.01, -0.15, 0xb8651b); gcyl(0.011, 0.14, -0.048, -0.04, 0.02, 0xb8651b); gcyl(0.026, 0.22, 0, -0.045, -0.28, 0x9a6a2a);
        gdisc(0.03, 0.01, -0.042, 0.02, 0.12, 0xc08a4a); for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; gbox(0.01, 0.012, 0.012, -0.044, 0.02 + Math.sin(a) * 0.034, 0.12 + Math.cos(a) * 0.034, 0xc08a4a); }
        gdisc(0.02, 0.012, -0.042, 0.06, 0.2, 0x24160a); gdisc(0.015, 0.014, -0.043, 0.06, 0.2, 0xffb347, 'glow'); gbox(0.004, 0.014, 0.003, -0.05, 0.062, 0.2, 0x24160a);
        gcyl(0.012, 0.2, 0, 0.1, 0.0, 0x8a4a14); gcone(0.016, 0.03, 0, 0.1, -0.1, 0x8a4a14, 'metal', -Math.PI / 2);
      } },
  ],
  smg: [
    { id: 'hornet', name: 'Hornet', rar: 'rare', col: 0xe3b81a, glow: 0xffd000, pal: { mid: 0x1a1a1a, steel: 0x777777, dark: 0x0a0a0a },
      extra: () => {
        for (let i = 0; i < 4; i++) gbox(0.073, 0.088, 0.022, 0, 0.01, -0.05 + i * 0.07, 0x141414, 'poly');
        gcone(0.014, 0.12, 0, 0.012, -0.4, 0x111111, 'metal', -Math.PI / 2); for (const sx of [-1, 1]) { gbox(0.1, 0.004, 0.13, sx * 0.075, 0.06, 0.1, 0x1a1a1a, 'poly', 0, sx * 0.3); gbox(0.07, 0.004, 0.09, sx * 0.07, 0.05, 0.2, 0x1a1a1a, 'poly', 0, sx * 0.2); gbox(0.004, 0.02, 0.05, sx * 0.037, 0.03, 0.0, 0xffd000, 'glow'); }
      } },
    { id: 'bubble', name: 'Bubblegum', rar: 'epic', col: 0xff6fb5, glow: 0x7ffcff, pal: { mid: 0xff9fcf, steel: 0xffffff, dark: 0x7a2a58, grip: 0xffe0f0 },
      extra: () => {
        gsph(0.04, 0, 0.012, -0.38, 0xff9fcf, 'poly'); gsph(0.025, 0.03, 0.03, -0.36, 0xffd0ea, 'poly');
        gsph(0.03, -0.055, 0.0, 0.05, 0xff3d8f, 'poly'); gcyl(0.006, 0.08, -0.055, -0.04, 0.05, 0xffffff); gbox(0.004, 0.004, 0.004, -0.05, 0.0, 0.05, 0xffffff);
        for (let i = 0; i < 4; i++) gbox(0.073, 0.088, 0.012, 0, 0.01, -0.02 + i * 0.06, 0xffffff, 'poly');
        for (const [x, z] of [[-0.04, 0.0], [-0.04, 0.2], [0.04, 0.1]]) gbox(0.012, 0.012, 0.012, x, 0.08, z, 0xfff27a, 'glow', 0.6, 0.6);
      } },
  ],
  shotgun: [
    { id: 'skull', name: 'Bonecrusher', rar: 'legendary', col: 0xe6dcc0, glow: 0x66ff88, pal: { mid: 0x3b2f22, steel: 0x8a8070, wood: 0xd8ccb0, grip: 0x2a2218, dark: 0x181410 },
      extra: () => {
        gsph(0.058, 0, 0.0, 0.54, 0xe6dcc0, 'poly'); gbox(0.07, 0.04, 0.06, 0, -0.05, 0.54, 0xe6dcc0, 'poly');
        for (const sx of [-1, 1]) { gsph(0.014, sx * 0.024, 0.01, 0.5, 0x66ff88, 'glow'); gbox(0.008, 0.012, 0.006, sx * 0.016, -0.075, 0.5, 0x3b2f22); }
        gcone(0.01, 0.025, 0, -0.01, 0.495, 0x3b2f22, 'metal', -Math.PI / 2);
        for (let i = 0; i < 11; i++) gbox(0.016, 0.014, 0.022, 0, 0.065, 0.2 - i * 0.05, 0xe6dcc0, 'poly');
        for (let i = 0; i < 5; i++) { gbox(0.074, 0.007, 0.012, 0, -0.012, -0.15 - i * 0.032, 0xe6dcc0, 'poly'); }
        for (const sx of [-1, 1]) gcone(0.012, 0.05, sx * 0.014, 0.0, -0.66, 0xe6dcc0, 'poly', -Math.PI / 2);
      } },
    { id: 'thunder', name: 'Thunderclap', rar: 'epic', col: 0x1a3a8a, glow: 0x66ccff, pal: { mid: 0x0e1d44, steel: 0xb8d4ff, dark: 0x050a1a, wood: 0x14285e },
      extra: () => {
        for (let i = 0; i < 6; i++) gtorus(0.03 - i * 0.002, 0.005, 0, 0.03, -0.2 - i * 0.07, 0x66ccff, 'glow');
        gsph(0.022, 0, 0.03, -0.68, 0xbfeaff, 'glow');
        const zz = [[0.0, 0.05], [0.025, 0.02], [-0.02, -0.01], [0.02, -0.04]]; zz.forEach(([x, y], i) => gbox(0.004, 0.034, 0.008, -0.037, 0.0 + y, 0.12 + x, 0xbfeaff, 'glow', 0, i % 2 ? 0.7 : -0.7));
      } },
  ],
  sniper: [
    { id: 'frost', name: 'Frostbite', rar: 'epic', col: 0x9fd8ff, glow: 0x7fe3ff, pal: { mid: 0x2a4a68, steel: 0xe8f6ff, dark: 0x0a1a2a },
      extra: () => {
        for (let i = 0; i < 5; i++) gcone(0.018 - i * 0.002, 0.12 - i * 0.012, (i % 2 ? 1 : -1) * 0.03, 0.03, 0.0 - i * 0.12, 0x7fe3ff, 'glow', 0, (i % 2 ? -1 : 1) * 0.5);
        for (let i = 0; i < 4; i++) gcone(0.012, 0.09 - i * 0.012, 0, -0.04, -0.2 - i * 0.07, 0xc8f0ff, 'glow', Math.PI);
        gcone(0.03, 0.18, 0, 0.09, 0.3, 0x7fe3ff, 'glow', 0.5); gcone(0.02, 0.12, 0.03, 0.08, 0.32, 0xc8f0ff, 'glow', 0.6, -0.5);
      } },
    { id: 'eagle', name: 'Golden Eagle', rar: 'legendary', col: 0xd4a017, glow: 0xffd24a, pal: { mid: 0x3a2a08, steel: 0xfff0b0, dark: 0x14100a },
      extra: () => {
        for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) gbox(0.006, 0.014, 0.13 - i * 0.012, sx * 0.04, 0.0 + i * 0.016, 0.3 - i * 0.012, i % 2 ? 0xfff0b0 : 0xd4a017, 'metal', 0, sx * (0.25 + i * 0.06));
        gcone(0.02, 0.07, 0, -0.02, -0.9, 0xd4a017, 'metal', -Math.PI / 2 + 0.5); gsph(0.01, 0.0, 0.025, -0.82, 0xffd24a, 'glow');
        for (const sx of [-1, 1]) gsph(0.008, sx * 0.034, 0.03, -0.18, 0xffd24a, 'glow');
      } },
  ],
  pistol: [
    { id: 'lunar', name: 'Lunar', rar: 'epic', col: 0xe8eef8, glow: 0xaad4ff, pal: { mid: 0x6a7a96, steel: 0xffffff, dark: 0x1a2030, grip: 0x2a3552 },
      extra: () => {
        gcrescent(-0.0245, 0.015, -0.005, 0.03, 0xaad4ff); gbox(0.004, 0.008, 0.008, -0.0245, 0.04, 0.06, 0xffffff, 'glow', 0, 0.8); gbox(0.004, 0.006, 0.006, -0.0245, -0.01, 0.07, 0xffffff, 'glow', 0, 0.8);
        gtorus(0.022, 0.003, 0, 0.015, -0.17, 0xaad4ff, 'glow');
      } },
    { id: 'revenant', name: 'Revenant', rar: 'legendary', col: 0x1a1f1a, glow: 0x39ff6a, pal: { mid: 0x0c120c, steel: 0x6a8a6a, dark: 0x050805, grip: 0x101510 },
      extra: () => {
        for (let i = 0; i < 5; i++) gcone(0.01, 0.04 + (i % 2) * 0.025, 0, 0.062, -0.09 + i * 0.04, 0x39ff6a, 'glow');
        gsph(0.017, -0.026, 0.012, 0.02, 0xcfe8cf, 'poly'); gbox(0.006, 0.01, 0.014, -0.036, 0.0, 0.02, 0x0c120c); gsph(0.004, -0.04, 0.02, 0.012, 0x39ff6a, 'glow'); gsph(0.004, -0.04, 0.02, 0.028, 0x39ff6a, 'glow');
        for (let i = 0; i < 4; i++) gtorus(0.008, 0.002, -0.0, -0.15 + i * 0.012, 0.13, 0x6a8a6a, 'metal');
      } },
  ],
  revolver: [
    { id: 'wild', name: 'Sheriff', rar: 'rare', col: 0xc9ced6, glow: 0xffd24a, pal: { mid: 0x8a6a40, steel: 0xffffff, dark: 0x3a3026, wood: 0x6b3a1a },
      extra: () => {
        for (let i = 0; i < 5; i++) gbox(0.003, 0.05, 0.004, -0.0235, 0.0, -0.01 + i * 0.022, 0x3a3026, 'metal', 0.5);
        for (const z of [-0.12, -0.2, -0.27]) gtorus(0.017, 0.004, 0, 0.026, z, 0xd9a21f, 'metal');
        gbox(0.01, 0.034, 0.034, -0.04, -0.09, 0.12, 0xd9a21f, 'metal', 0.3, 0.8); gbox(0.01, 0.034, 0.034, -0.04, -0.09, 0.12, 0xd9a21f, 'metal', 0.3, 0.0);
      } },
    { id: 'hell', name: 'Hellfire', rar: 'legendary', col: 0x1a0d0d, glow: 0xff5a14, pal: { mid: 0x2a1010, steel: 0xaa3a1a, dark: 0x0a0505, wood: 0x2a0d0d },
      extra: () => {
        for (let i = 0; i < 5; i++) gcone(0.012, 0.05 + (i % 3) * 0.02, 0, 0.04, -0.1 - i * 0.04, 0xff5a14, 'glow', 0.15);
        gtorus(0.037, 0.004, 0, 0.012, -0.03, 0xff5a14, 'glow'); gcyl(0.0375, 0.012, 0, 0.012, 0.0, 0xff5a14, 'glow');
        for (const sx of [-1, 1]) gcone(0.008, 0.05, sx * 0.01, 0.07, 0.1, 0x1a0d0d, 'metal', 0.2, sx * 0.4);
      } },
  ],
};
const gskinOf = (id) => { const l = GSKINS[id]; const k = prefs.models && prefs.models[id]; return l && k ? (l.find((s) => s.id === k) || null) : null; };
if (HALLOWEEN) {
  const hwS = (a, s) => { (GSKINS[a] = GSKINS[a] || []).push(s); };
  hwS('ar', { id: 'hw_jack', name: 'Jack-o-Rifle', rar: 'epic', col: 0xff7a1a, glow: 0xffd24a, pal: { mid: 0x1a0c04, steel: 0x3a2a1c, dark: 0x0a0603 },
    extra: () => { gcone(0.02, 0.09, 0, 0.1, -0.02, 0x2f6a22); for (const sx of [-1, 1]) gbox(0.004, 0.022, 0.06, sx * 0.037, 0.03, 0.1, 0xffd24a, 'glow'); } });
  hwS('smg', { id: 'hw_phantom', name: 'Phantom', rar: 'epic', col: 0xdfe8f0, glow: 0x7dffa0, pal: { mid: 0x5a6a78, steel: 0xffffff, dark: 0x1a2430, grip: 0x2a3a48 },
    extra: () => { for (const sx of [-1, 1]) gbox(0.004, 0.02, 0.07, sx * 0.037, 0.02, 0.08, 0x7dffa0, 'glow'); } });
  hwS('shotgun', { id: 'hw_witch', name: 'Witchbane', rar: 'legendary', col: 0x4b2a82, glow: 0x7dff3a, pal: { mid: 0x1a0c2e, steel: 0x6a4aa0, dark: 0x0a0414, grip: 0x14081f, wood: 0x2a1546 },
    extra: () => { gcone(0.02, 0.1, 0, 0.09, -0.3, 0x2f1650); for (const sx of [-1, 1]) gbox(0.004, 0.02, 0.08, sx * 0.034, 0.03, -0.1, 0x7dff3a, 'glow'); } });
  hwS('pistol', { id: 'hw_spooky', name: 'Spooky', rar: 'epic', col: 0xff7a1a, glow: 0xc06bff, pal: { mid: 0x1a0c04, steel: 0x6a3a1a, dark: 0x0a0603, grip: 0x2a1446 },
    extra: () => { gtorus(0.02, 0.003, 0, 0.015, -0.17, 0xc06bff, 'glow'); } });
}
const EMOJIS = ['🎯', '🐺', '🦅', '🐉', '💀', '⚡', '🧠', '🦊'];
if (HALLOWEEN) EMOJIS.push('🎃', '👻', '🧛');
const prefs = { primary: 'ar', secondary: 'pistol', melee: 'katana', admin: 'admin', diff: 'normal', time: 180, sens: 1, bob: 1, name: 'YOU', emoji: '🎯', skins: {}, models: {}, cross: '#ffffff', keys: {}, fov: 75, vol: 0.5, limit: 0 };
try {
  const o = JSON.parse(localStorage.getItem('ab_prefs') || '{}');
  for (const k of Object.keys(prefs)) if (o[k] !== undefined && typeof o[k] === typeof prefs[k]) prefs[k] = o[k];
  for (let i = 0; i < 3; i++) if (!WEAPONS[prefs[SLOTN[i]]] || WEAPONS[prefs[SLOTN[i]]].slot !== i) prefs[SLOTN[i]] = ['ar', 'pistol', 'katana'][i];
  if (!DIFFS[prefs.diff]) prefs.diff = 'normal';
  prefs.sens = Math.max(0.3, Math.min(2.5, prefs.sens));
  prefs.bob = Math.max(0, Math.min(2, prefs.bob));
  if (![60, 120, 180, 300].includes(prefs.time)) prefs.time = 180;
  if (!prefs.skins || typeof prefs.skins !== 'object') prefs.skins = {};
  for (const k of Object.keys(prefs.skins)) if (!SKINS[prefs.skins[k]]) delete prefs.skins[k];
  if (!prefs.models || typeof prefs.models !== 'object') prefs.models = {};
  for (const k of Object.keys(prefs.models)) if (!GSKINS[k] || !GSKINS[k].some((x) => x.id === prefs.models[k])) delete prefs.models[k];
} catch (e) { /* ignore */ }
prefs.fov = Math.max(60, Math.min(100, +prefs.fov || 75)); prefs.vol = Math.max(0, Math.min(1, isNaN(+prefs.vol) ? 0.5 : +prefs.vol)); if (![0, 15, 25, 40].includes(prefs.limit)) prefs.limit = 0;
function savePrefs() { try { localStorage.setItem('ab_prefs', JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
const inv = { cur: 0, last: 1, store: {} };
const curId = () => prefs[SLOTN[inv.cur]];
const curW = () => WEAPONS[curId()];
function stashAmmo() {
  const w = curW();
  if (!w.melee) inv.store[curId()] = { ammo: player.ammo, reserve: player.reserve };
}
function loadCur() {
  const id = curId(), w = WEAPONS[id];
  if (w.melee) { player.mag = 0; player.ammo = 0; player.reserve = 0; return; }
  const st = inv.store[id] || (inv.store[id] = { ammo: w.mag, reserve: w.res });
  player.mag = w.mag; player.ammo = st.ammo; player.reserve = st.reserve;
}
function equip(slot) {
  if (player.dead || slot === inv.cur || slot < 0 || slot > 3 || (slot === 3 && !admin.auth)) return;
  stashAmmo();
  inv.last = inv.cur;
  inv.cur = slot;
  player.reloadT = 0; player.ads = false; player.swapT = 0.35; player.fireCd = Math.max(player.fireCd, 0.3);
  loadCur();
  buildViewModel();
}
function resetInventory() {
  player.abCd = {}; player.abT = 0; player.abId = '';
  inv.store = {};
  for (let i = 0; i < 2; i++) { const w = WEAPONS[prefs[SLOTN[i]]]; inv.store[prefs[SLOTN[i]]] = { ammo: w.mag, reserve: w.res }; }
  inv.cur = 0; inv.last = 1;
  player.reloadT = 0; player.swapT = 0; player.ads = false;
  loadCur();
  buildViewModel();
}
function refillAmmo() {
  stashAmmo();
  let got = false;
  for (let i = 0; i < 2; i++) {
    const id = prefs[SLOTN[i]], w = WEAPONS[id], st = inv.store[id];
    if (st && st.reserve < w.res * 2) { st.reserve = Math.min(w.res * 2, st.reserve + Math.ceil(w.res / 2)); got = true; }
  }
  loadCur();
  return got;
}
playerInfo.name = prefs.name; playerInfo.emoji = prefs.emoji;

/* ================= CAREER: XP, levels, stats, weapon mastery, achievements ================= */
const GAME_VERSION = '2.1';
const CAREER_DEF = { xp: 0, matches: 0, wins: 0, kills: 0, deaths: 0, heads: 0, melee: 0, boom: 0, bestStreak: 0, bestMulti: 0, bestMatch: 0, secs: 0, perfect: 0, wk: {}, ach: {}, mw: {}, seenVer: '' };
const career = JSON.parse(JSON.stringify(CAREER_DEF));
try {
  const o = JSON.parse(localStorage.getItem('ab_career') || '{}');
  for (const k in CAREER_DEF) if (o[k] !== undefined && typeof o[k] === typeof CAREER_DEF[k]) career[k] = o[k];
} catch (e) { /* ignore */ }
function saveCareer() { try { localStorage.setItem('ab_career', JSON.stringify(career)); } catch (e) { /* ignore */ } }
const xpFor = (lv) => 100 + (lv - 1) * 60; // XP needed to go from level lv to lv+1
function levelInfo(xp) { let lv = 1; while (xp >= xpFor(lv)) { xp -= xpFor(lv); lv++; } return { lv, cur: xp, need: xpFor(lv) }; }
const RANKS = [['ROOKIE', '#9aa7bd'], ['RECRUIT', '#7fd18b'], ['SOLDIER', '#4aa3ff'], ['VETERAN', '#c06bff'], ['ELITE', '#ff9a2e'], ['CHAMPION', '#ff5a5a'], ['LEGEND', '#ffd24a']];
const rankOf = (lv) => RANKS[Math.min(RANKS.length - 1, Math.floor((lv - 1) / 5))];
const TIERS = [[100, 'DIAMOND', '#5be7ff'], [50, 'GOLD', '#ffc933'], [25, 'SILVER', '#c0c8d4'], [10, 'BRONZE', '#cd7f32']];
const tierOf = (k) => TIERS.find((t) => k >= t[0]) || null;
const nextTier = (k) => [...TIERS].reverse().find((t) => k < t[0]) || null;
const ACHS = [
  ['first', 'FIRST BLOOD', 'Get your first kill', '🩸', () => [career.kills, 1]],
  ['k100', 'CENTURION', 'Reach 100 total kills', '💯', () => [career.kills, 100]],
  ['k500', 'WARLORD', 'Reach 500 total kills', '👑', () => [career.kills, 500]],
  ['head10', 'SHARPSHOOTER', 'Land 10 headshot kills', '🎯', () => [career.heads, 10]],
  ['head50', 'DEAD EYE', 'Land 50 headshot kills', '👁️', () => [career.heads, 50]],
  ['melee10', 'UP CLOSE', 'Get 10 melee kills', '🗡️', () => [career.melee, 10]],
  ['boom10', 'DEMOLITION', 'Get 10 explosion kills', '💥', () => [career.boom, 10]],
  ['streak5', 'UNSTOPPABLE', '5 kills without dying', '🔥', () => [career.bestStreak, 5]],
  ['streak10', 'GODLIKE', '10 kills without dying', '⚡', () => [career.bestStreak, 10]],
  ['multi3', 'TRIPLE THREAT', '3 kills within 4 seconds', '☠️', () => [career.bestMulti, 3]],
  ['win1', 'VICTORY', 'Win a match', '🏆', () => [career.wins, 1]],
  ['win10', 'CHAMPION', 'Win 10 matches', '🥇', () => [career.wins, 10]],
  ['play10', 'REGULAR', 'Play 10 matches', '🎮', () => [career.matches, 10]],
  ['perfect', 'UNTOUCHABLE', 'Win a match without dying', '🛡️', () => [career.perfect, 1]],
  ['master', 'SPECIALIST', '25 kills with one weapon', '🔫', () => [Math.max(0, ...Object.values(career.wk)), 25]],
  ['arsenal', 'ARSENAL', 'Get kills with 10 different weapons', '🧰', () => [Object.keys(career.wk).length, 10]],
  ['lv10', 'SEASONED', 'Reach level 10', '⭐', () => [levelInfo(career.xp).lv, 10]],
  ['night', 'NIGHT SHIFT', 'Win a match on Neon Factory', '🌃', () => [career.mw.factory || 0, 1]],
];
if (HALLOWEEN) ACHS.push(['trick', 'TRICK OR TREAT', 'Win a match on Haunted Graveyard', '🎃', () => [career.mw.graveyard || 0, 1]]);
function checkAch() {
  for (const a of ACHS) {
    if (career.ach[a[0]]) continue;
    const p = a[4]();
    if (p[0] >= p[1]) { career.ach[a[0]] = 1; try { banner('ACHIEVEMENT UNLOCKED - ' + a[1], 2600); sfx.pickup(); } catch (e) { /* ignore */ } }
  }
}
let matchStats = { kills: 0, heads: 0, deaths: 0, on: false };
function careerStart() { matchStats = { kills: 0, heads: 0, deaths: 0, on: true }; }
function careerKill(kind) {
  const id = curId(); const before = tierOf(career.wk[id] || 0);
  career.kills++; matchStats.kills++;
  if (kind === 'head') { career.heads++; matchStats.heads++; }
  if (kind === 'blast') career.boom++;
  else {
    const w = WEAPONS[id];
    if (w && w.melee) career.melee++;
    career.wk[id] = (career.wk[id] || 0) + 1;
    const after = tierOf(career.wk[id]);
    if (after && after !== before) { try { banner('MASTERY - ' + w.name.toUpperCase() + ' ' + after[1], 2400); } catch (e) { /* ignore */ } }
  }
  checkAch(); saveCareer();
}
function careerEnd(iWon, rank) {
  if (!matchStats.on) return '';
  matchStats.on = false;
  const lvBefore = levelInfo(career.xp).lv;
  const parts = [['KILLS x' + matchStats.kills, matchStats.kills * 10]];
  if (matchStats.heads) parts.push(['HEADSHOTS x' + matchStats.heads, matchStats.heads * 5]);
  parts.push(['MATCH COMPLETE', 20]);
  if (iWon) parts.push(['VICTORY', 50]); else if (rank === 2) parts.push(['2ND PLACE', 25]); else if (rank === 3) parts.push(['3RD PLACE', 10]);
  if (HALLOWEEN) parts.push(['HALLOWEEN DOUBLE XP', parts.reduce((s, p) => s + p[1], 0)]);
  const gain = parts.reduce((s, p) => s + p[1], 0);
  career.xp += gain; career.matches++;
  if (iWon) { career.wins++; const mid = MAPS[selectedMap].id; career.mw[mid] = (career.mw[mid] || 0) + 1; if (matchStats.deaths === 0) career.perfect++; }
  career.bestMatch = Math.max(career.bestMatch, matchStats.kills);
  career.secs += Math.max(0, Math.round(ROUND_TIME - Math.max(0, roundT)));
  const li = levelInfo(career.xp);
  checkAch(); saveCareer();
  const up = li.lv > lvBefore;
  return `<div class="xpbox"><div class="xph">+${gain} XP${up ? ` <b class="lvup">LEVEL UP! ${lvBefore} &rarr; ${li.lv}</b>` : ''}</div>` +
    `<div class="xpl">${parts.map((p) => `<span>${p[0]} <em>+${p[1]}</em></span>`).join('')}</div>` +
    `<div class="xpbar"><s style="width:${Math.round(li.cur / li.need * 100)}%"></s></div><div class="xpn">LEVEL ${li.lv} &middot; ${li.cur} / ${li.need} XP</div></div>`;
}
const masteryTag = (id) => { const k = career.wk[id] || 0, t = tierOf(k); return t ? `<span style="color:${t[2]}">&#9733; ${t[1]}</span>` : ''; };
const fmtPlayed = (s) => (s >= 3600 ? Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm' : Math.floor(s / 60) + 'm ' + (s % 60) + 's');

/* ---- update log ---- */
const CHANGELOG = [
  { v: '2.1', name: 'HALLOWEEN + SMARTER BOTS', items: [
    ['NEW', 'HALLOWEEN EVENT (limited time, ends Nov 7): the whole game gets a spooky makeover.'],
    ['NEW', 'HAUNTED GRAVEYARD - a moonlit map with a glowing crypt, tombstones, lit jack-o-lanterns, drifting wisps and lightning.'],
    ['NEW', 'Spooky bots: Zombie, Witch, Jack, Ghost, Reaper, Vlad and Batty, each with their own hat.'],
    ['NEW', 'Glowing pumpkins on every map, plus a Halloween menu with flying bats.'],
    ['NEW', '4 event gun skins: Jack-o-Rifle, Phantom, Witchbane and Spooky.'],
    ['NEW', 'DOUBLE XP on every match, a Trick or Treat achievement, and extra avatars.'],
    ['NEW', 'Halloween app icon.'],
    ['NEW', 'SMARTER BOTS: bots now carry different weapon types - rifle, SMG, shotgun and sniper - and fight in different styles.'],
    ['IMPROVED', 'Bots dodge when shot: they sidestep and hop.'],
    ['IMPROVED', 'Hurt bots duck behind cover, then peek out again.'],
    ['IMPROVED', 'Bots aim better with smarter target leading, and rush in to finish weak players.'] ] },
  { v: '2.0', name: 'THE BREAKER UPDATE', items: [
    ['NEW', 'NEON FACTORY - a 4th map: a night-time factory floor with glowing conveyor lanes, a pulsing reactor in the middle and neon-lit towers in every corner.'],
    ['NEW', 'CAREER - you now earn XP for kills, headshots and wins. Level up through 7 ranks, from Rookie to Legend.'],
    ['NEW', 'STATS - lifetime matches, wins, kills, deaths, K/D, headshots, best streak and time played, saved on your device.'],
    ['NEW', '18 ACHIEVEMENTS with progress bars, from First Blood to Night Shift. A banner pops up the moment you unlock one.'],
    ['NEW', 'WEAPON MASTERY - every weapon tracks your kills and earns Bronze, Silver, Gold and Diamond marks. Shown in the loadout.'],
    ['NEW', 'KILL LIMIT - end solo matches early with First to 15 / 25 / 40 kills.'],
    ['NEW', 'FOV and VOLUME sliders in Settings.'],
    ['NEW', 'UPDATE LOG - this screen! New updates get a NEW badge on the home screen.'],
    ['IMPROVED', 'Results screen now shows an XP breakdown and level-ups.'],
    ['IMPROVED', 'Your level shows next to your name on the home screen.'] ] },
  { v: '1.3', name: 'THE NEW LOOK', items: [
    ['NEW', 'Brand new home screen with PLAY, LOADOUT, CONTROLS, ONLINE and SETTINGS.'],
    ['NEW', 'LOADOUT screen: pick guns by icon with stat bars, plus SKINS and WRAPS buttons for each gun.'],
    ['NEW', 'CONTROLS screen: every key listed, click any key to REBIND it, one button to reset.'],
    ['NEW', 'Crosshair colours, restyled pause and results screens.'],
    ['IMPROVED', 'Menu fits phones in landscape.'] ] },
  { v: '1.2', name: 'ADMIN TOOLS', items: [
    ['NEW', 'Admin option: shoot through walls.'] ] },
  { v: '1.1', name: 'STYLE UPDATE', items: [
    ['NEW', '9 weapon WRAPS: Woodland, Desert, Arctic, Gold, Neon Circuit, Carbon, Galaxy, Magma.'],
    ['NEW', 'Full-gun SKINS in Rare, Epic and Legendary for the main guns (Dragonfang and more).'] ] },
  { v: '1.0', name: 'TALK TO YOUR TEAM', items: [
    ['NEW', 'VOICE CHAT on PC and phone, asks for mic permission the first time.'],
    ['IMPROVED', 'Touch controls rebuilt: no overlapping buttons, cleaner layout, 10x better looking.'],
    ['IMPROVED', 'All weapon models rebuilt with far more detail.'] ] },
  { v: '0.9', name: 'POLISH', items: [
    ['NEW', 'TEXT CHAT for PC and mobile; other players see your messages.'],
    ['NEW', 'Balanced AIM ASSIST and AUTO SHOOT for phones.'],
    ['IMPROVED', 'Much more realistic shooting and reload animations.'],
    ['IMPROVED', 'Bots rebuilt with detail and textures. Maps filled with props and detail.'],
    ['FIXED', 'Aim assist and aim lock now aim at the torso instead of above the head.'] ] },
  { v: '0.8', name: 'MEGA ARSENAL', items: [
    ['NEW', '42 weapons across primaries, secondaries and melee.'],
    ['NEW', 'WEAPON ABILITIES on selected guns and blades: Overdrive, Barrier, Dash, Shockwave, Bloodlust and more.'],
    ['FIXED', 'Movement overhaul.'] ] },
  { v: '0.7', name: 'PLAY TOGETHER', items: [
    ['NEW', 'ONLINE MULTIPLAYER with 6-character room codes.'],
    ['NEW', 'Cross-play: PC and Android in the same match.'],
    ['NEW', 'Your room code is shown in the match so you can tell friends.'] ] },
  { v: '0.6', name: 'GO MOBILE', items: [
    ['NEW', 'ANDROID version with full touch controls.'],
    ['NEW', 'Custom shooting sounds for special weapons.'] ] },
  { v: '0.5', name: 'ADMIN PANEL', items: [
    ['NEW', 'Locked ADMIN PANEL with aimbot, aim lock, god mode and more.'],
    ['NEW', 'Admin Cannon weapon.'] ] },
  { v: '0.4', name: 'LOADOUTS', items: [
    ['NEW', 'Inventory: Primary, Secondary and Melee slots (katana and more).'],
    ['NEW', 'Bot difficulty and match length options.'] ] },
  { v: '0.3', name: 'MAP SELECT', items: [
    ['NEW', '3 maps: Concrete Yard, Sunset Docks, Frozen Ruins.'],
    ['FIXED', 'Slide-jump drift and movement not stopping.'] ] },
  { v: '0.2', name: 'DEATHMATCH', items: [
    ['NEW', '3-minute free-for-all against 7 bots, each with a unique avatar.'],
    ['NEW', 'Bots fight each other. Live leaderboard and kill feed.'],
    ['NEW', 'Slide and slide-jump, view bobbing, pickups and kill streaks.'] ] },
  { v: '0.1', name: 'FIRST BREAK', items: [
    ['NEW', 'First playable version: real rigid-body physics, destructible crates and barrels, grenades and ragdolls.'],
    ['NEW', 'Windows .exe build.'] ] },
];

/* ================= MENU: home / loadout / controls / online / settings ================= */
const menuEl = $('menu');
const ovEl = $('overlay');
let curScreen = 'home';
const esc = (t) => String(t).replace(/[<>&"]/g, '');
const hex6 = (n) => '#' + (n >>> 0).toString(16).padStart(6, '0');

/* ---- inline icons ---- */
const ICON = {
  gun: (c = '#9fb0c8') => `<svg viewBox="0 0 120 50" width="100%" height="100%"><path d="M4 18h70l6-7h24v9l-8 4H78l-6 20H56l3-20H4z" fill="${c}" stroke="#0a0d14" stroke-width="2" stroke-linejoin="round"/><rect x="82" y="23" width="12" height="3" fill="#0a0d14" opacity=".5"/></svg>`,
  blade: (c = '#dfe6ee', g = '#ffb347') => `<svg viewBox="0 0 120 50" width="100%" height="100%"><path d="M8 40 74 12l18-3-6 14-62 21z" fill="${c}" stroke="#0a0d14" stroke-width="2" stroke-linejoin="round"/><path d="M12 40 80 14" stroke="${g}" stroke-width="1.6" opacity=".8"/><rect x="88" y="5" width="6" height="26" rx="2" transform="rotate(28 91 18)" fill="#3a3f4a" stroke="#0a0d14" stroke-width="2"/><rect x="2" y="39" width="22" height="8" rx="3" transform="rotate(-24 13 43)" fill="#5a3a22" stroke="#0a0d14" stroke-width="2"/></svg>`,
  skins: `<svg viewBox="0 0 40 40"><path d="M3 20h20l3-4h8v6l-4 3h-7l-3 8h-5l2-8H3z" fill="#c06bff" stroke="#0a0d14" stroke-width="1.5" stroke-linejoin="round"/><path d="M31 4l1.8 4.2L37 10l-4.2 1.8L31 16l-1.8-4.2L25 10l4.2-1.8z" fill="#ffd24a" stroke="#0a0d14" stroke-width="1"/></svg>`,
  wraps: `<svg viewBox="0 0 40 40"><rect x="4" y="9" width="32" height="22" rx="5" fill="#1b2438" stroke="#3de0ff" stroke-width="2"/><path d="M4 26 22 9h8L8 31zM18 31 34 15v8L26 31z" fill="#3de0ff" opacity=".85"/><path d="M4 14 9 9h6L4 20z" fill="#ff9a2e"/></svg>`,
};
const mixc = (c, t, k) => { const r = ((c >> 16) & 255) * (1 - k) + ((t >> 16) & 255) * k, g = ((c >> 8) & 255) * (1 - k) + ((t >> 8) & 255) * k, b = (c & 255) * (1 - k) + (t & 255) * k; return ((r << 16) | (g << 8) | b) >>> 0; };
const wIcon = (id) => { const w = WEAPONS[id]; return w.melee ? ICON.blade(hex6(mixc(w.col, 0xdfe6ee, 0.4)), hex6(w.glow || 0xffb347)) : ICON.gun(hex6(mixc(w.col, 0xb4c2da, 0.6))); };

/* ---- 3D preview renderer (queued so the menu never freezes) ---- */
const skinPv = {};
function renderGunPreview(id) {
  try {
    if (!skinPv.scene) {
      const sc = new THREE.Scene();
      sc.add(new THREE.HemisphereLight(0xffffff, 0x445066, 1.6));
      const dl = new THREE.DirectionalLight(0xffffff, 2.4); dl.position.set(-2, 3, 3); sc.add(dl);
      const dl2 = new THREE.DirectionalLight(0x88aaff, 1.0); dl2.position.set(3, 1, -2); sc.add(dl2);
      const rt = new THREE.WebGLRenderTarget(300, 150); rt.texture.colorSpace = THREE.SRGBColorSpace;
      Object.assign(skinPv, { scene: sc, rt, cam: new THREE.PerspectiveCamera(24, 2, 0.05, 20), grp: new THREE.Group(), cv: document.createElement('canvas') });
      sc.add(skinPv.grp); skinPv.cv.width = 300; skinPv.cv.height = 150;
    }
    for (const c of gun.children.slice()) if (c !== flashMesh) gun.remove(c);
    buildGunModel(id);
    skinPv.grp.clear();
    const hold = new THREE.Group();
    for (const c of gun.children) if (c !== flashMesh) hold.add(c.clone(true));
    hold.rotation.y = -1.15; hold.rotation.x = 0.12;
    const box = new THREE.Box3().setFromObject(hold), ctr = new THREE.Vector3(), sz = new THREE.Vector3();
    box.getCenter(ctr); box.getSize(sz);
    hold.position.sub(ctr);
    skinPv.grp.add(hold);
    const dist = Math.max(sz.x, sz.y * 2, sz.z) * 1.9 + 0.2;
    skinPv.cam.position.set(0, 0.04, dist); skinPv.cam.lookAt(0, 0, 0);
    const oc = renderer.getClearColor(new THREE.Color()), oa = renderer.getClearAlpha();
    renderer.setRenderTarget(skinPv.rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(skinPv.scene, skinPv.cam); renderer.setRenderTarget(null); renderer.setClearColor(oc, oa);
    const buf = new Uint8Array(300 * 150 * 4);
    renderer.readRenderTargetPixels(skinPv.rt, 0, 0, 300, 150, buf);
    let any = 0; for (let i = 3; i < buf.length; i += 4) if (buf[i]) { any = 1; break; }
    if (!any) return null; // nothing drawn: the menu falls back to the icon
    const g2 = skinPv.cv.getContext('2d'), im = g2.createImageData(300, 150);
    for (let y = 0; y < 150; y++) im.data.set(buf.subarray((149 - y) * 1200, (150 - y) * 1200), y * 1200);
    g2.putImageData(im, 0, 0);
    return skinPv.cv.toDataURL('image/png');
  } catch (e) { return null; }
}

const pvCache = {}; const pvQ = []; let pvBusy = false;
const pvKey = (id, m, w) => id + '|' + (m || '') + '|' + (w || 'default');
function paintPv(k, url) {
  document.querySelectorAll('[data-pv]').forEach((el) => {
    if (el.dataset.pv !== k) return;
    if (url) el.innerHTML = `<img src="${url}" alt="">`;
  });
}
function wantPv(id, m, w) { // returns cached url or queues a render
  if (WEAPONS[id].melee) return null;
  const k = pvKey(id, m, w);
  if (k in pvCache) return pvCache[k] || null;
  if (!pvQ.some((j) => j.k === k)) { pvQ.push({ id, m, w, k }); pumpPv(); }
  return null;
}
function pumpPv() {
  if (pvBusy) return;
  pvBusy = true;
  const step = () => {
    let n = 0;
    while (pvQ.length && n < 3) {
      const j = pvQ.shift(); n++;
      if (j.k in pvCache) continue;
      const pm = prefs.models[j.id], ps = prefs.skins[j.id];
      if (j.m) prefs.models[j.id] = j.m; else delete prefs.models[j.id];
      if (j.w && j.w !== 'default') prefs.skins[j.id] = j.w; else delete prefs.skins[j.id];
      let url = null;
      try { url = renderGunPreview(j.id); } catch (e) { url = null; }
      if (pm) prefs.models[j.id] = pm; else delete prefs.models[j.id];
      if (ps) prefs.skins[j.id] = ps; else delete prefs.skins[j.id];
      pvCache[j.k] = url || 0;
      paintPv(j.k, url);
    }
    if (pvQ.length) requestAnimationFrame(step);
    else { pvBusy = false; try { buildViewModel(); } catch (e) { /* ignore */ } }
  };
  requestAnimationFrame(step);
}
const modelIdOf = (id) => prefs.models[id] || '';
const mWrap = (id) => skinOf(id);
function pvHtml(id, m, w, key) { // an element that fills with the preview image when ready
  const k = key || pvKey(id, m, w);
  const url = wantPv(id, m, w);
  return `<div class="pv" data-pv="${k}">${url ? `<img src="${url}" alt="">` : wIcon(id)}</div>`;
}

/* ---- map picker ---- */
let selectedMap = 0;
try {
  const m = parseInt(localStorage.getItem('ab_map') || '0', 10);
  if (m >= 0 && m < MAPS.length) selectedMap = m;
} catch (e) { /* ignore */ }
const mapsEl = $('maps');
function renderMaps() {
  mapsEl.innerHTML = MAPS.map((m, i) =>
    `<div class="mapcard${i === selectedMap ? ' sel' : ''}" data-i="${i}">` +
    `<div class="sw emoji" style="background:linear-gradient(180deg, ${m.preview[0]} 0%, ${m.preview[0]} 48%, ${m.preview[1]} 49%, ${m.preview[1]} 100%)">${m.icon}</div>` +
    `<div class="mn">${esc(m.name.toUpperCase())}</div><div class="md">${m.blurb}</div></div>`
  ).join('');
}
function selectMap(i) {
  if (state !== 'menu') return;
  selectedMap = i;
  applyTheme(MAPS[i].theme); // the backdrop previews the map's sky and light
  renderMaps(); renderPlaySub();
  try { localStorage.setItem('ab_map', String(i)); } catch (e) { /* ignore */ }
}
mapsEl.addEventListener('click', (e) => {
  const card = e.target && e.target.closest ? e.target.closest('.mapcard') : null;
  if (card) selectMap(parseInt(card.dataset.i, 10));
});
applyTheme(MAPS[selectedMap].theme);
function renderPlaySub() {
  const el = $('playsub');
  if (el) el.textContent = menuEl.dataset.mode === 'pause' ? 'BACK TO THE FIGHT' : MAPS[selectedMap].name.toUpperCase() + '  /  ' + (prefs.time / 60) + ' MIN  /  ' + prefs.diff.toUpperCase();
  $('pchipav').textContent = prefs.emoji; $('pchipname').textContent = prefs.name + '  LV ' + levelInfo(career.xp).lv;
}

/* ---- skins / wraps helpers ---- */
const skinOf = (id) => SKINS[(prefs.skins && prefs.skins[id]) || 'default'] ? (prefs.skins[id] || 'default') : 'default';

/* ---- home: loadout summary ---- */
function renderHome() {
  renderMaps(); renderPlaySub();
  $('sumload').innerHTML = [0, 1, 2].map((s) => {
    const id = prefs[SLOTN[s]], w = WEAPONS[id], gs = gskinOf(id), wr = skinOf(id);
    const tag = gs ? `<span style="color:${RARITY[gs.rar][1]}">${esc(gs.name)}</span>` : (wr !== 'default' ? esc(SKINS[wr].name) : '');
    return `<div class="sl" data-tab="${s}"><div class="k">${['PRIMARY', 'SECONDARY', 'MELEE'][s]}</div>${pvHtml(id, modelIdOf(id), mWrap(id))}<b>${esc(w.name.toUpperCase())}</b><em>${tag}</em></div>`;
  }).join('');
}
$('sumload').addEventListener('click', (e) => {
  const c = e.target.closest('.sl'); if (!c) return;
  ld.tab = parseInt(c.dataset.tab, 10); ld.sub = null; showScreen('loadout');
});

/* ---- loadout ---- */
const ld = { tab: 0, sub: null };
const STATS = {
  gun: [['DAMAGE', (w) => w.dmg * w.pellets, (w) => Math.round(w.dmg) + (w.pellets > 1 ? 'x' + w.pellets : '')], ['FIRE RATE', (w) => 1 / w.rof, (w) => Math.round(1 / w.rof) + '/s'],
    ['MAGAZINE', (w) => w.mag, (w) => w.mag], ['ACCURACY', (w) => 1 / (w.spread + 0.002), (w) => Math.round(100 - Math.min(99, w.spread * 1800)) + '%'], ['RELOAD', (w) => 1 / w.reload, (w) => w.reload.toFixed(1) + 's']],
  melee: [['DAMAGE', (w) => w.dmg, (w) => w.dmg], ['SPEED', (w) => 1 / w.cd, (w) => (1 / w.cd).toFixed(1) + '/s'], ['REACH', (w) => w.range, (w) => w.range.toFixed(1) + 'm'], ['KNOCKBACK', (w) => w.kb, (w) => w.kb]],
};
const maxOf = {};
function statMax(kind, i) {
  const k = kind + i;
  if (maxOf[k]) return maxOf[k];
  let m = 0.0001;
  for (const id in WEAPONS) { const w = WEAPONS[id]; if (w.slot > 2) continue; if (!!w.melee !== (kind === 'melee')) continue; m = Math.max(m, STATS[kind][i][1](w)); }
  return (maxOf[k] = m);
}
function renderLoadout() {
  const slot = ld.tab, cur = prefs[SLOTN[slot]];
  const ids = Object.keys(WEAPONS).filter((k) => WEAPONS[k].slot === slot);
  const tabs = ['PRIMARY', 'SECONDARY', 'MELEE'].map((n, i) => `<button class="tab${i === slot ? ' on' : ''}" data-tab="${i}">${n}<kbd>${i + 1}</kbd></button>`).join('');
  const cards = ids.map((k) => {
    const w = WEAPONS[k];
    return `<div class="wc${k === cur ? ' on' : ''}" data-w="${k}">${pvHtml(k, modelIdOf(k), mWrap(k))}<b>${esc(w.name.toUpperCase())}</b><div class="ab">${w.ability ? esc(ABILITIES[w.ability].name) : ''}</div><div class="ms">${masteryTag(k)}</div></div>`;
  }).join('');
  $('scr-loadout').innerHTML =
    `<div class="shead"><button class="back" data-go="home">&#8592; BACK</button><h2>LOADOUT</h2><div class="tabs">${tabs}</div></div>` +
    `<div class="sbody"><div id="ldwrap"><div id="wgrid">${cards}</div><div id="wdet">${detailHtml(cur)}</div></div></div>`;
}
function detailHtml(id) {
  const w = WEAPONS[id], melee = !!w.melee, gs = gskinOf(id), wr = skinOf(id);
  const rows = STATS[melee ? 'melee' : 'gun'].map((s, i) => `<div class="stat"><span>${s[0]}</span><i><s style="width:${Math.max(4, Math.min(100, s[1](w) / statMax(melee ? 'melee' : 'gun', i) * 100))}%"></s></i><em>${s[2](w)}</em></div>`).join('');
  const hasSk = !!GSKINS[id], hasWr = !melee;
  const sub = ld.sub === 'skins' && hasSk ? subSkins(id) : ld.sub === 'wraps' && hasWr ? subWraps(id) : (ld.sub ? `<div class="note">${melee ? 'Melee weapons have no skins or wraps yet.' : 'This gun has no full skins - try a wrap!'}</div>` : '');
  return `<div class="big-pv" data-pv="${pvKey(id, modelIdOf(id), mWrap(id))}">${(() => { const u = wantPv(id, modelIdOf(id), mWrap(id)); return u ? `<img src="${u}" alt="">` : wIcon(id); })()}</div>` +
    `<h3>${esc(w.name.toUpperCase())}</h3>` +
    `<div><span class="tag">${melee ? 'MELEE' : ['PRIMARY', 'SECONDARY'][w.slot]}</span>${w.auto ? '<span class="tag">AUTO</span>' : ''}${w.ability ? `<span class="tag" style="color:#ffcc66">ABILITY: ${esc(ABILITIES[w.ability].name)}</span>` : ''}${gs ? `<span class="tag" style="color:${RARITY[gs.rar][1]}">${esc(gs.name.toUpperCase())}</span>` : ''}${career.wk[id] ? `<span class="tag">${masteryTag(id) || '&#9733;'} ${career.wk[id]} KILLS</span>` : ''}</div>` +
    rows +
    `<div class="cust"><button class="cb${ld.sub === 'skins' ? ' on' : ''}${hasSk ? '' : ' off'}" data-sub="skins">${ICON.skins}<span>SKINS<small>${gs ? esc(gs.name) : hasSk ? GSKINS[id].length + ' available' : 'none for this gun'}</small></span></button>` +
    `<button class="cb${ld.sub === 'wraps' ? ' on' : ''}${hasWr ? '' : ' off'}" data-sub="wraps">${ICON.wraps}<span>WRAPS<small>${hasWr ? esc(SKINS[wr].name) : 'guns only'}</small></span></button></div>` + sub;
}
function subSkins(id) {
  const items = [{ id: '', name: 'Default', rar: null }, ...GSKINS[id]];
  return '<div id="sgrid">' + items.map((it) => {
    const rc = it.rar ? RARITY[it.rar][1] : '#8a93a6';
    return `<div class="sk${modelIdOf(id) === it.id ? ' on' : ''}" data-sk="${it.id}" style="--rc:${rc}">${pvHtml(id, it.id, mWrap(id))}<b>${esc(it.name)}</b><em style="color:${rc}">${it.rar ? RARITY[it.rar][0] : 'STANDARD'}</em></div>`;
  }).join('') + '</div>';
}
function subWraps(id) {
  return '<div id="sgrid">' + Object.keys(SKINS).map((k) => {
    const s = SKINS[k];
    return `<div class="sk${mWrap(id) === k ? ' on' : ''}" data-wr="${k}" style="--rc:${s.glow ? hex6(s.glow) : '#ffb347'}">${pvHtml(id, modelIdOf(id), k)}<b>${esc(s.name)}</b><em style="color:${s.glow ? hex6(s.glow) : '#8a93a6'}">${k === 'default' ? 'STANDARD' : 'WRAP'}</em></div>`;
  }).join('') + '</div>';
}
$('scr-loadout').addEventListener('click', (e) => {
  const t = e.target;
  const tab = t.closest('.tab'), wc = t.closest('.wc'), cb = t.closest('.cb'), sk = t.closest('.sk');
  if (tab) { ld.tab = parseInt(tab.dataset.tab, 10); ld.sub = null; renderLoadout(); return; }
  if (wc) { prefs[SLOTN[ld.tab]] = wc.dataset.w; savePrefs(); if (state === 'play') { /* applies on respawn */ } renderLoadout(); return; }
  const id = prefs[SLOTN[ld.tab]];
  if (cb) { if (cb.classList.contains('off')) return; ld.sub = ld.sub === cb.dataset.sub ? null : cb.dataset.sub; renderLoadout(); return; }
  if (sk) {
    if (sk.dataset.wr !== undefined) { if (sk.dataset.wr === 'default') delete prefs.skins[id]; else prefs.skins[id] = sk.dataset.wr; }
    else { if (sk.dataset.sk) prefs.models[id] = sk.dataset.sk; else delete prefs.models[id]; }
    savePrefs(); try { buildViewModel(); } catch (x) { /* ignore */ }
    const gv = $('wgrid').scrollTop, dv = $('wdet').scrollTop;
    renderLoadout(); $('wgrid').scrollTop = gv; $('wdet').scrollTop = dv;
    try { toast(sk.dataset.wr !== undefined ? 'WRAP EQUIPPED' : 'SKIN EQUIPPED'); } catch (x) { /* ignore */ }
  }
});

/* ---- key bindings (rebindable) ---- */
const ACTIONS = [
  ['MOVEMENT', [['fwd', 'Move forward', ['KeyW']], ['back', 'Move back', ['KeyS']], ['left', 'Move left', ['KeyA']], ['right', 'Move right', ['KeyD']],
    ['sprint', 'Sprint', ['ShiftLeft', 'ShiftRight']], ['jump', 'Jump / slide-jump', ['Space']], ['slide', 'Slide (while running)', ['KeyC']]]],
  ['COMBAT', [['reload', 'Reload', ['KeyR']], ['nade', 'Throw grenade', ['KeyG']], ['ability', 'Weapon ability', ['KeyE']], ['swap', 'Quick-swap last weapon', ['KeyQ']]]],
  ['WEAPONS', [['w1', 'Primary', ['Digit1']], ['w2', 'Secondary', ['Digit2']], ['w3', 'Melee', ['Digit3']], ['w4', 'Admin cannon', ['Digit4']]]],
  ['TEAM', [['chat', 'Open chat', ['KeyT', 'Enter']], ['mic', 'Mic on / off', ['KeyV']], ['lock', 'Aim lock (admin)', ['KeyB']]]],
];
const ADEF = {}; ACTIONS.forEach((g) => g[1].forEach((a) => { ADEF[a[0]] = a[2]; }));
const FIXED = [['MOUSE', [['LEFT CLICK', 'Fire / swing'], ['RIGHT CLICK', 'Aim down sights'], ['WHEEL', 'Cycle weapons']]], ['SYSTEM', [['ESC', 'Pause / back'], ['F3', 'FPS + debug'], ['F4', 'Admin panel'], ['F11', 'Fullscreen (PC app)'], ['F12', 'Dev console (PC app)']]]];
if (!prefs.keys || typeof prefs.keys !== 'object') prefs.keys = {};
for (const a of Object.keys(prefs.keys)) if (!ADEF[a] || typeof prefs.keys[a] !== 'string') delete prefs.keys[a];
const bindOf = (a) => prefs.keys[a] || ADEF[a][0];
let REV = {}, DEFSET = {}, anyRemap = false;
function rebuildKeys() {
  REV = {}; DEFSET = {}; anyRemap = false;
  for (const a in ADEF) {
    if (prefs.keys[a] && prefs.keys[a] !== ADEF[a][0]) { REV[prefs.keys[a]] = ADEF[a][0]; anyRemap = true; ADEF[a].forEach((c) => { DEFSET[c] = true; }); }
  }
}
rebuildKeys();
function keyLabel(c) {
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  const m = { ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', Space: 'SPACE', ControlLeft: 'L CTRL', ControlRight: 'R CTRL', AltLeft: 'L ALT', AltRight: 'R ALT', Enter: 'ENTER', Tab: 'TAB', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', CapsLock: 'CAPS' };
  return m[c] || c.replace(/^Numpad/, 'NUM ').toUpperCase();
}
let capturing = null, synth = false;
window.addEventListener('keydown', (e) => remapKey(e), true);
window.addEventListener('keyup', (e) => remapKey(e), true);
function remapKey(e) {
  if (synth) return;
  if (capturing) {
    if (e.type !== 'keydown') { e.stopImmediatePropagation(); e.preventDefault(); return; }
    e.stopImmediatePropagation(); e.preventDefault();
    const c = e.code, a = capturing; capturing = null;
    if (c !== 'Escape' && !/^F\d+$/.test(c) && c !== 'MetaLeft' && c !== 'MetaRight') {
      let other = null;
      for (const o in ADEF) if (o !== a && bindOf(o) === c) other = o;
      if (other) prefs.keys[other] = bindOf(a);
      prefs.keys[a] = c;
      for (const o of Object.keys(prefs.keys)) if (prefs.keys[o] === ADEF[o][0]) delete prefs.keys[o];
      savePrefs(); rebuildKeys();
    }
    renderControls();
    return;
  }
  if (!anyRemap) return;
  const tg = e.target && e.target.tagName;
  if (tg === 'INPUT' || tg === 'TEXTAREA' || tg === 'SELECT') return;
  const c = e.code;
  const to = REV[c] !== undefined ? REV[c] : (DEFSET[c] ? '' : null);
  if (to === null) return;
  e.stopImmediatePropagation();
  if (e.type === 'keydown') e.preventDefault();
  if (!to) return;
  synth = true;
  try { document.dispatchEvent(new KeyboardEvent(e.type, { code: to, key: e.key, repeat: e.repeat, bubbles: true, cancelable: true })); } finally { synth = false; }
}
function renderControls() {
  const grp = ACTIONS.map((g) => `<div class="kgrp"><h4>${g[0]}</h4>${g[1].map((a) => {
    const c = bindOf(a[0]), chg = !!(prefs.keys[a[0]] && prefs.keys[a[0]] !== ADEF[a[0]][0]);
    return `<div class="krow"><span>${a[1]}</span><button class="kc${capturing === a[0] ? ' wait' : ''}${chg ? ' chg' : ''}" data-act="${a[0]}">${capturing === a[0] ? 'PRESS A KEY...' : keyLabel(c)}</button></div>`;
  }).join('')}</div>`).join('') +
    FIXED.map((g) => `<div class="kgrp"><h4>${g[0]}</h4>${g[1].map((r) => `<div class="krow"><span>${r[1]}</span><span class="kc fixed">${r[0]}</span></div>`).join('')}</div>`).join('');
  $('scr-controls').innerHTML =
    `<div class="shead"><button class="back" data-go="home">&#8592; BACK</button><h2>CONTROLS</h2><button class="ghost" id="keyreset" style="margin-left:auto">RESET TO DEFAULT</button></div>` +
    `<div class="sbody"><div id="ctl"><div id="keycols">${grp}</div><div id="tpanel"><div class="kgrp"><h4>TOUCH (PHONE)</h4><div class="tp">` +
    [['&#9673;', 'FIRE - hold to shoot'], ['&#9650;', 'JUMP'], ['&#9678;', 'AIM down sights'], ['&#9660;', 'SLIDE'], ['&#10227;', 'RELOAD'], ['&#9679;', 'NADE - grenade'], ['&#10022;', 'SKILL - weapon ability'], ['1-4', 'Weapon slots'], ['&#10074;&#10074;', 'PAUSE - menu'], ['AIM+', 'Balanced aim assist'], ['AUTO', 'Auto-shoot on target']].map((r) => `<span>${r[0]}</span><div>${r[1]}</div>`).join('') +
    `</div></div><div class="note">PC: click a key box, then press the key you want. Pressing a key that is already used swaps the two. Esc cancels. Orange = changed.<br>Phone: left thumb stick moves, drag on the right half to look.</div></div></div></div>`;
}
$('scr-controls').addEventListener('click', (e) => {
  const b = e.target.closest('.kc[data-act]');
  if (b) { capturing = capturing === b.dataset.act ? null : b.dataset.act; renderControls(); return; }
  if (e.target.id === 'keyreset') { prefs.keys = {}; savePrefs(); rebuildKeys(); capturing = null; renderControls(); try { toast('CONTROLS RESET'); } catch (x) { /* ignore */ } }
});

/* ---- settings ---- */
const optbox = $('optbox');
const XH = ['#ffffff', '#3dff7a', '#3de0ff', '#ff4d4d', '#ffd24a', '#ff6bd6'];
function applyCross() { document.documentElement.style.setProperty('--xh', prefs.cross); }
function renderOpts() {
  const chips = (obj, cur, attr, fmt) => obj.map((k) => `<button class="chip${String(cur) === String(k) ? ' on' : ''}" data-${attr}="${k}">${fmt(k)}</button>`).join('');
  optbox.innerHTML =
    `<div class="srow"><b>PLAYER NAME</b><input id="pname" maxlength="10" value="${esc(prefs.name)}"></div>` +
    `<div class="srow"><b>AVATAR</b>${EMOJIS.map((e) => `<button class="chip av emoji${e === prefs.emoji ? ' on' : ''}" data-emo="${e}">${e}</button>`).join('')}</div>` +
    `<div class="srow"><b>BOT DIFFICULTY</b>${chips(Object.keys(DIFFS), prefs.diff, 'diff', (k) => k.toUpperCase())}</div>` +
    `<div class="srow"><b>MATCH LENGTH</b>${chips([60, 120, 180, 300], prefs.time, 'time', (t) => t / 60 + ' MIN')}</div>` +
    `<div class="srow"><b>MOUSE / LOOK SENS</b><input type="range" id="sens" min="0.3" max="2.5" step="0.05" value="${prefs.sens}"><em id="sensv">${(+prefs.sens).toFixed(2)}</em></div>` +
    `<div class="srow"><b>VIEW BOB</b><input type="range" id="bobs" min="0" max="2" step="0.1" value="${prefs.bob}"><em id="bobv">${(+prefs.bob).toFixed(1)}</em></div>` +
    `<div class="srow"><b>FIELD OF VIEW</b><input type="range" id="fovs" min="60" max="100" step="1" value="${prefs.fov}"><em id="fovv">${prefs.fov}</em></div>` +
    `<div class="srow"><b>VOLUME</b><input type="range" id="vols" min="0" max="1" step="0.05" value="${prefs.vol}"><em id="volv">${Math.round(prefs.vol * 100)}</em></div>` +
    `<div class="srow"><b>KILL LIMIT (SOLO)</b>${chips([0, 15, 25, 40], prefs.limit, 'lim', (k) => k ? 'FIRST TO ' + k : 'OFF')}</div>` +
    `<div class="srow"><b>CROSSHAIR</b>${XH.map((c) => `<button class="swatch${prefs.cross === c ? ' on' : ''}" data-xh="${c}" style="background:${c};color:${c}"></button>`).join('')}</div>`;
}
optbox.addEventListener('click', (e) => {
  const b = e.target && e.target.closest ? e.target.closest('button') : null;
  if (!b) return;
  if (b.dataset.diff) prefs.diff = b.dataset.diff;
  if (b.dataset.time) prefs.time = parseInt(b.dataset.time, 10);
  if (b.dataset.lim) prefs.limit = parseInt(b.dataset.lim, 10);
  if (b.dataset.emo) { prefs.emoji = b.dataset.emo; playerInfo.emoji = b.dataset.emo; }
  if (b.dataset.xh) { prefs.cross = b.dataset.xh; applyCross(); }
  savePrefs(); renderOpts(); renderPlaySub();
});
optbox.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'sens') { prefs.sens = parseFloat(t.value) || 1; $('sensv').textContent = (+prefs.sens).toFixed(2); }
  if (t.id === 'fovs') { prefs.fov = parseInt(t.value, 10) || 75; $('fovv').textContent = prefs.fov; }
  if (t.id === 'vols') { prefs.vol = parseFloat(t.value); $('volv').textContent = Math.round(prefs.vol * 100); if (master) master.gain.value = prefs.vol; }
  if (t.id === 'bobs') { prefs.bob = parseFloat(t.value); $('bobv').textContent = (+prefs.bob).toFixed(1); }
  if (t.id === 'pname') { prefs.name = (t.value.trim() || 'YOU').slice(0, 10); playerInfo.name = prefs.name; renderPlaySub(); }
  savePrefs();
});
applyCross();

/* ---- career + updates screens ---- */
const cr = { tab: 'stats' };
function renderCareer() {
  const li = levelInfo(career.xp), rk = rankOf(li.lv), pct = Math.round(li.cur / li.need * 100);
  const kd = career.deaths ? (career.kills / career.deaths).toFixed(2) : career.kills.toFixed(2);
  const wr = career.matches ? Math.round(career.wins / career.matches * 100) + '%' : '-';
  const stats = [['MATCHES', career.matches], ['WINS', career.wins], ['WIN RATE', wr], ['KILLS', career.kills], ['DEATHS', career.deaths], ['K/D', kd],
    ['HEADSHOTS', career.heads], ['MELEE KILLS', career.melee], ['EXPLOSION KILLS', career.boom], ['BEST STREAK', career.bestStreak], ['BEST MATCH', career.bestMatch + ' kills'], ['TIME PLAYED', fmtPlayed(career.secs)]];
  let body = '';
  if (cr.tab === 'stats') body = '<div class="cgrid">' + stats.map((s) => `<div class="cs"><b>${s[1]}</b><span>${s[0]}</span></div>`).join('') + '</div>';
  else if (cr.tab === 'ach') {
    const done = ACHS.filter((a) => career.ach[a[0]]).length;
    body = `<div class="note">${done} / ${ACHS.length} unlocked</div><div class="agrid">` + ACHS.map((a) => {
      const p = a[4](), got = !!career.ach[a[0]], v = Math.min(p[0], p[1]);
      return `<div class="ac${got ? ' got' : ''}"><div class="ai emoji">${a[3]}</div><div class="at"><b>${a[1]}</b><span>${a[2]}</span><i><s style="width:${Math.round(v / p[1] * 100)}%"></s></i><em>${got ? 'UNLOCKED' : v + ' / ' + p[1]}</em></div></div>`;
    }).join('') + '</div>';
  } else {
    const ids = Object.keys(WEAPONS).filter((k) => WEAPONS[k].slot <= 2);
    const rows = ids.map((k) => [k, career.wk[k] || 0]).sort((a, b) => b[1] - a[1]);
    body = '<div class="note">Get kills with a weapon to earn Bronze (10), Silver (25), Gold (50) and Diamond (100).</div><div class="mlist">' + rows.map(([k, n]) => {
      const t = tierOf(n), nx = nextTier(n), base = t ? t[0] : 0, tgt = nx ? nx[0] : base;
      return `<div class="mr"><div class="mi">${wIcon(k)}</div><b>${esc(WEAPONS[k].name.toUpperCase())}</b><span class="mk">${n} kills</span><i><s style="width:${nx ? Math.round((n - base) / (tgt - base) * 100) : 100}%;background:${(nx || t || TIERS[3])[2]}"></s></i><em style="color:${t ? t[2] : '#6b7488'}">${t ? '&#9733; ' + t[1] : nx ? 'NEXT: ' + nx[1] + ' (' + nx[0] + ')' : ''}</em></div>`;
    }).join('') + '</div>';
  }
  $('scr-career').innerHTML =
    `<div class="shead"><button class="back" data-go="home">&#8592; BACK</button><h2>CAREER</h2><div class="tabs">` +
    [['stats', 'STATS'], ['ach', 'ACHIEVEMENTS'], ['mastery', 'MASTERY']].map((t) => `<button class="tab${cr.tab === t[0] ? ' on' : ''}" data-ctab="${t[0]}">${t[1]}</button>`).join('') + `</div></div>` +
    `<div class="sbody"><div class="lvcard"><div class="ring" style="--p:${pct}%;--rc:${rk[1]}"><b>${li.lv}</b></div><div class="lvt"><h3 style="color:${rk[1]}">${rk[0]}</h3><div class="xpbar"><s style="width:${pct}%"></s></div><span>${li.cur} / ${li.need} XP to level ${li.lv + 1}</span></div></div>${body}</div>`;
}
$('scr-career').addEventListener('click', (e) => { const t = e.target.closest('[data-ctab]'); if (t) { cr.tab = t.dataset.ctab; renderCareer(); } });
function renderUpdates() {
  career.seenVer = GAME_VERSION; saveCareer(); renderNew();
  $('scr-updates').innerHTML =
    `<div class="shead"><button class="back" data-go="home">&#8592; BACK</button><h2>UPDATE LOG</h2><span class="verb">VERSION ${GAME_VERSION}</span></div>` +
    `<div class="sbody"><div id="ulog">` + CHANGELOG.map((c, i) => `<div class="ue${i === 0 ? ' cur' : ''}"><div class="uh"><b>v${c.v}</b><span>${esc(c.name)}</span>${i === 0 ? '<i>LATEST</i>' : ''}</div><ul>${c.items.map((it) => `<li><em class="ty ${it[0]}">${it[0]}</em>${esc(it[1])}</li>`).join('')}</ul></div>`).join('') + `</div></div>`;
}
function renderNew() { const d = $('newdot'); if (d) d.style.display = career.seenVer === GAME_VERSION ? 'none' : 'inline-block'; $('ver').textContent = 'v' + GAME_VERSION + (HALLOWEEN ? '   🎃 HALLOWEEN EVENT' : ''); }

/* ---- navigation ---- */
function showScreen(s) {
  curScreen = s; capturing = null;
  menuEl.dataset.screen = s;
  if (s === 'home') renderHome();
  if (s === 'loadout') renderLoadout();
  if (s === 'controls') renderControls();
  if (s === 'settings') renderOpts();
  if (s === 'career') renderCareer();
  if (s === 'updates') renderUpdates();
}
function setMode(m) { menuEl.dataset.mode = m; showScreen('home'); }
ovEl.addEventListener('click', (e) => {
  const g = e.target.closest ? e.target.closest('[data-go]') : null;
  if (g) { showScreen(g.dataset.go); return; }
});
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !locked && curScreen !== 'home' && !capturing) showScreen('home');
});
renderHome(); renderNew();
if (HALLOWEEN) { // limited-time Halloween menu theme
  ovEl.classList.add('hw');
  const hb = document.createElement('div'); hb.id = 'hwbanner';
  hb.innerHTML = '<span class="emoji">🎃</span> HALLOWEEN EVENT <em>Haunted Graveyard &middot; spooky bots &middot; DOUBLE XP &middot; ends Nov 7</em> <span class="emoji">🎃</span>';
  menuEl.insertBefore(hb, $('ovsub'));
  for (let i = 0; i < 6; i++) { const s = document.createElement('span'); s.className = 'bat emoji'; s.textContent = '🦇'; s.style.cssText = `top:${8 + i * 13}%;animation-delay:${-i * 2.3}s;animation-duration:${11 + i * 2}s;font-size:${18 + i * 4}px`; ovEl.appendChild(s); }
}

/* ---- online play: PeerJS (WebRTC) with the host relaying, PC and phone together ---- */
const net = { on: false, host: false, client: false, peer: null, conns: new Map(), conn: null, myId: 'H', code: '', remotes: new Map(), nextId: 0, sendT: 0, timeT: 0, pending: null };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
const netEl = $('netstat'), codeEl = $('mycode'), joinIn = $('joincode');
const netStatus = (t) => { netEl.textContent = t; };
const codeHud = $('codehud');
const netPlayers = () => 'Players: YOU' + [...net.remotes.values()].map((r) => ', ' + r.info.name).join('');
function infoOf(id) { return id === net.myId ? playerInfo : net.remotes.has(id) ? net.remotes.get(id).info : null; }
function netBroadcast(m, except) {
  for (const [id, c] of net.conns) if (id !== except && c.open) c.send(m);
}
net.send = (m) => {
  m.id = net.myId;
  if (net.host) netBroadcast(m);
  else if (net.conn && net.conn.open) net.conn.send(m);
};
net.sendTo = (to, m) => {
  m.to = to; m.id = net.myId;
  if (net.host) { const c = net.conns.get(to); if (c && c.open) c.send(m); }
  else if (net.conn && net.conn.open) net.conn.send(m);
};
function ensureBot(r) {
  if (r.bot || state !== 'play') return;
  const b = new Bot(r.info, r.st ? r.st.x : 0, r.st ? r.st.z : 0);
  b.netT = r.st;
  enemies.push(b);
  r.bot = b;
}
function addRemote(id, name, emoji, pid) {
  let info = null;
  for (let i = 1; i < roster.length; i++) if (!roster[i].remote) { info = roster[i]; break; }
  if (!info) return null;
  Object.assign(info, { remote: true, netId: id, name: String(name || 'Player').slice(0, 10), emoji: emoji || '🎯', kills: 0, deaths: 0, streak: 0, hidden: false, netDead: false });
  const r = { id, info, bot: null, st: null, pid: pid || null };
  net.remotes.set(id, r);
  ensureBot(r);
  return r;
}
function removeRemote(id) {
  const r = net.remotes.get(id);
  if (!r) return;
  if (r.bot) {
    world.removeBody(r.bot.body);
    scene.remove(r.bot.group);
    const i = enemies.indexOf(r.bot);
    if (i >= 0) enemies.splice(i, 1);
  }
  if (r.pid) { const cl = vc.calls.get(r.pid); if (cl) { try { cl.close(); } catch (e) { /* ignore */ } } vcDrop(r.pid); }
  r.info.enemy = null; r.info.remote = false; r.info.hidden = true; r.info.netId = null;
  net.remotes.delete(id);
  if (net.host && net.remotes.size === 0) net.on = false;
  if (state === 'menu') netStatus(net.remotes.size ? netPlayers() : 'Share your code, or enter a friend\'s code and press JOIN.');
}
function netHandle(m) {
  const r = net.remotes.get(m.id);
  switch (m.t) {
    case 'join': addRemote(m.id, m.name, m.emoji, m.pid); if (state === 'menu') netStatus(netPlayers() + '  -  START when ready'); break;
    case 'leave': removeRemote(m.id); break;
    case 'st': if (r) { r.st = m; if (r.bot) r.bot.netT = m; } break;
    case 'shot': if (r && state === 'play') spawnBullet(new CANNON.Vec3(m.p[0], m.p[1], m.p[2]), new CANNON.Vec3(m.v[0], m.v[1], m.v[2]), r.info, m.d, null, !!m.w); break;
    case 'hit': if (r && m.to === net.myId && state === 'play') hurtPlayer(m.dmg, r.info, r.st ? { x: r.st.x, z: r.st.z } : null); break;
    case 'died': { const v = infoOf(m.id); if (v && state === 'play') registerKill(infoOf(m.k) || v, v, m.kind || 'bullet'); break; }
    case 'time': if (state === 'play') roundT = m.r; break;
    case 'chat': if (r && typeof m.x === 'string') addChat(r.info.name, hexCss(r.info.color), m.x); break;
  }
}
function hostGot(c, m) {
  if (m.t === 'hello') {
    if (c._abid) return;
    if (state === 'over' || net.client || net.remotes.size >= 7) { c.send({ t: 'full' }); setTimeout(() => { try { c.close(); } catch (e) { /* ignore */ } }, 400); return; }
    if (state === 'play' && net.remotes.size === 0) {
      // a friend joined a bot match: the bots run only on the host, so they leave and it becomes a players-only match
      for (const b of enemies.slice()) if (!b.remote) { world.removeBody(b.body); scene.remove(b.group); b.info.enemy = null; }
      for (let i = enemies.length - 1; i >= 0; i--) if (!enemies[i].remote) enemies.splice(i, 1);
      respawns.length = 0;
      for (let i = 1; i < roster.length; i++) if (!roster[i].remote) roster[i].hidden = true;
      toast('FRIEND JOINED - BOTS REMOVED');
    }
    const id = 'C' + (++net.nextId);
    c._abid = id;
    net.conns.set(id, c);
    net.host = true; net.on = true;
    const others = [...net.remotes.values()].map((r) => ({ id: r.id, name: r.info.name, emoji: r.info.emoji, pid: r.pid }));
    addRemote(id, m.name, m.emoji, m.pid);
    c.send({ t: 'welcome', you: id, map: selectedMap, time: prefs.time, started: state === 'play', roundT, players: [{ id: 'H', name: playerInfo.name, emoji: playerInfo.emoji, pid: net.peer.id }, ...others] });
    netBroadcast({ t: 'join', id, name: m.name, emoji: m.emoji, pid: m.pid }, id);
    netStatus(netPlayers() + '  -  START when ready');
    return;
  }
  if (!c._abid) return;
  m.id = c._abid;
  if (m.to !== undefined) {
    if (m.to === net.myId) netHandle(m);
    else { const t = net.conns.get(m.to); if (t && t.open) t.send(m); }
    return;
  }
  netHandle(m);
  netBroadcast(m, m.id);
}
function clientGot(m) {
  if (m.t === 'welcome') {
    net.on = true; net.client = true; net.myId = m.you;
    net.pending = { time: m.time, started: !!m.started, roundT: m.roundT };
    codeHud.style.display = 'none';
    for (const p of m.players) { addRemote(p.id, p.name, p.emoji, p.pid); vcCall(p.pid); }
    if (net.conn) vcCall(net.conn.peer);
    selectMap(m.map);
    netStatus('Joined! ' + netPlayers() + '  -  click to START');
    return;
  }
  if (m.t === 'full') { netStatus('Game full or already started.'); return; }
  netHandle(m);
}
function netJoin(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!net.peer || net.on) return;
  if (code.length !== 6) { netStatus('Codes are 6 letters/numbers.'); return; }
  if (code === net.code) { netStatus('That is your own code.'); return; }
  netStatus('Connecting...');
  const c = net.peer.connect('abreaker-' + code, { reliable: true });
  const to = setTimeout(() => { if (!net.on) { netStatus('Could not connect. Check the code.'); try { c.close(); } catch (e) { /* ignore */ } } }, 12000);
  c.on('open', () => { net.conn = c; c.send({ t: 'hello', name: playerInfo.name, emoji: playerInfo.emoji, pid: net.peer.id }); });
  c.on('data', clientGot);
  c.on('close', () => { clearTimeout(to); if (net.client) { netStatus('Disconnected from host.'); if (state === 'play') toast('HOST LEFT'); } });
  c.on('error', () => netStatus('Connection error.'));
}
function netInit() {
  if (typeof Peer === 'undefined') { codeEl.textContent = 'OFFLINE'; netStatus('Online play needs an internet connection.'); return; }
  net.code = genCode();
  codeEl.textContent = net.code;
  try { net.peer = new Peer('abreaker-' + net.code); } catch (e) { codeEl.textContent = 'OFFLINE'; return; }
  net.peer.on('open', () => { codeHud.textContent = 'ROOM CODE  ' + net.code + '   -  friends can join with it'; $('roomcode').textContent = net.code; });
  net.peer.on('open', () => netStatus('Share your code, or enter a friend\'s code and press JOIN.'));
  net.peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { try { net.peer.destroy(); } catch (x) { /* ignore */ } netInit(); }
    else if (e.type === 'peer-unavailable') netStatus('No game found with that code.');
    else netStatus('Network problem: ' + e.type);
  });
  net.peer.on('call', (call) => { vcInit().then((s) => { try { call.answer(s); vcAttach(call.peer, call); } catch (e) { /* ignore */ } }); });
  net.peer.on('connection', (c) => {
    c.on('data', (m) => hostGot(c, m));
    c.on('close', () => {
      const id = c._abid;
      if (!id) return;
      net.conns.delete(id);
      removeRemote(id);
      netBroadcast({ t: 'leave', id });
    });
  });
}
function copyCode() {
  const txt = net.code;
  if (!txt) return;
  const done = () => toast('ROOM CODE COPIED: ' + txt);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, () => { fallbackCopy(txt); done(); }); return; }
  } catch (e) { /* fall through */ }
  fallbackCopy(txt); done();
}
function fallbackCopy(txt) {
  const ta = document.createElement('textarea');
  ta.value = txt;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* ignore */ }
  ta.remove();
}
$('copybtn').addEventListener('click', copyCode);
$('copybtn2').addEventListener('click', copyCode);
$('joinbtn').addEventListener('click', () => netJoin(joinIn.value));
joinIn.addEventListener('input', () => { joinIn.value = joinIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
joinIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') netJoin(joinIn.value); });
netInit();



/* ---- text chat (T or Enter on PC, CHAT button on phone); other players see it ---- */
const chat = { open: false, hadLock: false, last: 0 };
{
  const st = document.createElement('style');
  st.textContent = '#chatlog{position:fixed;left:14px;bottom:96px;width:min(420px,60vw);display:flex;flex-direction:column;gap:3px;pointer-events:none;z-index:9;font:600 15px "Segoe UI",sans-serif;color:#fff;text-shadow:0 1px 3px #000}' +
    '#chatlog div{background:rgba(0,0,0,.42);border-radius:6px;padding:3px 8px;word-break:break-word;transition:opacity .6s}#chatlog div.old{opacity:0}#chatlog.open div.old{opacity:1}' +
    '#chatbar{position:fixed;left:14px;bottom:56px;width:min(420px,70vw);display:none;gap:6px;z-index:10}#chatbar input{flex:1;min-width:0;padding:8px 10px;font:600 16px "Segoe UI",sans-serif;background:rgba(10,12,16,.88);color:#fff;border:2px solid rgba(80,200,255,.7);border-radius:8px;outline:none}' +
    '#chatbar button{padding:8px 14px;font:800 14px "Segoe UI",sans-serif;background:#2fa8ff;color:#fff;border:0;border-radius:8px}';
  document.head.appendChild(st);
}
const chatLog = document.createElement('div'); chatLog.id = 'chatlog';
const chatBar = document.createElement('div'); chatBar.id = 'chatbar';
chatBar.innerHTML = '<input id="chatin" maxlength="80" autocomplete="off" placeholder="Type a message, Enter to send"><button id="chatsend">SEND</button>';
document.body.appendChild(chatLog); document.body.appendChild(chatBar);
const chatIn = chatBar.querySelector('input');
function addChat(name, color, text) {
  const d = document.createElement('div');
  const b = document.createElement('b'); b.style.color = color; b.textContent = name + ': ';
  d.appendChild(b); d.appendChild(document.createTextNode(String(text).slice(0, 80)));
  chatLog.appendChild(d);
  while (chatLog.children.length > 8) chatLog.removeChild(chatLog.firstChild);
  setTimeout(() => d.classList.add('old'), 9000);
}
function openChat() {
  if (state !== 'play' || chat.open || !locked) return;
  chat.open = true;
  chat.hadLock = document.pointerLockElement === renderer.domElement;
  clearInput();
  chatBar.style.display = 'flex'; chatLog.classList.add('open');
  if (chat.hadLock && document.exitPointerLock) document.exitPointerLock();
  setTimeout(() => chatIn.focus(), 0);
}
function closeChat(send) {
  if (!chat.open) return;
  const text = chatIn.value.trim();
  chatIn.value = ''; chatIn.blur();
  chat.open = false; chatBar.style.display = 'none'; chatLog.classList.remove('open');
  if (send && text && performance.now() - chat.last > 600) {
    chat.last = performance.now();
    addChat(playerInfo.name, hexCss(playerInfo.color), text);
    if (net.on) net.send({ t: 'chat', x: text.slice(0, 80) });
    else addChat('', '#ffd24a', '(nobody online to hear you - share your code!)');
  }
  if (chat.hadLock && renderer.domElement.requestPointerLock) { try { const p = renderer.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
}
chatBar.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') closeChat(true); else if (e.key === 'Escape') closeChat(false); });
chatBar.addEventListener('mousedown', (e) => e.stopPropagation());
chatBar.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
chatBar.querySelector('button').addEventListener('click', () => closeChat(true));
document.addEventListener('keydown', (e) => {
  if (!chat.open && (e.code === 'KeyT' || e.code === 'Enter') && state === 'play' && locked && !e.repeat) { e.preventDefault(); openChat(); }
}, true);


/* ---- voice chat: mic permission is asked on the first tap/click; everyone in the room hears each other (WebRTC mesh via PeerJS) ---- */
const vc = { p: null, mic: null, on: true, calls: new Map(), audio: new Map(), watch: new Map(), ctx: null, denied: false };
{
  const st = document.createElement('style');
  st.textContent = '#voicebar{position:fixed;right:14px;top:96px;z-index:9;display:none;flex-direction:column;align-items:flex-end;gap:4px;font:700 13px "Segoe UI",sans-serif;color:#fff;text-shadow:0 1px 3px #000}' +
    '#voicebar button{pointer-events:auto;padding:5px 10px;font:800 12px "Segoe UI",sans-serif;background:rgba(0,0,0,.5);color:#fff;border:2px solid #3ddc84;border-radius:8px}#voicebar button.off{border-color:#ff4d4d;color:#ff9a9a}' +
    '#voicebar .sp{background:rgba(0,0,0,.45);border-radius:6px;padding:2px 8px;color:#7dffb0}';
  document.head.appendChild(st);
}
const voiceBar = document.createElement('div'); voiceBar.id = 'voicebar';
voiceBar.innerHTML = '<button id="micbtn">MIC ON (V)</button><div id="speakers"></div>';
document.body.appendChild(voiceBar);
const micBtn = voiceBar.querySelector('#micbtn'), speakersEl = voiceBar.querySelector('#speakers');
['mousedown', 'touchstart'].forEach((ev) => voiceBar.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
function vcContext() {
  if (!vc.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) vc.ctx = new C(); }
  if (vc.ctx && vc.ctx.state === 'suspended') vc.ctx.resume().catch(() => {});
  return vc.ctx;
}
function vcWatch(id, stream) {
  const ctx = vcContext();
  if (!ctx || !stream || !stream.getAudioTracks().length) return;
  try {
    const an = ctx.createAnalyser(); an.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(an);
    vc.watch.set(id, { an, buf: new Uint8Array(an.fftSize), lvl: 0 });
  } catch (e) { /* ignore */ }
}
function vcInit() {
  if (vc.p) return vc.p;
  vc.p = (async () => {
    const ctx = vcContext();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      vc.mic = s; vcWatch('me', s); vcApplyMute();
      return s;
    } catch (e) {
      vc.denied = true;
      vc.on = false;
      try { toast('MIC BLOCKED - you can still hear others'); } catch (x) { /* ignore */ }
      return ctx ? ctx.createMediaStreamDestination().stream : new MediaStream();
    }
  })().then((s) => { vcRefresh(); return s; });
  return vc.p;
}
function vcApplyMute() { if (vc.mic) for (const t of vc.mic.getAudioTracks()) t.enabled = vc.on; }
function vcToggle() {
  if (vc.denied) { vc.p = null; vc.denied = false; vc.on = true; vcInit(); toast('ASKING FOR MIC...'); return; }
  vc.on = !vc.on; vcApplyMute(); vcRefresh();
  try { toast(vc.on ? 'MIC ON' : 'MIC MUTED'); } catch (e) { /* ignore */ }
}
function vcRefresh() {
  micBtn.textContent = vc.denied ? 'MIC BLOCKED - TAP' : vc.on ? 'MIC ON (V)' : 'MIC MUTED (V)';
  micBtn.className = vc.on && !vc.denied ? '' : 'off';
  voiceBar.style.display = net.on ? 'flex' : 'none';
}
function vcAttach(pid, call) {
  const old = vc.calls.get(pid);
  if (old && old !== call) { try { old.close(); } catch (e) { /* ignore */ } }
  vc.calls.set(pid, call);
  call.on('stream', (rs) => {
    let a = vc.audio.get(pid);
    if (!a) { a = new Audio(); a.autoplay = true; vc.audio.set(pid, a); }
    a.srcObject = rs; const p = a.play(); if (p && p.catch) p.catch(() => {});
    vcWatch(pid, rs);
  });
  call.on('close', () => vcDrop(pid, call));
  call.on('error', () => vcDrop(pid, call));
}
function vcDrop(pid, call) {
  if (call && vc.calls.get(pid) !== call) return;
  vc.calls.delete(pid); vc.watch.delete(pid);
  const a = vc.audio.get(pid); if (a) { a.srcObject = null; vc.audio.delete(pid); }
}
function vcCall(pid) {
  if (!pid || !net.peer || pid === net.peer.id || vc.calls.has(pid)) return;
  vcInit().then((stream) => {
    if (vc.calls.has(pid) || !net.peer) return;
    try { vcAttach(pid, net.peer.call(pid, stream)); } catch (e) { /* ignore */ }
  });
}
setInterval(() => {
  vcRefresh();
  if (!net.on) return;
  const names = [];
  for (const [id, w] of vc.watch) {
    w.an.getByteTimeDomainData(w.buf);
    let sum = 0;
    for (let i = 0; i < w.buf.length; i++) { const v = (w.buf[i] - 128) / 128; sum += v * v; }
    w.lvl = Math.sqrt(sum / w.buf.length);
    if (w.lvl > 0.035 && (id !== 'me' || vc.on)) {
      if (id === 'me') names.push('YOU');
      else { let n = 'Player'; for (const r of net.remotes.values()) if (r.pid === id) n = r.info.name; names.push(n); }
    }
  }
  speakersEl.innerHTML = names.map((n) => '<div class="sp">🔊 ' + String(n).replace(/[<>&]/g, '') + '</div>').join('');
}, 150);
document.addEventListener('pointerdown', () => { vcInit(); }, { once: true, capture: true });
document.addEventListener('keydown', (e) => { if (e.code === 'KeyV' && locked && !chat.open && !e.repeat && state === 'play') vcToggle(); });
micBtn.addEventListener('click', vcToggle);

let toastTimer = 0, bannerTimer = 0, hitTimer = 0;
function toast(t) {
  hud.toast.textContent = t;
  hud.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hud.toast.classList.remove('show'), 1100);
}
function banner(t, ms = 2200) {
  hud.banner.innerHTML = t;
  hud.banner.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => hud.banner.classList.remove('show'), ms);
}
function hitMarker(kill) {
  hud.hit.className = 'show' + (kill ? ' kill' : '');
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => (hud.hit.className = ''), 130);
}

const hudCache = {};
function setHud(key, target, prop, val) {
  if (hudCache[key] !== val) { hudCache[key] = val; target[prop] = val; }
}
const sortedRoster = () =>
  roster.filter((r) => !r.hidden).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0));
const isAlive = (info) => (info.isPlayer ? !player.dead : info.remote ? !info.netDead : !!info.enemy);

const KIND_ICON = { bullet: '🔫', head: '🎯', blast: '💥', self: '💀' };
const feed = [];
let feedSig = '';
function addFeed(killer, victim, kind) {
  feed.push({ killer, victim, kind, t: timeNow });
  if (feed.length > 6) feed.shift();
}
function updateFeed() {
  while (feed.length && timeNow - feed[0].t > 6) feed.shift();
  const sig = feed.map((f) => f.t).join(',');
  if (sig === feedSig) return;
  feedSig = sig;
  const nm = (i) => `<span class="${i.isPlayer ? 'me' : ''}">${i.name}</span>`;
  hud.feed.innerHTML = feed
    .map((f) =>
      f.kind === 'self'
        ? `<div class="fe emoji">${avHtml(f.victim, true)}${nm(f.victim)} 💀</div>`
        : `<div class="fe emoji">${avHtml(f.killer, true)}${nm(f.killer)} ${KIND_ICON[f.kind] || '🔫'} ${avHtml(f.victim, true)}${nm(f.victim)}</div>`
    )
    .join('');
}

let boardSig = '';
function updateBoard() {
  const sorted = sortedRoster();
  const sig = sorted.map((r) => `${r.id}:${r.kills}:${r.deaths}:${isAlive(r) ? 1 : 0}`).join('|');
  if (sig === boardSig) return;
  boardSig = sig;
  hud.board.innerHTML =
    `<div class="hd"><span class="rk">#</span><span style="width:26px"></span><span class="nm">PLAYER</span><span class="k">K</span><span class="d">D</span></div>` +
    sorted
      .map(
        (r, i) =>
          `<div class="row${r.isPlayer ? ' me' : ''}${isAlive(r) ? '' : ' out'}"><span class="rk">${i + 1}</span>${avHtml(r)}<span class="nm">${r.name}</span><span class="k">${r.kills}</span><span class="d">${r.deaths}</span></div>`
      )
      .join('');
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function updateHud() {
  const hp = Math.max(0, Math.ceil(player.hp));
  setHud('hpw', hud.hpfill.style, 'width', ((player.hp / player.maxHp) * 100).toFixed(0) + '%');
  setHud('hpt', hud.hptext, 'textContent', String(hp));
  const cw = curW();
  setHud('ammo', hud.ammo, 'innerHTML', cw.melee ? `${cw.name.toUpperCase()}` : `${player.reloadT > 0 ? 'RELOAD' : player.ammo} <small>/ ${player.reserve}</small>`);
  const abd = cw.ability ? ABILITIES[cw.ability] : null;
  const abc = abd && player.abCd ? player.abCd[curId()] || 0 : 0;
  setHud('abil', hud.ability, 'textContent', abd ? `[E] ${abd.name}  ${abActive(cw.ability) ? 'ACTIVE ' + Math.ceil(player.abT) + 's' : abc > 0 ? Math.ceil(abc) + 's' : 'READY'}` : '');
  setHud('slots', hud.slots, 'innerHTML', (admin.auth ? [0, 1, 2, 3] : [0, 1, 2]).map((i) => `<span class="${inv.cur === i ? 'on' : ''}">${i + 1} ${WEAPONS[prefs[SLOTN[i]]].name}</span>`).join(''));
  const scoped = player.ads && cw.ads === 22 && !player.dead;
  setHud('scope', hud.scope.style, 'display', scoped ? 'block' : 'none');
  setHud('nades', hud.nades, 'textContent', 'GRENADES ' + player.grenades);
  const rank = sortedRoster().indexOf(playerInfo) + 1;
  setHud('score', hud.score, 'textContent',
    `KILLS ${playerInfo.kills}   DEATHS ${playerInfo.deaths}   RANK #${rank}` + (playerInfo.streak >= 2 ? `   STREAK ${playerInfo.streak}` : ''));
  setHud('time', hud.left, 'textContent', fmtTime(roundT));
  const warn = roundT <= 30 && state === 'play';
  if (hudCache.warn !== warn) { hudCache.warn = warn; hud.left.classList.toggle('warn', warn); }
  const low = player.hp < 30 && !player.dead ? 0.25 + Math.sin(timeNow * 6) * 0.1 : 0;
  setHud('vig', hud.vignette.style, 'opacity', Math.max(player.vignette, low).toFixed(2));

  // damage direction arrow
  if (player.dmgT > 0) {
    const pb = player.body.position;
    const dx = player.dmgX - pb.x, dz = player.dmgZ - pb.z;
    const fx2 = -Math.sin(player.yaw), fz2 = -Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    const ang = Math.atan2(dx * rx + dz * rz, dx * fx2 + dz * fz2);
    hud.dmgdir.style.opacity = Math.min(1, player.dmgT * 1.3).toFixed(2);
    hud.dmgdir.style.transform = `translate(-50%,-50%) rotate(${ang.toFixed(3)}rad)`;
    hudCache.dd = 1;
  } else if (hudCache.dd) {
    hudCache.dd = 0;
    hud.dmgdir.style.opacity = '0';
  }
  updateBoard();
  updateFeed();
}

/* ------------------------------ kills & scoring ------------------------------ */
function registerKill(killer, victim, kind) {
  victim.deaths++;
  victim.streak = 0;
  if (victim.isPlayer && matchStats.on) matchStats.deaths++;
  if (victim.isPlayer) { career.deaths++; saveCareer(); }
  if (killer && killer !== victim) {
    killer.kills++;
    killer.streak++;
    killer.multi = gameTime - killer.lastKillT < 4 ? killer.multi + 1 : 1;
    killer.lastKillT = gameTime;
    if (killer.isPlayer) { career.bestStreak = Math.max(career.bestStreak, killer.streak); career.bestMulti = Math.max(career.bestMulti, killer.multi); careerKill(kind); }
    // bloodlust: every kill heals a little
    if (killer.isPlayer) player.hp = Math.min(player.maxHp, player.hp + 15);
    else if (killer.enemy) killer.enemy.hp = Math.min(100, killer.enemy.hp + 15);
    if (killer.isPlayer) {
      sfx.kill();
      const m = killer.multi;
      const streakMsg = { 3: 'KILLING SPREE', 5: 'UNSTOPPABLE', 7: 'DOMINATING', 10: 'GODLIKE' }[killer.streak];
      if (m === 2) toast('DOUBLE KILL');
      else if (m === 3) toast('TRIPLE KILL');
      else if (m >= 4) toast('RAMPAGE x' + m);
      else if (streakMsg) toast(streakMsg);
      else toast(kind === 'head' ? 'HEADSHOT' : `ELIMINATED ${victim.name.toUpperCase()}`);
    }
  }
  addFeed(killer, victim, kind);
  if (prefs.limit && killer && killer !== victim && killer.kills >= prefs.limit && state === 'play' && !net.on) endMatch();
}

/* ------------------------------ ballistics ------------------------------ */
const bullets = [];
const tracerGeoP = new THREE.BoxGeometry(0.025, 0.025, 1.4);
const tracerGeoE = new THREE.BoxGeometry(0.06, 0.06, 0.8);
const tracerMats = new Map();
function tracerMat(info) {
  let m = tracerMats.get(info);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: info.isPlayer ? 0xffe9a0 : info.accent }); tracerMats.set(info, m); }
  return m;
}
function spawnBullet(pos, vel, owner, dmg, origin, ghost) {
  if (owner === playerInfo && admin.wall) ghost = true;
  if (net.on && owner === playerInfo) net.send({ t: 'shot', w: ghost ? 1 : 0, p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)], v: [+vel.x.toFixed(1), +vel.y.toFixed(1), +vel.z.toFixed(1)], d: dmg });
  const mesh = new THREE.Mesh(owner.isPlayer ? tracerGeoP : tracerGeoE, tracerMat(owner));
  mesh.visible = !owner.isPlayer;
  scene.add(mesh);
  bullets.push({ pos, vel, owner, dmg, life: 3, age: 0, mesh, origin: origin || pos.clone(), ghost: !!ghost });
}
function removeBullet(i) {
  scene.remove(bullets[i].mesh);
  bullets.splice(i, 1);
}

function updateBullets(dt) {
  const chest = chestOf(playerInfo);
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.life -= dt;
    b.age += dt;
    const prev = b.pos.clone();
    b.vel.y -= GRAV * dt; // bullet drop
    const next = prev.vadd(b.vel.scale(dt));
    const mask = b.ghost ? (b.owner.isPlayer ? GRP.ENEMY | GRP.RAG : 0) : b.owner.isPlayer ? GRP.STATIC | GRP.PROP | GRP.ENEMY | GRP.RAG : GRP.STATIC | GRP.PROP | GRP.ENEMY;
    const hit = rayCast(prev, next, mask);
    const end = hit ? hit.point : next;

    // bot bullets can hit the player (swept sphere test against the chest)
    if (!b.owner.isPlayer && chest) {
      const seg = end.vsub(prev);
      const L2 = seg.dot(seg) || 1e-6;
      let t = chest.vsub(prev).dot(seg) / L2;
      t = Math.max(0, Math.min(1, t));
      const q = prev.vadd(seg.scale(t));
      if (q.distanceTo(chest) < 0.7) {
        hurtPlayer(b.dmg, b.owner, b.origin);
        spawnSparks(q, 6, null, 3, 0xff3030, 0.3);
        removeBullet(i);
        continue;
      }
    }
    if (hit) {
      onBulletHit(b, hit);
      removeBullet(i);
      continue;
    }
    if (b.life <= 0 || next.y < -2) { removeBullet(i); continue; }
    b.pos = next;
    const dir = b.vel.unit();
    const len = b.owner.isPlayer ? 0.7 : 0.4;
    b.mesh.position.set(next.x - dir.x * len, next.y - dir.y * len, next.z - dir.z * len);
    b.mesh.lookAt(next.x, next.y, next.z);
    if (b.age > 0.02) b.mesh.visible = true;
  }
}

function onBulletHit(b, hit) {
  const body = hit.body;
  const u = body.userData || {};
  const dir = b.vel.unit();
  const dynamic = body.type !== CANNON.Body.STATIC;
  if (u.type === 'enemy') {
    if (u.enemy.info === b.owner) return;
    const head = hit.point.y - body.position.y > 0.42;
    hitEnemy(u.enemy, b.dmg, hit.point, dir, head, false, b.owner);
    return;
  }
  if (dynamic) {
    body.wakeUp();
    body.applyImpulse(dir.scale(b.owner.isPlayer ? BULLET_IMPULSE : 8), hit.point.vsub(body.position));
  } else if (b.owner.isPlayer) {
    addDecal(hit.point, hit.normal);
  }
  if (u.type === 'crate' || u.type === 'barrel') damageProp(body, b.dmg, b.owner);
  spawnSparks(hit.point, 5, hit.normal, 4, u.type === 'crate' ? 0xc8964f : 0xffd070, 0.35);
  if (b.owner.isPlayer) sfx.hit();
}

function damageProp(body, d, owner) {
  const u = body.userData;
  if (!u || u.dead) return;
  u.hp -= d;
  if (owner) u.owner = owner;
  if (u.hp <= 0) {
    if (u.type === 'crate') breakCrate(body);
    else if (u.type === 'barrel') blowBarrel(body);
  }
}
function breakCrate(b) {
  const u = b.userData;
  if (u.dead) return;
  u.dead = true;
  const p = b.position.clone();
  const v = b.velocity.clone();
  wakeNear(p, 2.2);
  untrack(b);
  for (let i = 0; i < 7; i++) spawnDebris(p.x + rand(-0.3, 0.3), p.y + rand(-0.3, 0.3), p.z + rand(-0.3, 0.3), v);
  spawnSparks(p, 14, null, 4, 0xb58a52, 0.6);
  sfx.crate();
}
function blowBarrel(b) {
  const u = b.userData;
  if (u.dead) return;
  u.dead = true;
  const p = b.position.clone();
  wakeNear(p, 4);
  untrack(b);
  explode(p, 7.5, 13, 1, u.owner || null);
}

/* ------------------------------ explosions ------------------------------ */
function explode(pos, radius, dv, power, owner) {
  sfx.boom();
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffa03a, transparent: true, opacity: 0.9 })
  );
  flash.position.set(pos.x, pos.y, pos.z);
  scene.add(flash);
  const light = boomLights[boomLightIdx++ % boomLights.length];
  light.position.set(pos.x, pos.y + 1, pos.z);
  fx.push({
    t: 0, dur: 0.5,
    upd(k) {
      flash.scale.setScalar(0.4 + k * radius * 0.5);
      flash.material.opacity = 0.9 * (1 - k);
      light.intensity = 40 * (1 - k);
    },
    end() {
      scene.remove(flash);
      flash.geometry.dispose();
      flash.material.dispose();
      light.intensity = 0;
    },
  });
  spawnSparks(pos, 36, null, 11, 0xffb040, 0.9);
  spawnSparks(pos, 20, null, 6, 0x333333, 1.2);

  const dPlayer = player.body.position.distanceTo(pos);
  player.shake = Math.min(1.2, player.shake + Math.max(0, 1 - dPlayer / 28));

  for (const b of world.bodies.slice()) {
    if (b.type === CANNON.Body.STATIC) continue;
    const off = b.position.vsub(pos);
    const dist = off.length();
    if (dist > radius) continue;
    const fall = 1 - dist / radius;
    const dir = dist > 0.001 ? off.scale(1 / dist) : new CANNON.Vec3(0, 1, 0);
    dir.y += 0.45;
    dir.normalize();
    const u = b.userData || {};
    if (b === player.body) {
      if (player.dead) continue;
      b.velocity.vadd(dir.scale(dv * fall * 0.6), b.velocity);
      hurtPlayer(85 * fall * power * (owner === playerInfo ? 0.6 : 1), owner || playerInfo, pos, true);
    } else if (u.type === 'enemy') {
      if (u.enemy.dead) continue;
      b.wakeUp();
      b.velocity.vadd(dir.scale(dv * fall), b.velocity);
      u.enemy.stagger = 0.9;
      hitEnemy(u.enemy, 150 * fall * power, b.position, dir, false, true, owner || u.enemy.info);
    } else {
      b.wakeUp();
      b.applyImpulse(dir.scale(b.mass * dv * fall));
      if (u.type === 'crate') damageProp(b, 110 * fall * power, owner);
      else if (u.type === 'barrel') damageProp(b, 70 * fall * power, owner);
    }
  }
}

/* ------------------------------ grenades ------------------------------ */
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.13, 12, 10);
const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x3b4d2e, roughness: 0.6, metalness: 0.3 });
function lookDir() {
  const cp = Math.cos(player.pitch);
  return new THREE.Vector3(-Math.sin(player.yaw) * cp, Math.sin(player.pitch), -Math.cos(player.yaw) * cp);
}
function spawnGrenade(owner, px, py, pz, vx, vy, vz) {
  const body = new CANNON.Body({
    mass: 1,
    shape: new CANNON.Sphere(0.13),
    material: matBouncy,
    position: new CANNON.Vec3(px, py, pz),
    linearDamping: 0.04,
    angularDamping: 0.3,
    collisionFilterGroup: GRP.PROP,
    collisionFilterMask: GRP.STATIC | GRP.PROP | GRP.ENEMY,
    allowSleep: false,
  });
  body.velocity.set(vx, vy, vz);
  body.angularVelocity.set(rand(-6, 6), rand(-6, 6), rand(-6, 6));
  body.userData = { type: 'grenade' };
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.castShadow = true;
  track(body, mesh);
  grenades.push({ body, t: 2.4, owner });
}
function throwGrenade() {
  if (player.dead || player.grenades <= 0 || player.throwCd > 0) return;
  player.grenades--;
  player.throwCd = 0.8;
  const d = lookDir();
  const pb = player.body.position;
  const pv = player.body.velocity;
  spawnGrenade(playerInfo, pb.x + d.x * 0.7, pb.y + 1.1 + d.y * 0.7, pb.z + d.z * 0.7,
    d.x * 17 + pv.x, d.y * 17 + 3, d.z * 17 + pv.z);
  sfx.throw();
}
function updateGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    g.t -= dt;
    if (g.t <= 0) {
      const p = g.body.position.clone();
      untrack(g.body);
      grenades.splice(i, 1);
      wakeNear(p, 5);
      explode(p, 9.5, 17, 1, g.owner);
    }
  }
}

/* ------------------------------ bot bodies, hats & name tags ------------------------------ */
const PARTS = {
  torso: { shape: 'box', h: [0.30, 0.30, 0.17], p: [0, 1.0, 0], mass: 20 },
  head: { shape: 'sphere', r: 0.2, p: [0, 1.52, 0], mass: 5 },
  legL: { shape: 'box', h: [0.11, 0.35, 0.11], p: [-0.15, 0.35, 0], mass: 9 },
  legR: { shape: 'box', h: [0.11, 0.35, 0.11], p: [0.15, 0.35, 0], mass: 9 },
  armL: { shape: 'box', h: [0.08, 0.28, 0.08], p: [-0.38, 1.0, 0], mass: 4 },
  armR: { shape: 'box', h: [0.08, 0.28, 0.08], p: [0.38, 1.0, 0], mass: 4 },
};
const FEET = 0.92; // body centre height above the ground for a standing bot
const partMats = {};
const partMat = (c) => partMats[c] || (partMats[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
const shinyMats = {};
const shinyMat = (c) => shinyMats[c] || (shinyMats[c] = new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.6 }));
const glowMats = {};
const glowMat = (c) => glowMats[c] || (glowMats[c] = new THREE.MeshBasicMaterial({ color: c }));
const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.5, metalness: 0.5 });
// procedural greyscale textures (multiplied by the part colour) so bots look woven / plated instead of flat
const botTex = {};
function botTexture(kind) {
  if (botTex[kind]) return botTex[kind];
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, 128, 128);
  if (kind === 'fabric') {
    for (let y = 0; y < 128; y += 4) { g.fillStyle = (y / 4) % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'; g.fillRect(0, y, 128, 2); }
    for (let x = 0; x < 128; x += 4) { g.fillStyle = (x / 4) % 2 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)'; g.fillRect(x, 0, 2, 128); }
  } else if (kind === 'armor') {
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 2;
    for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
    for (let y = 0; y < 128; y += 32) for (let x = 0; x < 128; x += 32) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 3, y + 3, 26, 5); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x + 4, y + 4, 3, 3); g.fillRect(x + 25, y + 25, 3, 3); }
  } else if (kind === 'skin') {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, 128, 128);
  }
  for (let i = 0; i < 1400; i++) { const v = (Math.random() * 60) | 0; g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${v / 400})` : `rgba(255,255,255,${v / 500})`; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (botTex[kind] = t);
}
const texMats = {};
function texMat(c, kind) {
  const k = kind + c;
  return texMats[k] || (texMats[k] = new THREE.MeshStandardMaterial({ color: c, map: botTexture(kind), roughness: kind === 'armor' ? 0.5 : 0.85, metalness: kind === 'armor' ? 0.35 : 0 }));
}
const DARKM = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.6, metalness: 0.4 });
const EYEW = new THREE.MeshBasicMaterial({ color: 0xffffff });
const EYEB = new THREE.MeshBasicMaterial({ color: 0x15151a });

function partColor(key, info) {
  if (key === 'head') return info.skin;
  if (key === 'legL' || key === 'legR') return info.legs;
  return info.color;
}
function partGeometry(part) {
  return part.shape === 'sphere'
    ? new THREE.SphereGeometry(part.r, 14, 12)
    : new THREE.BoxGeometry(part.h[0] * 2, part.h[1] * 2, part.h[2] * 2);
}

function addHat(head, info) {
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    head.add(m);
    return m;
  };
  switch (info.hat) {
    case 'cap':
      add(new THREE.CylinderGeometry(0.21, 0.21, 0.07, 14), partMat(info.accent), 0, 0.14, 0);
      add(new THREE.BoxGeometry(0.22, 0.02, 0.16), partMat(info.accent), 0, 0.11, 0.2);
      break;
    case 'horns':
      add(new THREE.ConeGeometry(0.045, 0.2, 8), partMat(0xf0ead6), -0.13, 0.2, 0, 0, 0.45);
      add(new THREE.ConeGeometry(0.045, 0.2, 8), partMat(0xf0ead6), 0.13, 0.2, 0, 0, -0.45);
      break;
    case 'visor':
      add(new THREE.BoxGeometry(0.37, 0.08, 0.14), glowMat(0x55e6ff), 0, 0.03, 0.15);
      break;
    case 'mohawk':
      add(new THREE.BoxGeometry(0.05, 0.17, 0.3), partMat(info.accent), 0, 0.2, 0);
      break;
    case 'halo': {
      const t = add(new THREE.TorusGeometry(0.17, 0.022, 8, 20), glowMat(0xfff2a0), 0, 0.34, 0);
      t.rotation.x = Math.PI / 2;
      break;
    }
    case 'helmet':
      add(new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), shinyMat(0x1b1d22), 0, 0.0, 0);
      add(new THREE.BoxGeometry(0.34, 0.05, 0.1), glowMat(info.accent), 0, 0.05, 0.17);
      break;
    case 'crown':
      add(new THREE.CylinderGeometry(0.17, 0.12, 0.13, 5), shinyMat(0xffd24a), 0, 0.23, 0);
      break;
    case 'antenna':
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), partMat(0x999999), 0, 0.3, 0);
      add(new THREE.SphereGeometry(0.045, 8, 8), glowMat(0xff3b3b), 0, 0.43, 0);
      break;
    case 'witch':
      add(new THREE.CylinderGeometry(0.31, 0.31, 0.02, 16), partMat(0x241038), 0, 0.14, 0);
      add(new THREE.ConeGeometry(0.17, 0.4, 10), partMat(0x2f1650), 0, 0.35, 0);
      add(new THREE.CylinderGeometry(0.176, 0.176, 0.06, 12), glowMat(0xff9a2e), 0, 0.19, 0);
      break;
    case 'pumpkin':
      add(new THREE.SphereGeometry(0.17, 12, 10), partMat(0xff7a1a), 0, 0.2, 0);
      add(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 6), partMat(0x2f6a22), 0, 0.38, 0);
      for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.06, 0.02), glowMat(0xffe066), sx * 0.06, 0.22, 0.16);
      break;
    case 'bolts':
      add(new THREE.BoxGeometry(0.34, 0.07, 0.3), partMat(0x151515), 0, 0.17, 0);
      for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 8), shinyMat(0x9aa4b0), sx * 0.22, 0, 0, 0, Math.PI / 2);
      break;
    case 'hood':
      add(new THREE.SphereGeometry(0.255, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.55), partMat(0x14121c), 0, 0.0, -0.01);
      break;
    case 'vamp':
      add(new THREE.BoxGeometry(0.36, 0.09, 0.34), partMat(0x0c0c10), 0, 0.15, -0.01);
      add(new THREE.ConeGeometry(0.05, 0.08, 4), partMat(0x0c0c10), 0, 0.1, 0.17, Math.PI);
      for (const sx of [-1, 1]) add(new THREE.ConeGeometry(0.012, 0.05, 6), partMat(0xffffff), sx * 0.045, -0.11, 0.19, Math.PI, 0);
      break;
    case 'batears':
      add(new THREE.ConeGeometry(0.07, 0.24, 6), partMat(0x1b1b24), -0.12, 0.26, 0, 0, 0.22);
      add(new THREE.ConeGeometry(0.07, 0.24, 6), partMat(0x1b1b24), 0.12, 0.26, 0, 0, -0.22);
      break;
    default:
      break;
  }
}

// one mesh for a body part; bots, ragdolls and the player's corpse all share this
function makePartMesh(key, info) {
  const part = PARTS[key];
  const col = partColor(key, info);
  const kind = key === 'head' ? 'skin' : key === 'torso' ? 'armor' : 'fabric';
  const m = new THREE.Mesh(partGeometry(part), texMat(col, kind));
  m.castShadow = true;
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.set(rx, 0, rz); o.castShadow = true; m.add(o); return o;
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (key === 'torso') {
    add(B(0.22, 0.14, 0.02), glowMat(info.accent), 0, 0.06, 0.175); // chest emblem
    add(B(0.64, 0.07, 0.36), DARKM, 0, -0.26, 0); // belt
    add(B(0.07, 0.075, 0.02), shinyMat(0xc9b04a), 0, -0.26, 0.185); // buckle
    for (const sx of [-1, 1]) {
      add(B(0.16, 0.1, 0.2), texMat(info.accent, 'armor'), sx * 0.34, 0.27, 0); // shoulder pads
      add(B(0.12, 0.12, 0.05), DARKM, sx * 0.17, -0.06, 0.18); // magazine pouches
      add(B(0.1, 0.03, 0.055), partMat(info.accent), sx * 0.17, 0.0, 0.18);
      add(B(0.06, 0.32, 0.02), DARKM, sx * 0.16, 0.1, 0.17); // vest straps
    }
    add(B(0.5, 0.05, 0.3), DARKM, 0, 0.3, 0); // collar
    add(B(0.3, 0.26, 0.06), shinyMat(0x22252b), 0, 0.02, -0.19); // backpack plate
  } else if (key === 'head') {
    const eyeY = 0.03;
    for (const sx of [-1, 1]) {
      add(B(0.07, 0.05, 0.02), EYEW, sx * 0.075, eyeY, 0.185);
      add(B(0.035, 0.04, 0.022), EYEB, sx * 0.075, eyeY, 0.19);
      add(B(0.085, 0.014, 0.02), partMat(0x20160e), sx * 0.075, eyeY + 0.055, 0.183, 0, sx * -0.18); // brows
      add(B(0.03, 0.06, 0.04), texMat(col, 'skin'), sx * 0.2, 0, 0.0); // ears
    }
    add(B(0.035, 0.05, 0.04), texMat(col, 'skin'), 0, -0.02, 0.2); // nose
    add(B(0.09, 0.016, 0.02), partMat(0x4a1f1f), 0, -0.09, 0.18); // mouth
    add(new THREE.CylinderGeometry(0.075, 0.085, 0.1, 10), texMat(col, 'skin'), 0, -0.22, 0); // neck
    addHat(m, info);
  } else if (key === 'legL' || key === 'legR') {
    add(B(0.125, 0.11, 0.2), DARKM, 0, -0.3, 0.03); // boot
    add(B(0.13, 0.03, 0.21), shinyMat(0x0c0c0e), 0, -0.35, 0.03); // sole
    add(B(0.125, 0.07, 0.125), texMat(info.accent, 'armor'), 0, -0.02, 0.0); // knee guard
    add(B(0.07, 0.1, 0.03), DARKM, 0.0, 0.2, 0.0 + 0.118); // thigh pocket
  } else if (key === 'armL' || key === 'armR') {
    add(B(0.095, 0.09, 0.095), DARKM, 0, -0.27, 0); // glove
    add(B(0.1, 0.05, 0.1), texMat(info.accent, 'armor'), 0, -0.06, 0); // elbow pad
    add(B(0.09, 0.03, 0.09), partMat(info.accent), 0, 0.12, 0); // sleeve band
  }
  return m;
}

function tagSprite(info) {
  if (!info.tagMat) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 10, 256, 44);
    g.fillStyle = hexCss(info.color);
    g.fillRect(0, 10, 8, 44);
    g.font = 'bold 26px "Segoe UI Emoji","Segoe UI",sans-serif';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.fillText(info.emoji + ' ' + info.name, 18, 33);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    info.tagMat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false });
  }
  const s = new THREE.Sprite(info.tagMat);
  s.scale.set(1.5, 0.375, 1);
  s.position.set(0, 1.1, 0);
  return s;
}

function buildBotMesh(e) {
  const info = e.info;
  const g = new THREE.Group();
  g.rotation.order = 'YXZ';
  const torso = makePartMesh('torso', info);
  torso.position.set(0, PARTS.torso.p[1] - FEET, 0);
  g.add(torso);
  const head = makePartMesh('head', info);
  head.position.set(0, PARTS.head.p[1] - FEET, 0);
  g.add(head);
  const limb = (key) => {
    const part = PARTS[key];
    const pivot = new THREE.Group();
    pivot.position.set(part.p[0], part.p[1] + part.h[1] - FEET, part.p[2]);
    const m = makePartMesh(key, info);
    m.position.set(0, -part.h[1], 0);
    pivot.add(m);
    g.add(pivot);
    return pivot;
  };
  e.legL = limb('legL');
  e.legR = limb('legR');
  e.armL = limb('armL');
  e.armR = limb('armR');
  e.armL.rotation.x = -1.35;
  e.armR.rotation.x = -1.45;
  const gun = new THREE.Group();
  gun.position.set(0, -0.3, 0);
  const gp = (w, h, d, x, y, z, mat = gunMat) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); o.castShadow = true; gun.add(o); return o; };
  // arm points forward when aiming, so the gun's length runs along local -Y
  gp(0.07, 0.3, 0.09, 0, -0.1, 0); // receiver
  gp(0.06, 0.26, 0.07, 0, -0.38, 0.0, shinyMat(0x2a2c32)); // handguard
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 8), shinyMat(0x9aa0aa)); bar.position.set(0, -0.62, 0); gun.add(bar);
  gp(0.04, 0.06, 0.04, 0, -0.77, 0, gunMat); // muzzle
  gp(0.05, 0.14, 0.05, 0, 0.1, 0.0, gunMat); gp(0.06, 0.2, 0.07, 0, 0.2, 0.0, shinyMat(0x2a2c32)); // stock
  gp(0.04, 0.12, 0.04, 0, -0.05, -0.08); gp(0.04, 0.12, 0.05, 0, -0.26, -0.09, shinyMat(0x2a2c32)); gp(0.015, 0.03, 0.03, 0, -0.5, 0.05, gunMat); // grip + mag + sight
  gp(0.02, 0.02, 0.06, 0, -0.3, -0.06, glowMat(info.accent)); // accent light
  gp(0.03, 0.1, 0.02, 0, -0.2, -0.06, shinyMat(0x111111));
  e.armR.add(gun);
  e.tag = tagSprite(info);
  g.add(e.tag);
  return g;
}

/* ------------------------------ spawning helpers ------------------------------ */
function chestOf(info) {
  if (info.netDead) return null;
  if (info.isPlayer) {
    if (player.dead) return null;
    const b = player.body.position;
    return new CANNON.Vec3(b.x, b.y + (player.sliding ? 0.0 : 0.45), b.z);
  }
  const e = info.enemy;
  if (!e || e.dead) return null;
  const b = e.body.position;
  return new CANNON.Vec3(b.x, b.y + 0.3, b.z);
}
function pickSpawn() {
  let best = SPAWNS[0], bestD = -1;
  for (let i = 0; i < 8; i++) {
    const s = SPAWNS[(Math.random() * SPAWNS.length) | 0];
    let md = 999;
    for (const info of roster) {
      const c = chestOf(info);
      if (c) md = Math.min(md, Math.hypot(c.x - s.x, c.z - s.z));
    }
    if (md > bestD) { bestD = md; best = s; }
  }
  return best;
}

/* ------------------------------ bots ------------------------------ */
const KITS = {
  rifle: { range: [9, 17], burst: [2, 4], bint: 0.11, cd: [0.9, 1.9], dmg: 10, pellets: 1, spread: 1, speed: 58, rush: 0, max: 48 },
  smg: { range: [6, 12], burst: [4, 7], bint: 0.07, cd: [0.7, 1.4], dmg: 7, pellets: 1, spread: 1.15, speed: 56, rush: 0, max: 28 },
  shotgun: { range: [4, 8], burst: [1, 1], bint: 0.1, cd: [1.1, 1.9], dmg: 7, pellets: 6, spread: 3.0, speed: 48, rush: 1, max: 16 },
  sniper: { range: [22, 32], burst: [1, 1], bint: 0.1, cd: [1.9, 3.0], dmg: 34, pellets: 1, spread: 0.35, speed: 95, rush: 0, max: 70 },
};
class Bot {
  constructor(info, x, z) {
    this.info = info;
    info.enemy = this;
    this.hp = 100;
    this.dead = false;
    this.stagger = 0;
    this.flinch = 0;
    this.invuln = 1.8;
    this.skill = info.skill * DIFFS[prefs.diff].skill;
    this.target = null;
    this.hasLOS = false;
    this.retargetT = Math.random() * 0.4;
    this.revenge = null;
    this.revengeT = 0;
    this.shootT = 1 + Math.random() * 1.5;
    this.burst = 0;
    this.burstT = 0;
    this.grenadeCd = rand(6, 14);
    this.strafe = Math.random() < 0.5 ? 1 : -1;
    this.strafeT = 1 + Math.random() * 2;
    this.kit = KITS[info.kit] || KITS.rifle;
    this.range = rand(this.kit.range[0], this.kit.range[1]);
    this.dodgeT = 0; this.jumpCd = rand(1, 3); this.hide = false; this.coverPhase = rand(1, 3); this.cover = null; this.coverRefT = 0;
    this.walkT = Math.random() * 10;
    this.yaw = Math.random() * Math.PI * 2;
    this.stuckT = 0;
    this.lastX = x;
    this.lastZ = z;
    this.wander = null;
    this.speed = 4.0 + this.skill * 1.2 + Math.random() * 0.4;
    const body = new CANNON.Body({
      mass: 70,
      shape: new CANNON.Box(new CANNON.Vec3(0.32, 0.9, 0.28)),
      position: new CANNON.Vec3(x, FEET, z),
      fixedRotation: true,
      material: matSlip,
      linearDamping: 0.08,
      collisionFilterGroup: GRP.ENEMY,
      collisionFilterMask: GRP.STATIC | GRP.PROP | GRP.PLAYER | GRP.ENEMY,
      allowSleep: false,
    });
    body.userData = { type: 'enemy', enemy: this };
    this.body = body;
    if (info.remote) {
      this.remote = true;
      this.netT = null;
      this.netFirst = true;
      body.type = CANNON.Body.KINEMATIC;
      body.mass = 0;
      body.updateMassProperties();
      body.collisionFilterMask = 0;
    }
    world.addBody(body);
    this.group = buildBotMesh(this);
    scene.add(this.group);
  }

  // nearest visible fighter (could be you or another bot) wins
  pickTarget() {
    const p = this.body.position;
    const eye = new CANNON.Vec3(p.x, p.y + 0.5, p.z);
    const cands = [];
    for (const info of roster) {
      if (info === this.info) continue;
      const c = chestOf(info);
      if (!c) continue;
      cands.push({ info, c, d: Math.hypot(c.x - p.x, c.z - p.z) });
    }
    cands.sort((a, b) => a.d - b.d);
    this.target = null;
    this.hasLOS = false;
    if (this.revenge && this.revengeT > 0) {
      const c = cands.find((x) => x.info === this.revenge);
      if (c && !rayCast(eye, c.c, GRP.STATIC | GRP.PROP)) { this.target = c.info; this.hasLOS = true; return; }
    }
    for (const c of cands) {
      if (c.d > 70) break;
      if (!rayCast(eye, c.c, GRP.STATIC | GRP.PROP)) { this.target = c.info; this.hasLOS = true; return; }
    }
    if (cands.length) this.target = cands[0].info; // nothing visible: chase the closest
  }

  coverPoint(p, tp) {
    if (this.cover && gameTime < this.coverRefT) return this.cover;
    let best = null, bd = 1e9;
    for (const r of coverRects) {
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d > 16 || d < 0.5) continue;
      const ex = r.x - tp.x, ez = r.z - tp.z, el = Math.hypot(ex, ez) || 1, off = Math.max(r.hw, r.hd) + 1.1;
      const cx = r.x + (ex / el) * off, cz = r.z + (ez / el) * off;
      if (!clearSpot(cx, cz, 0.5)) continue;
      const dd = Math.hypot(cx - p.x, cz - p.z);
      if (dd < bd) { bd = dd; best = { x: cx, z: cz }; }
    }
    this.cover = best; this.coverRefT = gameTime + 1.2;
    return best;
  }

  netStep(dt) {
    const m = this.netT, p = this.body.position;
    if (!m) { this.group.visible = false; return; }
    const dead = !!m.d;
    this.info.netDead = dead;
    this.group.visible = !dead;
    this.body.collisionFilterGroup = dead ? 0 : GRP.ENEMY;
    const ty = m.y - 0.5 + FEET;
    if (this.netFirst) { p.set(m.x, ty, m.z); this.netFirst = false; }
    const k = Math.min(1, 12 * dt);
    const ox = p.x, oz = p.z;
    p.x += (m.x - p.x) * k; p.y += (ty - p.y) * k; p.z += (m.z - p.z) * k;
    this.body.aabbNeedsUpdate = true;
    const sp = Math.hypot(p.x - ox, p.z - oz) / Math.max(dt, 1e-3);
    this.yaw = lerpAngle(this.yaw, m.yw + Math.PI, k);
    this.walkT += dt * sp * 2.4;
    const amp = Math.min(1, sp / 2) * 0.7;
    this.legL.rotation.x = Math.sin(this.walkT) * amp;
    this.legR.rotation.x = -Math.sin(this.walkT) * amp;
    this.flinch = Math.max(0, this.flinch - dt * 3);
    this.group.position.set(p.x, p.y, p.z);
    this.group.rotation.set(-this.flinch * 0.35, this.yaw, 0);
    this.tag.visible = camera.position.distanceTo(this.group.position) < 45;
  }

  update(dt) {
    if (this.remote) { this.netStep(dt); return; }
    const p = this.body.position;
    const v = this.body.velocity;
    if (admin.freeze && !this.dead) { v.x = 0; v.z = 0; return; }
    this.invuln -= dt;
    this.stagger -= dt;
    this.revengeT -= dt;
    this.dodgeT -= dt; this.jumpCd -= dt; this.coverPhase -= dt;
    if (this.coverPhase <= 0) { this.hide = !this.hide; this.coverPhase = rand(2.5, 4); }
    this.flinch = Math.max(0, this.flinch - dt * 3);

    this.retargetT -= dt;
    if (this.retargetT <= 0) { this.retargetT = 0.45 + Math.random() * 0.3; this.pickTarget(); }

    let tp = null;
    if (this.target) {
      tp = chestOf(this.target);
      if (!tp) { this.target = null; this.hasLOS = false; }
    }
    let dist = 999;
    let nx = 0, nz = 0;
    if (tp) {
      const dx = tp.x - p.x, dz = tp.z - p.z;
      dist = Math.hypot(dx, dz) || 1;
      nx = dx / dist; nz = dz / dist;
    }

    // where do I want to go?
    let mx = 0, mz = 0;
    const heal = this.hp < 60 ? nearestPickup(p.x, p.z, 'health') : null;
    this.strafeT -= dt;
    if (this.strafeT <= 0) { this.strafe *= -1; this.strafeT = 1.2 + Math.random() * 2.2; }
    if (heal) {
      const dx = heal.x - p.x, dz = heal.z - p.z, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
    } else if (tp && this.hp < 38 && this.hide) { // hurt: duck behind cover for a few seconds, then peek out again
      const cp = this.coverPoint(p, tp);
      if (cp) { const dx = cp.x - p.x, dz = cp.z - p.z, d = Math.hypot(dx, dz) || 1; if (d > 0.9) { mx = dx / d; mz = dz / d; } else { mx = -nz * this.strafe * 0.2; mz = nx * this.strafe * 0.2; } }
      else { mx = -nx; mz = -nz; }
    } else if (tp) {
      const tHp = this.target.isPlayer ? player.hp : this.target.enemy ? this.target.enemy.hp : 100;
      const rng = this.range * (tHp < 35 && this.hp > 45 ? 0.6 : 1); // finish off weak targets
      let f = 0;
      if (!this.hasLOS || dist > rng + 4) f = 1;
      else if (this.kit.rush && dist > rng) f = 1;
      else if (dist < rng - 4 && !this.kit.rush) f = -0.7;
      const sm = this.dodgeT > 0 ? 1.5 : 0.7;
      mx = nx * f - nz * this.strafe * sm;
      mz = nz * f + nx * this.strafe * sm;
    } else {
      if (!this.wander || Math.hypot(this.wander.x - p.x, this.wander.z - p.z) < 3) {
        this.wander = SPAWNS[(Math.random() * SPAWNS.length) | 0];
      }
      const dx = this.wander.x - p.x, dz = this.wander.z - p.z, d = Math.hypot(dx, dz) || 1;
      mx = dx / d; mz = dz / d;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }

    // steer around walls and crates
    if (ml > 0.1) {
      const hit = rayCast(new CANNON.Vec3(p.x, p.y, p.z), new CANNON.Vec3(p.x + mx * 2, p.y, p.z + mz * 2), GRP.STATIC | GRP.PROP);
      if (hit) {
        const a = this.strafe > 0 ? 1.25 : -1.25;
        const c = Math.cos(a), s = Math.sin(a);
        const rx = mx * c - mz * s, rz = mx * s + mz * c;
        mx = rx; mz = rz;
      }
    }

    if (this.stagger <= 0) {
      const k = Math.min(1, 8 * dt);
      v.x += (mx * this.speed - v.x) * k;
      v.z += (mz * this.speed - v.z) * k;
      if (tp && this.dodgeT > 0) { v.x += -nz * this.strafe * 14 * dt; v.z += nx * this.strafe * 14 * dt; } // sidestep when hit
    }
    // hop: dodge after being hit, now and then when fighting at range
    if (this.jumpCd <= 0 && Math.abs(v.y) < 0.4 && this.stagger <= 0 && this.skill > 0.75 && ((this.dodgeT > 0 && Math.random() < 0.45) || (tp && this.hasLOS && dist > 6 && dist < 22 && Math.random() < 0.004))) { v.y = 5.2; this.jumpCd = rand(1.8, 3.4); }
    // un-stick
    this.stuckT += dt;
    if (this.stuckT > 1) {
      if (Math.hypot(p.x - this.lastX, p.z - this.lastZ) < 0.3) {
        this.strafe *= -1;
        this.strafeT = 1.5;
        this.wander = null;
      }
      this.lastX = p.x; this.lastZ = p.z; this.stuckT = 0;
    }

    // facing
    let faceYaw = this.yaw;
    if (tp && this.hasLOS) faceYaw = Math.atan2(tp.x - p.x, tp.z - p.z);
    else if (ml > 0.1) faceYaw = Math.atan2(mx, mz);
    this.yaw = lerpAngle(this.yaw, faceYaw, Math.min(1, 10 * dt));

    // animation (drawn at the interpolated position so it stays smooth)
    const sp = Math.hypot(v.x, v.z);
    this.walkT += dt * sp * 2.4;
    const amp = Math.min(1, sp / 2) * 0.7;
    this.legL.rotation.x = Math.sin(this.walkT) * amp;
    this.legR.rotation.x = -Math.sin(this.walkT) * amp;
    const ip = this.body.interpolatedPosition;
    this.group.position.set(ip.x, ip.y, ip.z);
    this.group.rotation.set(-this.flinch * 0.35, this.yaw, 0);
    this.tag.visible = camera.position.distanceTo(this.group.position) < 45;

    // shooting in bursts
    this.shootT -= dt;
    if (this.burst > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) { this.fireOne(); this.burst--; this.burstT = this.kit.bint; }
    } else if (this.shootT <= 0 && tp && this.hasLOS && dist < this.kit.max && this.stagger <= 0) {
      const kt = this.kit;
      this.burst = kt.burst[0] + ((Math.random() * (kt.burst[1] - kt.burst[0] + 1)) | 0);
      this.burstT = 0;
      this.shootT = kt.cd[0] + Math.random() * (kt.cd[1] - kt.cd[0]) + (1 - Math.min(1, this.skill)) * 1.2;
    }
    // grenades
    this.grenadeCd -= dt;
    if (this.grenadeCd <= 0 && tp && this.hasLOS && dist > 9 && dist < 26 && this.stagger <= 0) {
      this.grenadeCd = 14 + Math.random() * 8;
      const d = Math.max(dist, 1);
      const sp2 = Math.min(20, d * 0.82 + 0.5);
      spawnGrenade(this.info, p.x + nx * 0.7, p.y + 0.9, p.z + nz * 0.7, nx * sp2, 6, nz * sp2);
    }
  }

  fireOne() {
    const tp = this.target ? chestOf(this.target) : null;
    if (!tp) return;
    const p = this.body.position;
    const from = new CANNON.Vec3(p.x, p.y + 0.5, p.z);
    const tinfo = this.target;
    const tv = tinfo.isPlayer ? player.body.velocity : tinfo.enemy ? tinfo.enemy.body.velocity : new CANNON.Vec3();
    const d = from.distanceTo(tp);
    const k = this.kit, SPEED = k.speed;
    const lead = (d / SPEED) * (0.45 + 0.45 * Math.min(1, this.skill / 1.2));
    const err = ((0.28 + d * 0.022) / this.skill) * k.spread * (this.dodgeT > 0 ? 1.3 : 1);
    for (let n = 0; n < k.pellets; n++) {
      const aim = new CANNON.Vec3(
        tp.x + tv.x * lead + rand(-err, err),
        tp.y + tv.y * lead * 0.3 + rand(-err, err) + d * 0.012, // compensate bullet drop
        tp.z + tv.z * lead + rand(-err, err)
      );
      const dir = aim.vsub(from).unit();
      spawnBullet(from.vadd(dir.scale(0.9)), dir.scale(SPEED), this.info, k.dmg * DIFFS[prefs.diff].dmg, from.clone());
    }
    if (camera.position.distanceTo(p) < 45) sfx.enemyShot();
  }
}

function hitEnemy(e, dmg, point, dir, head, fromBlast = false, attacker = playerInfo) {
  if (e.remote) { if (attacker === playerInfo && !fromBlast) hitMarker(false); return; }
  if (e.dead || e.invuln > 0) return;
  if (attacker === e.info && !fromBlast) return;
  if (admin.kill && attacker === playerInfo) dmg = 9999;
  const d = dmg * (head ? 2.4 : 1);
  e.hp -= d;
  e.stagger = Math.max(e.stagger, head ? 0.45 : 0.2);
  e.flinch = 1;
  e.dodgeT = 0.55 + Math.random() * 0.3; if (Math.random() < 0.6) e.strafe *= -1;
  e.body.wakeUp();
  if (attacker && attacker !== e.info) { e.revenge = attacker; e.revengeT = 4; }
  if (!fromBlast) {
    e.body.velocity.x += dir.x * 2.4;
    e.body.velocity.z += dir.z * 2.4;
  }
  spawnSparks(point, 7, null, 3.5, 0xb01818, 0.45);
  const playerDidIt = attacker && attacker.isPlayer;
  if (playerDidIt) hitMarker(e.hp <= 0);
  if (e.hp <= 0) {
    const kind = attacker === e.info ? 'self' : fromBlast ? 'blast' : head ? 'head' : 'bullet';
    killEnemy(e, dir, d, point, head, attacker, kind);
  } else if (playerDidIt) {
    sfx.hit();
  }
}

function killEnemy(e, dir, dmg, point, head, attacker, kind) {
  if (e.dead) return;
  e.dead = true;
  makeRagdoll(e, dir, dmg, point, head);
  world.removeBody(e.body);
  scene.remove(e.group);
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
  e.info.enemy = null;
  registerKill(attacker, e.info, kind);
  if (state === 'play') respawns.push({ info: e.info, t: RESPAWN_TIME });
}

function updateRespawns(dt) {
  for (let i = respawns.length - 1; i >= 0; i--) {
    const r = respawns[i];
    r.t -= dt;
    if (r.t <= 0) {
      const s = pickSpawn();
      const bot = new Bot(r.info, s.x, s.z);
      enemies.push(bot);
      respawns.splice(i, 1);
    }
  }
}

/* ------------------------------ ragdolls ------------------------------ */
const ragdolls = [];
function makeRagdoll(e, dir, dmg, point, head) {
  const info = e.info;
  const yawQ = new CANNON.Quaternion();
  yawQ.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), e.yaw);
  const feet = new CANNON.Vec3(e.body.position.x, e.body.position.y - FEET, e.body.position.z);
  const base = e.body.velocity.clone();
  const kick = 2 + dmg * 0.035;
  const bodies = {};
  const list = [];
  let nearest = null, nearestD = Infinity;
  for (const key of Object.keys(PARTS)) {
    const part = PARTS[key];
    const shape = part.shape === 'sphere'
      ? new CANNON.Sphere(part.r)
      : new CANNON.Box(new CANNON.Vec3(part.h[0], part.h[1], part.h[2]));
    const off = yawQ.vmult(new CANNON.Vec3(part.p[0], part.p[1], part.p[2]));
    const b = new CANNON.Body({
      mass: part.mass,
      material: matProp,
      shape,
      position: feet.vadd(off),
      quaternion: yawQ.clone(),
      linearDamping: 0.12,
      angularDamping: 0.55,
      collisionFilterGroup: GRP.RAG,
      collisionFilterMask: GRP.STATIC | GRP.PROP,
      sleepSpeedLimit: 0.3,
      sleepTimeLimit: 0.5,
    });
    b.velocity.set(base.x + dir.x * kick, base.y + dir.y * kick + 1.2, base.z + dir.z * kick);
    b.angularVelocity.set(rand(-3, 3), rand(-3, 3), rand(-3, 3));
    b.userData = { type: 'rag' };
    track(b, makePartMesh(key, info));
    bodies[key] = b;
    list.push(b);
    const dd = b.position.distanceTo(point);
    if (dd < nearestD) { nearestD = dd; nearest = b; }
  }
  if (nearest) nearest.applyImpulse(dir.scale(dmg * (head ? 0.18 : 0.12) * Math.sqrt(nearest.mass)), point.vsub(nearest.position));

  const cons = [];
  const link = (a, pa, b, pb) => {
    const c = new CANNON.PointToPointConstraint(bodies[a], new CANNON.Vec3(...pa), bodies[b], new CANNON.Vec3(...pb));
    c.collideConnected = false;
    world.addConstraint(c);
    cons.push(c);
  };
  link('torso', [0, 0.32, 0], 'head', [0, -0.2, 0]);
  link('torso', [-0.15, -0.3, 0], 'legL', [0, 0.35, 0]);
  link('torso', [0.15, -0.3, 0], 'legR', [0, 0.35, 0]);
  link('torso', [-0.38, 0.25, 0], 'armL', [0, 0.25, 0]);
  link('torso', [0.38, 0.25, 0], 'armR', [0, 0.25, 0]);

  ragdolls.push({ bodies: list, cons, t: 14 });
  if (ragdolls.length > 10) removeRagdoll(ragdolls.shift());
}
function removeRagdoll(r) {
  for (const c of r.cons) world.removeConstraint(c);
  for (const b of r.bodies) untrack(b);
}

/* ------------------------------ player ------------------------------ */
function placePlayer(s) {
  const b = player.body;
  b.position.set(s.x, 0.6, s.z);
  b.previousPosition.copy(b.position);
  b.interpolatedPosition.copy(b.position);
  b.velocity.set(0, 0, 0);
  player.yaw = Math.atan2(s.x, s.z); // face the middle of the arena
  player.pitch = 0;
}

function hurtPlayer(d, attacker, src, blast = false) {
  if (player.dead || state !== 'play' || player.invuln > 0 || admin.god) return;
  player.hp -= d;
  player.lastHurt = gameTime;
  player.shake = Math.min(1.2, player.shake + d * 0.02);
  player.vignette = Math.min(0.9, player.vignette + 0.35 + d * 0.01);
  if (src) { player.dmgX = src.x; player.dmgZ = src.z; player.dmgT = 1.2; }
  sfx.hurt();
  if (player.hp <= 0) {
    player.hp = 0;
    const kind = attacker === playerInfo ? 'self' : blast ? 'blast' : 'bullet';
    playerDie(attacker || playerInfo, kind);
  }
}

function playerDie(attacker, kind) {
  if (player.dead) return;
  const b = player.body;
  player.dead = true;
  player.deadT = RESPAWN_TIME;
  player.killer = attacker;
  player.sliding = false;
  player.ads = false;
  firing = false;
  const ip = b.interpolatedPosition;
  player.deathPos.set(ip.x, ip.y - 0.5, ip.z);

  // your body drops as a ragdoll too
  const from = chestOf(attacker);
  let dx = 0, dz = 0;
  if (from) { dx = b.position.x - from.x; dz = b.position.z - from.z; }
  const dl = Math.hypot(dx, dz) || 1;
  const dir = new CANNON.Vec3(dx / dl, 0.25, dz / dl);
  makeRagdoll(
    { info: playerInfo, yaw: player.yaw + Math.PI, body: { position: new CANNON.Vec3(ip.x, ip.y - 0.5 + FEET, ip.z), velocity: b.velocity.clone() } },
    dir, 60, new CANNON.Vec3(ip.x, ip.y + 0.4, ip.z), false
  );

  b.type = CANNON.Body.KINEMATIC;
  b.collisionFilterMask = 0;
  b.velocity.set(0, 0, 0);

  registerKill(attacker, playerInfo, kind);
  if (net.on) net.send({ t: 'died', k: attacker === playerInfo ? net.myId : (attacker && attacker.netId) || null, kind });
  const who = attacker === playerInfo ? 'YOURSELF' : attacker.name.toUpperCase();
  banner(`ELIMINATED BY ${who}<br><span style="font-size:20px;letter-spacing:4px">RESPAWNING...</span>`, RESPAWN_TIME * 1000 - 200);
}

function respawnPlayer() {
  const b = player.body;
  const s = pickSpawn();
  b.type = CANNON.Body.DYNAMIC;
  b.collisionFilterMask = GRP.STATIC | GRP.PROP | GRP.ENEMY;
  b.wakeUp();
  placePlayer(s);
  player.dead = false;
  player.hp = player.maxHp;
  resetInventory();
  player.grenades = Math.max(player.grenades, 2);
  player.reloadT = 0;
  player.invuln = 2.5; // spawn protection
  player.vignette = 0;
  player.landDip = 0;
}

function reload() {
  const w = curW();
  if (w.melee || player.dead || player.reloadT > 0 || player.ammo >= player.mag || player.reserve <= 0) return;
  player.reloadT = w.reload;
  player.reloadMax = w.reload;
  player.ads = false;
  sfx.reload();
}

const abActive = (id) => player.abT > 0 && player.abId === id;
function useAbility() {
  if (player.dead || state !== 'play') return;
  const w = curW();
  const ab = w.ability ? ABILITIES[w.ability] : null;
  if (!ab) { toast('NO ABILITY ON THIS WEAPON'); return; }
  if (!player.abCd) player.abCd = {};
  const cd = player.abCd[curId()] || 0;
  if (cd > 0) { toast(ab.name + ' READY IN ' + Math.ceil(cd) + 's'); return; }
  player.abCd[curId()] = ab.cd;
  player.abId = w.ability;
  player.abT = ab.dur;
  toast(ab.name + '!');
  const pb = player.body.position, v = player.body.velocity;
  const d = lookDir();
  if (w.ability === 'adrenaline') player.hp = Math.min(player.maxHp, player.hp + 25);
  else if (w.ability === 'shield') player.invuln = Math.max(player.invuln, ab.dur);
  else if (w.ability === 'dash') {
    const hl = Math.hypot(d.x, d.z) || 1;
    player.dashX = (d.x / hl) * 24; player.dashZ = (d.z / hl) * 24; player.dashT = 0.22;
    player.invuln = Math.max(player.invuln, 0.3);
    player.fov = 1;
  } else if (w.ability === 'shockwave') {
    player.shake = 1;
    spawnSparks(new CANNON.Vec3(pb.x, pb.y - 0.3, pb.z), 40, null, 10, 0xffcc66, 0.6);
    for (const e of enemies.slice()) {
      if (e.dead) continue;
      const c = chestOf(e.info);
      if (!c) continue;
      const dx = c.x - pb.x, dz = c.z - pb.z, dist = Math.hypot(dx, dz);
      if (dist > 7) continue;
      if (e.remote) { if (net.on) net.sendTo(e.info.netId, { t: 'hit', dmg: 40 }); continue; }
      hitEnemy(e, 40, new CANNON.Vec3(c.x, c.y, c.z), { x: dx / (dist || 1), y: 0, z: dz / (dist || 1) }, false, false, playerInfo);
      e.body.velocity.x += (dx / (dist || 1)) * 14; e.body.velocity.z += (dz / (dist || 1)) * 14; e.body.velocity.y += 5;
    }
  }
}

function meleeSwing(w) {
  player.fireCd = w.cd;
  player.swing = 1;
  const pb = player.body.position;
  const d = lookDir();
  const ox = pb.x, oy = pb.y + 1.2, oz = pb.z;
  if (player.onGround) { player.body.velocity.x += d.x * 3.5; player.body.velocity.z += d.z * 3.5; }
  burst({ dur: 0.14, freq: 2500, sweepTo: 900, vol: 0.25, tone: 400, toneEnd: 200 });
  for (const e of enemies.slice()) {
    if (e.dead) continue;
    const c = chestOf(e.info);
    if (!c) continue;
    const vx = c.x - ox, vy = c.y - oy, vz = c.z - oz;
    const dist = Math.hypot(vx, vy, vz);
    if (dist > w.range + 0.6) continue;
    if ((vx * d.x + vy * d.y + vz * d.z) / Math.max(dist, 0.001) < w.arc) continue;
    if (abActive('bloodlust')) player.hp = Math.min(player.maxHp, player.hp + w.dmg * 0.5);
    if (e.remote) { if (net.on) net.sendTo(e.info.netId, { t: 'hit', dmg: w.dmg }); hitMarker(false); continue; }
    hitEnemy(e, w.dmg, new CANNON.Vec3(c.x, c.y, c.z), { x: d.x, y: d.y, z: d.z }, false, false, playerInfo);
    e.body.velocity.x += d.x * (w.kb || 5); e.body.velocity.z += d.z * (w.kb || 5);
    player.shake = Math.min(1, player.shake + 0.25);
  }
}

const admin = { open: false, auth: false, wall: false, god: false, ammo: false, aim: false, kill: false, lock: false, speed: false, jump: false, freeze: false };
const ADMIN_CODE = 'adminpanelf2p';
const shotSnds = {};
function customShot(id) {
  try {
    let pool = shotSnds[id];
    if (!pool) { pool = shotSnds[id] = { i: 0, a: [] }; for (let k = 0; k < 3; k++) { const au = new Audio('./sounds/' + id + '_shot.ogg'); au.volume = 0.9; pool.a.push(au); } }
    const au = pool.a[pool.i++ % pool.a.length];
    au.currentTime = 0;
    const p = au.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}
function aimbot() {
  const pb = player.body.position;
  const ox = pb.x, oy = pb.y + 1.2, oz = pb.z;
  let best = null, bestD = 1e9;
  for (const e of enemies) {
    if (e.dead) continue;
    const c = chestOf(e.info);
    if (!c) continue;
    const dx = c.x - ox, dy = c.y - 0.12 - oy, dz = c.z - oz; // torso centre
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (dist < bestD) { bestD = dist; best = { dx, dy, dz, dist }; }
  }
  if (!best) return;
  const flat = Math.hypot(best.dx, best.dz);
  const drop = best.dist * 0.012; // bullet drop compensation
  player.yaw = Math.atan2(-best.dx, -best.dz);
  player.pitch = Math.atan2(best.dy + drop, flat);
}

// ---- mobile balanced aim assist + auto shoot (switched on by the touch UI only) ----
const assist = { aim: false, auto: false, lockT: 0, tgt: null };
function assistUpdate(dt) {
  if (!(assist.aim || assist.auto) || player.dead || state !== 'play' || !locked) { assist.tgt = null; return; }
  const w = curW();
  if (w.melee) { assist.tgt = null; return; }
  const pb = player.body.position;
  const ox = pb.x, oy = pb.y + 1.2, oz = pb.z;
  const look = lookDir();
  const scoped = player.ads && w.ads === 22;
  const cone = Math.cos((firing || player.ads ? 11 : 7) * Math.PI / 180);
  let best = null, bestScore = -1;
  for (const e of enemies) {
    if (e.dead || e.info.hidden || e.invuln > 0 && !e.remote) continue;
    const c = chestOf(e.info);
    if (!c) continue;
    const dx = c.x - ox, dy = c.y - 0.12 - oy, dz = c.z - oz; // torso centre
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 45 || dist < 0.5) continue;
    const dot = (dx * look.x + dy * look.y + dz * look.z) / dist;
    if (dot < cone || dot <= bestScore) continue;
    const blocked = rayCast(new CANNON.Vec3(ox, oy, oz), new CANNON.Vec3(c.x, c.y, c.z), GRP.STATIC | GRP.PROP);
    if (blocked && blocked.dist < dist - 0.6) continue;
    bestScore = dot; best = { dx, dy, dz, dist, dot };
  }
  if (!best) { assist.tgt = null; assist.lockT = 0; return; }
  assist.tgt = best;
  assist.lockT += dt;
  if (assist.aim) {
    // pull the view toward the target: gentle normally, firmer while shooting / aiming down sights
    const flat = Math.hypot(best.dx, best.dz);
    const ty = Math.atan2(-best.dx, -best.dz);
    const tp = Math.atan2(best.dy + best.dist * 0.012, flat);
    let dyaw = ty - player.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const rate = (firing || player.ads ? 7 : 2.8) * (1 - best.dot > 0.004 ? 1 : 0.4);
    const k = Math.min(1, rate * dt) * 0.55;
    player.yaw += dyaw * k;
    player.pitch += (tp - player.pitch) * k;
  }
  if (assist.auto && assist.lockT > 0.22 && best.dot > Math.cos(2.6 * Math.PI / 180) && !scoped && player.reloadT <= 0 && player.swapT <= 0) {
    if (!w.auto) player.semiLock = false;
    fire();
  }
}

function fire() {
  if (player.dead || player.swapT > 0 || player.fireCd > 0) return;
  const w = curW();
  if (w.melee) { meleeSwing(w); return; }
  if (player.reloadT > 0) return;
  if (!w.auto && player.semiLock) return;
  if (player.ammo <= 0) { reload(); return; }
  player.ammo--;
  if (admin.ammo) player.ammo = player.mag;
  player.semiLock = true;
  if (admin.aim) aimbot();
  player.fireCd = w.rof * (abActive('overdrive') ? 0.5 : 1);
  const pb = player.body.position;
  const camPos = new CANNON.Vec3(pb.x, pb.y + 1.2, pb.z);
  const base = lookDir();
  const right = new THREE.Vector3().crossVectors(base, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, base).normalize();
  const spd = Math.hypot(player.body.velocity.x, player.body.velocity.z);
  let spread = w.spread + player.heat * 0.02 * (w.auto ? 1 : 0.3) + spd * 0.0012 * (w.ads === 22 ? 3 : 1);
  if (player.ads) spread *= w.ads === 22 ? 0.05 : 0.4;
  for (let i = 0; i < w.pellets; i++) {
    const d = base.clone();
    const ang = Math.random() * Math.PI * 2;
    const r = (w.pellets > 1 ? Math.sqrt(Math.random()) : Math.random()) * spread;
    d.addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r).normalize();
    spawnBullet(camPos, new CANNON.Vec3(d.x * w.speed, d.y * w.speed, d.z * w.speed), playerInfo, w.dmg * (abActive('overcharge') ? 2 : 1));
  }
  const kick = (w.kick + Math.random() * w.kick * 0.5) * (player.ads ? 0.7 : 1);
  player.pitch += kick;
  player.recoilDebt += kick;
  player.yaw += rand(-0.002, 0.002);
  player.heat = Math.min(1, player.heat + (w.auto ? 0.1 : 0.25));
  player.kickBack = 1;
  player.shots = (player.shots || 0) + 1;
  player.flash = 0.05;
  sfx.shot();
}

function finishReload() {
  const need = player.mag - player.ammo;
  const take = Math.min(need, player.reserve);
  player.ammo += take;
  player.reserve -= take;
}

function tryStartSlide() {
  if (state !== 'play' || player.dead || player.sliding || player.slideCd > 0 || !player.onGround) return;
  const v = player.body.velocity;
  const hs = Math.hypot(v.x, v.z);
  if (hs < 4.5) return; // need some speed to slide
  player.sliding = true;
  player.slideT = SLIDE_TIME;
  player.slideDirX = v.x / hs;
  player.slideDirZ = v.z / hs;
  player.slideSpeed = Math.min(15, Math.max(9, hs * 1.3 + 2));
  player.sprinting = false;
  sfx.slide();
}
function endSlide() {
  player.sliding = false;
  player.slideCd = 0.45;
}

function updatePlayer(dt) {
  const b = player.body;
  const v = b.velocity;
  player.invuln = Math.max(0, player.invuln - dt);
  player.dmgT = Math.max(0, player.dmgT - dt);
  player.vignette = Math.max(0, player.vignette - dt * 1.2);
  player.shake = Math.max(0, player.shake - dt * 2.2);

  if (player.dead) {
    player.deadT -= dt;
    v.set(0, 0, 0);
    if (player.deadT <= 0) respawnPlayer();
    return;
  }

  // ground check
  const down = rayCast(b.position, new CANNON.Vec3(b.position.x, b.position.y - 0.75, b.position.z), GRP.STATIC | GRP.PROP | GRP.ENEMY);
  player.onGround = !!down;

  const fwd = (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  const side = (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  let wx = -sy * fwd + cy * side;
  let wz = -cy * fwd - sy * side;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  player.slideCd -= dt;
  const hs0 = Math.hypot(v.x, v.z);

  if (player.sliding) {
    player.slideT -= dt;
    const k = Math.max(0, player.slideT / SLIDE_TIME);
    const sp = 2.5 + (player.slideSpeed - 2.5) * Math.pow(k, 1.5); // slide friction: fast at first, then eases to a stop
    if (wl > 0) { // gentle steering
      const dx = player.slideDirX + wx * 1.8 * dt, dz = player.slideDirZ + wz * 1.8 * dt;
      const dl = Math.hypot(dx, dz) || 1;
      player.slideDirX = dx / dl; player.slideDirZ = dz / dl;
    }
    v.x = player.slideDirX * sp;
    v.z = player.slideDirZ * sp;
    player.slideDust -= dt;
    if (player.slideDust <= 0) {
      player.slideDust = 0.06;
      spawnSparks({ x: b.position.x, y: b.position.y - 0.45, z: b.position.z }, 2, { x: 0, y: 1, z: 0 }, 2.2, 0xcfc7b8, 0.35);
    }
    if (keys['Space'] && player.onGround) {
      // slide jump: a bounded leap that carries momentum, then fades in the air
      const boost = Math.min(12.5, sp + 2.5);
      v.y = 7.0;
      v.x = player.slideDirX * boost;
      v.z = player.slideDirZ * boost;
      endSlide();
    } else if (player.slideT <= 0 || sp < 3.4 || !player.onGround || fwd < 0 || (!player.slideHeld && player.slideT < SLIDE_TIME - 0.35)) {
      endSlide(); // the slide also ends when you slow down, release the key, or pull back (S)
    }
  } else {
    const wantSprint = (keys['ShiftLeft'] || keys['ShiftRight']) && fwd > 0 && !player.ads;
    player.sprinting = wantSprint && wl > 0;
    const speed = (player.ads ? 4.2 : wantSprint ? 11 : 7.5) * (admin.speed ? 2 : 1) * (abActive('adrenaline') ? 1.4 : 1);
    if (player.onGround) {
      const braking = wl === 0;
      let ax = wx * speed - v.x, az = wz * speed - v.z;
      const al = Math.hypot(ax, az);
      const maxStep = (braking ? 170 : 110) * dt;
      if (al > maxStep) { ax = (ax / al) * maxStep; az = (az / al) * maxStep; }
      v.x += ax;
      v.z += az;
      if (braking && Math.hypot(v.x, v.z) < 0.5) { v.x = 0; v.z = 0; } // hard stop, no creeping
      if (keys['Space'] && v.y < 2) v.y = admin.jump ? 12 : 6.6;
    } else {
      // in the air: steer toward where you press, and bleed momentum so you can never drift forever
      if (wl > 0) {
        const cur = v.x * wx + v.z * wz;
        const add = Math.min(speed - cur, 30 * dt);
        if (add > 0) { v.x += wx * add; v.z += wz * add; }
      }
      const drag = Math.exp(-(wl > 0 ? 1.0 : 3.2) * dt);
      v.x *= drag;
      v.z *= drag;
    }
  }

  // landing impact dips the camera
  if (player.onGround && !player.wasGround && player.lastVy < -3.5) player.landDip = Math.min(0.28, -player.lastVy * 0.028);
  player.wasGround = player.onGround;
  player.lastVy = v.y;
  if (b.position.y < -15) { b.position.set(0, 1, 0); v.set(0, 0, 0); }

  // timers
  player.fireCd -= dt;
  player.throwCd -= dt;
  player.flash -= dt;
  player.heat = Math.max(0, player.heat - dt * 1.4);
  player.kickBack = Math.max(0, player.kickBack - dt * 12);
  if (player.reloadT > 0) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) finishReload();
  }
  // recoil recovery
  const rec = Math.min(player.recoilDebt, player.recoilDebt * dt * 5);
  player.pitch -= rec * 0.6;
  player.recoilDebt -= rec;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));

  if (firing && locked) fire();

  // view bob phase and footsteps
  const hs = Math.hypot(v.x, v.z);
  const bobTarget = player.onGround && !player.sliding ? Math.min(1, hs / 6) : 0;
  player.bobAmp += (bobTarget - player.bobAmp) * Math.min(1, 10 * dt);
  player.bob += dt * hs * 1.25; // phase advances with distance walked
  player.landDip *= Math.max(0, 1 - 7 * dt);
  const stepIdx = Math.floor(player.bob / Math.PI);
  if (stepIdx !== player.lastStep) {
    player.lastStep = stepIdx;
    if (player.onGround && !player.sliding && player.bobAmp > 0.35) sfx.step();
  }

  // slow health regeneration when you haven't been hit for a while
  if (gameTime - player.lastHurt > 6 && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 6 * dt);
}

/* ------------------------------ match flow ------------------------------ */
function startMatch() {
  ROUND_TIME = net.client && net.pending ? net.pending.time : prefs.time;
  buildMap(MAPS[selectedMap]);
  menuEl.dataset.mode = 'pause'; menuEl.dataset.screen = 'home';
  resetInventory();
  hud.wave.textContent = 'FREE FOR ALL - ' + MAPS[selectedMap].name + (prefs.limit && !net.on ? ' - FIRST TO ' + prefs.limit : '');
  careerStart();
  state = 'play';
  roundT = net.client && net.pending && net.pending.started ? net.pending.roundT : ROUND_TIME;
  gameTime = 0;
  lastTickSec = -1;
  const pool = SPAWNS.slice().sort(() => Math.random() - 0.5);
  placePlayer(pool[0]);
  player.invuln = 3;
  const mp = net.on && net.remotes.size > 0;
  for (let i = 1; i < roster.length; i++) roster[i].hidden = mp ? !roster[i].remote : false;
  if (mp) {
    for (const r of net.remotes.values()) ensureBot(r);
  } else {
    net.on = false;
    for (let i = 1; i < roster.length; i++) {
      const s = pool[i % pool.length];
      const bot = new Bot(roster[i], s.x, s.z);
      bot.invuln = 3;
      enemies.push(bot);
    }
  }
  banner(`${MAPS[selectedMap].name}<br><span style="font-size:20px;letter-spacing:4px">${ROUND_TIME / 60} MIN  -  MOST KILLS WINS</span>`, 3500);
}

function endMatch() {
  state = 'over';
  firing = false;
  document.exitPointerLock();
  const sorted = sortedRoster();
  const win = sorted[0];
  const myRank = sorted.indexOf(playerInfo) + 1;
  if (playerInfo.kills > bestKills) {
    bestKills = playerInfo.kills;
    try { localStorage.setItem('ab_best_kills', String(bestKills)); } catch (e) { /* ignore */ }
  }
  const rows = sorted
    .map(
      (r, i) =>
        `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${avHtml(r)}</td><td>${r.name}</td><td>${r.kills}</td><td>${r.deaths}</td></tr>`
    )
    .join('');
  hud.ovsub.innerHTML =
    `${win.isPlayer ? 'YOU WIN!' : win.name.toUpperCase() + ' WINS'}<br><span style="font-size:18px">You finished #${myRank} with ${playerInfo.kills} kills &nbsp;|&nbsp; Best ever: ${bestKills}</span>`;
  hud.results.innerHTML =
    `<table class="res emoji"><tr><th>#</th><th></th><th>PLAYER</th><th>KILLS</th><th>DEATHS</th></tr>${rows}</table>` + careerEnd(win.isPlayer, myRank);
  menuEl.dataset.mode = 'over'; menuEl.dataset.screen = 'home';
  hud.overlay.classList.remove('hidden');
}

function updateMatch(dt) {
  roundT -= dt;
  const sec = Math.ceil(roundT);
  if (sec !== lastTickSec) {
    lastTickSec = sec;
    if (sec <= 10 && sec > 0) sfx.tick();
    if (sec === 30) banner('30 SECONDS LEFT', 1500);
  }
  updateRespawns(dt);
  updatePickups(dt);
  if (roundT <= 0) endMatch();
}

function clearInput() {
  for (const k in keys) keys[k] = false;
  firing = false;
  player.ads = false;
  player.slideHeld = false;
}
// a key released while the window wasn't focused would otherwise stay "held" forever
window.addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

document.addEventListener('pointerlockchange', () => {
  if (chat.open && document.pointerLockElement !== renderer.domElement) return;
  locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    hud.overlay.classList.add('hidden');
    if (state === 'menu') startMatch();
  } else if (state === 'play') {
    hud.ovsub.textContent = 'PAUSED - loadout changes apply when you respawn';
    hud.ovcta.innerHTML = 'RESUME<small id="playsub"></small>';
    hud.results.innerHTML = '';
    setMode('pause');
    hud.overlay.classList.remove('hidden');
    $('roombox').style.display = net.client ? 'none' : 'block';
    clearInput();
  }
});
hud.overlay.addEventListener('click', (e) => {
  if (!(e.target && e.target.closest && e.target.closest('[data-start]'))) return; // only the PLAY / RESUME button starts the match
  ac();
  if (state === 'over') { location.reload(); return; }
  const p = renderer.domElement.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
});
/* ---- touch / Android bridge (used by mobile.js; harmless on desktop) ---- */
function showPause() {
  hud.ovsub.textContent = 'PAUSED - loadout changes apply when you respawn';
  hud.ovcta.innerHTML = 'RESUME<small id="playsub"></small>';
  hud.results.innerHTML = '';
  setMode('pause');
  hud.overlay.classList.remove('hidden');
  $('roombox').style.display = net.client ? 'none' : 'block';
  clearInput();
}
window.AB = {
  admin,
  get playing() { return state === 'play' && locked; },
  start() {
    ac();
    if (state === 'over') { location.reload(); return; }
    locked = true;
    hud.overlay.classList.add('hidden');
    if (state === 'menu') startMatch();
  },
  pause() { if (state === 'play' && locked) { locked = false; showPause(); } },
  assist,
  get slot() { return inv.cur; },
  get micOn() { return vc.on && !vc.denied; },
  mic() { vcToggle(); },
  chat() { if (chat.open) closeChat(false); else openChat(); },
  look(dx, dy) {
    if (!locked || player.dead || chat.open) return;
    const sens = 0.0034 * prefs.sens * (player.ads ? (curW().ads === 22 ? 0.3 : 0.65) : 1);
    player.yaw -= dx * sens;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sens));
  },
  key(code, down) { if (locked) keys[code] = down; },
  fire(down) { if (!locked) return; firing = down; if (!down) player.semiLock = false; },
  ads(down) { if (!locked) return; player.ads = down && !curW().melee && player.reloadT <= 0; },
  slide(down) { if (!locked) return; player.slideHeld = down; if (down) tryStartSlide(); },
  reload() { if (locked) reload(); },
  grenade() { if (locked) throwGrenade(); },
  ability() { if (locked) useAbility(); },
  equip(i) { if (locked) equip(i); },
  toggleLock() { if (admin.auth) { admin.lock = !admin.lock; toast(admin.lock ? 'AIM LOCK ON' : 'AIM LOCK OFF'); } },
};
document.addEventListener('mousemove', (e) => {
  if (!locked || player.dead || chat.open) return;
  const sens = 0.0022 * prefs.sens * (player.ads ? (curW().ads === 22 ? 0.3 : 0.65) : 1);
  player.yaw -= e.movementX * sens;
  player.pitch -= e.movementY * sens;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
});
document.addEventListener('mousedown', (e) => {
  if (!locked || chat.open) return;
  if (e.button === 0) firing = true;
  if (e.button === 2 && !curW().melee && player.reloadT <= 0) player.ads = true;
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) { firing = false; player.semiLock = false; }
  if (e.button === 2) player.ads = false;
});
const adminEl = $('admin');
const ADMIN_TOGGLES = [['god', 'God mode (no damage)'], ['ammo', 'Infinite ammo'], ['aim', 'Aimbot (snaps to nearest enemy on shot)'], ['lock', 'AIM LOCK on nearest person (hotkey B)'], ['kill', 'One-hit kills'], ['speed', 'Super speed'], ['jump', 'Super jump'], ['freeze', 'Freeze bots'], ['wall', 'Shoot through walls']];
function renderAdmin() {
  if (!admin.auth) {
    adminEl.innerHTML = '<h3>ADMIN PANEL</h3><input id="acode" type="password" placeholder="Enter code" autocomplete="off"><button id="ago">UNLOCK</button><div id="amsg"></div><small>F4 to close</small>';
    const go = () => {
      if ($('acode').value === ADMIN_CODE) { admin.auth = true; renderAdmin(); toast('ADMIN CANNON UNLOCKED - PRESS 4'); }
      else $('amsg').textContent = 'Wrong code';
    };
    $('ago').onclick = go;
    $('acode').onkeydown = (e) => { if (e.key === 'Enter') go(); };
    setTimeout(() => $('acode').focus(), 30);
    return;
  }
  adminEl.innerHTML = '<h3>ADMIN PANEL</h3>' +
    ADMIN_TOGGLES.map(([k, n]) => `<label><input type="checkbox" data-k="${k}"${admin[k] ? ' checked' : ''}> ${n}</label>`).join('') +
    '<div class="abtns"><button data-a="snap">Aim at nearest now</button><button data-a="heal">Full heal</button><button data-a="ammo">Refill ammo</button><button data-a="kills">+10 kills</button></div><small>F4 to close</small>';
}
adminEl.addEventListener('click', (e) => {
  e.stopPropagation();
  const t = e.target;
  if (t.dataset && t.dataset.a === 'snap') aimbot();
  if (t.dataset && t.dataset.a === 'heal') player.hp = player.maxHp;
  if (t.dataset && t.dataset.a === 'ammo') { for (const id in inv.store) inv.store[id] = { ammo: WEAPONS[id].mag, reserve: WEAPONS[id].res * 2 }; loadCur(); player.grenades = 5; }
  if (t.dataset && t.dataset.a === 'kills') playerInfo.kills += 10;
  if (t.dataset && t.dataset.k) admin[t.dataset.k] = t.checked;
});
adminEl.addEventListener('keydown', (e) => e.stopPropagation());
function toggleAdmin() {
  admin.open = !admin.open;
  adminEl.style.display = admin.open ? 'block' : 'none';
  if (admin.open) { if (document.exitPointerLock) document.exitPointerLock(); renderAdmin(); }
}
document.addEventListener('keydown', (e) => {
  if (e.code === 'F4') { e.preventDefault(); toggleAdmin(); }
  if (e.code === 'KeyB' && admin.auth && locked && !e.repeat) {
    admin.lock = !admin.lock;
    toast(admin.lock ? 'AIM LOCK ON' : 'AIM LOCK OFF');
  }
});
$('adminbtn').addEventListener('click', (e) => { e.stopPropagation(); toggleAdmin(); });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('keydown', (e) => {
  if (chat.open) return;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (!locked) return;
  if (e.code === 'KeyC') {
    e.preventDefault();
    player.slideHeld = true;
    if (!e.repeat) tryStartSlide();
  }
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyE') useAbility();
  if (e.code === 'Digit1') equip(0);
  if (e.code === 'Digit2') equip(1);
  if (e.code === 'Digit3') equip(2);
  if (e.code === 'Digit4') equip(3);
  if (e.code === 'KeyQ') equip(inv.last);
});
document.addEventListener('wheel', (e) => {
  if (!locked || state !== 'play') return;
  equip((inv.cur + (e.deltaY > 0 ? 1 : 2)) % 3);
}, { passive: true });
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyC') player.slideHeld = false;
});

/* ------------------------------ view model ------------------------------ */
const gun = new THREE.Group();
camera.add(gun);
{
  const mk = (w, h, d, x, y, z, c = 0x222428) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.6 }));
    m.position.set(x, y, z);
    gun.add(m);
    return m;
  };
  mk(0.07, 0.11, 0.5, 0, 0, 0);
  mk(0.035, 0.035, 0.32, 0, 0.015, -0.4, 0x15161a);
  mk(0.05, 0.15, 0.07, 0, -0.12, 0.06, 0x2d2f33);
  mk(0.06, 0.1, 0.22, 0, -0.01, 0.34, 0x33363b);
  mk(0.02, 0.04, 0.04, 0, 0.075, -0.1, 0x111111);
}
const flashMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(0.28, 0.28),
  new THREE.MeshBasicMaterial({ color: 0xffc060, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
);
flashMesh.position.set(0, 0.015, -0.62);
flashMesh.visible = false;
gun.add(flashMesh);
const GUN_HIP = new THREE.Vector3(0.24, -0.22, -0.5);
const CONE_Y = 0.11;
let neonCone = null;
/* ---- detailed first-person gun models (built from many small parts, no external files) ---- */
const GMATS = {};
const GTEX = {};
function gtex(kind) {
  if (GTEX[kind]) return GTEX[kind];
  return (GTEX[kind] = canvasTex(128, (g, sz) => {
    g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, sz, sz);
    if (kind === 'metal') { // brushed steel streaks + tiny pits
      for (let i = 0; i < 260; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)'; g.fillRect(Math.random() * sz, Math.random() * sz, rand(10, 60), 1); }
      for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(Math.random() * sz, Math.random() * sz, 1, 1); }
    } else if (kind === 'wood') { // grain
      for (let y = 0; y < sz; y += 2) { g.fillStyle = `rgba(${40 + (Math.random() * 40) | 0},20,5,${rand(0.05, 0.22).toFixed(2)})`; g.fillRect(0, y + Math.sin(y * 0.3) * 2, sz, 1.5); }
    } else { // polymer stipple + diamond grip texture
      for (let i = 0; i < 900; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.07)'; g.fillRect(Math.random() * sz, Math.random() * sz, 1.5, 1.5); }
      g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
      for (let i = -sz; i < sz * 2; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + sz, sz); g.stroke(); g.beginPath(); g.moveTo(i, sz); g.lineTo(i + sz, 0); g.stroke(); }
    }
  }, 1, 1));
}
let SKIN = null, SKIN_FROM = -1;
function skinMat(slot, kind) {
  const key = 'skin' + SKIN.id + slot + kind;
  if (GMATS[key]) return GMATS[key];
  const o = { color: SKIN[slot], roughness: SKIN.rough, metalness: kind === 'poly' ? Math.min(SKIN.metal, 0.4) : SKIN.metal, map: skinTex(SKIN.tex) };
  if (SKIN.emissiveMap) { o.emissive = SKIN.glow; o.emissiveMap = skinTex(SKIN.tex); o.emissiveIntensity = 1.3; }
  return (GMATS[key] = new THREE.MeshStandardMaterial(o));
}
function gmat(color, kind) {
  if (SKIN && SKIN.id !== 'default' && kind !== 'glow') {
    if (color === SKIN_FROM) return skinMat('body', kind);
    if (color === G_MID) return skinMat('mid', kind);
  }
  const key = kind + color;
  if (GMATS[key]) return GMATS[key];
  const opt = kind === 'metal' ? { color, roughness: 0.32, metalness: 0.9, map: gtex('metal'), envMapIntensity: 1.2 }
    : kind === 'wood' ? { color, roughness: 0.75, metalness: 0.05, map: gtex('wood') }
    : kind === 'glow' ? { color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.2 }
    : { color, roughness: 0.6, metalness: 0.25, map: gtex('poly') };
  return (GMATS[key] = new THREE.MeshStandardMaterial(opt));
}
// rounded body: a box with its four long edges filled by cylinders
function gbody(w, h, d, x, y, z, color, kind = 'metal') {
  const r = Math.min(w, h) * 0.16;
  const a = gbox(w - 2 * r, h, d, x, y, z, color, kind);
  gbox(w, h - 2 * r, d, x, y, z, color, kind);
  const geo = new THREE.CylinderGeometry(r, r, d, 8);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const cy = new THREE.Mesh(geo, gmat(color, kind));
    cy.rotation.x = Math.PI / 2; cy.position.set(x + sx * (w / 2 - r), y + sy * (h / 2 - r), z);
    (gParent || gun).add(cy);
  }
  return a;
}
function gScrew(x, y, z, side) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.004, 8), gmat(G_STEEL, 'metal')); m.rotation.z = Math.PI / 2; m.position.set(x + side * 0.0, y, z); (gParent || gun).add(m); }
const GNAME = {};
function gPlate(id, x, y, z, wd, ht, accent) {
  const w = WEAPONS[id];
  const tex = GNAME[id] || (GNAME[id] = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(8,9,12,0.92)'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = hexCss(accent || 0xffb347); g.fillRect(0, 0, 10, 64); g.fillRect(0, 58, 256, 6);
    g.fillStyle = '#e8eaef'; g.font = 'bold 30px "Segoe UI",Arial,sans-serif'; g.textBaseline = 'middle';
    g.fillText(String(w.name).toUpperCase().slice(0, 14), 22, 28);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = '14px monospace'; g.fillText('MK-' + (Object.keys(WEAPONS).indexOf(id) + 11) + '  //  AB', 22, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })());
  const p = new THREE.Mesh(new THREE.PlaneGeometry(wd, ht), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.3 }));
  p.rotation.y = -Math.PI / 2; p.position.set(x, y, z);
  (gParent || gun).add(p);
}
// gloved hand: palm, wrapped fingers, thumb, cuff and sleeve running back toward the camera
function gHand(x, y, z, side, mode, accent, parent) {
  const old = gParent; if (parent) gParent = parent;
  const gl = G_GRIP, sl = 0x24272d;
  if (mode === 'grip') { // right hand around a pistol grip
    gbox(0.03, 0.07, 0.06, x + side * 0.032, y, z, gl, 'poly');
    for (let i = 0; i < 4; i++) { gbox(0.036, 0.017, 0.044, x - side * 0.022, y + 0.03 - i * 0.02, z - 0.004, gl, 'poly'); gbox(0.006, 0.012, 0.03, x - side * 0.04, y + 0.03 - i * 0.02, z - 0.012, G_MID, 'poly'); }
    gbox(0.02, 0.016, 0.055, x + side * 0.0, y + 0.058, z - 0.014, gl, 'poly', 0.15);
  } else { // left hand cupping the forend from below
    gbox(0.06, 0.03, 0.07, x, y - 0.04, z, gl, 'poly');
    for (let i = 0; i < 4; i++) { gbox(0.016, 0.05, 0.016, x + 0.035, y - 0.018, z - 0.03 + i * 0.02, gl, 'poly'); gbox(0.012, 0.01, 0.012, x + 0.037, y + 0.004, z - 0.03 + i * 0.02, G_MID, 'poly'); }
    gbox(0.02, 0.016, 0.06, x - 0.028, y - 0.004, z - 0.02, gl, 'poly', 0, -0.2);
  }
  const wy = mode === 'grip' ? y - 0.045 : y - 0.065;
  gbox(0.075, 0.075, 0.03, x + side * 0.03, wy, z + 0.06, accent || 0x3a3d44, 'poly', 0.35); // cuff
  gbox(0.085, 0.085, 0.42, x + side * 0.05, wy - 0.07, z + 0.27, sl, 'poly', 0.4); // sleeve
  gbox(0.09, 0.02, 0.3, x + side * 0.05, wy - 0.02, z + 0.3, accent || 0x3a3d44, 'glow', 0.4);
  gParent = old;
}
const HANDS = {
  rifle: { r: [0, -0.15, 0.23], l: [0, -0.03, -0.21] }, bullpup: { r: [0, -0.13, -0.02], l: [0, -0.03, -0.24] },
  smg: { r: [0, -0.13, 0.16], l: [0, -0.04, -0.17] }, lmg: { r: [0, -0.14, 0.3], l: [0, -0.05, -0.22] },
  minigun: { r: [0, -0.15, 0.2], l: [-0.1, -0.05, 0.02] }, dmr: { r: [0, -0.14, 0.2], l: [0, -0.04, -0.22] },
  sniper: { r: [0, -0.14, 0.2], l: [0, -0.04, -0.24] }, shotgun: { r: [0, -0.12, 0.17], l: 'pump', lp: [0, 0.0, -0.22] },
  dbl: { r: [0, -0.08, 0.11], l: [0, -0.03, -0.2] }, sawed: { r: [0, -0.09, 0.14], l: [0, -0.02, -0.08] },
  plasma: { r: [0, -0.14, 0.2], l: [0, -0.04, -0.17] }, revolver: { r: [0, -0.11, 0.12] }, pistol: { r: [0, -0.1, 0.1] },
  cannon: { r: [0, -0.1, 0.1] }, machpist: { r: [0, -0.1, 0.1] },
};
const GPLATE = { rifle: [0.037, 0.022, 0.1], bullpup: [0.039, 0.0, 0.1], smg: [0.037, 0.012, 0.07], lmg: [0.047, 0.02, 0.1], minigun: [0.077, -0.02, 0.1], dmr: [0.033, 0.02, 0.12], sniper: [0.033, 0.02, 0.1], shotgun: [0.037, 0.0, 0.1], plasma: [0.047, 0.0, 0.08], revolver: [0.024, 0.0, 0.03], pistol: [0.024, 0.016, 0.02], cannon: [0.029, 0.016, 0.04], machpist: [0.024, 0.016, 0.02] };
function gunExtras(id, m, accent) {
  const h = [...id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const long = ['rifle', 'bullpup', 'smg', 'lmg', 'dmr', 'sniper', 'plasma'].includes(m);
  if (long && h % 3 === 0 && m !== 'sniper') { gbox(0.026, 0.1, 0.034, 0, -0.085, -0.19, G_GRIP, 'poly', 0.1); gbox(0.03, 0.012, 0.04, 0, -0.037, -0.19, G_DARK); } // vertical foregrip
  if (long && h % 4 === 1) { gbox(0.022, 0.022, 0.06, 0.042, -0.004, -0.2, G_DARK); gbox(0.008, 0.008, 0.004, 0.042, -0.004, -0.232, 0xff2222, 'glow'); } // laser module
  if (long && h % 5 === 2) { gcyl(0.014, 0.07, -0.042, -0.004, -0.2, G_DARK); gcyl(0.012, 0.004, -0.042, -0.004, -0.238, 0xfff2c0, 'glow'); } // flashlight
  const pl = GPLATE[m] || GPLATE.rifle;
  gPlate(id, -pl[0], pl[1], pl[2], m === 'pistol' || m === 'revolver' ? 0.07 : 0.13, m === 'pistol' || m === 'revolver' ? 0.02 : 0.03, accent);
  for (const [dz, dy] of [[0.0, 0.034], [0.18, 0.034], [0.0, -0.034], [0.18, -0.034]]) if (long) { const a = gParent; gParent = null; gScrew(-pl[0], pl[1] + dy * 0.6, pl[2] + dz - 0.06, 0); gParent = a; }
  const H = HANDS[m] || HANDS.pistol;
  gHand(H.r[0], H.r[1], H.r[2], 1, 'grip', accent);
  if (H.l === 'pump' && VM.pump) gHand(H.lp[0], H.lp[1], H.lp[2], -1, 'under', accent, VM.pump);
  else if (H.l) { const lg = new THREE.Group(); gun.add(lg); VM.lh = lg; gHand(H.l[0], H.l[1], H.l[2], -1, 'under', accent, lg); }
}
let gParent = null;
const VM = { mag: null, slide: null, handle: null, pump: null, lh: null, handleZ: 0 };
function gbox(w, h, d, x, y, z, color, kind = 'metal', rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), gmat(color, kind));
  m.position.set(x, y, z);
  m.rotation.x = rx; m.rotation.z = rz;
  (gParent || gun).add(m);
  return m;
}
// barrel-style cylinder lying along Z: rFront is the muzzle-side radius, rBack the rear radius
function gcyl(rFront, len, x, y, z, color, kind = 'metal', rBack = rFront) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rBack, rFront, len, 14), gmat(color, kind));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  (gParent || gun).add(m);
  return m;
}
const GPAL0 = { dark: 0x16171b, mid: 0x2a2c32, light: 0x4a4d55, steel: 0x9aa0aa, wood: 0x6b4426, grip: 0x1f2024 };
let G_DARK = GPAL0.dark, G_MID = GPAL0.mid, G_LIGHT = GPAL0.light, G_STEEL = GPAL0.steel, G_WOOD = GPAL0.wood, G_GRIP = GPAL0.grip;
function gSetPal(p) { const o = Object.assign({}, GPAL0, p || {}); G_DARK = o.dark; G_MID = o.mid; G_LIGHT = o.light; G_STEEL = o.steel; G_WOOD = o.wood; G_GRIP = o.grip; }
function gcone(r, h, x, y, z, color, kind = 'metal', rx = 0, rz = 0) { const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), gmat(color, kind)); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); (gParent || gun).add(m); return m; }
function gtorus(R, t, x, y, z, color, kind = 'metal', arc = Math.PI * 2) { const m = new THREE.Mesh(new THREE.TorusGeometry(R, t, 6, 20, arc), gmat(color, kind)); m.position.set(x, y, z); (gParent || gun).add(m); return m; }
function gsph(r, x, y, z, color, kind = 'metal') { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), gmat(color, kind)); m.position.set(x, y, z); (gParent || gun).add(m); return m; }
function gdisc(r, th, x, y, z, color, kind = 'metal') { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, th, 14), gmat(color, kind)); m.rotation.z = Math.PI / 2; m.position.set(x, y, z); (gParent || gun).add(m); return m; }
function gcrescent(x, y, z, R, color) { const m = new THREE.Mesh(new THREE.TorusGeometry(R, 0.004, 6, 24, Math.PI * 1.4), gmat(color, 'glow')); m.rotation.y = -Math.PI / 2; m.rotation.z = 0.9; m.position.set(x, y, z); (gParent || gun).add(m); return m; }
function gRail(x, y, z0, len) { // picatinny rail with teeth
  gbox(0.022, 0.008, len, x, y, z0 - len / 2 + 0.0, G_DARK, 'metal');
  for (let i = 0; i < Math.floor(len / 0.018); i++) gbox(0.026, 0.006, 0.008, x, y + 0.006, z0 - 0.01 - i * 0.018, G_MID, 'metal');
}
function gOptic(kind, y, z, g) {
  if (kind === 'reddot') {
    gbox(0.04, 0.012, 0.075, 0, y, z, G_DARK);
    gbox(0.004, 0.036, 0.07, 0.019, y + 0.024, z, G_DARK); gbox(0.004, 0.036, 0.07, -0.019, y + 0.024, z, G_DARK);
    gbox(0.04, 0.008, 0.07, 0, y + 0.046, z, G_DARK);
    gbox(0.034, 0.03, 0.003, 0, y + 0.026, z - 0.034, 0x335566, 'glow');
    gbox(0.006, 0.006, 0.004, 0, y + 0.026, z + 0.034, 0xff2222, 'glow');
  } else if (kind === 'scope') {
    gbox(0.03, 0.024, 0.02, 0, y, z + 0.06, G_DARK); gbox(0.03, 0.024, 0.02, 0, y, z - 0.06, G_DARK);
    gcyl(0.022, 0.26, 0, y + 0.032, z, G_DARK, 'metal', 0.016);
    gcyl(0.028, 0.06, 0, y + 0.032, z - 0.15, G_MID, 'metal');
    gcyl(0.024, 0.004, 0, y + 0.032, z - 0.182, 0x2266aa, 'glow');
    gcyl(0.018, 0.05, 0, y + 0.032, z + 0.15, G_MID, 'metal');
    gbox(0.012, 0.012, 0.03, 0.03, y + 0.032, z, G_MID);
  } else { // iron sights
    gbox(0.008, 0.03, 0.01, 0, y + 0.012, z - 0.12, G_DARK); gbox(0.03, 0.02, 0.008, 0, y + 0.01, z + 0.1, G_DARK);
    gbox(0.004, 0.012, 0.004, 0, y + 0.034, z - 0.12, g || 0xffffff, g ? 'glow' : 'metal');
  }
}
function gMuzzle(z, r, c, style) {
  if (style === 'supp') { gcyl(r * 1.9, 0.2, 0, 0.015, z - 0.08, G_DARK, 'metal'); for (let i = 0; i < 4; i++) gcyl(r * 2.0, 0.008, 0, 0.015, z - 0.02 - i * 0.045, G_MID, 'metal'); }
  else { gcyl(r * 1.7, 0.05, 0, 0.015, z - 0.02, G_DARK, 'metal'); for (let i = 0; i < 3; i++) gbox(r * 3.6, r * 0.8, 0.006, 0, 0.015, z - 0.005 - i * 0.012, G_LIGHT, 'metal'); }
}
function gMag(x, y, z, w, h, d, rx, color, glow) {
  const grp = new THREE.Group(); gun.add(grp); VM.mag = grp; gParent = grp;
  gbox(w, h, d, x, y, z, color, 'poly', rx);
  gbox(w + 0.004, 0.012, d + 0.004, x, y - h / 2 * Math.cos(rx) - 0.004, z + (h / 2) * Math.sin(-rx) * -1, G_DARK, 'metal', rx);
  if (glow) gbox(w + 0.002, 0.006, d * 0.5, x, y + h * 0.15, z, glow, 'glow', rx);
  gParent = null;
}
function gGrip(x, y, z, rx, color) {
  gbox(0.036, 0.1, 0.042, x, y, z, color || G_GRIP, 'poly', rx);
  for (let i = 0; i < 4; i++) gbox(0.038, 0.006, 0.044, x, y + 0.03 - i * 0.02, z + 0.012 * i * Math.sin(rx) * 0, G_DARK, 'poly', rx);
}
function gTriggerGuard(y, z) {
  gbox(0.01, 0.006, 0.07, 0, y, z, G_DARK); gbox(0.01, 0.034, 0.006, 0, y + 0.017, z - 0.032, G_DARK); gbox(0.008, 0.028, 0.006, 0, y + 0.014, z + 0.01, G_STEEL);
}
function gStock(z, style, c) {
  if (style === 'fold') { gbox(0.012, 0.012, 0.18, 0.02, 0.01, z + 0.1, G_MID); gbox(0.012, 0.012, 0.18, -0.02, 0.01, z + 0.1, G_MID); gbox(0.05, 0.08, 0.012, 0, 0.0, z + 0.2, G_DARK, 'poly'); }
  else if (style === 'wood') { gbox(0.05, 0.09, 0.26, 0, -0.01, z + 0.14, G_WOOD, 'wood', 0.08); gbox(0.052, 0.1, 0.02, 0, -0.012, z + 0.28, G_DARK, 'poly', 0.08); }
  else if (style === 'sniper') { gbox(0.052, 0.11, 0.28, 0, -0.005, z + 0.15, c, 'poly'); gbox(0.04, 0.03, 0.12, 0, 0.065, z + 0.2, c, 'poly'); gbox(0.056, 0.12, 0.025, 0, -0.01, z + 0.3, G_DARK, 'poly'); }
  else { gcyl(0.018, 0.17, 0, 0.005, z + 0.1, G_MID, 'metal'); gbox(0.05, 0.075, 0.2, 0, -0.005, z + 0.19, c, 'poly'); gbox(0.054, 0.095, 0.02, 0, -0.005, z + 0.3, G_DARK, 'poly'); }
}
function gStripe(g, len, z) {
  if (!g) return;
  gbox(0.006, 0.008, len, 0.038, 0.02, z, g, 'glow'); gbox(0.006, 0.008, len, -0.038, 0.02, z, g, 'glow');
}

function buildGunModel(id) {
  const w = WEAPONS[id];
  const GS = gskinOf(id);
  gSetPal(GS && GS.pal);
  SKIN = Object.assign({ id: skinOf(id) }, SKINS[skinOf(id)]);
  const c = (GS && GS.col) || w.col || 0x2a2c32, g = SKIN.glow || (GS && GS.glow) || w.glow || 0;
  SKIN_FROM = c;
  const m = w.model || ({ ar: 'rifle', neon: 'rifle', admin: 'rifle', smg: 'smg', shotgun: 'shotgun', sniper: 'sniper', pistol: 'pistol', revolver: 'revolver' })[id] || 'pistol';
  let fz = -0.7, adsY = 0.1, adsZ = -0.4;
  GUN_HIP.set(0.24, -0.22, -0.5);
  const rifleBody = (o) => {
    gbody(0.07, 0.072, 0.34, 0, 0.02, 0.1, c); // upper receiver
    gbox(0.066, 0.058, 0.26, 0, -0.04, 0.12, G_MID, 'poly'); // lower receiver
    gbox(0.012, 0.03, 0.05, 0.036, 0.03, 0.12, G_DARK); // ejection port
    VM.handle = gbox(0.014, 0.014, 0.03, -0.04, 0.045, 0.2, G_STEEL); VM.handleZ = 0.2; // charging handle
    gbody(0.065, 0.065, o.hg, 0, 0.018, -0.07 - o.hg / 2, o.hgColor || c); // handguard
    for (let i = 0; i < Math.floor(o.hg / 0.045); i++) gbox(0.068, 0.012, 0.02, 0, 0.018, -0.1 - i * 0.045, G_DARK); // vents
    gcyl(0.013, o.len, 0, 0.018, -0.07 - o.hg - o.len / 2 + 0.02, G_STEEL);
    gMuzzle(-0.07 - o.hg - o.len + 0.02, 0.013, c, o.muzzle);
    gbox(0.012, 0.045, 0.014, 0, 0.065, -0.07 - o.hg + 0.01, G_DARK); // front sight post
    gRail(0, 0.061, 0.22, 0.34 + o.hg * 0.9);
    gOptic(o.optic, 0.07, 0.06, g);
    gTriggerGuard(-0.072, 0.14); gGrip(0, -0.12, 0.22, 0.3);
    gMag(0, -0.125, 0.07, 0.034, 0.12, 0.05, o.curved ? -0.2 : 0, G_MID, g);
    gStock(0.22, o.stock, c);
    gStripe(g, o.hg * 0.8, -0.07 - o.hg / 2);
    fz = -0.07 - o.hg - o.len - 0.02;
  };
  if (m === 'rifle' || m === 'bullpup') {
    if (id === 'ar') rifleBody({ hg: 0.26, len: 0.2, optic: 'reddot', curved: true, stock: 'tube', muzzle: 'brake' });
    else if (id === 'carbine') rifleBody({ hg: 0.2, len: 0.14, optic: 'iron', curved: true, stock: 'fold', muzzle: 'brake' });
    else if (id === 'neon' || id === 'admin') rifleBody({ hg: 0.26, len: 0.2, optic: id === 'neon' ? 'iron' : 'reddot', curved: true, stock: 'tube', muzzle: id === 'admin' ? 'supp' : 'brake', hgColor: 0x0b0b0d });
    else if (m === 'bullpup') { // short receiver, magazine behind the grip
      gbox(0.075, 0.1, 0.5, 0, 0.0, 0.12, c); gbox(0.07, 0.04, 0.2, 0, 0.065, 0.25, G_MID, 'poly');
      gcyl(0.014, 0.28, 0, 0.02, -0.28, G_STEEL); gbox(0.06, 0.06, 0.16, 0, 0.0, -0.13, G_MID, 'poly');
      gMuzzle(-0.42, 0.014, c, 'brake'); gRail(0, 0.052, 0.1, 0.3); gOptic('reddot', 0.06, 0.05, g);
      gGrip(0, -0.1, -0.02, 0.2); gTriggerGuard(-0.058, 0.0); gMag(0, -0.1, 0.16, 0.036, 0.12, 0.05, 0.1, G_MID, g);
      gbox(0.06, 0.1, 0.03, 0, 0.0, 0.38, G_DARK, 'poly'); gStripe(g, 0.4, 0.1); fz = -0.45;
    } else rifleBody({ hg: 0.24, len: 0.18, optic: 'reddot', curved: true, stock: 'tube', muzzle: 'brake' });
    adsY = 0.115; adsZ = -0.37;
  } else if (m === 'smg') {
    gbody(0.07, 0.085, 0.3, 0, 0.01, 0.07, c); gbox(0.064, 0.05, 0.2, 0, -0.04, 0.09, G_MID, 'poly');
    gbox(0.062, 0.062, 0.14, 0, 0.012, -0.15, c); for (let i = 0; i < 3; i++) gbox(0.064, 0.012, 0.014, 0, 0.012, -0.1 - i * 0.04, G_DARK);
    gcyl(0.013, 0.1, 0, 0.012, -0.27, G_STEEL); gMuzzle(-0.32, 0.013, c, id === 'viper' ? 'supp' : 'brake');
    gRail(0, 0.056, 0.14, 0.26); gOptic('reddot', 0.064, 0.02, g); gTriggerGuard(-0.068, 0.06);
    gGrip(0, -0.1, 0.16, 0.25); gMag(0, -0.14, 0.02, 0.032, 0.17, 0.045, -0.04, G_MID, g);
    gbox(0.03, 0.07, 0.03, 0, -0.07, -0.16, G_GRIP, 'poly'); gStock(0.15, 'fold', c); gStripe(g, 0.2, -0.1);
    fz = -0.34; adsY = 0.115; adsZ = -0.36;
  } else if (m === 'lmg') {
    gbody(0.09, 0.1, 0.4, 0, 0.01, 0.1, c); gbox(0.08, 0.05, 0.3, 0, -0.05, 0.1, G_MID, 'poly');
    gcyl(0.03, 0.34, 0, 0.012, -0.25, G_MID, 'metal', 0.03); for (let i = 0; i < 7; i++) gcyl(0.034, 0.012, 0, 0.012, -0.12 - i * 0.045, G_DARK, 'metal');
    gcyl(0.014, 0.2, 0, 0.012, -0.5, G_STEEL); gMuzzle(-0.6, 0.014, c, 'brake');
    gbox(0.03, 0.06, 0.02, 0, 0.08, 0.0, G_DARK); gbox(0.02, 0.012, 0.22, 0, 0.1, 0.0, G_STEEL); // carry handle
    gbox(0.14, 0.12, 0.14, 0, -0.13, 0.08, c, 'poly'); if (g) gbox(0.145, 0.014, 0.1, 0, -0.11, 0.08, g, 'glow'); // box mag
    gbox(0.012, 0.16, 0.012, 0.04, -0.07, -0.42, G_STEEL, 'metal', 0.4); gbox(0.012, 0.16, 0.012, -0.04, -0.07, -0.42, G_STEEL, 'metal', 0.4);
    gTriggerGuard(-0.07, 0.2); gGrip(0, -0.12, 0.3, 0.3); gStock(0.28, 'tube', c); gStripe(g, 0.3, 0.1);
    fz = -0.62; GUN_HIP.set(0.26, -0.24, -0.5); adsY = 0.115; adsZ = -0.38;
  } else if (m === 'minigun') {
    gbox(0.15, 0.14, 0.26, 0, -0.02, 0.1, c); gbox(0.1, 0.1, 0.12, 0, -0.01, 0.27, G_MID, 'poly');
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; gcyl(0.012, 0.62, Math.cos(a) * 0.035, -0.02 + Math.sin(a) * 0.035, -0.3, G_STEEL); }
    for (const zz of [-0.05, -0.28, -0.56]) gcyl(0.052, 0.014, 0, -0.02, zz, G_DARK, 'metal');
    gcyl(0.05, 0.05, 0, -0.02, -0.04, g || G_LIGHT, g ? 'glow' : 'metal');
    gbox(0.02, 0.1, 0.02, 0, 0.07, 0.0, G_STEEL); gbox(0.1, 0.012, 0.012, 0, 0.12, 0.0, G_STEEL);
    gGrip(0, -0.13, 0.2, 0.3); gbox(0.06, 0.1, 0.1, 0.12, -0.1, 0.16, 0x7a6a2a, 'metal'); gbox(0.014, 0.014, 0.16, 0.09, -0.06, 0.12, 0xc9a227, 'metal');
    fz = -0.62; GUN_HIP.set(0.26, -0.26, -0.55); adsY = 0.13; adsZ = -0.4;
  } else if (m === 'dmr' || m === 'sniper') {
    const big = m === 'sniper';
    gbody(0.062, 0.085, big ? 0.44 : 0.38, 0, 0.015, 0.1, c); gbox(0.06, 0.05, 0.24, 0, -0.04, 0.12, G_MID, 'poly');
    gbox(0.058, 0.058, 0.22, 0, 0.012, -0.2, big ? G_MID : c, 'poly'); gcyl(0.012, big ? 0.62 : 0.42, 0, 0.012, big ? -0.55 : -0.5, G_STEEL);
    gMuzzle(big ? -0.88 : -0.7, 0.012, c, 'brake');
    { const bh = new THREE.Group(); gun.add(bh); gParent = bh; gbox(0.012, 0.012, 0.06, 0.04, 0.03, 0.2, G_STEEL); gbox(0.016, 0.016, 0.016, 0.052, 0.03, 0.23, G_STEEL); gParent = null; VM.handle = bh; VM.handleZ = 0; } // bolt handle
    gRail(0, 0.06, 0.2, 0.46); gOptic('scope', 0.062, 0.0, g || 0x66aaff);
    gTriggerGuard(-0.07, 0.14); gGrip(0, -0.12, 0.2, 0.25); gMag(0, -0.1, 0.08, 0.04, 0.09, 0.07, 0, G_MID, g);
    gbox(0.012, 0.15, 0.012, 0.035, -0.06, -0.3, G_STEEL, 'metal', 0.35); gbox(0.012, 0.15, 0.012, -0.035, -0.06, -0.3, G_STEEL, 'metal', 0.35); // bipod
    gStock(0.24, 'sniper', c); gStripe(g, 0.3, -0.05);
    fz = big ? -0.92 : -0.74; GUN_HIP.set(0.24, -0.23, -0.55); adsY = 0.115; adsZ = -0.4;
  } else if (m === 'shotgun' || m === 'dbl' || m === 'sawed') {
    if (m === 'shotgun') {
      gbody(0.07, 0.09, 0.3, 0, 0.0, 0.1, c); gcyl(0.017, 0.62, 0, 0.03, -0.32, G_STEEL); gcyl(0.014, 0.5, 0, -0.012, -0.26, G_DARK); // barrel + mag tube
      { const pg = new THREE.Group(); gun.add(pg); gParent = pg; VM.pump = pg;
      gbox(0.062, 0.07, 0.2, 0, -0.012, -0.22, id === 'autoshot' ? G_MID : G_WOOD, id === 'autoshot' ? 'poly' : 'wood');
      for (let i = 0; i < 5; i++) gbox(0.064, 0.006, 0.01, 0, -0.012, -0.15 - i * 0.03, G_DARK); gParent = null; }
      gbox(0.008, 0.012, 0.012, 0, 0.05, -0.62, 0xffdd55, 'glow'); gMuzzle(-0.64, 0.017, c, 'brake');
      if (id === 'autoshot') gcyl(0.055, 0.1, 0, -0.1, 0.06, G_MID, 'metal'); // drum
      gGrip(0, -0.1, 0.17, 0.3, id === 'autoshot' ? G_GRIP : G_WOOD); gTriggerGuard(-0.058, 0.1); gStock(0.2, id === 'autoshot' ? 'tube' : 'wood', c);
      fz = -0.68;
    } else if (m === 'dbl') {
      gbox(0.07, 0.07, 0.2, 0, 0.0, 0.06, G_MID); gcyl(0.016, 0.6, 0.019, 0.01, -0.3, G_STEEL); gcyl(0.016, 0.6, -0.019, 0.01, -0.3, G_STEEL);
      gbox(0.012, 0.012, 0.58, 0, 0.03, -0.3, G_DARK); gbox(0.056, 0.05, 0.16, 0, -0.03, -0.18, G_WOOD, 'wood');
      gbox(0.02, 0.02, 0.02, 0, 0.045, 0.1, G_STEEL); gTriggerGuard(-0.04, 0.12); gStock(0.1, 'wood', c); fz = -0.6;
    } else {
      gbox(0.065, 0.06, 0.14, 0, 0.0, 0.05, G_MID); gcyl(0.016, 0.3, 0.019, 0.01, -0.12, G_STEEL); gcyl(0.016, 0.3, -0.019, 0.01, -0.12, G_STEEL);
      gbox(0.054, 0.05, 0.1, 0, -0.03, -0.06, G_WOOD, 'wood'); gGrip(0, -0.07, 0.14, 0.45, G_WOOD); gTriggerGuard(-0.036, 0.08);
      fz = -0.28; GUN_HIP.set(0.2, -0.2, -0.42);
    }
    adsY = 0.075; adsZ = -0.4;
  } else if (m === 'plasma') {
    gbox(0.09, 0.1, 0.42, 0, 0.0, 0.08, c); gbox(0.08, 0.05, 0.26, 0, -0.05, 0.1, G_MID, 'poly');
    gcyl(0.03, 0.4, 0, 0.015, -0.3, G_MID, 'metal', 0.04); gcyl(0.02, 0.38, 0, 0.015, -0.3, g, 'glow');
    for (let i = 0; i < 5; i++) gcyl(0.044, 0.012, 0, 0.015, -0.16 - i * 0.07, G_DARK, 'metal');
    for (const sx of [-1, 1]) { gbox(0.01, 0.07, 0.18, sx * 0.05, 0.05, 0.0, G_LIGHT, 'metal', 0, sx * 0.4); gbox(0.006, 0.05, 0.12, sx * 0.058, 0.02, 0.2, g, 'glow'); }
    gcyl(0.03, 0.04, 0, 0.0, -0.52, g, 'glow'); gbox(0.04, 0.05, 0.1, 0, 0.1, 0.14, G_DARK); gbox(0.03, 0.02, 0.08, 0, 0.13, 0.14, g, 'glow');
    gTriggerGuard(-0.075, 0.12); gGrip(0, -0.12, 0.2, 0.3); gStock(0.22, 'tube', c);
    fz = -0.56; adsY = 0.115; adsZ = -0.37;
  } else if (m === 'revolver') {
    gbox(0.045, 0.07, 0.14, 0, 0.0, 0.02, c); gcyl(0.036, 0.075, 0, 0.012, -0.03, G_STEEL); // frame + cylinder
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; gcyl(0.008, 0.078, Math.cos(a) * 0.024, 0.012 + Math.sin(a) * 0.024, -0.03, G_DARK); }
    gcyl(0.014, id === 'magnum' ? 0.26 : 0.2, 0, 0.026, -0.2, c); gbox(0.016, 0.03, 0.2, 0, -0.005, -0.18, c); // barrel + underlug
    gbox(0.008, 0.02, 0.012, 0, 0.05, -0.28, G_DARK); gbox(0.014, 0.02, 0.03, 0, 0.045, 0.1, G_STEEL, 'metal', -0.4); // sights + hammer
    gTriggerGuard(-0.043, 0.04); gbox(0.04, 0.11, 0.05, 0, -0.08, 0.12, G_WOOD, 'wood', 0.3);
    fz = id === 'magnum' ? -0.34 : -0.3; GUN_HIP.set(0.2, -0.2, -0.42); adsY = 0.06; adsZ = -0.34;
  } else { // pistol / cannon / machine pistol
    const big = m === 'cannon', mp = m === 'machpist';
    const sl = big ? 0.3 : mp ? 0.24 : 0.24;
    const sg = new THREE.Group(); gun.add(sg); gParent = sg; VM.slide = sg;
    gbody(big ? 0.056 : 0.046, big ? 0.075 : 0.062, sl, 0, 0.015, 0, c); // slide
    for (let i = 0; i < 5; i++) gbox(big ? 0.058 : 0.048, 0.05, 0.006, 0, 0.015, 0.05 + i * 0.012, G_DARK); // serrations
    gbox(0.014, 0.012, 0.02, 0, 0.06, -sl / 2 + 0.03, G_DARK); gbox(0.03, 0.012, 0.014, 0, 0.056, sl / 2 - 0.02, G_DARK); // sights
    gParent = null;
    gbox(0.042, 0.03, sl * 0.8, 0, -0.03, -0.01, G_MID, 'poly'); // frame
    gcyl(0.012, 0.04, 0, 0.012, -sl / 2 - 0.02, G_STEEL);
    if (big) gRail(0, 0.054, sl / 2 - 0.02, sl * 0.8);
    if (g) gbox(0.006, 0.01, sl * 0.7, 0.026, 0.015, 0, g, 'glow');
    gTriggerGuard(-0.05, 0.02); gGrip(0, -0.09, 0.1, 0.22, big ? 0x4a3320 : G_GRIP);
    if (mp) { gbox(0.032, 0.16, 0.044, 0, -0.14, 0.04, G_MID, 'poly'); gcyl(0.02, 0.07, 0, 0.012, -sl / 2 - 0.04, G_DARK, 'metal'); }
    else gbox(0.04, 0.012, 0.05, 0, -0.145, 0.11, G_DARK, 'metal', 0.22);
    fz = -sl / 2 - 0.05; GUN_HIP.set(0.2, -0.2, -0.42); adsY = 0.06; adsZ = -0.32;
  }
  if (GS && GS.extra) GS.extra();
  gunExtras(id, m, g || 0xffb347);
  GUN_ADS.set(0, -adsY - 0.01, adsZ);
  if (id === 'neon') {
    for (const sx of [-1, 1]) { // antlers
      gbox(0.012, 0.1, 0.012, sx * 0.04, 0.12, 0.0, 0x050506, 'metal', 0, -sx * 0.5);
      gbox(0.01, 0.06, 0.01, sx * 0.075, 0.17, 0.0, 0x050506, 'metal', 0, sx * 0.3);
    }
    neonCone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.11, 10), gmat(0x1f8a2e, 'poly'));
    neonCone.position.set(0, CONE_Y, 0.02);
    gun.add(neonCone);
  } else if (id === 'admin') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 10), gmat(0x1f8a2e, 'poly'));
    cone.position.set(0, 0.14, 0.15);
    gun.add(cone);
  }
  return fz;
}

function buildViewModel() {
  neonCone = null; gParent = null; VM.mag = VM.slide = VM.handle = VM.pump = VM.lh = null;
  for (const c of gun.children.slice()) if (c !== flashMesh) { gun.remove(c); c.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  const mk = (w, h, d, x, y, z, c = 0x222428, par = gun) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.6 }));
    m.position.set(x, y, z);
    par.add(m);
    return m;
  };
  const id = curId();
  let fz = -0.62;
  GUN_HIP.set(0.24, -0.22, -0.5);
  if (!WEAPONS[id].melee) {
    fz = buildGunModel(id);
  } else if (id === 'ar') {
    mk(0.07, 0.11, 0.5, 0, 0, 0); mk(0.035, 0.035, 0.32, 0, 0.015, -0.4, 0x15161a); mk(0.05, 0.15, 0.07, 0, -0.12, 0.06, 0x2d2f33); mk(0.06, 0.1, 0.22, 0, -0.01, 0.34, 0x33363b); mk(0.02, 0.04, 0.04, 0, 0.075, -0.1, 0x111111);
  } else if (id === 'neon') {
    const glow = (m, c) => { m.material.emissive = new THREE.Color(c); m.material.emissiveIntensity = 1.2; return m; };
    mk(0.075, 0.11, 0.5, 0, 0, 0.05, 0x0b0b0d);
    mk(0.04, 0.04, 0.34, 0, 0.02, -0.4, 0x050506);
    mk(0.05, 0.14, 0.07, 0, -0.12, 0.08, 0x0b0b0d);
    mk(0.06, 0.1, 0.2, 0, -0.01, 0.36, 0x111114);
    glow(mk(0.01, 0.012, 0.46, 0.039, 0.0, 0.05, 0x00ff44), 0x00ff44);
    glow(mk(0.01, 0.012, 0.46, -0.039, 0.0, 0.05, 0x00ff44), 0x00ff44);
    glow(mk(0.012, 0.09, 0.012, 0, -0.01, -0.2, 0x00ff44), 0x00ff44);
    glow(mk(0.07, 0.012, 0.012, 0, 0.0, -0.58, 0x00ff44), 0x00ff44);
    for (const sx of [-1, 1]) { // antlers
      const a1 = mk(0.012, 0.1, 0.012, sx * 0.04, 0.12, 0.0, 0x050506); a1.rotation.z = -sx * 0.5;
      const a2 = mk(0.01, 0.06, 0.01, sx * 0.075, 0.17, 0.0, 0x050506); a2.rotation.z = sx * 0.3;
    }
    neonCone = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.11, 10), new THREE.MeshStandardMaterial({ color: 0x1f8a2e, roughness: 0.6 }));
    neonCone.position.set(0, CONE_Y, 0.02);
    gun.add(neonCone);
    fz = -0.62;
  } else if (id === 'smg') {
    mk(0.07, 0.1, 0.34, 0, 0, 0); mk(0.03, 0.03, 0.18, 0, 0.01, -0.26, 0x15161a); mk(0.04, 0.2, 0.06, 0, -0.14, 0.02, 0x2d2f33); mk(0.05, 0.09, 0.16, 0, -0.01, 0.24, 0x33363b); fz = -0.42;
  } else if (id === 'shotgun') {
    mk(0.07, 0.1, 0.45, 0, 0, 0.05); mk(0.035, 0.035, 0.6, 0, 0.03, -0.5, 0x15161a); mk(0.03, 0.03, 0.55, 0, -0.02, -0.47, 0x15161a); mk(0.06, 0.06, 0.2, 0, -0.045, -0.3, 0x5a3b22); mk(0.06, 0.1, 0.26, 0, -0.02, 0.38, 0x5a3b22); fz = -0.85;
  } else if (id === 'sniper') {
    mk(0.06, 0.1, 0.6, 0, 0, 0.1); mk(0.028, 0.028, 0.7, 0, 0.015, -0.6, 0x15161a); mk(0.04, 0.04, 0.22, 0, 0.1, -0.05, 0x111111); mk(0.055, 0.14, 0.3, 0, -0.01, 0.5, 0x2d3b2d); fz = -1.0;
    GUN_HIP.set(0.24, -0.23, -0.55);
  } else if (id === 'pistol') {
    mk(0.045, 0.06, 0.24, 0, 0, 0); mk(0.04, 0.12, 0.06, 0, -0.08, 0.08, 0x2d2f33); fz = -0.17;
    GUN_HIP.set(0.2, -0.2, -0.42);
  } else if (id === 'revolver') {
    mk(0.045, 0.06, 0.26, 0, 0.01, -0.02, 0x777b82); mk(0.05, 0.05, 0.06, 0, 0, 0.0, 0x555a62); mk(0.04, 0.12, 0.06, 0, -0.08, 0.1, 0x4a3320); mk(0.03, 0.03, 0.2, 0, 0.012, -0.22, 0x777b82); fz = -0.34;
    GUN_HIP.set(0.2, -0.2, -0.42);
  } else if (id === 'admin') {
    const glow = (m, c) => { m.material.emissive = new THREE.Color(c); m.material.emissiveIntensity = 1.2; return m; };
    mk(0.08, 0.12, 0.55, 0, 0, 0.05, 0x0b0b0d);
    mk(0.045, 0.045, 0.4, 0, 0.02, -0.45, 0x050506);
    mk(0.05, 0.15, 0.07, 0, -0.12, 0.08, 0x0b0b0d);
    mk(0.07, 0.1, 0.22, 0, -0.01, 0.38, 0x111114);
    glow(mk(0.012, 0.012, 0.5, 0.042, 0.02, 0.05, 0x00ff44), 0x00ff44);
    glow(mk(0.012, 0.012, 0.5, -0.042, 0.02, 0.05, 0x00ff44), 0x00ff44);
    glow(mk(0.085, 0.012, 0.012, 0, 0.063, -0.15, 0x00ff44), 0x00ff44);
    glow(mk(0.06, 0.012, 0.012, 0, 0.0, -0.66, 0x00ff44), 0x00ff44);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 10), new THREE.MeshStandardMaterial({ color: 0x1f8a2e, roughness: 0.6 }));
    cone.position.set(0, 0.14, 0.15);
    gun.add(cone);
    fz = -0.7;
  } else if (WEAPONS[id].model && !['ar', 'smg', 'shotgun', 'sniper', 'pistol', 'revolver', 'katana', 'knife', 'admin', 'neon'].includes(id)) {
    const w = WEAPONS[id], c = w.col, g = w.glow;
    const glow = (m) => { if (g) { m.material.emissive = new THREE.Color(g); m.material.emissiveIntensity = 1.2; } return m; };
    const grp = () => { const k = new THREE.Group(); gun.add(k); return k; };
    const m = w.model;
    fz = -0.62;
    if (!w.melee) {
      if (m === 'rifle' || m === 'bullpup') {
        const bp = m === 'bullpup';
        mk(0.07, 0.11, bp ? 0.55 : 0.5, 0, 0, 0.05, c); mk(0.035, 0.035, bp ? 0.25 : 0.32, 0, 0.015, -0.4, 0x15161a);
        mk(0.05, 0.15, 0.07, 0, -0.12, bp ? 0.0 : 0.06, 0x2d2f33); if (!bp) mk(0.06, 0.1, 0.22, 0, -0.01, 0.34, 0x33363b); else mk(0.05, 0.16, 0.08, 0, -0.1, 0.22, 0x222226);
        glow(mk(0.012, 0.012, 0.3, 0.04, 0.02, 0.05, g || c)); if (bp) fz = -0.5;
      } else if (m === 'smg') {
        mk(0.07, 0.1, 0.34, 0, 0, 0, c); mk(0.03, 0.03, 0.18, 0, 0.01, -0.26, 0x15161a); mk(0.04, 0.2, 0.06, 0, -0.14, 0.02, 0x2d2f33); glow(mk(0.012, 0.012, 0.3, 0.04, 0.02, 0, g || c)); fz = -0.42;
      } else if (m === 'lmg') {
        mk(0.09, 0.13, 0.62, 0, 0, 0.05, c); mk(0.04, 0.04, 0.5, 0, 0.02, -0.52, 0x15161a); mk(0.12, 0.12, 0.14, 0, -0.14, 0.05, 0x2d2f33);
        mk(0.02, 0.2, 0.02, 0.05, -0.12, -0.5, 0x222226); mk(0.02, 0.2, 0.02, -0.05, -0.12, -0.5, 0x222226); mk(0.06, 0.12, 0.25, 0, -0.01, 0.4, 0x33363b); glow(mk(0.012, 0.012, 0.5, 0.05, 0.03, 0.05, g || c)); fz = -0.82;
        GUN_HIP.set(0.26, -0.24, -0.5);
      } else if (m === 'minigun') {
        mk(0.14, 0.14, 0.3, 0, -0.02, 0.1, c);
        for (const [bx, by] of [[0, 0.04], [0.04, -0.03], [-0.04, -0.03]]) mk(0.03, 0.03, 0.7, bx, by - 0.02, -0.5, 0x15161a);
        glow(mk(0.1, 0.1, 0.02, 0, -0.02, -0.2, g || c)); mk(0.1, 0.1, 0.1, 0, -0.1, 0.26, 0x222226); fz = -0.9;
        GUN_HIP.set(0.28, -0.28, -0.55);
      } else if (m === 'dmr') {
        mk(0.065, 0.1, 0.55, 0, 0, 0.1, c); mk(0.03, 0.03, 0.5, 0, 0.015, -0.5, 0x15161a); mk(0.04, 0.045, 0.2, 0, 0.09, -0.05, 0x111111); mk(0.05, 0.14, 0.07, 0, -0.12, 0.08, 0x2d2f33); mk(0.055, 0.12, 0.25, 0, -0.01, 0.46, 0x2d3b2d); fz = -0.82;
      } else if (m === 'dbl') {
        mk(0.06, 0.07, 0.45, 0, 0, 0.1, c); mk(0.028, 0.028, 0.55, 0.022, 0.02, -0.4, 0x15161a); mk(0.028, 0.028, 0.55, -0.022, 0.02, -0.4, 0x15161a); mk(0.06, 0.1, 0.26, 0, -0.03, 0.4, c); fz = -0.7;
      } else if (m === 'plasma') {
        mk(0.09, 0.12, 0.45, 0, 0, 0.05, c); glow(mk(0.05, 0.05, 0.3, 0, 0.02, -0.38, g)); glow(mk(0.11, 0.02, 0.06, 0, 0.02, -0.2, g)); mk(0.05, 0.14, 0.07, 0, -0.12, 0.08, 0x222226); glow(mk(0.06, 0.06, 0.1, 0, 0.0, -0.58, g)); fz = -0.65;
      } else if (m === 'shotgun') {
        mk(0.075, 0.11, 0.42, 0, 0, 0.05, c); mk(0.04, 0.04, 0.5, 0, 0.03, -0.42, 0x15161a); mk(0.06, 0.08, 0.2, 0, -0.04, -0.25, 0x2d2f33); mk(0.06, 0.1, 0.26, 0, -0.02, 0.38, c); fz = -0.72;
      } else if (m === 'sniper') {
        mk(0.065, 0.11, 0.7, 0, 0, 0.1, c); mk(0.03, 0.03, 0.8, 0, 0.015, -0.65, 0x15161a); mk(0.045, 0.05, 0.25, 0, 0.1, -0.05, 0x111111); glow(mk(0.07, 0.015, 0.4, 0, 0.0, 0.1, g || c)); mk(0.055, 0.14, 0.3, 0, -0.01, 0.52, 0x2a2a2e); fz = -1.1;
      } else if (m === 'cannon') {
        glow(mk(0.06, 0.08, 0.3, 0, 0, 0, c)); mk(0.05, 0.12, 0.07, 0, -0.1, 0.09, 0x222226); glow(mk(0.012, 0.012, 0.28, 0.032, 0.0, 0, g || 0x000000)); fz = -0.22;
        GUN_HIP.set(0.2, -0.2, -0.42);
      } else if (m === 'machpist') {
        mk(0.05, 0.07, 0.26, 0, 0, 0, c); mk(0.04, 0.12, 0.06, 0, -0.08, 0.08, 0x2d2f33); mk(0.035, 0.18, 0.05, 0, -0.12, -0.03, 0x15161a); fz = -0.2;
        GUN_HIP.set(0.2, -0.2, -0.42);
      } else if (m === 'sawed') {
        mk(0.028, 0.028, 0.32, 0.022, 0.02, -0.12, 0x15161a); mk(0.028, 0.028, 0.32, -0.022, 0.02, -0.12, 0x15161a); mk(0.055, 0.07, 0.12, 0, -0.01, 0.1, c); mk(0.05, 0.1, 0.08, 0, -0.08, 0.2, c); fz = -0.32;
        GUN_HIP.set(0.2, -0.2, -0.42);
      } else if (m === 'revolver') {
        mk(0.045, 0.06, 0.26, 0, 0.01, -0.02, c); mk(0.05, 0.05, 0.06, 0, 0, 0.0, 0x555a62); mk(0.04, 0.12, 0.06, 0, -0.08, 0.1, 0x4a3320); mk(0.03, 0.03, 0.2, 0, 0.012, -0.22, c); fz = -0.34;
        GUN_HIP.set(0.2, -0.2, -0.42);
      } else { // 'pistol' style
        glow(mk(0.045, 0.06, 0.24, 0, 0, 0, c)); mk(0.04, 0.12, 0.06, 0, -0.08, 0.08, 0x2d2f33); fz = -0.17;
        GUN_HIP.set(0.2, -0.2, -0.42);
      }
    } else {
      const k = grp();
      const L = w.len || 0.8, hc = w.hilt || 0x222226;
      if (m === 'sword') {
        glow(mk(w.wide || 0.03, L, 0.006, 0, 0.1 + L / 2, 0, c, k)); mk(0.12, 0.016, 0.05, 0, 0.1, 0, 0x888a90, k); mk(0.03, 0.22, 0.03, 0, -0.02, 0, hc, k); k.rotation.set(-0.5, 0, -0.35);
      } else if (m === 'axe') {
        mk(0.03, 0.8, 0.03, 0, 0.3, 0, 0x6a4a2a, k); mk(0.22, 0.16, 0.025, 0.1, 0.62, 0, c, k); k.rotation.set(-0.5, 0, -0.3);
      } else if (m === 'hammer') {
        mk(0.03, 0.8, 0.03, 0, 0.3, 0, 0x6a4a2a, k); mk(0.2, 0.14, 0.14, 0, 0.7, 0, c, k); k.rotation.set(-0.5, 0, -0.3);
      } else if (m === 'bat') {
        mk(0.04, L > 0.6 ? 0.8 : 0.5, 0.04, 0, 0.35, 0, c, k); mk(0.065, 0.3, 0.065, 0, L > 0.6 ? 0.65 : 0.5, 0, c, k); k.rotation.set(-0.5, 0, -0.3);
      } else if (m === 'spear') {
        mk(0.025, 1.4, 0.025, 0, 0.5, 0, 0x6a4a2a, k); mk(0.05, 0.22, 0.01, 0, 1.28, 0, c, k); k.rotation.set(-0.7, 0, -0.1);
      } else if (m === 'crowbar') {
        mk(0.03, 0.6, 0.03, 0, 0.3, 0, c, k); mk(0.03, 0.1, 0.03, 0.03, 0.62, 0, c, k); k.rotation.set(-0.5, 0, -0.3);
      } else if (m === 'pan') {
        mk(0.03, 0.35, 0.03, 0, 0.1, 0, hc || 0x222226, k); const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 16), new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.6 })); pan.position.set(0, 0.36, 0); k.add(pan); k.rotation.set(-0.5, 0, -0.3);
      } else if (m === 'scythe') {
        mk(0.03, 1.2, 0.03, 0, 0.4, 0, 0x5a3a22, k); mk(0.4, 0.04, 0.012, -0.18, 1.0, 0, c, k); mk(0.1, 0.04, 0.012, -0.4, 0.93, 0, c, k); k.rotation.set(-0.6, 0, -0.2);
      }
      GUN_HIP.set(m === 'spear' || m === 'scythe' ? 0.35 : 0.3, -0.42, -0.5);
    }
  } else if (id === 'katana') {
    const k = new THREE.Group();
    mk(0.026, 0.8, 0.006, 0, 0.5, 0, 0xdfe6ee, k).material.emissive = new THREE.Color(0x334455);
    mk(0.12, 0.014, 0.05, 0, 0.1, 0, 0xc9a227, k);
    mk(0.03, 0.22, 0.03, 0, -0.02, 0, 0x1a1a1f, k);
    k.rotation.set(-0.5, 0, -0.35);
    gun.add(k);
    GUN_HIP.set(0.3, -0.42, -0.5);
  } else if (id === 'knife') {
    const k = new THREE.Group();
    mk(0.02, 0.28, 0.005, 0, 0.2, 0, 0xdfe6ee, k);
    mk(0.03, 0.12, 0.03, 0, -0.02, 0, 0x1a1a1f, k);
    k.rotation.set(-0.9, 0, -0.2);
    gun.add(k);
    GUN_HIP.set(0.26, -0.3, -0.45);
  }
  flashMesh.position.set(0, 0.015, fz);
  gunBase.copy(GUN_HIP);
}
const vmS = { z: 0, vz: 0, p: 0, vp: 0, x: 0, vx: 0, r: 0, vr: 0 };
let vmShots = 0, vmSince = 9;
const GUN_ADS = new THREE.Vector3(0.0, -0.155, -0.42);
const gunBase = GUN_HIP.clone();

/* ------------------------------ main update ------------------------------ */
function update(dt) {
  gameTime += dt;
  for (const f of mapAnim) f(dt);
  if (net.on && state === 'play') {
    net.sendT -= dt;
    if (net.sendT <= 0) {
      net.sendT = 0.066;
      const nb = player.body.position;
      net.send({ t: 'st', x: +nb.x.toFixed(2), y: +nb.y.toFixed(2), z: +nb.z.toFixed(2), yw: +player.yaw.toFixed(3), d: player.dead ? 1 : 0 });
    }
    if (net.host) { net.timeT -= dt; if (net.timeT <= 0) { net.timeT = 1; net.send({ t: 'time', r: roundT }); } }
  }
  if (admin.lock && admin.auth && state === 'play' && !player.dead && locked) aimbot();
  assistUpdate(dt);
  updatePlayer(dt);
  if (player.abT > 0) player.abT = Math.max(0, player.abT - dt);
  if (player.abCd) for (const k in player.abCd) if (player.abCd[k] > 0) player.abCd[k] = Math.max(0, player.abCd[k] - dt);
  if (player.dashT > 0) { player.dashT -= dt; const dv = player.body.velocity; dv.x = player.dashX; dv.z = player.dashZ; }
  world.step(1 / 60, dt, 6);

  for (const e of enemies.slice()) e.update(dt);
  updateMatch(dt);
  updateBullets(dt);
  updateGrenades(dt);

  for (let i = debrisList.length - 1; i >= 0; i--) {
    const d = debrisList[i];
    d.t -= dt;
    if (d.t <= 0) { untrack(d.body); debrisList.splice(i, 1); }
  }
  for (let i = ragdolls.length - 1; i >= 0; i--) {
    ragdolls[i].t -= dt;
    if (ragdolls[i].t <= 0) { removeRagdoll(ragdolls[i]); ragdolls.splice(i, 1); }
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    if (s.life <= 0) { scene.remove(s.m); sparks.splice(i, 1); continue; }
    s.v.y -= GRAV * 0.8 * dt;
    s.m.position.addScaledVector(s.v, dt);
    s.m.scale.setScalar(Math.max(0.05, s.life / s.max));
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i];
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    f.upd(k);
    if (k >= 1) { f.end(); fx.splice(i, 1); }
  }
}

function syncMeshes() {
  for (const b of synced) {
    const m = b.userData.mesh;
    const ip = b.interpolatedPosition, iq = b.interpolatedQuaternion;
    m.position.set(ip.x, ip.y, ip.z);
    m.quaternion.set(iq.x, iq.y, iq.z, iq.w);
  }
}


let sprintBlend = 0;
let lastCross = '';
function updateCamera(dt) {
  if (player.dead) {
    // kill-cam: slump to the floor
    const k = Math.min(1, (1 - player.deadT / RESPAWN_TIME) * 3);
    camera.position.set(player.deathPos.x, player.deathPos.y + 1.2 - 0.85 * k, player.deathPos.z);
    camera.rotation.set(player.pitch * (1 - k) - 0.3 * k, player.yaw, 1.0 * k);
    gun.visible = false;
    return;
  }
  gun.visible = true;

  const pb = player.body.interpolatedPosition;
  const vel = player.body.velocity;
  const hs = Math.hypot(vel.x, vel.z);
  player.slideBlend += ((player.sliding ? 1 : 0) - player.slideBlend) * Math.min(1, 12 * dt);
  const sb = player.slideBlend;

  // view bobbing (medium): vertical step bounce, side sway, a little roll
  const amp = player.bobAmp * (player.sprinting ? 1.35 : 1) * prefs.bob;
  const ph = player.bob;
  const bobY = Math.sin(ph * 2) * 0.075 * amp;
  const bobX = Math.sin(ph) * 0.05 * amp;
  const bobRoll = Math.sin(ph) * 0.01 * amp;
  const bobPitch = Math.sin(ph * 2 + 1) * 0.006 * amp;
  const s = player.shake;
  const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw); // camera right vector
  camera.position.set(
    pb.x + rx * bobX + rand(-1, 1) * s * 0.05,
    pb.y + 1.2 + bobY - player.landDip - 0.55 * sb + rand(-1, 1) * s * 0.05,
    pb.z + rz * bobX + rand(-1, 1) * s * 0.05
  );
  camera.rotation.set(
    player.pitch + bobPitch + rand(-1, 1) * s * 0.02,
    player.yaw + rand(-1, 1) * s * 0.02,
    bobRoll - sb * 0.05 + rand(-1, 1) * s * 0.03
  );

  // field of view: zoom for ADS, widen while sprinting or sliding
  const fovT = player.ads ? (curW().ads || 58) : player.sliding ? prefs.fov + 9 : player.sprinting && hs > 7 ? prefs.fov + 7 : prefs.fov;
  if (Math.abs(camera.fov - fovT) > 0.05) {
    camera.fov += (fovT - camera.fov) * Math.min(1, 8 * dt);
    camera.updateProjectionMatrix();
  }

  // weapon: smooth base position + bob + recoil + sprint/slide lowering
  sprintBlend += ((player.sprinting || player.sliding ? 1 : 0) - sprintBlend) * Math.min(1, 9 * dt);
  gunBase.lerp(player.ads ? GUN_ADS : GUN_HIP, Math.min(1, 14 * dt));
  // ---- shooting: damped spring driven by an impulse per shot (kick back, muzzle climb, side jolt, roll)
  if ((player.shots || 0) !== vmShots) {
    vmShots = player.shots || 0; vmSince = 0;
    const a = player.ads ? 0.45 : 1, w = curW();
    const p = Math.min(2.2, 0.8 + (w.kick || 0.01) * 60);
    vmS.vz += 1.5 * p * a; vmS.vp += 2.0 * p * a; vmS.vx += rand(-0.15, 0.15) * p * a; vmS.vr += rand(-1, 1) * 1.1 * p * a;
  }
  vmSince += dt;
  const sub = Math.min(dt, 0.012);
  for (const k of ['z', 'p', 'x', 'r']) {
    const st = vmS, v = 'v' + k;
    st[v] += (-260 * st[k] - 22 * st[v]) * sub; st[k] += st[v] * sub;
  }
  // ---- reload: keyframed phases (tilt out, mag out, mag in, seat, rack, return)
  const rk = player.reloadT > 0 ? 1 - player.reloadT / (player.reloadMax || 1.9) : 0;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const tilt = rk > 0 ? ss(0, 0.18, rk) - ss(0.85, 1, rk) : 0;       // gun rolls and lowers
  const magOut = rk > 0 ? ss(0.2, 0.38, rk) - ss(0.5, 0.68, rk) : 0; // 0 = seated, 1 = fully removed
  const seat = rk > 0 ? Math.sin(Math.PI * ss(0.66, 0.78, rk)) : 0;  // thud when the mag locks in
  const rack = rk > 0 ? Math.sin(Math.PI * ss(0.76, 0.92, rk)) : 0;  // bolt / slide / pump cycle
  if (VM.lh) { const hk = rk > 0 ? ss(0.1, 0.28, rk) - ss(0.72, 0.9, rk) : 0; VM.lh.position.set(0.01 * hk, -0.07 * hk - 0.12 * magOut, 0.24 * hk); VM.lh.rotation.x = -0.25 * hk; }
  if (VM.mag) { VM.mag.position.set(0.05 * magOut, -0.28 * magOut, 0.03 * magOut); VM.mag.rotation.z = 0.5 * magOut; VM.mag.visible = magOut < 0.98; }
  if (VM.handle) VM.handle.position.z = (VM.handle.isGroup ? 0 : VM.handleZ) + rack * 0.06 + vmS.z * 0.2;
  if (VM.slide) VM.slide.position.z = rack * 0.05 + Math.max(0, vmS.z) * 0.9;
  if (VM.pump) { const t = Math.min(1, vmSince / 0.55); VM.pump.position.z = (vmSince < 0.55 && player.shots ? 0.09 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.1) / 0.8))) : 0) + rack * 0.09; }
  const reloadK = tilt;
  gun.position.set(
    gunBase.x + Math.sin(ph) * 0.016 * amp - sprintBlend * 0.05 + vmS.x - tilt * 0.05,
    gunBase.y + Math.sin(ph * 2) * 0.014 * amp - player.kickBack * 0.006 - sprintBlend * 0.07 - tilt * 0.07 - seat * 0.02 + vmS.p * 0.01,
    gunBase.z + player.kickBack * 0.02 + vmS.z * 0.07 + tilt * 0.03
  );
  gun.rotation.x = vmS.p * 0.1 + player.kickBack * 0.02 + reloadK * 0.55 + seat * 0.06 + sprintBlend * 0.25;
  gun.rotation.y = -sprintBlend * 0.4 - tilt * 0.35;
  gun.rotation.z = vmS.r * 0.05 + reloadK * 0.7 + sb * 0.25;
  if (player.swapT > 0) { player.swapT -= dt; gun.position.y -= Math.max(0, player.swapT) * 1.1; }
  if (player.swing > 0) {
    player.swing = Math.max(0, player.swing - dt * 3.2);
    const sw = Math.sin(player.swing * Math.PI);
    gun.position.x -= sw * 0.45; gun.position.y += sw * 0.1; gun.position.z -= sw * 0.1;
    gun.rotation.z += sw * 1.3; gun.rotation.x -= sw * 0.6; gun.rotation.y += sw * 0.9;
  }
  gun.visible = !(player.ads && curW().ads === 22);
  if (neonCone) {
    // reload: the cone lifts off and a fresh identical one drops back on
    let y = CONE_Y, sc = 1, rz = 0;
    if (player.reloadT > 0) {
      const k = 1 - player.reloadT / (player.reloadMax || 1.7);
      if (k < 0.5) { const t = k / 0.5; y = CONE_Y + t * 0.4; sc = 1 - t * t; rz = t * 1.2; }
      else { const t = (k - 0.5) / 0.5; y = CONE_Y + (1 - t) * 0.4; sc = t * t; }
    }
    neonCone.position.y = y;
    neonCone.scale.setScalar(Math.max(0.001, sc));
    neonCone.rotation.z = rz;
  }

  const flashing = player.flash > 0;
  flashMesh.visible = flashing;
  if (flashing) {
    flashMesh.rotation.z = Math.random() * 6.28;
    flashMesh.scale.setScalar(rand(0.7, 1.2));
  }
  muzzleLight.intensity = flashing ? 8 : 0;

  // crosshair breathes with spread (only touch the DOM when it changes)
  const spread = (0.002 + player.heat * 0.02 + hs * 0.0012) * (player.ads ? 0.4 : 1);
  const size = Math.round(22 + spread * 1500);
  const key = size + '/' + (player.ads ? 1 : 0);
  if (key !== lastCross) {
    lastCross = key;
    hud.cross.style.width = hud.cross.style.height = size + 'px';
    hud.cross.style.opacity = player.ads ? 0.45 : 1;
  }
}

/* ------------------------------ fps + debug readout ------------------------------ */
const dbg = document.createElement('div');
dbg.style.cssText = 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);font:12px Consolas,monospace;color:#9fe8ff;opacity:.8;pointer-events:none;text-shadow:0 1px 3px #000;z-index:5;white-space:pre;text-align:center';
document.body.prepend(dbg);
let dbgFull = false, fpsShown = 0, fpsFrames = 0, fpsT = 0;
document.addEventListener('keydown', (e) => {
  if (e.code === 'F3') { dbgFull = !dbgFull; e.preventDefault(); }
});
function updateDebug(raw) {
  fpsFrames++;
  fpsT += raw;
  if (fpsT < 400) return;
  fpsShown = Math.round((fpsFrames * 1000) / fpsT);
  fpsFrames = 0; fpsT = 0;
  let t = fpsShown + ' FPS   (F3 = debug)';
  if (dbgFull) {
    const v = player.body.velocity;
    const held = Object.keys(keys).filter((k) => keys[k]).join(' ') || '-';
    t += `\nspeed ${Math.hypot(v.x, v.z).toFixed(1)} m/s   ground ${player.onGround ? 'yes' : 'no'}   slide ${player.sliding ? 'yes' : 'no'}   render x${pixelRatio.toFixed(2)}\nkeys held: ${held}`;
  }
  dbg.textContent = t;
}

/* ------------------------------ loop ------------------------------ */
let last = performance.now();
let frameAvg = 16, downTimer = 0, upTimer = 0;
function setRes(pr) {
  pixelRatio = pr;
  renderer.setPixelRatio(pr);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.min(200, now - last);
  const dt = Math.min(0.1, raw / 1000);
  last = now;
  timeNow = now / 1000;

  // adaptive resolution keeps the game smooth on weak GPUs / battery saver
  frameAvg += (raw - frameAvg) * 0.05;
  downTimer += raw / 1000;
  upTimer += raw / 1000;
  if (downTimer > 1.5) {
    downTimer = 0;
    if (frameAvg > 26 && pixelRatio > 0.55) { setRes(Math.max(0.55, pixelRatio - 0.2)); upTimer = 0; }
  }
  if (upTimer > 8) {
    upTimer = 0;
    if (frameAvg < 18 && pixelRatio < MAX_PR) setRes(Math.min(MAX_PR, pixelRatio + 0.1));
  }

  if (state === 'play' && locked) update(dt);
  syncMeshes();
  updateCamera(dt);
  updateHud();
  updateDebug(raw);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
