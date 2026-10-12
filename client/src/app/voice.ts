/**
 * Party voice: a small peer-to-peer mesh over WebRTC, opt-in, and only ever with the people in
 * your party (at most four, so every member can talk to every other directly).
 *
 * The server never hears any of it. It carries the *introductions* — a hello, an offer, an answer,
 * ICE candidates — between two members of one party, and refuses to carry them anywhere else; the
 * audio itself goes browser to browser. Nothing starts without a click: the microphone is asked for
 * when the player turns voice on, and it opens only while a key is held (push to talk) unless they
 * choose an open mic. Leaving the party, or the page, closes every connection.
 */

export type Signal = (to: string, kind: 'hello' | 'offer' | 'answer' | 'ice' | 'bye', data?: unknown) => void;

type Link = 'idle' | 'connecting' | 'live' | 'failed';

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  state: Link;
  level: number;
  analyser: AnalyserNode | null;
  pending: RTCIceCandidateInit[];
  /** True once the other side has said hello, so we know it is listening. */
  greeted: boolean;
}

const ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const SPEAKING = 0.045;

export class Voice {
  /** Voice is on: the microphone is held and the connections are up. */
  enabled = false;
  /** Push to talk (hold the key) or an open microphone. */
  pushToTalk = true;
  /** The player has muted themselves. */
  muted = false;
  /** Why voice could not start, for the party page to say. */
  error = '';
  /** Whether the transmit key is down right now. */
  keyDown = false;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private local: AnalyserNode | null = null;
  private localLevel = 0;
  private readonly peers = new Map<string, Peer>();
  private members: string[] = [];
  private timer = 0;
  private readonly changed: (() => void)[] = [];

  constructor(
    private readonly send: Signal,
    private readonly selfId: () => string | null,
  ) {}

  onChange(fn: () => void): void {
    this.changed.push(fn);
  }

  private emit(): void {
    for (const fn of this.changed) fn();
  }

  /** Who is speaking right now, the player included (as `me`). */
  speaking(): Set<string> {
    const out = new Set<string>();
    if (this.enabled && !this.muted && this.transmitting && this.localLevel > SPEAKING) out.add('me');
    for (const p of this.peers.values()) if (p.state === 'live' && p.level > SPEAKING) out.add(p.id);
    return out;
  }

  /** How each member's link looks, for the roster. */
  status(id: string): Link | 'none' {
    return this.peers.get(id)?.state ?? 'none';
  }

  /** The microphone is open to the party right now. */
  get transmitting(): boolean {
    return this.enabled && !this.muted && (!this.pushToTalk || this.keyDown);
  }

  // -------------------------------------------------------------------------
  // Turning it on and off
  // -------------------------------------------------------------------------

  async enable(): Promise<boolean> {
    if (this.enabled) return true;
    this.error = '';
    if (!navigator.mediaDevices?.getUserMedia) {
      this.error = 'this browser cannot open a microphone here (it needs https or localhost)';
      this.emit();
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    } catch {
      this.error = 'the microphone was not allowed';
      this.emit();
      return false;
    }
    this.ctx = new AudioContext();
    this.local = this.analyse(this.stream);
    this.enabled = true;
    this.applyTrack();
    this.timer = window.setInterval(() => this.measure(), 90);
    // introduce ourselves to everyone already in the party
    for (const id of this.members) this.greet(id);
    this.emit();
    return true;
  }

