"""Crops the dark-theme screenshots into the focused images used by docs/using-vikalp.md.
Run after `npm run shots`: python3 e2e/crop-guide.py
Boxes are in the 2000px-wide display scale of the 2x screenshots."""
from pathlib import Path
from PIL import Image

SHOTS = Path(__file__).resolve().parent.parent / "docs" / "screenshots"
SCALE = 1.44
CROPS = {
    "markers": ("dark-03-span-note.png", (520, 175, 1530, 500)),
    "paragraph-span": ("dark-03-span-note.png", (490, 1050, 1530, 1120)),
    "alternatives-panel": ("dark-01-alternatives-panel.png", (62, 60, 478, 420)),
    "ai-alternatives": ("dark-04-ai-alternatives.png", (62, 60, 478, 620)),
    "ghost": ("dark-03-span-note.png", (520, 915, 1530, 1025)),
    "overflow": ("dark-03-span-note.png", (1590, 60, 2000, 270)),
    "linter": ("dark-05-linter.png", (520, 160, 2000, 760)),
    "lab": ("dark-06-lab.png", (1400, 420, 1875, 1110)),
    "typo-pass": ("dark-07-typo-pass.png", (520, 110, 2000, 600)),
    "trim": ("dark-08-trim.png", (520, 240, 1530, 1130)),
}

(SHOTS / "guide").mkdir(exist_ok=True)
for name, (source, box) in CROPS.items():
    crop = Image.open(SHOTS / source).crop(tuple(int(value * SCALE) for value in box))
    if crop.width > 1600:
        crop = crop.resize((1600, int(crop.height * 1600 / crop.width)), Image.LANCZOS)
    crop.save(SHOTS / "guide" / f"{name}.png", optimize=True)
full = Image.open(SHOTS / "dark-09-read-through.png")
full.resize((1440, int(full.height * 1440 / full.width)), Image.LANCZOS).save(SHOTS / "guide" / "read-through.png", optimize=True)
print("guide images written")
