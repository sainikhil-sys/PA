"""
Generates Cowork's launcher icon variants from the existing mark (assets/images/android-icon-*.png).
Run from apps/mobile:  python scripts/generate-app-icons.py
Writes:
  assets/app-icons/preview/<key>.png      in-app previews (Settings > Appearance)
  assets/app-icons/android/...            Android resources the config plugin copies into the build
Keep VARIANTS in step with src/features/appearance/icons.ts and plugins/with-app-icons.js.
No green (house rule), so the brief's "Mint" is replaced by "Orange".
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "assets", "images")
OUT = os.path.join(ROOT, "assets", "app-icons")

# key, background, mark ("gradient" = the original orange mark, otherwise a solid colour)
VARIANTS = [
    ("night", "#0A0A0A", "gradient"),
    ("day", "#FFFFFF", "gradient"),
    ("orange", "#F97316", "#111111"),
    ("sky", "#7CC4F2", "#0B2545"),
    ("ivory", "#F6F1E7", "#C2410C"),
    ("blue", "#1E3A8A", "#FFFFFF"),
    ("dark", "#1F1F1F", "#F97316"),
    ("light", "#F3F4F6", "#111111"),
]

# Android density buckets for the legacy (pre-Android 8) square icon, and the adaptive foreground (108dp).
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


gradient = Image.open(os.path.join(SRC, "android-icon-foreground.png")).convert("RGBA")
mono = Image.open(os.path.join(SRC, "android-icon-monochrome.png")).convert("RGBA")


def mark(spec):
    if spec == "gradient":
        return gradient.copy()
    solid = Image.new("RGBA", mono.size, hex_rgb(spec) + (255,))
    solid.putalpha(mono.getchannel("A"))
    return solid


def composite(bg, fg, size):
    base = Image.new("RGBA", fg.size, hex_rgb(bg) + (255,))
    base.alpha_composite(fg)
    return base.resize((size, size), Image.LANCZOS)


def save(img, *parts):
    path = os.path.join(OUT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path, optimize=True)


colors = []
for key, bg, spec in VARIANTS:
    fg = mark(spec)
    save(composite(bg, fg, 192), "preview", f"{key}.png")
    for density, px in LEGACY.items():
        save(composite(bg, fg, px), "android", "res", f"mipmap-{density}", f"ic_launcher_{key}.png")
    for density, px in ADAPTIVE.items():
        save(fg.resize((px, px), Image.LANCZOS), "android", "res", f"mipmap-{density}", f"ic_launcher_{key}_foreground.png")
    adaptive = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        f'  <background android:drawable="@color/ic_launcher_{key}_background"/>\n'
        f'  <foreground android:drawable="@mipmap/ic_launcher_{key}_foreground"/>\n'
        '  <monochrome android:drawable="@mipmap/ic_launcher_cowork_monochrome"/>\n'
        "</adaptive-icon>\n"
    )
    path = os.path.join(OUT, "android", "res", "mipmap-anydpi-v26", f"ic_launcher_{key}.xml")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(adaptive)
    colors.append(f'  <color name="ic_launcher_{key}_background">{bg}</color>')

for density, px in ADAPTIVE.items():
    save(mono.resize((px, px), Image.LANCZOS), "android", "res", f"mipmap-{density}", "ic_launcher_cowork_monochrome.png")

with open(os.path.join(OUT, "android", "res", "values", "app_icon_colors.xml"), "w", encoding="utf-8", newline="\n") as f:
    os.makedirs(os.path.dirname(f.name), exist_ok=True)
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + "\n".join(colors) + "\n</resources>\n")

print(f"Wrote {len(VARIANTS)} variants to {OUT}")
