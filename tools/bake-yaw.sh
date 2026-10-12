#!/usr/bin/env bash
# Bake the animation frames for one camera yaw across the whole collection,
# sharded over several Blender processes.
#
#   bash tools/bake-yaw.sh 0      # facing the camera
#   bash tools/bake-yaw.sh 180    # back of the head
#
# Each yaw lands in its own tagged directory (<token>_y<yaw>), so shards and
# angles never collide.
set -u

YAW="${1:?usage: bake-yaw.sh <yaw-degrees>}"
SHARDS="${2:-4}"
BLENDER="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/blender/out/_bake"
TAG="y${YAW%.*}"

if [ ! -x "$BLENDER" ] && [ ! -f "$BLENDER" ]; then
  echo "blender not found at: $BLENDER" >&2
  exit 1
fi

cd "$ROOT" || exit 1

for ((s = 0; s < SHARDS; s++)); do
  TOKENS="$(python -c "
import json
p = json.load(open('blender/params.json'))
ks = sorted(p, key=int)
print(' '.join(ks[$s::$SHARDS]))
")"
  [ -z "$TOKENS" ] && continue
  "$BLENDER" --background --python blender/chog.py -- \
    --tokens $TOKENS --anim --yaw "$YAW" --out "$OUT" --size 128 \
    > "/tmp/bake_${TAG}_s$s.log" 2>&1 &
  echo "shard $s -> /tmp/bake_${TAG}_s$s.log"
done

wait
echo "yaw $YAW done: $(find "$OUT/anim" -maxdepth 1 -type d -name "*_${TAG}" | wc -l) tokens"
