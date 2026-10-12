import * as THREE from 'three';
import { QUEST_BY_ID, SECTOR_NAME, anyChip, cityOf, DUNGEONS, gatesBetween, nextStep, npcOf, unlocksAt, type AreaRun, type ProfileView, type SectorId, type SectorState, type TalkView } from '@chog/shared';
import { sfx, toggleMute, unlock } from '../audio.ts';
import { net } from '../net.ts';
import { DISTRICTS } from './art.ts';
import { Duel, DUEL_CAM } from './duel/duel.ts';
import { loadChogNFT, type Chog, type PartsModel } from './chogLoader.ts';
import { CHOG_SCALE, Explorer, type Target } from './explorer.ts';
import { Hud } from './hud/hud.ts';
import { ICON } from './hud/icons.ts';
import { createTouchLayer, type TouchLayer } from './hud/touch.ts';
import { buildRoom, type RoomKind, type RoomLayout } from './interiors.ts';
import { buildDungeonField, type DungeonField, type DungeonNode } from './dungeon/field.ts';
import { moodFor } from './dungeon/themes.ts';
import { RemoteAvatars, WALK_SPEED, bindKeys, createPlayer, setVirtualInput, stepPlayer } from './player.ts';
import { bindFolder } from './deckPages.ts';
import { bindDungeons } from './dungeonPage.ts';
import { bindParty, social } from './partyPage.ts';
import { pickAndEnter } from './picker.ts';
import { Voice } from './voice.ts';
import { TABS, bindSheet, renderSheet, type AreaView, type SheetCtx, type Tab, type WarView } from './sheet.ts';
import { Stage } from './stage.ts';

/**
 * The clamshell.
 *
 * Exploring, the top screen is the whole window — a city, seen from above at a quarter
 * turn, with a HUD laid over it. Anything that is not walking (the bag, the shop, the quest
 * log, the Custom Screen of a fight) is the lower screen, which slides up under it when it
 * has something to show and goes away when it does not.
 *
 * This file is orchestration only. The district's geometry and people are `explorer.ts`,
 * the framing is `camera.ts`, the look is `render/`, the interface is `hud/`, and every
 * rule — who you can talk to, what a quest pays, whether a wave was really under your
 * feet — is the server's. What is left here is: which key does what, and in what order.
 */

const SECTORS: SectorId[] = ['ashflat', 'voltgrid', 'hollow'];
// One neutral body plus a small GLB per trait value: the player signs in with a
// wallet, and the model is THAT token's model -- mounted here from the traits
// the server read for it, not a shared mascot. `/models`, not `/chogs`: the
// latter is proxied to the sprite server on :8787.
const MODEL: PartsModel = {
  baseUrl: '/models/chog-base.glb',
  partsUrl: '/models/trait-parts.json',
  colorsUrl: '/models/trait-colors.json',
  skinsUrl: '/models/skins.json',
};
const ITEM_KEYS = ['med', 'repair', 'amp', 'ward'] as const;
const ROOM_KINDS = new Set(['shop', 'heal', 'brother', 'telemetry']);

export interface Shell {
  stage: Stage;
  hud: Hud;
  sector: SectorId;
  say(text: string, cls?: string): void;
}

