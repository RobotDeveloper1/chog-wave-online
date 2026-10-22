import {
  AbsoluteFill,
  Audio,
  Img,
  Sequence,
  Video,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {BEATS, END_DUR, OPEN_DUR, type Beat} from './beats';
import {VO_DUR} from './timings';

export const FPS = 30;

const MINT = '#43e2a8';
const INK = '#0b0916';
const MONO = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace";
const SANS = "system-ui, 'Segoe UI', Arial, sans-serif";

const beatFrames = (b: Beat): number => Math.round(b.dur * FPS);
const OPEN_F = Math.round(OPEN_DUR * FPS);
const END_F = Math.round(END_DUR * FPS);

let acc = OPEN_F;
const STARTS: number[] = BEATS.map((b) => {
  const s = acc;
  acc += beatFrames(b);
  return s;
});
export const TOTAL_FRAMES = acc + END_F;

const VO_LEAD = 10; // VO starts 1/3s into the beat

function DuckedVideo({beat}: {beat: Beat}): JSX.Element {
  const frame = useCurrentFrame();
  const voEnd = VO_LEAD + (VO_DUR[beat.key] ?? 0) * FPS;
  const volume = interpolate(frame, [0, VO_LEAD, voEnd, voEnd + 15], [0.85, 0.3, 0.3, 0.85], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const zoom = beat.zoom
    ? interpolate(frame, [0, beatFrames(beat)], [1, 1.32], {extrapolateRight: 'clamp'})
    : 1;
  return (
    <AbsoluteFill style={beat.zoom ? {transform: `scale(${zoom})`, transformOrigin: '72% 42%'} : undefined}>
      <Video
        src={staticFile(`shots/${beat.file}`)}
        startFrom={Math.round(beat.in * FPS)}
        playbackRate={beat.rate ?? 1}
        volume={Number(volume.toFixed(3))}
      />
    </AbsoluteFill>
  );
}

function Title({beat, index}: {beat: Beat; index: number}): JSX.Element {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const total = beatFrames(beat);
  const slide = spring({frame, fps, config: {damping: 18, stiffness: 220}});
  const x = interpolate(slide, [0, 1], [-620, 0]);
  const fade = interpolate(frame, [total - 10, total], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const count = spring({frame: frame - 6, fps, config: {damping: 16, stiffness: 200}});
  return (
    <AbsoluteFill style={{opacity: fade, justifyContent: 'flex-end'}}>
      <div style={{position: 'absolute', left: 84, bottom: 88, transform: `translateX(${x}px)`}}>
        <div
          style={{
            display: 'inline-block',
            background: MINT,
            color: INK,
            fontFamily: SANS,
            fontWeight: 900,
            fontSize: 64,
            letterSpacing: -1,
            padding: '10px 26px 12px',
            transform: 'skewX(-8deg)',
          }}
        >
          {beat.title}
        </div>
        <div
          style={{
            display: 'table',
            background: INK,
            color: '#fff',
            fontFamily: MONO,
            fontSize: 30,
            padding: '8px 20px',
            marginTop: 10,
            transform: 'skewX(-8deg)',
          }}
        >
          {beat.sub}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          right: 84,
          top: 64,
          fontFamily: MONO,
          fontSize: 34,
          color: '#fff',
          background: 'rgba(11,9,22,.72)',
          border: `2px solid ${MINT}`,
          padding: '6px 18px',
          transform: `translateY(${interpolate(count, [0, 1], [-70, 0])}px)`,
          opacity: count,
        }}
      >
        {String(index + 1).padStart(2, '0')} / {String(BEATS.length).padStart(2, '0')}
      </div>
    </AbsoluteFill>
  );
}

function BeatScene({beat, index}: {beat: Beat; index: number}): JSX.Element {
  const voF = Math.round((VO_DUR[beat.key] ?? 0) * FPS);
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <DuckedVideo beat={beat} />
      <Sequence from={VO_LEAD} durationInFrames={voF + 30}>
        <Audio src={staticFile(`voice/${beat.key}.mp3`)} />
      </Sequence>
      <Title beat={beat} index={index} />
    </AbsoluteFill>
  );
}

