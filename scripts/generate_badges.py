#!/usr/bin/env python3
"""Generate xiangqi piece badge PNGs with exact Chinese labels."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUTS = [ROOT / "resources/art/badges", ROOT / "public/assets/badges"]

FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/Library/Fonts/Arial Unicode.ttf",
]

PIECES = [
    ("red", "帅"), ("red", "仕"), ("red", "相"), ("red", "马"),
    ("red", "车"), ("red", "炮"), ("red", "兵"),
    ("black", "将"), ("black", "士"), ("black", "象"), ("black", "马"),
    ("black", "车"), ("black", "炮"), ("black", "卒"),
]

def font(size: int) -> ImageFont.ImageFont:
    for p in FONT_CANDIDATES:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size, index=0)
            except Exception:
                try:
                    return ImageFont.truetype(p, size)
                except Exception:
                    pass
    return ImageFont.load_default()

def badge(side: str, text: str, size: int = 256) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = cy = size // 2
    r = size // 2 - 8
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(30, 24, 16, 255))
    d.ellipse([cx - r + 6, cy - r + 6, cx + r - 6, cy + r - 6], outline=(212, 175, 55, 255), width=8)
    fill = (139, 0, 0, 255) if side == "red" else (26, 26, 32, 255)
    ring = (229, 57, 53, 255) if side == "red" else (30, 136, 229, 255)
    d.ellipse([cx - r + 18, cy - r + 18, cx + r - 18, cy + r - 18], fill=fill, outline=ring, width=4)
    f = font(int(size * 0.42))
    bbox = d.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text((cx - tw / 2, cy - th / 2 - size * 0.02), text, font=f, fill=(255, 255, 255, 255))
    return img

def main() -> None:
    for out in OUTS:
        out.mkdir(parents=True, exist_ok=True)
        for side, text in PIECES:
            img = badge(side, text)
            img.save(out / f"badge_{side}_{text}.png")
            print("wrote", out / f"badge_{side}_{text}.png")

if __name__ == "__main__":
    main()
