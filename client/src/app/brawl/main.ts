import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  PointLight, Vector3, Color3, Color4, MeshBuilder, StandardMaterial, PointerEventTypes, Matrix,
} from '@babylonjs/core';
import { deriveBuild } from '@chog/shared';

type Elem = 'burn' | 'frost' | 'volt' | 'wave' | 'prism' | 'void';
const ELEM_COLOR: Record<Elem, Color3> = {
  burn: Color3.FromHexString('#ff5a3c'),
  frost: Color3.FromHexString('#5cc8ff'),
  volt: Color3.FromHexString('#ffe14d'),
  wave: Color3.FromHexString('#6affc0'),
  prism: Color3.FromHexString('#c98bff'),
  void: Color3.FromHexString('#8a5cff'),
};

const canvas = document.getElementById('render') as HTMLCanvasElement;
// Cap DPR at 2 so phones don't melt — mobile readiness from line one.
const engine = new Engine(canvas, true, { adaptToDeviceRatio: true, antialias: true });
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

const scene = new Scene(engine);
scene.clearColor = new Color4(0.04, 0.02, 0.07, 1);
scene.fogMode = Scene.FOGMODE_EXP2;
scene.fogColor = new Color3(0.04, 0.02, 0.07);
scene.fogDensity = 0.022;

// Fixed isometric follow-cam (Diablo feel): no user orbit, tracks the player.
const cam = new ArcRotateCamera('cam', -Math.PI / 4, Math.PI / 3.1, 18, Vector3.Zero(), scene);
cam.fov = 0.8;
cam.detachControl();

const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene);
hemi.intensity = 0.45;
hemi.groundColor = new Color3(0.1, 0.05, 0.15);
const sun = new DirectionalLight('sun', new Vector3(-0.4, -1, 0.3), scene);
sun.intensity = 0.8;

// --- Room ---
const ROOM = 20;
const ground = MeshBuilder.CreateGround('g', { width: ROOM * 2, height: ROOM * 2 }, scene);
const gm = new StandardMaterial('gm', scene);
gm.diffuseColor = new Color3(0.08, 0.07, 0.12);
gm.specularColor = Color3.Black();
ground.material = gm;

function wall(x: number, z: number, w: number, d: number) {
  const m = MeshBuilder.CreateBox('w', { width: w, height: 6, depth: d }, scene);
  m.position.set(x, 3, z);
  const mm = new StandardMaterial('wm', scene);
  mm.diffuseColor = new Color3(0.1, 0.08, 0.16);
  mm.specularColor = Color3.Black();
  m.material = mm;
}
wall(0, -ROOM, ROOM * 2, 1);
wall(0, ROOM, ROOM * 2, 1);
wall(-ROOM, 0, 1, ROOM * 2);
wall(ROOM, 0, 1, ROOM * 2);

for (const [px, pz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]] as [number, number][]) {
  const p = MeshBuilder.CreateCylinder('p', { diameter: 1.2, height: 6 }, scene);
  p.position.set(px, 3, pz);
  const pm = new StandardMaterial('pm', scene);
  pm.diffuseColor = new Color3(0.12, 0.1, 0.18);
  p.material = pm;
  const t = new PointLight('torch' + px + pz, new Vector3(px, 5, pz), scene);
  t.diffuse = new Color3(1, 0.6, 0.3);
  t.intensity = 0.6;
  t.range = 14;
}

// --- Player (Chog stand-in), tinted by the NFT element via the shared model ---
const tokenId = Number(new URLSearchParams(location.search).get('chog') ?? '1') || 1;
let element: Elem = 'prism';
try {
  const b = deriveBuild({ tokenId, transferCount: 0, daysHeld: 0 });
  const e = (b.loadout?.element || 'prism') as Elem;
  if (ELEM_COLOR[e]) element = e;
} catch { /* stand-in colour stays */ }