export async function bootShell(): Promise<Shell> {
  const hud = new Hud();
  const stage = new Stage(hud.canvas);
  bindKeys();

  const debug = new URLSearchParams(location.search).has('debug');

  // Nothing walks the street until the server has said yes to a Chog. The picker is a
  // choice; the join is the admission, and the id the world honoured is the one the model
  // is painted from — a foster Chog must not arrive wearing Chog #1's face.
  const pick = await pickAndEnter();

  // there is one city; the dungeons are under it
  let sector: SectorId = 'ashflat';
  if (!SECTORS.includes(sector)) sector = 'ashflat';

  // ---------------------------------------------------------------- the world

  const explorer = new Explorer(stage, MODEL, () => {
    const s = net.sector(sector);
    return { wave: s?.wave ?? 0, tier: (s?.tier ?? 'normal') as 'normal' };
  });
  const remotes = new RemoteAvatars(
    stage.scene,
    async () => {
      const c = await loadChogNFT({ ...MODEL, traits: {}, tokenId: 900_000 + Math.floor(Math.random() * 99_999) });
      c.root.scale.setScalar(CHOG_SCALE);
      return c;
    },
    (x, z) => explorer.city?.groundY(x, z) ?? 0,
  );

  const say = (text: string, cls = ''): void => hud.log(text, cls);
  // THIS token's model: the picker's own reading when the picker handed one over,
  // otherwise the world's. A Foster is given traits of its own and the model has
  // to be built from those -- the server says what the world read, real or predicted.
  const traits = pick.attributes ?? net.me?.attributes ?? {};
  const chog: Chog = await loadChogNFT({ ...MODEL, traits, tokenId: net.me?.tokenId ?? 0 });
  chog.root.scale.setScalar(CHOG_SCALE);
  const first = explorer.enter(sector, null);
  const player = createPlayer(chog, first);
  stage.scene.add(chog.root);
  stage.snap();

  // A ring under your own feet, in your element's colour. In a city seen from this far, the
  // one question that matters is "which one is me?", and this answers it from any distance.
  const ring = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9a72ea, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const ringBand = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.28, 48), ringMat);
  ringBand.rotation.x = -Math.PI / 2;
  const ringFill = new THREE.Mesh(new THREE.CircleGeometry(1.05, 40), new THREE.MeshBasicMaterial({ color: 0x9a72ea, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false }));
  ringFill.rotation.x = -Math.PI / 2;
  ring.add(ringBand, ringFill);
  stage.scene.add(ring);
  const ELEMENT_RING: Record<string, number> = { burn: 0xff7a45, frost: 0x7fd8ff, volt: 0xffe066, wave: 0x43e2a8, prism: 0xcbb2f2, void: 0xa874ff };

  const shell: Shell = {
    stage,
    hud,
    get sector() {
      return sector;
    },
    say,
  };

  // ---------------------------------------------------------------- state

  let inside: { kind: RoomKind; label: string } | null = null;
  let room: RoomLayout | null = null;
  let roomTarget: { kind: 'board' | 'gate'; label: string; x: number; z: number; hint: string } | null = null;
  /** The dungeon we are standing in, if any. Its own scene, its own node graph. */
  let dungeon: DungeonField | null = null;
  let dungeonTarget: DungeonNode | null = null;
  let dungeonName = '';
  const streetPos = new THREE.Vector3();
  let duel: Duel | null = null;
  let busy = false;
  let viz = false;
  let tab: Tab = 'home';
  let war: WarView | null = null;
  let area: AreaView | null = null;
  let tracked: string | null = null;
  let talkingTo: string | null = null;
  let laser = 0;
  let target: Target | null = null;
  let interactAsked = false;
  let promptKey = '';
  let pendingEncounter: { name: string; band?: { lead: string; minions: string[] } } | null = null;
  let lastTrack = 0;
  let lastBanner = 0;
  let sendAt = 0;
  let stepAcc = 0;
  let last = performance.now();
  let now = last;
  let anomalyHere = false;

  const me = (): string => `CHOG #${net.me?.tokenId ?? 'foster'}`;

  // ---------------------------------------------------------------- the HUD

  const setIdentity = (): void => {
    if (!net.me) return;
    const col = ELEMENT_RING[net.me.build.loadout.element] ?? 0x9a72ea;
    ringMat.color.setHex(col);
    (ringFill.material as THREE.MeshBasicMaterial).color.setHex(col);
    hud.setIdentity({
      tokenId: net.me.tokenId,
      name: net.me.build.callsign,
      element: net.me.build.loadout.element,
      tribe: net.me.build.loadout.element,
      foster: net.me.tokenId >= 900_000,
    });
  };

  const applyProfile = (): void => {
    const p = net.profile;
    if (!p) return;
    const run = p.run;
    hud.setStats({
      level: p.level,
      into: p.into,
      need: p.need,
      wav: p.wav,
      hp: run && !run.done ? run.hp : p.unlocks.fieldHp,
      hpMax: run && !run.done ? run.maxHp : p.unlocks.fieldHp,
      laser,
    });
    hud.setItems(p.items, viz);
    // A server one version behind sends neither marks nor caught waves; the street still
    // has to render, it just has no quest givers lit up.
    explorer.setMarks(p.marks ?? {});
    explorer.setCaught(p.caught ?? []);
    if (!tracked || !p.quests.some((x) => x.id === tracked && !x.turnedIn)) {
      tracked = (p.quests.find((x) => x.main && !x.done) ?? p.quests.find((x) => !x.done) ?? p.quests[0])?.id ?? null;
    }
    refreshTracker();
  };

  /** A short "which way, how far" for a list of targets, from the player's position and the camera's yaw. */
  const whereTo = (t: { kind: 'npc' | 'poi' | 'door'; id: string }[], questSector?: string): string => {
    const here = player.pos;
    let best: { d: number; ang: number } | null = null;
    for (const k of t) {
      const at = explorer.positionOf(k.kind, k.id);
      if (!at) continue;
      const dx = at.x - here.x;
      const dz = at.z - here.z;
      const d = Math.hypot(dx, dz);
      if (!best || d < best.d) best = { d, ang: Math.atan2(dx, -dz) };
    }
    if (!best) return questSector && questSector !== sector ? questSector : '';
    // Relative to the camera: "up" on the screen is the camera's forward direction.
    const rel = best.ang - (Math.PI - stage.director.yaw);
    const k = Math.round((((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    return `${'↑↗→↘↓↙←↖'[k]} ${Math.round(best.d)}m`;
  };

  const where = (qv: ProfileView['quests'][number]): string => whereTo(qv.done ? [{ kind: 'npc' as const, id: qv.turnInId }] : (qv.track ?? []), qv.sector);

  /**
   * The live arrow for whatever the guide is pointing at, recomputed every
   * frame. `guide()`'s own string only refreshed on profile events -- a walk
   * across the map left it pointing at where the quest USED to be.
   */
  const currentArrow = (): string => {
    const p = net.profile;
    if (!p) return '';
    const order = p.quests
      .filter((z) => !z.turnedIn)
      .sort((a, b) => Number(b.id === tracked) - Number(a.id === tracked) || Number(b.done) - Number(a.done) || Number(b.main) - Number(a.main));
    const qv = order.find((z) => z.id === tracked);
    if (qv?.done) return whereTo([{ kind: 'npc', id: qv.turnInId }], qv.sector);
    if (qv?.track?.length) return whereTo(qv.track, qv.sector);
    const step = nextStep(p.mainDone ?? [], p.quests.filter((z) => z.main).map((z) => ({ id: z.id, done: z.done })), p.level);
    const def = step && QUEST_BY_ID.get(step.step.id);
    if (def) return whereTo([{ kind: 'npc', id: def.giver ?? '' }], def.sector);
    return '';
  };

  const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

  /** The guide: the next step of the main road in one line, and the beam toward whoever it is about. */
  const guide = (p: ProfileView): { point: { x: number; z: number } | null } => {
    const step = nextStep(p.mainDone ?? [], p.quests.filter((z) => z.main).map((z) => ({ id: z.id, done: z.done })), p.level);
    if (!step) {
      hud.setNext(null);
      return { point: null };
    }
    const def = QUEST_BY_ID.get(step.step.id);
    const live = p.quests.find((z) => z.id === step.step.id);
    const who = (id: string): string => npcOf(id)?.npc.name ?? id;
    let text: string;
    let target: { kind: 'npc'; id: string } | null = null;
    if (step.step.state === 'ready') {
      text = `hand it in to ${who(live?.turnInId ?? def?.turnIn ?? def?.giver ?? '')}`;
      target = { kind: 'npc', id: live?.turnInId ?? def?.turnIn ?? def?.giver ?? '' };
    } else if (step.step.state === 'active') {
      text = live?.doing || def?.doing || 'carry on';
      target = null;
    } else if (step.step.state === 'locked') {
      text = `reach level ${step.step.level} — the Sim, errands and dungeon runs all pay XP`;
      target = null;
    } else {
      text = `take it from ${who(def?.giver ?? '')}`;
      target = { kind: 'npc', id: def?.giver ?? '' };
    }
    const wh = live && step.step.state !== 'next' ? where(live) : target ? whereTo([target], def?.sector) : '';
    hud.setNext({ act: `ACT ${ROMAN[step.act.id] ?? step.act.id} · ${step.act.name}`, title: step.step.name, text, where: wh, state: step.step.state === 'ready' || step.step.state === 'active' ? step.step.state : 'next' });
    const at = target ? explorer.positionOf('npc', target.id) : null;
    return { point: at };
  };
  const refreshTracker = (): void => {
    const p = net.profile;
    if (!p) return;
    // The tracked quest first, then anything ready to hand in, then the main road.
    const order = p.quests
      .filter((z) => !z.turnedIn)
      .sort((a, b) => Number(b.id === tracked) - Number(a.id === tracked) || Number(b.done) - Number(a.done) || Number(b.main) - Number(a.main));
    // The quest *list* is the J tab's job; the HUD carries one objective (setNext) and the
    // beacons below. It used to do both, and the two disagreed about what was open.

    // Beacons over the tracked quest's targets, wherever in this district they are.
    const qv = order.find((z) => z.id === tracked);
    const points: { x: number; z: number }[] = [];
    if (qv) {
      const t = qv.done ? [{ kind: 'npc' as const, id: qv.turnInId }] : (qv.track ?? []);
      for (const k of t) {
        const at = explorer.positionOf(k.kind, k.id);
        if (at) points.push(at);
      }
    }
    // Nothing tracked points anywhere: the guide's own target gets the beam.
    const g = guide(p);
    if (!points.length && g.point) points.push(g.point);
    explorer.setBeacons(points);
  };

  const setTracked = (id: string): void => {
    tracked = id;
    refreshTracker();
    paint();
  };

  // ---------------------------------------------------------------- menu (the lower screen)

  const sheetCtx = (): SheetCtx => ({
    sector,
    sectors: net.sectors(),
    debug,
    tracked,
    area: explorer.areaName(player.pos.x, player.pos.z),
  });

  let paintedTab: Tab | null = null;

  /** The lower screen's header: the player on the home page, and a way back on any other. */
  const header = (): string => {
    if (tab === 'home') {
      const p = net.profile;
      const name = (net.me?.build.callsign ?? '').replace(/[<>&"]/g, '');
      return `<span class="me"><span class="lv">LV ${p?.level ?? 1}</span><small>${name}</small><span class="wav">${(p?.wav ?? 0).toLocaleString()} WAV</span></span><button data-t="close" title="close the menu"><span class="key">Tab</span> CLOSE</button>`;
    }
    const def = TABS.find((t) => t.id === tab);
    return `<button data-t="home" title="back to the menu"><span class="key">Esc</span> MENU</button><span class="title">${def ? ICON[def.icon] : ''}${def?.label ?? ''}</span><button data-t="prev" title="previous page"><span class="key">Z</span><i class="pg">‹</i></button><button data-t="next" title="next page"><span class="key">X</span><i class="pg">›</i></button><button data-t="close" title="close the menu">✕</button>`;
  };

  const paint = (): void => {
    if (duel || !hud.menuOpen) return;
    hud.tabsEl.innerHTML = header();
    hud.tabsEl.querySelectorAll<HTMLElement>('[data-t]').forEach((b) =>
      b.addEventListener('click', () => {
        const t = b.dataset.t!;
        if (t === 'close') closeMenu();
        else if (t === 'prev') turnPage(-1);
        else if (t === 'next') turnPage(1);
        else openTab(t);
      }),
    );
    hud.sheetEl.classList.add('on');
    // a repaint of the same page keeps where the lists were scrolled to
    const scrolls = tab === paintedTab ? [hud.sheetEl.scrollTop, ...[...hud.sheetEl.querySelectorAll<HTMLElement>('.fd-list, .lib-list, .dg-list')].map((e) => e.scrollTop)] : [];
    paintedTab = tab;
    hud.sheetEl.innerHTML = renderSheet(tab, net.profile, war, area, sheetCtx());
    if (scrolls.length) {
      hud.sheetEl.scrollTop = scrolls[0] ?? 0;
      hud.sheetEl.querySelectorAll<HTMLElement>('.fd-list, .lib-list, .dg-list').forEach((e, i) => (e.scrollTop = scrolls[i + 1] ?? 0));
    }
    if (tab === 'folder' && net.profile) {
      bindFolder(hud.sheetEl, net.profile, {
        save: (cards) => net.loop('folder.save', { cards }),
        auto: () => net.loop('folder.auto'),
        reset: () => net.loop('folder.reset'),
        repaint: paint,
      });
    }
    hud.sheetEl.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.addEventListener('click', () => openTab(b.dataset.t!)));
    if (tab === 'dungeons') bindDungeons(hud.sheetEl, paint);
    if (tab === 'party') {
      bindParty(hud.sheetEl, {
        invite: (id) => net.send('party', { action: 'invite', with: id }),
        accept: () => partyAct('accept'),
        decline: () => partyAct('decline'),
        leave: () => net.send('party', { action: 'leave' }),
        kick: (id) => net.send('party', { action: 'kick', with: id }),
        voiceToggle: () => {
          if (voice.enabled) voice.disable();
          else void voice.enable().then(() => voice.setMembers((social.party?.members ?? []).map((x) => x.id)));
        },
        ptt: (on) => voice.setPushToTalk(on),
        mute: (on) => voice.setMuted(on),
        whisper: (tokenId) => {
          closeMenu();
          hud.chatOpen(true);
          const input = hud.hud.querySelector<HTMLInputElement>('#hud-log input');
          if (input) input.value = `/w #${tokenId} `;
        },
      });
    }
    bindSheet(hud.sheetEl, {
      buy: (kind, stockId) => net.loop('buy', { kind, stockId }),
      sell: (chipId) => net.loop('sell', { stockId: chipId }),
      use: (id) => net.loop('use', { itemId: id }),
      track: setTracked,
      openDungeon: (id) => net.loop('area.open', { dungeonId: id }),
      stepArea: (nodeId) => net.loop('area.step', { nodeId }),
      closeArea: () => {
        net.loop('area.close');
        area = null;
        leaveDungeon();
        paint();
      },
    });
    drawWorldMap();
  };

  const drawWorldMap = (): void => {
    if (tab !== 'map' || !hud.menuOpen) return;
    const cv = hud.sheetEl.querySelector<HTMLCanvasElement>('canvas.wm');
    if (!cv) return;
    hud.minimap.drawWorld(cv, player.pos.x, player.pos.z, markers());
  };

  const openTab = (t: string): void => {
    sfx.ui();
    tab = (t === 'home' || TABS.some((x2) => x2.id === t) ? t : 'home') as Tab;
    if (tab === 'war') net.loop('war');
    if (tab === 'dungeons') net.loop('area.state');
    if (tab === 'shop' || tab === 'jobs' || tab === 'album' || tab === 'bag' || tab === 'folder' || tab === 'library' || tab === 'career') net.loop('profile');
    if (tab === 'party') social.notice = '';
    hud.menu(true);
    paint();
  };

  const closeMenu = (): void => {
    if (!hud.menuOpen) return;
    sfx.ui();
    hud.menu(false);
  };

  /** Tab opens the menu on its first page and closes it again. */
  const toggleMenu = (): void => (hud.menuOpen ? closeMenu() : openTab('home'));

  /** A page's own key: opens it from the street, closes the menu if it is already showing. */
  const showTab = (t: Tab): void => (hud.menuOpen && tab === t ? closeMenu() : openTab(t));

  /** The shoulder buttons: the page before or after this one. */
  const turnPage = (d: number): void => {
    const ids: Tab[] = ['home', ...TABS.map((x2) => x2.id)];
    const i = Math.max(0, ids.indexOf(tab));
    openTab(ids[(i + d + ids.length) % ids.length]!);
  };

  // ---------------------------------------------------------------- the Visualizer

  const toggleViz = (): void => {
    viz = !viz;
    sfx.visualizer(viz);
    hud.setViz(viz);
    explorer.setViz(viz);
    hud.setItems(net.profile?.items ?? {}, viz);
    say(viz ? 'visualizer on — the wave layer is showing' : 'visualizer off', 't-glitch');
    if (viz) hud.toast({ icon: 'eye', title: 'VISUALIZER', sub: 'Mystery Waves and hidden people are showing', colour: 'var(--cyan)' });
  };

  // ---------------------------------------------------------------- talking and playing together

  const voice = new Voice(
    (to, kind, data) => net.send('rtc', { to, kind, data }),
    () => net.me?.id ?? null,
  );
  social.voice = voice;

  let lastWhisperFrom: string | null = null;

  const HELP = [
    'chat: type to the whole city · /p text — your party · /w #143 text — whisper (a token number, or the full name in quotes) · /r text — reply',
    'party: /invite #143 · /accept · /decline · /leave · /party opens the page · hold T to talk once voice is on',
  ];

  /** Turn what the player typed into a message: a bare line is the city's, a slash picks the channel. */
  const sendChat = (raw: string): void => {
    const text = raw.trim();
    if (!text) return;
    if (!text.startsWith('/')) return net.send('chat', { channel: 'global', text });
    const [cmd = '', ...rest] = text.slice(1).split(/\s+/);
    const body = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case 'p':
      case 'party':
        if (!body) return openTab('party');
        return net.send('chat', { channel: 'party', text: body });
      case 'g':
      case 'say':
        return net.send('chat', { channel: 'global', text: body });
      case 'w':
      case 'whisper':
      case 'msg': {
        const quoted = body.match(/^"([^"]+)"\s+(.+)$/);
        const plain = body.match(/^(\S+)\s+(.+)$/);
        const m = quoted ?? plain;
        if (!m) return say('whisper to whom? /w #143 hello', 'sys');
        return net.send('chat', { channel: 'whisper', to: m[1], text: m[2] });
      }
      case 'r':
      case 'reply':
        if (!lastWhisperFrom) return say('nobody has whispered to you yet', 'sys');
        return net.send('chat', { channel: 'whisper', to: lastWhisperFrom, text: body });
      case 'invite':
      case 'inv': {
        const want = body.replace(/^#/, '').toLowerCase();
        const hit = social.nearby.find((p) => String(p.tokenId) === want || (p.name ?? '').toLowerCase() === want);
        if (!hit) return say(want ? `nobody on the street matches ${body}` : '/invite #143', 'sys');
        return net.send('party', { action: 'invite', with: hit.id });
      }
      case 'accept':
        return net.send('party', { action: 'accept' });
      case 'decline':
        return net.send('party', { action: 'decline' });
      case 'leave':
        return net.send('party', { action: 'leave' });
      case 'help':
      case '?':
        return HELP.forEach((l) => say(l, 'sys'));
      default:
        say(`unknown command /${cmd} — try /help`, 'sys');
    }
  };

  /** The invitation popup's buttons. */
  const partyAct = (action: string): void => {
    if (action === 'accept' || action === 'decline') {
      social.invite = null;
      hud.setInvite(null);
      net.send('party', { action });
    }
  };

  const refreshParty = (): void => {
    const p = social.party;
    const members = p?.members ?? [];
    hud.setParty(members, social.me, p?.leader ?? '', voice.speaking());
    if (hud.menuOpen && tab === 'party') paint();
  };
  voice.onChange(refreshParty);

  net.on('party', (m) => {
    social.me = net.me?.id ?? null;
    social.party = m;
    const members = (m.members ?? []) as { id: string }[];
    if (m.invite) {
      social.invite = { ...m.invite, at: performance.now() };
      sfx.accept();
      hud.setInvite(m.invite);
      say(`${m.invite.name} invited you to a party — Y to accept, N to decline`, 't-anomaly');
    } else if (members.length > 1 && social.invite) {
      social.invite = null;
      hud.setInvite(null);
    }
    if (m.notice) {
      social.notice = String(m.notice);
      say(String(m.notice), 't-glitch');
    }
    if (m.refused) {
      social.notice = String(m.refused);
      hud.toast({ icon: 'chat', title: 'PARTY', sub: String(m.refused), colour: 'var(--rose)' });
    }
    voice.setMembers(members.map((x) => x.id));
    if (members.length < 2 && voice.enabled) voice.disable();
    refreshParty();
  });

  net.on('rtc', (m) => {
    void voice.onSignal(String(m.from), String(m.kind), m.data);
  });

  net.on('disconnect', () => voice.disable());
  addEventListener('beforeunload', () => voice.dispose());

  // push to talk works everywhere, in a fight as much as on the street, unless a text box has the keys
  const typing = (e: KeyboardEvent): boolean => (e.target as HTMLElement | null)?.tagName === 'INPUT';
  addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 't' && !e.repeat && !typing(e) && voice.enabled) voice.setKey(true);
  }, { capture: true });
  addEventListener('keyup', (e) => {
    if (e.key.toLowerCase() === 't') voice.setKey(false);
  }, { capture: true });

  // ---------------------------------------------------------------- the welcome

  let welcomed = false;

  /** The first minute: who you are, what the game is, how to move, and the one thing to do next. */
  const openWelcome = (): void => {
    const b = net.me?.build;
    const name = b?.callsign ?? 'Chog';
    hud.openDialogue({
      name: 'WAVE LINK',
      role: 'system',
      tribe: b?.loadout.element ?? 'prism',
      pages: [
        `Link established. Welcome to the Index, ${name}. You are a Chog — a signal that walks. The traits on your token are not decoration: they are your deck, your speed and your weakness.`,
        'Under this city runs the Wave, and the real market moves it. When it runs hot an anomaly opens over a district, and you fight it Star Force style: slide off the red rows, build a program from your cards on the Custom Screen, and hit what you cover.',
        'Beneath the Foldgate Yard are six dungeons, one for each element. Each opens at a level and only once the one before it is beaten; their bosses are the road, and the city is where you get ready for them.',
        'W A S D to walk · Q and R turn the camera · the wheel zooms · E talks to people and opens doors · Tab opens the menu · Enter is chat (/p talks to your party) · P is your party. The beam of light always points at what to do next.',
        'Your first step is a contract on the Quest Board in the middle of this plaza — the marker with the "!" over it. Walk to it and press E. The Operator at the Wave Station will take it from there.',
      ],
      options: [{ id: 'welcome:go', label: "Let's go", primary: true }],
    });
  };

  // ---------------------------------------------------------------- level up

  let lastLevel = 0;
  let pendingLevelUp: { level: number; unlocks: string[]; next: string | null } | null = null;

  const showLevelUp = (): void => {
    if (!pendingLevelUp || duel || hud.dialogueOpen) return;
    hud.levelUp(pendingLevelUp);
    pendingLevelUp = null;
  };

  // ---------------------------------------------------------------- conversations

  const talk = (npcId: string): void => {
    talkingTo = npcId;
    net.loop('npc.talk', { npcId });
  };

  const openTalk = (t: TalkView): void => {
    sfx.talk();
    hud.menu(false);
    talkingTo = t.npc.id;
    hud.openDialogue({ name: t.npc.name, role: t.npc.role, tribe: t.npc.tribe, pages: t.pages, options: t.options, ...(t.rewards ? { rewards: t.rewards } : {}) });
  };

  const closeDialogue = (): void => {
    hud.closeDialogue();
    talkingTo = null;
  };

  hud.bind({
    useItem: (id) => net.loop('use', { itemId: id }),
    openTab: (t) => openTab(t),
    toggleViz,
    chat: (text) => sendChat(text),
    party: (action) => partyAct(action),
    closeDialogue,
    option: (id) => {
      const npc = talkingTo;
      // The Wave Station's terminal offers two fights; neither is a quest, so neither is an NPC option.
      if (id === 'duel:anomaly' || id === 'duel:train') {
        closeDialogue();
        startDuel(id === 'duel:train' ? 'train' : 'anomaly');
        return;
      }
      if (id === 'welcome:go') {
        closeDialogue();
        net.loop('flag.set', { flag: 'welcome' });
        return;
      }
      if (id === 'encounter:solo' || id === 'encounter:party') {
        closeDialogue();
        pendingEncounter = null;
        net.loop('area.engage');
        return;
      }
      if (id === 'close' || !npc) return closeDialogue();
      if (id === 'shop') {
        closeDialogue();
        openTab('shop');
      } else if (id.startsWith('accept:')) net.loop('quest.accept', { questId: id.slice(7), npcId: npc });
      else if (id.startsWith('turnin:')) net.loop('quest.turnin', { questId: id.slice(7), npcId: npc });
      else closeDialogue();
    },
  });

  // ---------------------------------------------------------------- rooms and doors

  /** Fade out, run `fn` in the dark, fade back in. Input is held while it runs. */
  const transition = (fn: () => void): void => {
    if (busy) return;
    busy = true;
    hud.fade(true);
    setTimeout(() => {
      fn();
      hud.fade(false);
      setTimeout(() => (busy = false), 160);
    }, 230);
  };

  const enterRoom = (kind: RoomKind, label: string): void => {
    if (inside) return;
    sfx.door();
    net.move({ place: 'room' });
    net.loop('door.enter', { door: kind });
    transition(() => {
      room = buildRoom(kind, DISTRICTS[sector], label);
      streetPos.copy(player.pos);
      inside = { kind, label };
      explorer.setVisible(false);
      remotes.visible(false);
      stage.scene.add(room.group);
      player.pos.set(room.spawn.x, 0, room.spawn.z);
      stage.setBounds(null);
      stage.setRig('indoor', true);
      stage.focusOn(0, 1.3, -0.4);
      stage.snap();
      hud.setWhere(explorer.layout.name, label);
      hud.setPrompt(null);
      say(`inside ${label.toLowerCase()}`, 't-glitch');
      if (kind === 'shop' || kind === 'heal' || kind === 'telemetry') net.loop('profile');
      if (kind === 'dungeon') net.loop('area.state');
    });
  };

  const exitRoom = (): void => {
    if (!inside || !room) return;
    sfx.door();
    net.move({ place: 'street' });
    transition(() => {
      stage.scene.remove(room!.group);
      room!.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry?.dispose();
      });
      room = null;
      inside = null;
      explorer.setVisible(true);
      remotes.visible(true);
      player.pos.copy(streetPos);
      stage.setBounds(explorer.walk.bounds);
      stage.setRig('street', true);
      stage.snap();
      hud.setWhere(explorer.layout.name, explorer.areaName(player.pos.x, player.pos.z));
    });
  };

  /**
   * Walk into a Data Area. The run the server opened becomes a *place*: its own
   * floor, rock, air and props, and one lit platform per node of the same graph
   * the lower screen draws. Same contract as a room, so the movement code
   * already knows how to walk it.
   */
  const enterDungeon = (a: AreaView): void => {
    if (!a.area || !a.run || dungeon) return;
    const def = a.area.dungeonId ? DUNGEONS.find((d) => d.id === a.area!.dungeonId) : undefined;
    const element = def?.element ?? 'void';
    transition(() => {
      dungeonName = a.area!.name;
      dungeon = buildDungeonField(a.area!, a.run!, element);
      streetPos.copy(player.pos);
      explorer.setVisible(false);
      remotes.visible(false);
      stage.scene.add(dungeon.group);
      stage.setDungeonMood(moodFor(element));
      player.pos.set(dungeon.spawn.x, 0, dungeon.spawn.z);
      stage.setBounds(null);
      // The street rig frames a whole district; a dungeon wants the indoor lens,
      // close enough that the rock reads as walls and the chog as the subject.
      stage.setRig('dungeon', true);
      stage.setZoom(1.0);
      stage.snap();
      hud.setWhere(dungeonName, 'data area');
      hud.setPrompt(null);
      say(`the fold opens: ${dungeonName} — ${moodFor(element).air}`, 't-anomaly');
      hud.zoneBanner(dungeonName, def?.tagline ?? 'a data area');
    });
  };

  const leaveDungeon = (): void => {
    if (!dungeon) return;
    transition(() => {
      stage.scene.remove(dungeon!.group);
      dungeon!.dispose();
      dungeon = null;
      dungeonTarget = null;
      explorer.setVisible(true);
      remotes.visible(true);
      player.pos.copy(streetPos);
      stage.setDistrict(DISTRICTS[sector], sector);
      stage.setBounds(explorer.walk.bounds);
      stage.setRig('street', true);
      stage.snap();
      say(`out of ${dungeonName}`, 't-glitch');
    });
  };

  /** Re-lay the platforms after the run moved: which node is here, which are open. */
  const refreshDungeon = (): void => {
    if (!dungeon || !area?.area || !area.run) return;
    const el = area.area.dungeonId ? DUNGEONS.find((d) => d.id === area!.area!.dungeonId)?.element ?? 'void' : 'void';
    const keep = player.pos.clone();
    stage.scene.remove(dungeon.group);
    dungeon.dispose();
    dungeon = buildDungeonField(area.area, area.run, el);
    stage.scene.add(dungeon.group);
    player.pos.copy(keep);
    stage.snap();
  };

  /** What the counter in each room does, from the player's side. */
  const useCounter = (): void => {
    switch (inside?.kind) {
      case 'shop':
        openTab('shop');
        say('counter open — the shelf turns over in six hours', 't-glitch');
        break;
      case 'heal': {
        const res = net.profile && (net.profile.items.med ?? 0) > 0 ? 'med' : 'repair';
        net.loop('use', { itemId: res });
        say(`patched up with a ${res}`, 't-glitch');
        break;
      }
      case 'brother':
        openTab('war');
        say('the war table shows this week’s standing', 't-glitch');
        break;
      case 'telemetry':
        openTab('album');
        say('the album wall lights up what you have logged', 't-glitch');
        break;
      case 'dungeon':
        openTab('dungeons');
        say('the fold ring is primed — pick a dungeon on the lower screen', 't-anomaly');
        break;
      default:
        say('nothing to do here', 't-glitch');
    }
  };

  const cityTagline = (): string => 'brick, dusk and the smell of the bakery on Baker Row';

  // ---------------------------------------------------------------- fights

  /**
   * The Wave Station's terminal. It is where a fight begins: the anomaly the market opened
   * (when there is one), or the Training Sim, which is always there and is where the first
   * fight is meant to happen — nobody should have to wait for a sale to learn the Custom Screen.
   */
  const openStation = (): void => {
    const s = net.sector(sector);
    const boss = s?.boss;
    const trained = (net.profile?.stats.trains ?? 0) > 0;
    const pages = boss
      ? [
          `WAVE STATION · ${SECTOR_NAME[sector]} — a ${(boss.archetype ?? boss.tier).toUpperCase()} is open over the city. ${(boss.hp / 1000).toFixed(0)}k HP and falling while the street fights it.`,
          trained ? 'Pulse in whenever you are ready — or warm up in the sim first.' : 'First time? Run the Training Sim before you pulse into a real one.',
        ]
      : [
          `WAVE STATION · ${SECTOR_NAME[sector]} — the wave is quiet. Nothing real to pulse into until the market moves. The dungeons are always open.`,
          trained ? 'The sim is always open if you want the practice.' : 'The Training Sim is open. It is where a new Chog learns to fight.',
        ];
    const options = [
      ...(boss ? [{ id: 'duel:anomaly', label: 'Pulse into the anomaly', primary: trained }] : []),
      { id: 'duel:train', label: 'Training Sim', primary: !trained || !boss },
      { id: 'close', label: 'Not now' },
    ];
    talkingTo = 'station';
    sfx.talk();
    hud.openDialogue({ name: 'WAVE STATION', role: 'terminal', tribe: 'wave', pages, options });
  };

  const openEncounterPrompt = (enemy: { name: string; band?: { lead: string; minions: string[] } }): void => {
    pendingEncounter = enemy;
    const band = enemy.band;
    const minionText = band && band.minions.length
      ? `They brought backup: ${band.minions.join(', ')}.`
      : '';
    const pages = [
      `FOLD ENCOUNTER · ${enemy.name}${band ? ` — ${band.lead}` : ''}`,
      minionText || 'The room is hostile. Step in when you are ready.',
    ];
    const party = social.party;
    const hasParty = (party?.members ?? []).length > 1;
    const options: { id: string; label: string; primary?: boolean }[] = [
      { id: 'encounter:solo', label: 'Enter alone', primary: true },
    ];
    if (hasParty) {
      options.unshift({ id: 'encounter:party', label: 'Enter with party', primary: false });
    }
    options.push({ id: 'close', label: 'Step back' });
    talkingTo = 'encounter';
    sfx.talk();
    hud.openDialogue({ name: 'THE FOLD', role: 'system', tribe: 'void', pages, options });
  };

  const startDuel = (mode: 'anomaly' | 'train' | 'node'): void => {
    if (duel) return;
    closeDialogue();
    duel = new Duel(
      {
        stage,
        hud,
        chog,
        sector,
        art: DISTRICTS[sector],
        enter: () => {
          explorer.setVisible(false);
          remotes.visible(false);
          ring.visible = false;
          chog.root.visible = true;
        },
        onClose: () => {
          duel = null;
          explorer.setVisible(true);
          remotes.visible(true);
          ring.visible = true;
          hud.menu(false);
          stage.setBounds(explorer.walk.bounds);
          stage.setRig('street', true);
          player.pos.copy(player.pos);
          stage.snap();
          net.loop('profile');
          paint();
          setTimeout(showLevelUp, 400);
          // a dungeon fight ends on the dungeon's map: the next step is right there, not a menu away
          if (mode === 'node') {
            net.loop('area.state');
            const back = (): void => {
              if (duel || hud.dialogueOpen) return;
              if (hud.levelUpOpen) setTimeout(back, 250);
              else openTab('dungeons');
            };
            setTimeout(back, 520);
          }
        },
        toast: (t) => hud.toast({ icon: 'sparkle', ...t }),
        say: (text, cls) => say(text, cls),
      },
      mode,
    );
    duel.start();
  };

  // ---------------------------------------------------------------- interaction

  const interact = (t: Target): void => {
    switch (t.kind) {
      case 'npc':
      case 'board':
        talk(t.id);
        break;
      case 'door':
        if (t.sub === 'station') openStation();
        else if (ROOM_KINDS.has(t.sub)) enterRoom(t.sub as RoomKind, t.label);
        break;
      case 'fold':
        enterRoom('dungeon', t.label);
        break;
      case 'wave':
        net.loop('wave.collect', { waveId: t.id });
        break;
    }
  };

  const hintFor = (t: Target): string => {
    if (t.kind === 'npc' || t.kind === 'board') {
      return t.mark === 'turnin' ? 'talk · report in' : t.mark === 'offer' ? 'talk · quest available' : t.mark === 'progress' ? 'talk · errand in progress' : t.hint;
    }
    if (t.kind === 'door' && t.sub === 'station') return anomalyHere ? 'PULSE IN · or run the training sim' : 'training sim · the wave is quiet';
    return t.hint;
  };

  const markers = () =>
    explorer.markers({
      anomaly: anomalyHere,
      tracked: (() => {
        const qv = net.profile?.quests.find((z) => z.id === tracked);
        return qv ? (qv.done ? [{ kind: 'npc' as const, id: qv.turnInId }] : (qv.track ?? [])) : [];
      })(),
      remotes: remotes.positions(),
    });

  // ---------------------------------------------------------------- input

  // Browsers refuse audio until a gesture; the first key or click is the gesture.
  const wake = (): void => unlock();
  addEventListener('keydown', wake, { once: true });
  addEventListener('pointerdown', wake, { once: true });

  addEventListener('keydown', (e) => {
    if (duel) return;
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (hud.levelUpOpen) {
      if (k === 'enter' || k === ' ' || k === 'escape' || k === 'e') hud.dismissLevelUp();
      e.preventDefault();
      return;
    }
    if (hud.dialogueOpen) {
      // E is the advance key, and the only one besides Enter. Space used to do it too, which
      // taught players that E — the key the box itself advertises — was not the advance key.
      if (k === 'e' || k === 'enter') hud.advance();
      else if (k >= '1' && k <= '9') hud.pickOption(Number(k) - 1);
      else if (k === 'escape') closeDialogue();
      e.preventDefault();
      return;
    }
    if (e.repeat) return;
    switch (k) {
      case 'enter':
        hud.chatOpen(true);
        e.preventDefault();
        break;
      case 'e':
      case ' ':
        interactAsked = true;
        break;
      case 'q':
        stage.director.rotate(-1);
        break;
      case 'r':
        stage.director.rotate(1);
        break;
      case 'v':
        toggleViz();
        break;
      case 'm':
        showTab('map');
        break;
      case 'j':
        showTab('jobs');
        break;
      case 'b':
        showTab('bag');
        break;
      case 'f':
        showTab('folder');
        break;
      case 'g':
        // Not 'd': D is the strafe key, so a dungeon shortcut bound to it fired every time the
        // player walked right. G reads as the Fold Gate, and it is not under a walking finger.
        showTab('dungeons');
        break;
      case 'p':
        showTab('party');
        break;
      case 'y':
        if (social.invite) partyAct('accept');
        break;
      case 'n':
        // One case, not two: a second `case 'n'` further down the switch was unreachable, so
        // the mute toggle it carried had never actually fired.
        if (social.invite) partyAct('decline');
        else hud.toast({ icon: 'sparkle', title: toggleMute() ? 'SOUND OFF' : 'SOUND ON', colour: 'var(--dim)' });
        break;
      case 'c':
        showTab('career');
        break;
      case 'tab':
        toggleMenu();
        e.preventDefault();
        break;
      case 'z':
        if (hud.menuOpen) turnPage(-1);
        break;
      case 'x':
        if (hud.menuOpen) turnPage(1);
        break;
      case 'escape':
        if (hud.menuOpen) {
          if (tab === 'home') closeMenu();
          else openTab('home');
        }
        break;
      case '+':
      case '=':
        stage.setZoom(stage.zoom * 0.88);
        break;
      case '-':
        stage.setZoom(stage.zoom / 0.88);
        break;
      default: {
        const n = Number(k);
        if (n >= 1 && n <= 4) net.loop('use', { itemId: ITEM_KEYS[n - 1]! });
      }
    }
  });

  // Scroll over the top screen only: the lower screen is a scrolling menu, and stealing
  // its wheel would make the bag unreadable.
  hud.top.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      stage.setZoom(stage.zoom * Math.exp(e.deltaY * 0.0013));
    },
    { passive: false },
  );

  // ---------------------------------------------------------------- the network

  // The gate's join already waited out the first `welcome`, so this runs for the switches
  // after it — and the tail of the boot calls it once by hand, which is what puts the
  // player's own build lines in the log.
  const onWelcome = (): void => {
    setIdentity();
    document.title = `CHOG WAVE — ${net.me?.build.callsign ?? ''}`;
    say(`build: ${net.me?.build.loadout?.why?.slice(0, 2).join(' · ') ?? ''}`, 't-glitch');
    say(net.me?.traitsSource === 'real' ? 'traits: on-chain metadata' : 'traits: predicted from token id', 't-anomaly');
    hud.setWhere(explorer.layout.name, explorer.areaName(player.pos.x, player.pos.z));
  };

  net.on('welcome', onWelcome);

  net.on('profile', () => {
    applyProfile();
    const pr = net.profile;
    if (pr) {
      if (lastLevel && pr.level > lastLevel) {
        sfx.level();
        pendingLevelUp = { level: pr.level, unlocks: gatesBetween(lastLevel, pr.level), next: unlocksAt(pr.level).next };
        showLevelUp();
      }
      lastLevel = pr.level;
      if (!welcomed && Array.isArray(pr.flags) && !pr.flags.includes('welcome') && !duel && !hud.dialogueOpen && explorer.layout) {
        welcomed = true;
        openWelcome();
      }
    }
    if (hud.menuOpen && !duel) paint();
  });

  net.on('world', (m) => {
    const sectors = (m.sectors ?? []) as SectorState[];
    hud.setWaves(sectors, sector);
    hud.setTicker(m.market ?? net.world?.market ?? []);
    const boss = sectors.find((s) => s.sector === sector)?.boss;
    if (!!boss !== anomalyHere) {
      anomalyHere = !!boss;
      if (anomalyHere) stage.shake(0.45, 0.7);
    }
    social.me = net.me?.id ?? null;
    social.nearby = ((m.players ?? []) as { id: string; tokenId: number; name?: string; level?: number; tribe?: string }[])
      .filter((p) => p.id !== net.me?.id)
      .map((p) => ({ ...p })) as typeof social.nearby;
    void remotes.sync(
      ((m.players ?? []) as { id: string; x: number; y: number; facing: number; heading?: number; anim: string }[])
        .filter((p) => p.id !== net.me?.id)
        .map((p) => ({ id: p.id, x: p.x, y: p.y, facing: p.facing, ...(p.heading !== undefined ? { heading: p.heading } : {}), anim: p.anim })),
    );
  });

  net.on('chat', (m) => {
    if (m.id === 'system' || m.channel === 'system') {
      say(m.text, 'sys');
      return;
    }
    const mine = m.id === net.me?.id;
    if (m.channel === 'whisper' && !mine) lastWhisperFrom = String(m.id);
    hud.chatLine({ name: m.name, text: m.text, channel: m.channel === 'sector' || m.channel === 'local' ? 'global' : m.channel, tribe: m.tribe, to: m.to, mine });
    hud.bubble(m.id, m.text, m.channel);
    if (!mine && (m.channel === 'whisper' || m.channel === 'party')) sfx.ui();
  });

  net.on('found', (m) => {
    sfx.discover();
    hud.toast({ icon: 'pin', title: `DISCOVERED · ${String(m.name).toUpperCase()}`, sub: `+${m.xp} XP`, colour: 'var(--prism)' });
    say(String(m.text), 't-glitch');
  });

  net.on('hit', (m) => {
    // The laser meter rides on every reply to a legacy `fire`; the duel reads its own messages.
    if (typeof m.charge === 'number') {
      laser = m.charge;
      applyProfile();
    }
  });

  // A fight the server started for us — stepping into a fold node — opens the duel by itself.
  net.on('duel', (m) => {
    if (!duel && m.kind === 'start') startDuel('node');
  });

  net.on('loop', (m) => {
    switch (m.action) {
      case 'npc.talk':
        if (!m.ok) {
          hud.toast({ icon: 'chat', title: 'NO ANSWER', sub: String(m.reason ?? ''), colour: 'var(--dim)' });
        } else openTalk(m.talk as TalkView);
        break;
      case 'quest.accept':
        if (m.ok) {
          sfx.accept();
          hud.toast({ icon: 'scroll', title: 'QUEST ACCEPTED', sub: String(m.name), colour: 'var(--gold)' });
          say(`quest accepted: ${m.name}`, 't-anomaly');
          closeDialogue();
        } else say(String(m.reason ?? 'refused'), 't-storm');
        break;
      case 'quest.turnin':
        if (m.ok) {
          sfx.quest();
          hud.toast({ icon: 'check', title: 'QUEST COMPLETE', sub: `${m.name} · +${m.wav} WAV · +${m.xp} XP`, colour: 'var(--wave)', big: true });
          closeDialogue();
        } else say(String(m.reason ?? 'refused'), 't-storm');
        break;
      case 'wave.collect':
        if (m.ok) {
          sfx.wave();
          hud.toast({ icon: 'sparkle', title: m.match ? 'RESONANCE' : 'WAVE CAUGHT', sub: `+${m.wav} WAV${m.match ? ' · tuned to your element' : ''}`, colour: 'var(--cyan)' });
        } else if (m.reason) say(String(m.reason), 't-glitch');
        break;
      case 'war':
        if (m.ok) war = (m as { war?: WarView }).war ?? null;
        break;
      case 'area.state':
        if (m.ok) {
          area = { area: m.area ?? null, run: m.run ?? null, dungeons: m.dungeons ?? [], level: m.level ?? 1 };
          // A run that was already open when we walked in (a reload, a rejoin)
          // still has to put us in the place it is about.
          if (area.area && area.run && !area.run.done && !area.run.failed) enterDungeon(area);
          else if (dungeon) leaveDungeon();
        }
        break;
      case 'area.open':
        if (m.ok) {
          area = { area: m.area ?? null, run: m.run ?? null, dungeons: area?.dungeons ?? [], level: area?.level ?? 1 };
          if (area.area && area.run) enterDungeon(area);
        } else if (m.reason) {
          sfx.deny();
          hud.toast({ icon: 'gate', title: 'THE DOOR STAYS SHUT', sub: String(m.reason), colour: 'var(--rose)' });
        }
        break;
      case 'area.step':
        if (!m.ok) say(`the fold refuses: ${m.reason}`, 't-storm');
        else {
          if (m.run) area = { ...area, run: m.run as AreaRun } as AreaView;
          const r = (m.run ?? area?.run) as AreaRun | null;
          if (r && (r.done || r.failed)) {
            // The core is down (or the run died): the fold closes and the city
            // is where you are standing again.
            leaveDungeon();
          } else {
            // The run moved: re-lay the platforms so the lit node is the one we are on.
            refreshDungeon();
          }
          // A fight node now returns enemy info and waits for the player to engage.
          if (m.fights && m.enemy) {
            openEncounterPrompt(m.enemy as { name: string; band?: { lead: string; minions: string[] } });
          }
          // A chest resolves on the step, so it pays on the step rather than waiting by the door.
          // A card you already hold is sold on the spot, and that is worth saying before the purse
          // moves — otherwise the WAV line looks like the tile rolled generous.
          const g = m.grant as
            | { xp: number; wav: number; chips: string[]; refunded: { name: string; wav: number }[] }
            | undefined;
          if (g) {
            sfx.wave();
            const found = g.chips.length
              ? g.chips.length === 1
                ? `NEW CARD · ${anyChip(g.chips[0]!)?.name ?? g.chips[0]}`
                : `${g.chips.length} NEW CARDS`
              : '';
            const dup = g.refunded[0];
            hud.toast({
              icon: 'pack',
              title: found ? 'CARD FOUND' : 'THE FOLD PAYS',
              sub: [found, `+${g.wav} WAV`, g.xp ? `+${g.xp} XP` : '', dup ? `HELD ${dup.name} — SOLD +${dup.wav}` : '']
                .filter(Boolean)
                .join(' · '),
              colour: 'var(--gold)',
            });
          }
        }
        break;
      default:
        if (m.ok && (m.action === 'buy' || m.action === 'sell')) say(`${m.action === 'buy' ? 'bought' : 'sold'}${m.wav ? ` · ${m.wav} WAV` : ''}`, 't-glitch');
        else if (!m.ok && m.reason) say(String(m.reason), 't-storm');
    }
    if (m.ok && (m.action === 'buy' || m.action === 'sell' || m.action === 'use')) net.loop('profile');
    if (hud.menuOpen && !duel) paint();
  });

  // the fold has three things to say: a party member was taken in, refused, or the core is closed
  net.on('dungeon', (m) => {
    if (m.kind === 'entered') {
      sfx.wave();
      hud.toast({ icon: 'gate', title: `INSIDE ${String(m.name)}`, sub: `${String(m.host)} opened the fold — same map, your own route`, colour: 'var(--cyan)' });
      net.loop('area.state');
      return;
    }
    if (m.kind === 'refused') {
      sfx.deny();
      hud.toast({ icon: 'gate', title: 'THE DOOR STAYS SHUT', sub: String(m.reason), colour: 'var(--rose)' });
      return;
    }
    if (m.kind !== 'cleared') return;
    sfx.cleared();
    hud.toast({ icon: 'skull', title: m.first ? `DUNGEON CLEARED · ${String(m.name)}` : `${String(m.name)} CLOSED`, sub: m.first ? `title earned: ${String(m.title)} · +${m.xp} XP · +${m.wav} WAV` : 'the core is closed again', colour: 'var(--gold)', big: !!m.first });
    if (m.first) say(`${String(m.name)} cleared for the first time — title: ${String(m.title)}`, 't-anomaly');
    net.loop('profile');
    net.loop('area.state');
  });

  net.on('signal', (m) => {
    const s = m.signal;
    if (s.type === 'anomaly' || s.type === 'spawn') {
      say(`${s.boss.archetype ?? s.boss.tier.toUpperCase()} over the city — ${(s.boss.hp / 1000).toFixed(0)}k HP`, `t-${s.boss.tier}`);
      hud.toast({ icon: 'skull', title: `${String(s.boss.archetype ?? s.boss.tier).toUpperCase()} · RIFT`, sub: `${(s.boss.hp / 1000).toFixed(0)}k HP anomaly`, colour: 'var(--rose)' });
    } else if (s.type === 'cleared') say('the rift is deleted', 't-glitch');
    else if (s.type === 'ravaged') say('the city was ravaged', 't-storm');
    else if (s.type === 'reward') say(`loot → #${s.tokenId}: ${s.chips.join(', ') || 'nothing'}`, 't-anomaly');
  });

  // ---------------------------------------------------------------- the frame

  const resize = (): void => stage.resizeTo(hud.top);
  new ResizeObserver(resize).observe(hud.top);
  resize();

  hud.minimap.setCity(explorer.layout, DISTRICTS[sector]);
  hud.zoneBanner(explorer.layout.name, explorer.areaName(player.pos.x, player.pos.z), cityTagline());
  onWelcome();
  say('link established');
  // A run left open by a reload has to be walked back into, not ignored.
  net.loop('area.state');
  paint();

  // ---------------------------------------------------------------- the fingers

  /*
   * Touch is a second pair of hands on the same verbs, not a different game. The stick pushes
   * the same screen-relative direction a key does, a sweep turns the lens the one quarter step
   * Q and R already take, and nothing new is invented — except that the act control is now
   * large enough for a thumb and the keyboard hints have no business being on screen.
   */
  const asked = new URLSearchParams(location.search).get('touch');
  const touchOn = asked !== null ? asked !== '0' : matchMedia('(pointer: coarse)').matches;
  let touch: TouchLayer | null = null;
  if (touchOn) {
    hud.deck.classList.add('touch');
    touch = createTouchLayer(hud.top, hud.hud, {
      act: () => {
        interactAsked = true;
      },
      menu: toggleMenu,
      map: () => showTab('map'),
      viz: toggleViz,
      turn: (d) => stage.director.rotate(d),
      zoom: (f) => stage.setZoom(stage.zoom * f),
    });
  }

  const step = (dt: number): void => {
    touch?.setActive(!duel && !hud.levelUpOpen && !hud.dialogueOpen && !busy);
    if (duel) {
      duel.update(dt, performance.now());
      return;
    }
    const lock = busy || hud.dialogueOpen || hud.chatting;
    const walk = dungeon
      ? { solids: dungeon.solids, bounds: dungeon.bounds }
      : inside && room
        ? { solids: room.solids, bounds: room.bounds }
        : explorer.walk;
    stepPlayer(player, dt, walk, lock, inside || dungeon ? 0 : stage.director.yaw);

    // Footsteps, soft, on the beat of the stride.
    if (player.moving) {
      stepAcc += dt;
      if (stepAcc > (player.running ? 0.21 : 0.34)) {
        stepAcc = 0;
        sfx.step();
      }
    }
    ring.visible = !inside && !dungeon;
    ring.position.set(player.pos.x, player.pos.y + 0.09, player.pos.z);
    ring.scale.setScalar(1 + 0.06 * Math.sin(now / 260));

    // What is in reach, and the prompt for it.
    if (dungeon) {
      dungeon.update(now / 1000);
      // A room is entered by standing in it: the plate is the room's floor.
      const room = dungeon.roomAt(player.pos.x, player.pos.z);
      dungeonTarget = room && !room.cleared && room.reachable ? room : null;
      target = null;
      roomTarget = null;
    } else if (inside && room) {
      roomTarget = null;
      for (const it of room.interactables) {
        if (Math.hypot(player.pos.x - it.x, player.pos.z - it.z) < 3.4) {
          roomTarget = it;
          break;
        }
      }
      target = null;
    } else {
      target = explorer.nearest(player.pos.x, player.pos.z);
      roomTarget = null;
    }
    const key = dungeonTarget
      ? `dg:${dungeonTarget.id}`
      : target
        ? `${target.id}:${target.mark ?? ''}:${anomalyHere}`
        : roomTarget
          ? `room:${roomTarget.kind}`
          : '';
    if (key !== promptKey && !hud.dialogueOpen) {
      promptKey = key;
      if (dungeonTarget) hud.setPrompt({ key: 'E', title: dungeonTarget.label, sub: dungeonTarget.kind === 'boss' ? 'the core — this is the fight' : 'step into this room', icon: 'gate', colour: 'var(--violet)' });
      else if (target) hud.setPrompt({ key: 'E', title: target.label, sub: hintFor(target), icon: target.icon, colour: target.colour });
      else if (roomTarget) hud.setPrompt({ key: 'E', title: roomTarget.label, sub: roomTarget.hint, icon: roomTarget.kind === 'gate' ? 'gate' : 'chat' });
      else hud.setPrompt(null);
    }
    if (hud.dialogueOpen) hud.setPrompt(null);
    touch?.setReach((!!target || !!roomTarget || !!dungeonTarget) && !lock);
    if (interactAsked && !lock) {
      if (dungeonTarget) net.loop('area.step', { nodeId: dungeonTarget.id });
      else if (target) interact(target);
      else if (roomTarget) (roomTarget.kind === 'gate' ? exitRoom : useCounter)();
    }
    interactAsked = false;

    // The server proposes nothing: it takes our position, clamps it, and checks the speed.
    // Inside a Data Area nobody else can see you, so nothing is reported -- and the
    // city's bounds would clamp a dungeon walk back to the street anyway.
    if (!dungeon && (player.moving || player.since > 0.01) && now - sendAt > 90) {
      sendAt = now;
      player.since = 0;
      net.move({
        x: player.pos.x,
        y: player.pos.z,
        vx: player.running ? 12.5 : player.moving ? WALK_SPEED : 0,
        facing: Math.sin(player.facing) >= 0 ? 1 : -1,
        heading: player.facing,
        anim: player.moving ? 'walk' : 'idle',
        hp: 100,
        place: inside ? 'room' : 'street',
      });
    }

    if (!inside) {
      explorer.update(dt, player.pos.x, player.pos.z, stage.director.focusPoint());
      stage.follow(player.pos.x, player.pos.z, player.facing, player.moving, dt);
      remotes.update(dt);
      const a = explorer.areaChanged(player.pos.x, player.pos.z);
      if (a) {
        hud.setWhere(explorer.layout.name, a);
        // Name the neighbourhood when you walk into it, but not twice in one breath, and
        // never for the open road, which is the space between neighbourhoods.
        if (a !== 'Streets' && now - lastBanner > 5000) {
          hud.zoneBanner(a.toUpperCase(), explorer.layout.name);
          lastBanner = now;
        }
      }
      if (now - lastTrack > 300) {
        lastTrack = now;
        refreshTracker();
        if (hud.menuOpen && tab === 'map') drawWorldMap();
      }
      hud.frame(player.pos.x, player.pos.z, stage.director.yaw, player.facing, markers(), now / 1000);
    }
    placeBubbles();
    if (social.invite && performance.now() - social.invite.at > 45_000) {
      social.invite = null;
      hud.setInvite(null);
    }
  };

  const projected = new THREE.Vector3();
  /** Where a head is on the screen, for the speech bubbles. */
  const placeBubbles = (): void => {
    const w = hud.top.clientWidth;
    const h = hud.top.clientHeight;
    const remote = new Map(remotes.positions().map((p) => [p.id, p]));
    hud.placeBubbles((id) => {
      const at = id === net.me?.id ? { x: player.pos.x, z: player.pos.z } : remote.get(id);
      if (!at || duel || inside) return null;
      projected.set(at.x, 2.9, at.z).project(stage.camera);
      return { x: (projected.x * 0.5 + 0.5) * w, y: (-projected.y * 0.5 + 0.5) * h, vis: projected.z < 1 };
    });
  };

  let arrowClock = 0;
  const frame = (t: number): void => {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    now = t;
    step(dt);
    // The GPS arrow is the one thing that must not wait for a profile event:
    // it is the player asking "which way, how far" every step they take.
    arrowClock += dt;
    if (arrowClock > 0.15 && !duel && !hud.dialogueOpen && !inside && !hud.menuOpen) {
      arrowClock = 0;
      const txt = currentArrow();
      if (txt) hud.setArrow(txt);
    }
    stage.render(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- debug hooks

  const g = window as unknown as Record<string, unknown>;
  g.__chog = shell;
  g.__pos = () => ({ x: +player.pos.x.toFixed(2), z: +player.pos.z.toFixed(2), moving: player.moving ? 1 : 0, sector, area: explorer.areaName(player.pos.x, player.pos.z) });
  g.__tp = (px: number, pz: number) => {
    const from = player.pos.clone();
    player.pos.set(px, 0, pz);
    stage.snap();
    // The server only hears positions the player *walks*, and walks a jump at run speed, so
    // a debug teleport reports itself as a run of short hops it will accept.
    const n = Math.max(1, Math.ceil(from.distanceTo(player.pos) / 3));
    for (let i = 1; i <= n; i++) {
      setTimeout(() => net.move({ x: from.x + ((px - from.x) * i) / n, y: from.z + ((pz - from.z) * i) / n, vx: 0, heading: player.facing, anim: 'idle', place: 'street' }), i * 110);
    }
    return `at ${px},${pz} (${n} hops)`;
  };
  g.__drive = (tx: number, tz: number, seconds: number) => {
    const dt = 1 / 30;
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      const dx = tx - player.pos.x;
      const dz = tz - player.pos.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.35) break;
      setVirtualInput(dx / len, dz / len, len > 6);
      step(dt);
    }
    setVirtualInput(0, 0);
    return 'done';
  };
  g.__cam = (p?: Parameters<Stage['tuneCamera']>[0]) => {
    if (p) stage.tuneCamera(p);
    return stage.director.describe();
  };
  g.__zoom = (v?: number) => (v === undefined ? stage.zoom : stage.setZoom(v));
  g.__debug = () => stage.debug();
  g.__town = () => ({ sector, name: explorer.layout.name, areas: explorer.layout.areas.map((a) => a.name), anchors: explorer.layout.anchors.length, solids: explorer.layout.solids.length, tris: explorer.city?.triangles, buildMs: explorer.city?.buildMs, extent: cityOf(sector).extent });
  g.__anchors = () => explorer.layout.anchors.map((a) => ({ id: a.id, kind: a.kind, x: +a.x.toFixed(1), z: +a.z.toFixed(1), sub: a.sub, area: a.area }));
  g.__key = (k: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: k }));
    return k;
  };
  g.__state = () => ({ inside: inside?.kind ?? null, busy, duel: !!duel, dialogue: hud.dialogueOpen, chatting: hud.chatting, target: target?.id ?? null, roomTarget: roomTarget?.kind ?? null, sector });
  g.__traffic = () => explorer.life?.debugCars() ?? null;
  g.__viz = toggleViz;
  g.__menu = (t?: string) => {
    if (t) openTab(t);
    else toggleMenu();
    return hud.menuOpen;
  };
  g.__duel = (mode: 'anomaly' | 'train' = 'train') => {
    startDuel(mode);
    return `duel ${mode} requested`;
  };
  g.__dungeon = () => (dungeon ? { name: dungeonName, nodes: dungeon.nodes, solids: dungeon.solids.length, spawn: dungeon.spawn, pos: { x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1) } } : null);
  g.__stuck = () => {
    if (!dungeon) return 'no dungeon';
    const hits = dungeon.solids.filter((s) =>
      Math.abs(player.pos.x - s.x) < s.halfW + 0.45 && Math.abs(player.pos.z - s.z) < s.halfD + 0.45);
    return {
      pos: { x: +player.pos.x.toFixed(1), z: +player.pos.z.toFixed(1) },
      hits: hits.length,
      near: hits.slice(0, 3),
      bounds: dungeon.bounds,
      nodes: dungeon.nodes.map((n) => ({ id: n.id, kind: n.kind, x: n.x, z: n.z })),
      areaNodes: (area?.area?.nodes ?? []).map((n) => ({ id: n.id, row: n.row, col: n.col, links: n.links })),
    };
  };
  g.__enterDungeon = () => {
    if (!area?.area || !area.run) return 'no run open';
    enterDungeon(area);
    return 'enter requested';
  };
  g.__busy = () => busy;
  g.__duelcam = DUEL_CAM;
  g.__voice = voice;
  g.__social = social;
  g.__duelobj = () => duel;
  g.__me = me;
  g.__net = net;
  return shell;
}
