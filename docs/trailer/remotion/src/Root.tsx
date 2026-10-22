import {Composition} from 'remotion';
import {FPS, TOTAL_FRAMES, Trailer} from './Trailer';

export const RemotionRoot = () => {
  return (
    <Composition
      id="Trailer"
      component={Trailer}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
  );
};
