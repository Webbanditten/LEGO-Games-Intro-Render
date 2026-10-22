#!/bin/sh
# Side-by-side sheet: original frame (left) vs. recreation (right) for each frame number.
#   tools/compare.sh <render-dir> <out.png> <frame> [frame...]   (frames are 1-based, f_NNN)
set -e
dir=$1; out=$2; shift 2
orig=${ORIG_FRAMES:-$(cd "$(dirname "$0")/.." && pwd)/renders/original}   # tools/extract-original.sh
tmp=$(mktemp -d)
i=0
for f in "$@"; do
  n=$(printf %03d "$f")
  ffmpeg -v error -y -i "$orig/f_$n.png" -i "$dir/f_$n.png" -filter_complex \
    "[0:v]scale=320:240[a];[1:v]scale=320:240[b];[a][b]hstack,pad=iw+4:ih+4:2:2:gray" \
    "$tmp/p_$(printf %03d $i).png"
  i=$((i + 1))
done
ffmpeg -v error -y -framerate 1 -i "$tmp/p_%03d.png" -vf "tile=2x$(( (i + 1) / 2 ))" -frames:v 1 "$out"
rm -rf "$tmp"
echo "$out"
