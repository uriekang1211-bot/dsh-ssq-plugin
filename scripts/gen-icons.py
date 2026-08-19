#!/usr/bin/env python3
"""生成 PWA 图标：红底 + 白球(红球) + 蓝球，输出到 src/pwa/icons/。
用法：python3 scripts/gen-icons.py
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "pwa", "icons")
RED = "#d63b3b"
BLUE = "#2f6fed"

def draw_icon(size, maskable=False):
    """红底圆角方块 + 白色大圆 + 蓝色小圆（双色球意象）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # maskable：背景铺满全图，图形收缩到安全区（66%）
        d.rectangle([0, 0, size, size], fill=RED)
        scale = 0.62
    else:
        d.rounded_rectangle([0, 0, size, size], radius=int(size * 0.18), fill=RED)
        scale = 1.0
    # 图形坐标基于 512 设计稿缩放并居中
    def pt(x, y):
        return (x * scale + (1 - scale) * size / 2, y * scale + (1 - scale) * size / 2)
    wr = 150 * scale
    wcx, wcy = pt(200, 220)
    d.ellipse([wcx - wr, wcy - wr, wcx + wr, wcy + wr], fill="white")
    br = 66 * scale
    bcx, bcy = pt(332, 350)
    d.ellipse([bcx - br, bcy - br, bcx + br, bcy + br], fill=BLUE)
    return img

def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, False),
    ]
    for name, size, maskable in jobs:
        draw_icon(size, maskable).save(os.path.join(OUT, name))
        print(f"wrote {name} ({size}x{size})")

if __name__ == "__main__":
    main()
