#!/usr/bin/env python3
"""Assembles the frames recorded by record.mjs into an animated GIF.

    python3 scripts/demo/build-gif.py FRAMES_DIR docs/assets/demo.gif [WIDTH]
"""
import json
import sys

from PIL import Image

frames_dir, target = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 960
meta = json.load(open(f"{frames_dir}/frames.json"))
images, durations = [], []
for f in meta:
    im = Image.open(f["file"]).convert("RGB")
    if im.width != width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    # one shared, small palette keeps the file light and the colours stable
    images.append(im)
    durations.append(f["ms"])
palette_src = images[len(images) // 2].quantize(colors=64, method=Image.MEDIANCUT)
quantized = [im.quantize(palette=palette_src, dither=Image.NONE) for im in images]
quantized[0].save(target, save_all=True, append_images=quantized[1:], duration=durations, loop=0, optimize=True, disposal=1)
print(f"{target}: {len(quantized)} frames")