const player = MeshBuilder.CreateCapsule('player', { radius: 0.6, height: 2.2 }, scene);
player.position.set(0, 1.1, 8);
const pm = new StandardMaterial('playerm', scene);
pm.diffuseColor = ELEM_COLOR[element];
pm.emissiveColor = ELEM_COLOR[element].scale(0.25);
player.material = pm;

// --- Enemy ---
let enemy = MeshBuilder.CreateSphere('enemy', { diameter: 1.8, segments: 12 }, scene);
enemy.position.set(0, 1.2, -6);
const em = new StandardMaterial('enemym', scene);
em.diffuseColor = new Color3(0.8, 0.2, 0.35);
em.emissiveColor = new Color3(0.3, 0.05, 0.1);
enemy.material = em;
let enemyHp = 100, enemyMax = 100, enemyAlive = true, enemyAttackCd = 0;

// --- Loot ---
let loot: ReturnType<typeof MeshBuilder.CreateSphere> | null = null;
let lootCount = 0;
const LOG = document.getElementById('log')!;
function log(s: string) {
  const d = document.createElement('div');
  d.textContent = s;
  LOG.prepend(d);
  while (LOG.childElementCount > 6) LOG.lastChild?.remove();
}

// --- Input ---
const keys: Record<string, boolean> = {};
addEventListener('keydown', (e) => (keys[e.key.toLowerCase()] = true));
addEventListener('keyup', (e) => (keys[e.key.toLowerCase()] = false));
let moveTarget: Vector3 | null = null;
const joy = { x: 0, y: 0, active: false };

scene.onPointerObservable.add((pi) => {
  if (pi.type !== PointerEventTypes.POINTERDOWN) return;
  const pick = scene.pick(scene.pointerX, scene.pointerY);
  if (pick?.hit && pick.pickedMesh === enemy && enemyAlive) { tryAttack(); return; }
  if (pick?.hit && pick.pickedMesh === ground) moveTarget = pick.pickedPoint!.clone();
});

// Virtual joystick (mobile)
const joyEl = document.getElementById('joy')!;
const stickEl = document.getElementById('stick')!;
let joyId = -1, joyCx = 0, joyCy = 0;
joyEl.addEventListener('pointerdown', (e) => {
  joy.active = true; joyId = e.pointerId;
  const r = joyEl.getBoundingClientRect();
  joyCx = r.left + r.width / 2; joyCy = r.top + r.height / 2;
  joyEl.setPointerCapture(e.pointerId); moveStick(e);
});
joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joyId) moveStick(e); });
joyEl.addEventListener('pointerup', (e) => {
  if (e.pointerId === joyId) { joy.active = false; joy.x = joy.y = 0; stickEl.style.transform = 'translate(0,0)'; }
});
function moveStick(e: PointerEvent) {
  const dx = e.clientX - joyCx, dy = e.clientY - joyCy;
  const max = 35, d = Math.hypot(dx, dy) || 1, c = Math.min(d, max);
  const nx = dx / d, ny = dy / d;
  joy.x = (nx * c) / max; joy.y = (ny * c) / max;
  stickEl.style.transform = `translate(${nx * c}px, ${ny * c}px)`;
}

// Attack button (mobile) + desktop
document.getElementById('atk')!.addEventListener('pointerdown', (e) => { e.preventDefault(); tryAttack(); });

let atkCd = 0;
function tryAttack() {
  if (atkCd > 0 || !enemyAlive) return;
  if (Vector3.Distance(player.position, enemy.position) > 4) return;
  atkCd = 0.45;
  const dmg = 18 + Math.floor(Math.random() * 8);
  enemyHp -= dmg;
  floatText(enemy.position, `-${dmg}`, '#ffd14d');
  if (enemyHp <= 0) killEnemy();
}