function CardBack({from}: {from: number}): JSX.Element {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 200], [1, 1.12], {extrapolateRight: 'clamp'});
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${zoom})`,
        filter: 'blur(9px) brightness(0.42) saturate(1.2)',
      }}
    >
      <Video src={staticFile('shots/01-login.mp4')} startFrom={from} volume={0} />
    </AbsoluteFill>
  );
}

function OpenCard(): JSX.Element {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = spring({frame, fps, config: {damping: 15, stiffness: 130}});
  const bar = spring({frame: frame - 8, fps, config: {damping: 20, stiffness: 160}});
  const sub = spring({frame: frame - 14, fps, config: {damping: 18, stiffness: 170}});
  const fade = interpolate(frame, [OPEN_F - 8, OPEN_F], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill
      style={{backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', opacity: fade}}
    >
      <CardBack from={15} />
      <Sequence from={VO_LEAD} durationInFrames={Math.round(VO_DUR.open * FPS) + 30}>
        <Audio src={staticFile('voice/open.mp3')} />
      </Sequence>
      <div style={{fontFamily: MONO, fontSize: 30, color: MINT, letterSpacing: 8}}>A CHOGATHON DEMO</div>
      <Img
        src={staticFile('brand/wordmark.svg')}
        style={{
          width: 470,
          marginTop: 30,
          transform: `scale(${interpolate(logo, [0, 1], [0.82, 1])})`,
          opacity: logo,
        }}
      />
      <div
        style={{
          width: interpolate(bar, [0, 1], [0, 560]),
          height: 10,
          background: MINT,
          marginTop: 30,
        }}
      />
      <div
        style={{
          fontFamily: MONO,
          fontSize: 34,
          color: '#fff',
          marginTop: 22,
          letterSpacing: 4,
          opacity: sub,
        }}
      >
        MAKE CHOG GREAT AGAIN
      </div>
    </AbsoluteFill>
  );
}

function EndCard(): JSX.Element {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logo = spring({frame, fps, config: {damping: 15, stiffness: 130}});
  const move = spring({frame: frame - 10, fps, config: {damping: 14, stiffness: 120}});
  return (
    <AbsoluteFill style={{backgroundColor: '#000', justifyContent: 'center', alignItems: 'center'}}>
      <CardBack from={120} />
      <Sequence from={VO_LEAD} durationInFrames={Math.round(VO_DUR.end * FPS) + 30}>
        <Audio src={staticFile('voice/end.mp3')} />
      </Sequence>
      <Img src={staticFile('brand/wordmark-line.svg')} style={{width: 420, opacity: logo}} />
      <div
        style={{
          fontFamily: SANS,
          fontWeight: 900,
          fontSize: 200,
          color: '#fff',
          lineHeight: 1,
          transform: `scale(${interpolate(move, [0, 1], [1.25, 1])})`,
          opacity: move,
        }}
      >
        YOUR MOVE.
      </div>
      <div style={{fontFamily: MONO, fontSize: 44, color: MINT, marginTop: 30, letterSpacing: 6}}>
        CHOGWAVE.ONLINE
      </div>
      <div style={{fontFamily: MONO, fontSize: 26, color: '#8f8ba3', marginTop: 16, letterSpacing: 4}}>
        CHOGATHON DEMO · MONAD TESTNET
      </div>
    </AbsoluteFill>
  );
}

const BED_F = Math.round(63.67 * FPS); // seamless loop: two back-to-back plays cover the film

export const Trailer = (): JSX.Element => {
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <Sequence from={0} durationInFrames={Math.min(BED_F, TOTAL_FRAMES)}>
        <Audio src={staticFile('audio/bed.ogg')} volume={0.16} />
      </Sequence>
      {TOTAL_FRAMES > BED_F ? (
        <Sequence from={BED_F} durationInFrames={TOTAL_FRAMES - BED_F}>
          <Audio src={staticFile('audio/bed.ogg')} volume={0.16} />
        </Sequence>
      ) : null}
      <Sequence from={0} durationInFrames={OPEN_F}>
        <OpenCard />
      </Sequence>
      {BEATS.map((b, i) => (
        <Sequence key={b.key} from={STARTS[i]} durationInFrames={beatFrames(b)}>
          <BeatScene beat={b} index={i} />
        </Sequence>
      ))}
      <Sequence from={acc} durationInFrames={END_F}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  );
};
