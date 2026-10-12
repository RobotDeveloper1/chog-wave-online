import {
  SF,
  applyDamage,
  partyHpScale,
  partyRewardScale,
  type Boss,
  type Element,
  type ScaleKind,
  type SectorId,
  type SectorSignal,
  type SectorState,
} from '@chog/shared';

export interface SessionMember {
  id: string;
  name?: string;
  tribe?: Element;
  wallet?: string | null;
}

export interface DuelBossSpec {
  name: string;
  hp: number;
  maxHp: number;
  element: Element;
  archetype?: string;
  power?: number;
  node?: boolean;
  nodeId?: string;
  dungeonId?: string;
  areaId?: string;
  partyHp?: ScaleKind;
  training?: boolean;
  tier?: SF.DuelTier;
  level?: number;
  difficulty?: number;
  /** Capture the actual anomaly, not whichever boss occupies this sector next. */
  source?: Boss;
}

export interface JoinSpec {
  stats: SF.DuelStats;
  tokenId: number;
  aggro: number;
  resist: Element | null;
  folder: string[];
  level: number;
  /** Run integrity, when this is a dungeon field rather than a fresh fight. */
  hp?: number;
  maxHp?: number;
}

export interface SessionEvent {
  type: 'field';
  session: string;
  sector: SectorId;
  events: SF.FieldEvent[];
  bossHp: number;
  players: { id: string; hp: number; chain: number; col: number; down: boolean }[];
  bossCol: number;
  bossRow: number;
  phase: number;
}

export interface SessionStep {
  events: SF.FieldEvent[];
  cleared: boolean;
  downed: string[];
  expired: string[];
  gone: boolean;
  signals: SectorSignal[];
}

/** MMO identity, persistence and sector mirroring; all combat belongs to SF. */
export class BattleSession {
  readonly id: string;
  readonly sector: SectorId;
  readonly spec: DuelBossSpec;
  readonly state: SF.DuelSession;
  readonly nodeFight: boolean;
  readonly training: boolean;
  readonly bossTier: 'glitch' | 'anomaly' | 'storm';
  readonly duelTier: SF.DuelTier;
  readonly archetype: SF.Archetype;
  readonly difficulty: number;
  readonly bossIdentity: string | null;
  readonly cause: NonNullable<Boss['cause']>;
  private mirroredHp: number;
  private readonly baseHp: number | null;
  private archived = new Map<string, { hp: number; maxHp: number; outcome: SF.BodyOutcome; seconds: number }>();
  private landed = new Map<string, { damage: number; best: number }>();
  private waveApplied = 0;

  constructor(id: string, sector: SectorId, boss: DuelBossSpec, rand: () => number = Math.random) {
    this.id = id;
    this.sector = sector;
    this.spec = { ...boss };
    this.nodeFight = !!boss.node;
    this.training = !!boss.training;
    this.duelTier = boss.tier ?? (this.training ? 'train' : this.nodeFight ? 'node' : 'glitch');
    this.bossTier = this.duelTier === 'anomaly' || this.duelTier === 'storm' ? this.duelTier : 'glitch';
    this.archetype = SF.archetypeOf(boss.archetype ?? (this.training ? 'dummy' : undefined));
    this.difficulty = Math.max(1, Math.min(6, Math.round(boss.difficulty ?? 1)));
    this.bossIdentity = boss.source ? `${boss.source.id}:${boss.source.spawnedAt}` : null;
    this.cause = (boss.source?.cause ?? []).map((c) => ({ ...c }));
    this.baseHp = boss.partyHp ? Math.max(1, boss.maxHp) : null;
    this.state = SF.openSession({
      id,
      place: {
        kind: this.training ? 'train' : this.nodeFight ? 'dungeon' : 'sector',
        sector,
        ...(boss.dungeonId ? { dungeonId: boss.dungeonId } : {}),
        ...(boss.nodeId ? { roomId: boss.nodeId } : {}),
      },
      boss: {
        name: boss.name,
        archetype: this.archetype,
        hp: boss.hp,
        element: boss.element,
        level: boss.level ?? 2,
        power: boss.power,
        tier: this.duelTier,
        difficulty: this.difficulty,
        training: this.training,
        node: this.nodeFight,
      },
      rand,
    });
    this.field.boss.maxHp = Math.max(this.field.boss.hp, boss.maxHp);
    this.mirroredHp = this.field.boss.hp;
  }