function killEnemy() {
  enemyAlive = false;
  enemy.setEnabled(false);
  log('Inimigo abatido!');
  spawnLoot(enemy.position.clone());
}
function spawnLoot(at: Vector3) {
  const o = MeshBuilder.CreateSphere('loot', { diameter: 0.6 }, scene);
  o.position.set(at.x, 0.6, at.z);
  const om = new StandardMaterial('loom', scene);
  om.emissiveColor = new Color3(0.4, 1, 0.6);
  om.diffuseColor = new Color3(0.2, 0.6, 0.4);
  o.material = om;
  loot = o;
}
const LOOT_KINDS = ['burn', 'frost', 'volt', 'wave', 'prism', 'void'];
function floatText(w: Vector3, text: string, color: string) {
  const p = Vector3.Project(w, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport);
  const d = document.createElement('div');
  d.id = 'float'; d.textContent = text; d.style.color = color;
  d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
  document.body.appendChild(d);
  let t = 0;
  const iv = setInterval(() => {
    t += 16; d.style.top = p.y - t * 0.04 + 'px'; d.style.opacity = String(Math.max(0, 1 - t / 800));
    if (t >= 800) { clearInterval(iv); d.remove(); }
  }, 16);
}

// HUD
const php = document.querySelector('#php > i') as HTMLElement;
const ehp = document.querySelector('#ehp > i') as HTMLElement;
let playerHp = 100, playerMax = 100;

// --- Loop ---
let last = performance.now();
scene.onBeforeRenderObservable.add(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const speed = 7;
  let mx = 0, mz = 0;
  if (joy.active) { mx = joy.x; mz = joy.y; moveTarget = null; }
  else {
    if (keys['w'] || keys['arrowup']) mz -= 1;
    if (keys['s'] || keys['arrowdown']) mz += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (moveTarget) {
      const dir = moveTarget.subtract(player.position); dir.y = 0;
      const dist = dir.length();
      if (dist < 0.3) moveTarget = null; else { dir.normalize(); mx = dir.x; mz = dir.z; }
    }
  }
  if (mx || mz) {
    const len = Math.hypot(mx, mz) || 1;
    player.position.x = Math.max(-ROOM + 1, Math.min(ROOM - 1, player.position.x + (mx / len) * speed * dt));
    player.position.z = Math.max(-ROOM + 1, Math.min(ROOM - 1, player.position.z + (mz / len) * speed * dt));
    player.rotation.y = Math.atan2(mx, mz);
  }
  cam.target.copyFrom(player.position);

  if (enemyAlive) {
    const dir = player.position.subtract(enemy.position); dir.y = 0;
    const dist = dir.length();
    if (dist > 1.6) { dir.normalize(); enemy.position.x += dir.x * 3 * dt; enemy.position.z += dir.z * 3 * dt; }
    else {
      enemyAttackCd -= dt;
      if (enemyAttackCd <= 0) {
        enemyAttackCd = 1;
        const dmg = 8 + Math.floor(Math.random() * 6);
        playerHp = Math.max(0, playerHp - dmg);
        floatText(player.position, `-${dmg}`, '#ff6a6a');
        if (playerHp <= 0) log('Você morreu — recarregue a página');
      }
    }
    enemy.position.y = 1.2 + Math.sin(now * 0.004) * 0.1;
  }

  if (loot && Vector3.Distance(player.position, loot.position) < 1.4) {
    lootCount++;
    log(`Loot #${lootCount} (${LOOT_KINDS[lootCount % 6]}+)`);
    loot.dispose(); loot = null;
    setTimeout(respawnEnemy, 1500);
  }

  php.style.width = (playerHp / playerMax) * 100 + '%';
  ehp.style.width = (enemyAlive ? (enemyHp / enemyMax) * 100 : 0) + '%';
  if (atkCd > 0) atkCd -= dt;
});

function respawnEnemy() {
  enemyHp = enemyMax; enemyAlive = true; enemy.setEnabled(true);
  enemy.position.set((Math.random() - 0.5) * 10, 1.2, -6);
  log('Novo inimigo surgiu.');
}

engine.runRenderLoop(() => scene.render());
addEventListener('resize', () => engine.resize());
log('Babylon slice — WASD/mouse ou joystick+tap. Use ?chog=<id> pra cor do elemento.');
