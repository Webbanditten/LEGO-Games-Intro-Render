#!/bin/sh
# Extracts every frame of intro.mp4 to renders/original/f_001.png .. f_237.png
# (f_N is at t = (N-1)/15 s), the reference the comparison tools use.
set -e
root=$(cd "$(dirname "$0")/.." && pwd)
mkdir -p "$root/renders/original"
ffmpeg -v error -y -i "$root/intro.mp4" "$root/renders/original/f_%03d.png"
echo "$(ls "$root/renders/original" | wc -l | tr -d ' ') frames → $root/renders/original"