  get field(): SF.WaveField { return this.state.field; }
  get size(): number { return this.state.players.length; }
  get alive(): number { return this.state.players.filter((b) => !b.down).length; }
  get empty(): boolean { return this.size === 0; }
  get hpScale(): number { return this.baseHp === null ? 1 : partyHpScale(this.size, this.spec.partyHp ?? 'node'); }
  get partyScale(): { bodies: number; owners: number; hp: number; loot: number } {
    const bodies = this.size;
    const owners = new Set(this.state.players.map((b) => b.owner)).size;
    return { bodies, owners, hp: this.hpScale, loot: this.nodeFight ? partyRewardScale(bodies, owners) : 1 };
  }

  bodyOf(id: string): SF.DuelBody | null { return this.state.players.find((b) => b.id === id) ?? null; }
  has(id: string): boolean { return this.bodyOf(id) !== null; }

  join(p: SessionMember, spec: JoinSpec): void {
    if (this.has(p.id) || this.state.over || this.archived.has(p.id)) return;
    const body = SF.addBody(this.state, {
      id: p.id,
      owner: p.wallet ?? `unverified:${p.id}`,
      name: p.name ?? p.id,
      tribe: p.tribe ?? 'prism',
      stats: { ...spec.stats },
      tokenId: spec.tokenId,
      aggro: spec.aggro,
      ...(spec.resist ? { resist: spec.resist } : {}),
      folder: spec.folder,
      level: spec.level,
    });
    if (spec.maxHp !== undefined) body.maxHp = Math.max(1, spec.maxHp);
    if (spec.hp !== undefined) body.hp = Math.max(0, Math.min(body.maxHp, spec.hp));
    this.setStats(p.id, spec.stats);
    this.retargetHp();
  }

  /** Changing a party or level changes capacity, never restores integrity. */
  setStats(id: string, stats: SF.DuelStats): void {
    const b = this.bodyOf(id);
    if (!b) return;
    const fraction = b.gauge / Math.max(1, b.gaugeMs);
    b.stats = { ...stats };
    b.maxHp = stats.hp;
    b.hp = Math.min(b.hp, b.maxHp);
    b.gaugeMs = Math.round(SF.gaugeMsFor({ gauge: stats.gauge, training: this.training }) * SF.gaugeScale(stats.gaugePct));
    b.gauge = Math.min(b.gaugeMs, Math.round(fraction * b.gaugeMs));
    SF.widen(this.field, stats.cols);
  }

  private retargetHp(): void {
    if (this.baseHp === null || this.state.over) return;
    const boss = this.field.boss;
    const next = Math.max(1, Math.round(this.baseHp * this.hpScale));
    // Preserve damage already done when the dungeon re-prices a larger/smaller pull.
    const previous = boss.hp;
    boss.hp = Math.max(1, next - (boss.maxHp - boss.hp));
    boss.maxHp = next;
    this.mirroredHp += boss.hp - previous;
  }

  heal(id: string, amount: number): number {
    const b = this.bodyOf(id);
    if (!b || b.down || !Number.isFinite(amount) || amount <= 0) return 0;
    const before = b.hp;
    b.hp = Math.min(b.maxHp, b.hp + amount);
    return b.hp - before;
  }

  hpOf(id: string): { hp: number; maxHp: number } | null {
    const b = this.bodyOf(id) ?? this.archived.get(id);
    return b ? { hp: b.hp, maxHp: b.maxHp } : null;
  }

  private archive(body: SF.DuelBody, lost = false): void {
    const result = SF.outcome({ ...this.state, players: [body], ...(lost ? { result: 'loss' as const } : {}) });
    const outcome = result.bodies[0]!;
    this.archived.set(body.id, { hp: body.hp, maxHp: body.maxHp, outcome, seconds: result.seconds });
  }

  leave(id: string): void {
    const body = this.bodyOf(id);
    if (!body) return;
    this.archive(body);
    SF.removeBody(this.state, id);
    this.field.shots = this.field.shots.filter((shot) => shot.owner !== id);
    for (const b of this.state.players) if (b.hold?.target === id) b.hold = null;
    this.retargetHp();
  }

  outcomeOf(id: string): SF.BodyOutcome | null {
    return SF.outcome(this.state).bodies.find((b) => b.id === id) ?? this.archived.get(id)?.outcome ?? null;
  }

  secondsOf(id: string): number { return this.archived.get(id)?.seconds ?? SF.outcome(this.state).seconds; }
  damageOf(id: string): number { return this.landed.get(id)?.damage ?? 0; }
  bestOf(id: string): number { return this.landed.get(id)?.best ?? 0; }
  occupiedCols(): Map<string, number> {
    return new Map(this.state.players.filter((b) => !b.down).map((b) => [b.id, b.file]));
  }

