#!/bin/sh
set -eu
out="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)/packages/mock-engine/fixtures"
mkdir -p "$out"
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc=size=320x180:rate=25" \
  -f lavfi -i "sine=frequency=440:sample_rate=44100" \
  -t 4 \
  -c:v libx264 -pix_fmt yuv420p -profile:v baseline -level 3.0 \
  -g 50 -keyint_min 50 -sc_threshold 0 \
  -c:a aac -b:a 64k -shortest \
  -f hls -hls_time 2 -hls_playlist_type vod \
  -hls_segment_filename "$out/seg%d.ts" \
  "$out/index.m3u8"
rm -f "$out/index.m3u8"
echo "barras de prueba en $out"
