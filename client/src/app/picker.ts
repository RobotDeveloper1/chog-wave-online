import './picker.css';
import { GENESIS_SUPPLY, describeBuild, type HolderCard, type HoldingsView } from '@chog/shared';
import { net } from '../net.ts';
import { wallet } from '../wallet.ts';

import { wordmark } from './brand.ts';
import * as THREE from 'three';
import { PARTS_MODEL, hullMaterial, loadChogNFT, type Chog } from './chogLoader.ts';
import { bodyUrl } from './portrait.ts';

/**
 * The gate in front of the world.
 *
 * Nothing here computes a Chog. Every card is the server's own `deriveBuild` output,
 * sent over `/api/auth/holdings` for the address the signature proved — so the grid
 * cannot show a build the world will not honour, and picking from it is a request,
 * not a claim. The server still re-checks ownership on the join and can answer `no`;
 * that answer comes back through `refuse()` and is printed here rather than hidden.
 *
 * The Foster Chog button is not a consolation prize. The collection floor is ~5,260
 * MON, so most people who open this page own nothing in it, and a game that only
 * plays for holders is a demo of a wallet, not a game.
 */

export interface Pick {
  /** The Chog to play, or null for a Foster. */
  tokenId: number | null;
  session: string | null;
  /** The picked token's raw traits, so the model can be mounted from the NFT. */
  attributes?: Record<string, string>;
}