  matchesBoss(boss: Boss | null): boolean {
    return !!boss && this.bossIdentity === `${boss.id}:${boss.spawnedAt}`;
  }

  /** Reconcile releases made between ticks, then tick, then apply only landed HP deltas. */
  step(dtMs: number, sectors: SectorState[]): SessionStep {
    const signals: SectorSignal[] = [];
    const sector = this.nodeFight || this.training ? null : sectors.find((s) => s.sector === this.sector);
    const external = !this.nodeFight && !this.training;
    if (external && !this.matchesBoss(sector?.boss ?? null)) {
      this.state.over = true;
      this.state.result = 'loss';
      SF.drainEvents(this.state);
      return { events: [], cleared: false, downed: [], expired: [], gone: true, signals };
    }
    let landed = 0;
    const apply = (delta: number): void => {
      const actual = Math.max(0, delta);
      if (!external) { landed += actual; return; }
      if (!sector?.boss || !this.matchesBoss(sector.boss)) return;
      const amount = Math.min(sector.boss.hp, actual);
      if (amount <= 0) return;
      landed += amount;
      signals.push(...applyDamage(sectors, this.sector, amount, Date.now()));
    };
    apply(this.mirroredHp - this.field.boss.hp);
    if (signals.some((s) => s.type === 'cleared')) {
      this.field.boss.hp = 0;
      this.state.over = true;
      this.state.result = 'win';
    }
    if (sector?.boss) {
      this.field.boss.hp = sector.boss.hp;
      this.field.boss.maxHp = sector.boss.maxHp;
      // A sale may have enlarged the shared pool before a between-tick release arrived.
      if (this.state.result === 'win') {
        this.state.over = false;
        this.state.result = null;
        this.state.events = this.state.events.filter((e) => e.type !== 'boss-down');
      }
    }
    const before = this.field.boss.hp;
    const bodies = [...this.state.players];
    SF.tick(this.state, dtMs);
    apply(before - this.field.boss.hp);
    const events = SF.drainEvents(this.state);
    // SF reports a shot's potential; the MMO credits only HP actually removed, including overkill.
    let credit = landed;
    for (const e of events) {
      if (e.type !== 'hit' && e.type !== 'buster') continue;
      const actual = Math.min(credit, Math.max(0, e.damage));
      credit -= actual;
      e.damage = actual;
      if (!actual) continue;
      const prior = this.landed.get(e.owner) ?? { damage: 0, best: 0 };
      this.landed.set(e.owner, { damage: prior.damage + actual, best: Math.max(prior.best, actual) });
    }
    if (sector && this.matchesBoss(sector.boss)) {
      const wave = this.state.wave - this.waveApplied;
      sector.wave = Math.max(0, Math.min(120, sector.wave - wave));
      this.waveApplied = this.state.wave;
    } else if (sector && signals.some((s) => s.type === 'cleared')) {
      sector.wave = Math.max(0, Math.min(120, sector.wave - (this.state.wave - this.waveApplied)));
      this.waveApplied = this.state.wave;
    }
    const expired = events.filter((e) => e.type === 'lost').map((e) => e.owner);
    for (const id of expired) {
      const body = bodies.find((b) => b.id === id);
      if (body) this.archive(body, true);
      this.field.shots = this.field.shots.filter((shot) => shot.owner !== id);
      for (const b of this.state.players) if (b.hold?.target === id) b.hold = null;
    }
    if (expired.length) this.retargetHp();
    this.mirroredHp = this.field.boss.hp;
    const cleared = external ? signals.some((s) => s.type === 'cleared') : this.state.result === 'win';
    return {
      events,
      cleared,
      downed: events.filter((e) => e.type === 'down').map((e) => e.owner),
      expired,
      gone: false,
      signals,
    };
  }

  view(forId: string | null): SF.DuelView { return SF.viewOf(this.state, forId ?? undefined); }

  /** Benign legacy entry can inspect SF, but cannot execute placements or teleport files. */
  snapshot(): SessionEvent {
    return {
      type: 'field', session: this.id, sector: this.sector, events: [], bossHp: this.field.boss.hp,
      players: this.state.players.map((b) => ({ id: b.id, hp: b.hp, chain: b.chain, col: b.file, down: b.down })),
      bossCol: this.field.boss.file, bossRow: this.field.boss.lane, phase: SF.bossPhase(this.field.boss),
    };
  }
}