  disable(): void {
    if (!this.enabled && !this.peers.size) return;
    for (const id of [...this.peers.keys()]) {
      this.send(id, 'bye');
      this.drop(id);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
    this.local = null;
    window.clearInterval(this.timer);
    this.enabled = false;
    this.keyDown = false;
    this.emit();
  }

  setPushToTalk(on: boolean): void {
    this.pushToTalk = on;
    this.applyTrack();
    this.emit();
  }

  setMuted(on: boolean): void {
    this.muted = on;
    this.applyTrack();
    this.emit();
  }

  /** The transmit key went down or up. */
  setKey(down: boolean): void {
    if (this.keyDown === down) return;
    this.keyDown = down;
    this.applyTrack();
    this.emit();
  }

  private applyTrack(): void {
    const on = this.transmitting;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = on));
  }

  // -------------------------------------------------------------------------
  // The party changed
  // -------------------------------------------------------------------------

  /** The roster arrived: connect to whoever joined, hang up on whoever left. */
  setMembers(ids: string[]): void {
    const me = this.selfId();
    this.members = ids.filter((i) => i !== me);
    if (!this.enabled) return;
    for (const id of [...this.peers.keys()]) if (!this.members.includes(id)) this.drop(id);
    for (const id of this.members) if (!this.peers.has(id)) this.greet(id);
  }

  private greet(id: string): void {
    this.send(id, 'hello');
    this.ensure(id);
  }

  // -------------------------------------------------------------------------
  // The introductions
  // -------------------------------------------------------------------------

  async onSignal(from: string, kind: string, data: unknown): Promise<void> {
    if (!this.enabled || !this.members.includes(from)) return;
    if (kind === 'hello') {
      const p = this.ensure(from);
      const first = !p.greeted;
      p.greeted = true;
      // answer a hello once, so someone who turned voice on after us still hears from us
      if (first) this.send(from, 'hello');
      // the lower id dials, so two members never dial each other at once
      if (this.selfId()! < from && p.state === 'connecting') await this.offer(p);
    } else if (kind === 'offer') {
      const p = this.ensure(from);
      await p.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
      await this.flush(p);
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      this.send(from, 'answer', p.pc.localDescription);
    } else if (kind === 'answer') {
      const p = this.peers.get(from);
      if (!p) return;
      await p.pc.setRemoteDescription(data as RTCSessionDescriptionInit);
      await this.flush(p);
    } else if (kind === 'ice') {
      const p = this.ensure(from);
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data as RTCIceCandidateInit).catch(() => undefined);
      else p.pending.push(data as RTCIceCandidateInit);
    } else if (kind === 'bye') {
      this.drop(from);
      this.emit();
    }
  }

  private async offer(p: Peer): Promise<void> {
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this.send(p.id, 'offer', p.pc.localDescription);
  }

  private async flush(p: Peer): Promise<void> {
    for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => undefined);
  }

  private ensure(id: string): Peer {
    const have = this.peers.get(id);
    if (have) return have;
    const pc = new RTCPeerConnection(ICE);
    const audio = new Audio();
    audio.autoplay = true;
    const peer: Peer = { id, pc, audio, state: 'connecting', level: 0, analyser: null, pending: [], greeted: false };
    this.peers.set(id, peer);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(id, 'ice', e.candidate.toJSON());
    };
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      if (!stream) return;
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
      peer.analyser = this.analyse(stream);
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState === 'connected' ? 'live' : pc.connectionState === 'failed' ? 'failed' : 'connecting';
      this.emit();
    };
    return peer;
  }

  private drop(id: string): void {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    p.audio.srcObject = null;
    this.peers.delete(id);
  }

  // -------------------------------------------------------------------------
  // Who is speaking
  // -------------------------------------------------------------------------

  private analyse(stream: MediaStream): AnalyserNode | null {
    if (!this.ctx) return null;
    const a = this.ctx.createAnalyser();
    a.fftSize = 512;
    this.ctx.createMediaStreamSource(stream).connect(a);
    return a;
  }

  private readonly buf = new Float32Array(512);

  private rms(a: AnalyserNode | null): number {
    if (!a) return 0;
    a.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    return Math.sqrt(s / this.buf.length);
  }

  private measure(): void {
    const before = [...this.speaking()].sort().join();
    this.localLevel = this.rms(this.local);
    for (const p of this.peers.values()) p.level = this.rms(p.analyser);
    if ([...this.speaking()].sort().join() !== before) this.emit();
  }

  /** Close everything, for a party that was left or a page that is closing. */
  dispose(): void {
    this.disable();
  }
}