const POLL_MS = 3000;
/** The same six hues the HUD uses; hud.css is not loaded yet when this opens. */
const ELEMENT_HEX: Record<string, string> = {
  burn: '#ff7a45',
  frost: '#7fd8ff',
  volt: '#ffe066',
  wave: '#43e2a8',
  prism: '#cbb2f2',
  void: '#a874ff',
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** A token id named in the URL. It is a request to preselect, never a way in. */
function wantedToken(): number | null {
  const n = Number(new URLSearchParams(location.search).get('chog'));
  return Number.isInteger(n) && n >= 1 && n <= GENESIS_SUPPLY ? n : null;
}

function since(ms: number): string {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return 'moved today';
  return `moved ${days}d ago`;
}

class Picker {
  private readonly root = h('div', 'chog-pick');
  private readonly markEl = h('div', 'pk-mark');
  private readonly chainEl = h('span', 'pk-chain');
  private readonly walletBtn = h('button', 'pk-wallet-act');
  private readonly lineEl = h('div', 'pk-line');
  private readonly gridEl = h('div', 'pk-grid');
  private readonly detailEl = h('div', 'pk-detail');
  private readonly enterBtn = h('button', 'pk-enter');
  private readonly connectBtn = h('button', 'pk-connect');

  private readonly kickerEl = h('span', 'pk-kicker');
  private resolve: ((p: Pick) => void) | null = null;
  private view: HoldingsView | null = null;
  private chosen: HolderCard | null = null;
  /** tokenId -> full-body 3D still, shot once per detected Chog. */
  private snaps = new Map<number, string>();
  private snapFailed = new Set<number>();
  private snapBusy = new Set<number>();
  /** Bumped on close so late mounts dispose instead of painting a dead gate. */
  private snapRun = 0;
  /** The detail panel's live viewport: one renderer for the whole gate. */
  private stage: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; chog: Chog; raf: number; tokenId: number } | null = null;
  private detailKey = '';
  /** `?chog=` for a token this wallet does not hold, tried only without a session. */
  private ghost: number | null = null;
  private note = '';
  /** Whether the line currently showing is something going wrong — it is printed in rose, not gold. */
  private bad = false;
  private poll: ReturnType<typeof setTimeout> | null = null;
  private offChange: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  open(refusal?: string): Promise<Pick> {
    this.note = refusal ?? '';
    this.bad = !!refusal;
    return new Promise<Pick>((resolve) => {
      this.resolve = resolve;
      this.build();
      document.body.appendChild(this.root);
      this.offChange = wallet.onChange(() => void this.sync());
      this.keyHandler = (e) => this.onKey(e);
      addEventListener('keydown', this.keyHandler);
      void this.sync();
    });
  }

  private build(): void {
    const brand = h('div', 'pk-brand');
    const logo = document.createElement('img');
    logo.src = '/brand/chog-wave-logo.png';
    logo.alt = 'Chog Wave logo';
    logo.className = 'pk-logo';
    const lockup = h('div', 'pk-lockup');
    lockup.append(logo, this.markEl);
    brand.append(
      lockup,
      h('span', 'pk-tag', 'online'),
      h('span', 'pk-supply', `chog testnet replicas · monad testnet`),
    );

    // Their mark, not a redrawn one: the official lockup, kept small and off to the side.
    const monad = h('div', 'pk-monad');
    const seal = document.createElement('img');
    seal.src = '/brand/monad-lockup.svg';
    seal.alt = 'Monad';
    monad.append(seal, h('i', ''), this.chainEl);

    const walletRow = h('div', 'pk-wallet');
    this.walletBtn.addEventListener('click', () => void this.connect());
    walletRow.append(monad, this.walletBtn);

    const top = h('header', 'pk-top');
    top.append(brand, walletRow);

    // ── auth: the pitch, and the door.
    const title = h('h1', 'pk-h1');
    title.append(document.createTextNode('Pick the '), h('em', '', 'Chog'), document.createTextNode(' you play as.'));
    const lede = h('p', 'pk-lede');
    lede.append(
      document.createTextNode('There are '),
      h('b', '', GENESIS_SUPPLY.toLocaleString()),
      document.createTextNode(' of them, and they live on Monad. Connect through Privy with the wallet that holds them — the world will not let you wear one you do not hold.'),
    );
    const steps = h('div', 'pk-steps');
    for (const [n, label, detail] of [['01', 'WALLET', 'connect via privy'], ['02', 'PICK', 'a testnet Chog'], ['03', 'PLAY', 'the street, live']] as const) {
      const step = h('div', n === '01' ? 'pk-step now' : 'pk-step');
      step.append(h('b', '', `${n} ${label}`), h('span', '', detail));
      steps.append(step);
    }
    const copy = h('section', 'pk-copy');
    // The collection's voice, up front: the gate sells the fantasy before the wallet does.
    const meme = h('p', 'pk-meme', 'Make Chog great again.');
    // Four real faces off the collection's own art: the 1969 are already on chain.
    const faces = h('div', 'pk-faces');
    for (const tokenId of [1, 7, 418, 1462]) {
      const face = document.createElement('img');
      face.src = `/art/${tokenId}.webp`;
      face.alt = `Chog #${tokenId}`;
      face.loading = 'lazy';
      face.onerror = () => face.remove();
      faces.append(face);
    }
    faces.append(h('span', '', 'the 1969 · already on chain'));
    copy.append(title, lede, meme, steps, faces);

    this.connectBtn.addEventListener('click', () => void this.connect());
    const fine = h('p', 'pk-fine');
    fine.append(
      document.createTextNode('Connect your own crypto wallet through Privy — '),
      h('b', '', 'the wallet that holds your Chogs'),
      document.createTextNode(' is the one you play as; holding none, foster in instead.'),
    );
    const act = h('div', 'pk-act');
    act.append(this.kickerEl, this.connectBtn, this.fosterButton(true), fine);

    const hero = h('section', 'pk-hero');
    hero.append(copy, act);

    // ── pick: the shelf, and the build the server will run.
    const shelf = h('div', 'pk-shelf');
    shelf.append(h('div', 'pk-micro', 'IN THIS WALLET'), this.gridEl);
    const main = h('section', 'pk-main');
    main.append(shelf, this.detailEl);

    const foot = h('footer', 'pk-foot');
    foot.append(this.fosterButton(false), this.enterBtn);
    this.enterBtn.addEventListener('click', () => this.confirm());

    this.root.append(top, this.lineEl, hero, main, foot);
  }

  /** The way in for somebody who owns none of this. Not a consolation prize — the floor prices most people out. */
  private fosterButton(detailed: boolean): HTMLElement {
    const btn = h('button', 'pk-foster');
    btn.append(document.createTextNode(detailed ? 'Walk in as a foster Chog' : 'enter as a foster chog'));
    if (detailed) btn.append(h('small', '', `you hold none of the ${GENESIS_SUPPLY.toLocaleString()} · a foster is given a token of its own`));
    btn.addEventListener('click', () => this.close({ tokenId: null, session: wallet.session }));
    return btn;
  }

  // ── state ─────────────────────────────────────────────────────────────────────

  /** Where the wallet stands decides what can be shown: nothing is invented while waiting. */
  private async sync(): Promise<void> {
    if (!wallet.session) {
      const back = await wallet.restore().catch(() => null);
      if (!back) {
        this.view = null;
        this.paint();
        return;
      }
    }
    await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.view = await wallet.holdings();
    } catch (error) {
      this.note = (error as Error).message;
      this.bad = true;
      this.view = null;
    }
    this.paint();
    // Mid-scan the index genuinely does not know who holds what yet, so an empty grid
    // is not an answer. Ask again until the server says it has read the chain.
    if (this.view && !this.view.ready) this.poll = setTimeout(() => void this.load(), POLL_MS);
  }

  private connect(): void {
    if (wallet.session) {
      wallet.signOut();
      this.view = null;
      this.chosen = null;
      this.note = 'signed out';
      this.bad = false;
      this.paint();
      return;
    }
    if (!wallet.available) {
      this.note = 'no privy app id — the login is not configured';
      this.bad = true;
      this.paint();
      return;
    }
    this.note = '';
    this.bad = false;
    this.paint();
    void wallet.loginWithModal().then(
      () => {
        this.note = '';
        void this.load();
      },
      (error: unknown) => {
        this.note = error instanceof Error ? error.message : 'that login did not work';
        this.bad = true;
        this.paint();
      },
    );
  }

  // ── painting ──────────────────────────────────────────────────────────────────

  private paint(): void {
    const view = this.view;
    const signed = !!wallet.session;
    this.root.dataset.phase = signed ? 'pick' : 'auth';

    // The ribbon under the name is the gate's lamp: rose for a refusal, gold while the
    // chain is still being read, mint once it has something to hand over.
    const ribbon = this.bad ? '#ff5d72' : view && !view.ready ? '#f5c343' : '#43e2a8';
    this.markEl.innerHTML = wordmark(['CHOG', 'WAVE'], { cell: signed ? 3 : 6, ribbon });

    this.chainEl.textContent = !wallet.address ? 'no session' : wallet.onMonad ? `chain ${wallet.chainId}` : 'off Monad';
    this.chainEl.classList.toggle('on', wallet.onMonad && !!wallet.address);
    this.chainEl.classList.toggle('bad', !!wallet.address && !wallet.onMonad);
    this.walletBtn.textContent = signed ? 'sign out' : wallet.available ? `connect ${wallet.label}` : 'no privy app id';
    this.walletBtn.disabled = !signed && !wallet.available;
    this.kickerEl.textContent = signed ? 'session live' : 'no session';

    this.connectBtn.textContent = '';
    this.connectBtn.disabled = !signed && !wallet.available;
    const cta = h('span', '');
    const cap = h('small', '');
    if (signed) cap.textContent = wallet.short;
    else if (!wallet.available) cap.textContent = 'missing VITE_PRIVY_APP_ID';
    else {
      // Their mark, not a redrawn one: the official Privy lockup, dark art for the mint button.
      const seal = document.createElement('img');
      seal.src = '/brand/privy-lockup-dark.png';
      seal.alt = 'Privy';
      cap.append(document.createTextNode('Protected by '), seal);
    }
    cta.append(
      document.createTextNode(signed ? 'You are signed in' : !wallet.available ? 'Login not configured' : 'Connect wallet'),
      cap,
    );
    this.connectBtn.append(cta, h('i', '', '›'));

    // A `?chog=` this wallet does hold, or a wallet holding exactly one Chog, has already
    // answered the question — the gate should not make somebody click it again.
    if (this.view) this.autoSelect(this.view);
    const ghost = this.ghostCandidate();

    this.lineEl.textContent = '';
    this.lineEl.classList.toggle('bad', this.bad && !!this.note);
    if (this.note) this.lineEl.append(h('span', this.bad ? 'pk-note bad' : 'pk-note', this.note));
    if (view && !view.ready) {
      const read = Math.max(view.coverage, view.history);
      const bar = h('i', 'pk-bar');
      const fill = h('b', '');
      fill.style.width = `${Math.min(100, (read / GENESIS_SUPPLY) * 100).toFixed(1)}%`;
      bar.append(fill);
      this.lineEl.append(h('span', 'pk-note', `reading the chain — ${read.toLocaleString()} of ${GENESIS_SUPPLY.toLocaleString()} owners known`), bar);
    }

    this.gridEl.textContent = '';
    if (!wallet.session) {
      this.gridEl.append(h('div', 'pk-empty', 'sign in to see the chogs this wallet holds, or walk in as a foster chog.'));
    } else if (!view) {
      this.gridEl.append(h('div', 'pk-empty', 'reading your holdings…'));
    } else if (!view.tokens.length) {
      this.gridEl.append(h('div', 'pk-empty', `this wallet holds none of the ${GENESIS_SUPPLY.toLocaleString()} genesis chogs.`));
    } else {
      for (const card of view.tokens) this.gridEl.append(this.card(card));
      void this.warmSnapshots(view.tokens);
    }
    // The unsigned `?chog=` candidate sits beside whatever else is on the shelf. It is a
    // request rather than a claim, so the server's answer is what settles it.
    this.ghost = ghost;
    if (ghost !== null) this.gridEl.append(this.ghostCard(ghost));

    this.enterBtn.disabled = this.chosen === null && ghost === null;
    this.enterBtn.textContent = this.chosen ? `play chog #${this.chosen.tokenId}` : ghost !== null ? `try chog #${ghost} anyway` : 'pick a chog';
    this.paintDetail();
  }

  /** `?chog=` preselects a card that exists; one Chog in the wallet needs no picking. */
  private autoSelect(view: HoldingsView): void {
    if (this.chosen) return;
    const wanted = wantedToken();
    const hit = wanted === null ? null : view.tokens.find((t) => t.tokenId === wanted);
    if (hit) this.chosen = hit;
    else if (view.tokens.length === 1) this.chosen = view.tokens[0]!;
  }

  /** `?chog=` for a token this wallet does not hold, tried only without a session. */
  private ghostCandidate(): number | null {
    const wanted = wantedToken();
    if (wanted === null || this.chosen) return null;
    if (this.view?.tokens.some((t) => t.tokenId === wanted)) return null;
    // Signed in and not held is a refusal the server is entitled to make; unsigned, it
    // is the recorder's lever (DEV_TOKENS) and only the server knows if it is up.
    return wallet.session ? null : wanted;
  }

  private card(card: HolderCard): HTMLElement {
    const node = h('button', 'pk-card');
    node.style.setProperty('--el', ELEMENT_HEX[card.element] ?? ELEMENT_HEX.prism!);
    if (card === this.chosen) node.classList.add('sel');

    const art = h('div', 'pk-art');
    art.dataset.artFor = String(card.tokenId);
    // The atlas is a 6x4 grid of 128px cells and idle is row 0, so the six frames are
    // the six horizontal positions — no canvas, no decoder, one request per card.
    // The token's own 3D model, shot off-screen; the sprite covers the load, the plate covers failure.
    const snap = this.snaps.get(card.tokenId);
    if (snap) {
      const img = h('div', 'pk-model');
      img.style.backgroundImage = `url(${snap})`;
      art.append(img);
    } else if (card.sprite) {
      const sprite = h('div', 'pk-sprite');
      sprite.style.backgroundImage = `url(${card.sprite})`;
      art.append(sprite);
    } else {
      art.append(h('span', 'pk-plate', `#${card.tokenId}`));
    }

    const meta = h('div', 'pk-meta');
    meta.append(h('span', 'pk-id', `chog #${card.tokenId}`), h('span', 'pk-name', card.callsign), h('span', 'pk-el', `${card.element}${card.tier ? ` · ${card.tier}` : ''}`));
    const prov = `${card.provenance.transferCount} crossed${card.provenance.daysHeld ? ` · held ${card.provenance.daysHeld}d` : ''}`;
    meta.append(h('span', 'pk-hist', `${prov}${card.lastSaleTs ? ` · ${since(card.lastSaleTs)}` : ''}`));

    node.append(art, meta);
    node.addEventListener('click', () => this.select(card));
    return node;
  }

  private ghostCard(tokenId: number): HTMLElement {
    const node = h('button', 'pk-card pk-ghost');
    const art = h('div', 'pk-art');
    const meta = h('div', 'pk-meta');
    art.append(h('span', 'pk-plate', `#${tokenId}`));
    meta.append(h('span', 'pk-id', `chog #${tokenId}`), h('span', 'pk-name', 'not in this wallet'), h('span', 'pk-el', 'unsigned · the server decides'));
    if (this.ghost === tokenId) node.classList.add('sel');
    node.append(art, meta);
    node.addEventListener('click', () => {
      this.chosen = null;
      this.ghost = tokenId;
      this.paint();
    });
    return node;
  }

  private paintDetail(): void {
    const card = this.chosen;
    // The readout is deterministic per choice; rebuilding it would remount the live viewport on every poll.
    const key = `${card?.tokenId ?? 'none'}|${this.ghost ?? 'none'}`;
    if (key === this.detailKey && this.detailEl.childElementCount) return;
    this.detailKey = key;
    this.teardownStage();
    this.detailEl.textContent = '';
    this.detailEl.append(h('div', 'pk-micro', 'THE BUILD THE WORLD WILL RUN'));
    if (!card) {
      this.detailEl.append(
        h(
          'p',
          'pk-dim',
          this.ghost !== null
            ? `Chog #${this.ghost} is not in this wallet. The join only goes through if the server is running unsigned demo tokens.`
            : 'Pick a chog to see the build the world will run.',
        ),
      );
      return;
    }
    const head = h('div', 'pk-dhead');
    head.style.setProperty('--el', ELEMENT_HEX[card.element] ?? ELEMENT_HEX.prism!);
    // The readout opens on the face you are about to wear, not on a table of numbers.
    const stage = h('div', 'pk-stage');
    head.append(stage);
    void this.mountStage(stage, card);
    head.append(h('b', '', `chog #${card.tokenId}`), h('span', '', card.callsign));
    this.detailEl.append(head);
    for (const line of describeBuild(card.build)) this.detailEl.append(h('p', 'pk-dline', line));
    this.detailEl.append(
      h('p', 'pk-dline', `traits ${card.traitsSource === 'real' ? 'read off the token metadata' : 'predicted from the token id'} · links ${card.linkSlots}x${card.linkSlots} · provenance ${card.provenance.transferCount} transfers, ${card.provenance.daysHeld}d held`),
    );
  }

  /** Shoot every detected Chog once, sequentially, painting each card as its still lands. */
  private async warmSnapshots(tokens: HolderCard[]): Promise<void> {
    const run = this.snapRun;
    for (const card of tokens.slice(0, 24)) {
      if (run !== this.snapRun) return;
      if (this.snaps.has(card.tokenId) || this.snapFailed.has(card.tokenId) || this.snapBusy.has(card.tokenId)) continue;
      this.snapBusy.add(card.tokenId);
      const url = await this.snapCard(card);
      this.snapBusy.delete(card.tokenId);
      if (run !== this.snapRun) return;
      if (url) {
        this.snaps.set(card.tokenId, url);
        this.refreshCardArt(card.tokenId, url);
      } else {
        this.snapFailed.add(card.tokenId);
      }
    }
  }

  /** Mount one token's model off-screen, shoot it, dispose it. Never throws. */
  private async snapCard(card: HolderCard): Promise<string | null> {
    let chog: Chog;
    try {
      chog = await loadChogNFT({ ...PARTS_MODEL, traits: card.attributes, tokenId: card.tokenId });
    } catch {
      return null;
    }
    let url: string | null = null;
    try {
      if (chog.clips.includes('idle')) {
        chog.play('idle');
        chog.update(0.35);
      }
      chog.root.updateMatrixWorld(true);
      url = bodyUrl(chog.root);
    } catch {
      url = null;
    }
    this.disposeChog(chog);
    return url;
  }

  private refreshCardArt(tokenId: number, url: string): void {
    const art = this.gridEl.querySelector(`[data-art-for="${tokenId}"]`);
    if (!art || art.querySelector('.pk-model')) return;
    art.textContent = '';
    const img = h('div', 'pk-model');
    img.style.backgroundImage = `url(${url})`;
    art.append(img);
  }

  /** The chosen Chog, live and turning. Falls back to its still, then its sprite. */
  private async mountStage(box: HTMLElement, card: HolderCard): Promise<void> {
    const run = this.snapRun;
    let chog: Chog;
    try {
      chog = await loadChogNFT({ ...PARTS_MODEL, traits: card.attributes, tokenId: card.tokenId });
    } catch {
      this.stageFallback(box, card);
      return;
    }
    if (run !== this.snapRun || !box.isConnected) {
      this.disposeChog(chog);
      return;
    }
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      this.disposeChog(chog);
      this.stageFallback(box, card);
      return;
    }
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.4, 1.8, 2.6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb0ff, 0.55);
    rim.position.set(-1.6, 0.6, -1.2);
    scene.add(rim);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 60);
    const root = chog.root;
    root.rotation.set(0, 0.55, 0);
    scene.add(root);
    const height = chog.height > 0 ? chog.height : 1.6;
    camera.position.set(0, height * 0.55, height * 2.6);
    camera.lookAt(0, height * 0.5, 0);
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    renderer.setSize(480, 480, false);
    box.append(renderer.domElement);
    if (chog.clips.includes('idle')) {
      try {
        chog.play('idle');
      } catch {
        /* a dead clip must not kill the gate */
      }
    }
    const spin = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = performance.now();
    const loop = (now: number): void => {
      if (!this.stage || this.stage.tokenId !== card.tokenId) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      try {
        if (spin) root.rotation.y += dt * 0.5;
        chog.update(dt);
      } catch {
        /* a dead frame must not kill the gate */
      }
      renderer.render(scene, camera);
      this.stage.raf = requestAnimationFrame(loop);
    };
    this.teardownStage();
    this.stage = { renderer, scene, camera, chog, raf: 0, tokenId: card.tokenId };
    this.stage.raf = requestAnimationFrame(loop);
  }

  private stageFallback(box: HTMLElement, card: HolderCard): void {
    const show = (url: string | null): void => {
      if (!box.isConnected) return;
      if (url) {
        const img = h('div', 'pk-model');
        img.style.backgroundImage = `url(${url})`;
        box.append(img);
      } else if (card.sprite) {
        const sprite = h('div', 'pk-sprite');
        sprite.style.backgroundImage = `url(${card.sprite})`;
        box.append(sprite);
      }
    };
    const snap = this.snaps.get(card.tokenId);
    if (snap || this.snapFailed.has(card.tokenId)) {
      show(snap ?? null);
      return;
    }
    void this.snapCard(card).then(show);
  }

  private teardownStage(): void {
    const st = this.stage;
    this.stage = null;
    if (!st) return;
    cancelAnimationFrame(st.raf);
    st.scene.remove(st.chog.root);
    this.disposeChog(st.chog);
    st.renderer.dispose();
    st.renderer.domElement.remove();
  }

  /** Drop a snapshot model's GPU copies. Cache sources re-upload on demand; the ink hull is module-shared and stays. */
  private disposeChog(chog: Chog): void {
    chog.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (m && m !== hullMaterial) m.dispose();
      }
    });
  }

  private select(card: HolderCard): void {
    this.chosen = card;
    this.ghost = null;
    this.paint();
  }

  private confirm(): void {
    const tokenId = this.chosen?.tokenId ?? this.ghost;
    if (tokenId === null) return;
    this.close({ tokenId, session: wallet.session, attributes: this.chosen?.attributes });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !this.enterBtn.disabled) this.confirm();
    const n = Number(e.key);
    const card = this.view?.tokens[n - 1];
    if (n >= 1 && n <= 9 && card) this.select(card);
  }

  private close(pick: Pick): void {
    this.snapRun++;
    this.teardownStage();
    const resolve = this.resolve;
    this.resolve = null;
    if (this.poll) clearTimeout(this.poll);
    this.offChange?.();
    if (this.keyHandler) removeEventListener('keydown', this.keyHandler);
    this.root.remove();
    resolve?.(pick);
  }
}

/**
 * Show the gate and wait for an answer.
 *
 * Resolves once: with a token id, or with null for a Foster Chog. The caller still
 * has to ask the world for that id — this is a choice, not an admission. A refusal
 * from that asking comes back as `refusal` the next time round, printed rather than
 * swallowed.
 */
export function pickChog(refusal?: string): Promise<Pick> {
  return new Picker().open(refusal);
}

/**
 * The gate, and the asking that follows it.
 *
 * Resolves only when the server has put this Chog in the world. A `no` comes back as the
 * server's own words printed on the gate, because the reason a join was refused — not
 * signed in, not held, no such token — exists nowhere else the player can look.
 */
export async function pickAndEnter(): Promise<Pick> {
  let refusal: string | undefined;
  for (;;) {
    const pick = await pickChog(refusal);
    const verdict = await net.enter(pick.tokenId, pick.session);
    if (verdict.ok) return pick;
    refusal = verdict.reason;
  }
}
