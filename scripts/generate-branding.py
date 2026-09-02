"""
Lumio branding asset generator.
Produces:
  assets/icon.png            1024x1024  App icon (dark bg + glowing L circle)
  assets/adaptive-icon.png   1024x1024  Android adaptive icon foreground (transparent bg)
  assets/splash.png          1284x2778  Splash screen (dark bg + centred logo + wordmark)
  assets/logo-light.png       512x512   Logo on white background
  assets/logo-dark.png        512x512   Logo on dark background
  assets/favicon.png           64x64    Web favicon
"""
from PIL import Image, ImageDraw, ImageFont
import os

ASSETS = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(ASSETS, exist_ok=True)

# Palette
BG_DARK  = (15, 23, 42)      # #0f172a
BG_LIGHT = (255, 255, 255)
GRAD_A   = (56, 103, 214)    # blue
GRAD_B   = (124, 58, 237)    # purple
L_COLOR  = (255, 255, 255)   # white letter


def lerp_color(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_gradient_circle(draw, cx, cy, r, color_a, color_b):
    """Fill a circle with a top-left to bottom-right linear gradient."""
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            dx, dy = x - cx, y - cy
            if dx * dx + dy * dy <= r * r:
                t = ((dx + dy) / (2 * r) + 0.5)
                t = max(0.0, min(1.0, t))
                color = lerp_color(color_a, color_b, t)
                draw.point((x, y), fill=color)


def draw_glow(img, cx, cy, r):
    """Paint a soft radial glow behind the circle via alpha compositing."""
    glow_r = int(r * 1.45)
    glow_layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    for ring in range(glow_r, 0, -1):
        alpha = int(60 * (1 - ring / glow_r) ** 2)
        color = (99, 102, 241, alpha)
        bbox = [cx - ring, cy - ring, cx + ring, cy + ring]
        ImageDraw.Draw(glow_layer).ellipse(bbox, fill=color)
    img.alpha_composite(glow_layer)


def draw_letter_L(draw, cx, cy, size):
    """Draw a bold, rounded 'L' centred at (cx, cy)."""
    stroke = max(int(size * 0.175), 4)
    half   = size // 2
    x0 = cx - half // 2
    y0 = cy - half
    y1 = cy + half
    x1 = cx + half
    # vertical bar
    draw.rounded_rectangle([x0, y0, x0 + stroke, y1],
                            radius=stroke // 2, fill=L_COLOR)
    # horizontal bar
    draw.rounded_rectangle([x0, y1 - stroke, x1, y1],
                            radius=stroke // 2, fill=L_COLOR)


def make_icon_canvas(size, bg_color=None, transparent=False):
    mode = 'RGBA'
    bg   = (0, 0, 0, 0) if transparent else (*bg_color, 255)
    return Image.new(mode, (size, size), bg)


def render_logo(size, bg_color, circle_fraction=0.72):
    """Core renderer: Lumio logo on bg_color background."""
    img  = make_icon_canvas(size, bg_color)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    r  = int(size * circle_fraction / 2)

    draw_glow(img, cx, cy, r)
    draw_gradient_circle(draw, cx, cy, r, GRAD_A, GRAD_B)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                 outline=(180, 180, 255, 80), width=max(2, r // 40))
    draw_letter_L(draw, cx, cy, int(r * 0.75))
    return img


def render_adaptive_foreground(size):
    """Foreground only (transparent bg) for Android adaptive icon."""
    img  = make_icon_canvas(size, transparent=True)
    draw = ImageDraw.Draw(img)
    cx = cy = size // 2
    r  = int(size * 0.72 / 2)

    draw_glow(img, cx, cy, r)
    draw_gradient_circle(draw, cx, cy, r, GRAD_A, GRAD_B)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                 outline=(180, 180, 255, 80), width=max(2, r // 40))
    draw_letter_L(draw, cx, cy, int(r * 0.75))
    return img


def _get_font(size):
    """Load best available system font for wordmark."""
    candidates = [
        'C:/Windows/Fonts/segoeuib.ttf',
        'C:/Windows/Fonts/calibrib.ttf',
        'C:/Windows/Fonts/Arial.ttf',
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()


def render_splash(w, h):
    img  = Image.new('RGBA', (w, h), (*BG_DARK, 255))
    draw = ImageDraw.Draw(img)

    cx, cy = w // 2, h // 2 - h // 12   # slightly above centre

    r = int(min(w, h) * 0.18)
    draw_glow(img, cx, cy, r)
    draw_gradient_circle(draw, cx, cy, r, GRAD_A, GRAD_B)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r],
                 outline=(180, 180, 255, 80), width=max(2, r // 40))
    draw_letter_L(draw, cx, cy, int(r * 0.75))

    # Wordmark below the circle using a real system font
    font_size = int(r * 0.55)
    font = _get_font(font_size)
    text = "lumio"
    text_color = (200, 210, 255, 220)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    tx = cx - tw // 2
    ty = cy + r + int(r * 0.35)
    draw.text((tx, ty), text, font=font, fill=text_color)

    return img


# Generate all assets

def save(img, path):
    out = img.convert('RGBA')
    out.save(path, 'PNG', optimize=True)
    size_kb = os.path.getsize(path) // 1024
    print(f"  OK {os.path.relpath(path)}  ({out.size[0]}x{out.size[1]}, {size_kb} KB)")


print("\nGenerating Lumio branding assets...\n")

# icon.png - 1024x1024 on dark background
icon = render_logo(1024, BG_DARK)
save(icon, os.path.join(ASSETS, 'icon.png'))

# adaptive-icon.png - 1024x1024 transparent foreground
adaptive = render_adaptive_foreground(1024)
save(adaptive, os.path.join(ASSETS, 'adaptive-icon.png'))

# splash.png - portrait 1284x2778
splash = render_splash(1284, 2778)
save(splash, os.path.join(ASSETS, 'splash.png'))

# logo-light.png - 512x512 on white
logo_light = render_logo(512, BG_LIGHT, circle_fraction=0.78)
save(logo_light, os.path.join(ASSETS, 'logo-light.png'))

# logo-dark.png - 512x512 on dark
logo_dark = render_logo(512, BG_DARK, circle_fraction=0.78)
save(logo_dark, os.path.join(ASSETS, 'logo-dark.png'))

# favicon.png - 64x64
favicon = render_logo(64, BG_DARK, circle_fraction=0.85)
save(favicon, os.path.join(ASSETS, 'favicon.png'))

print("\nDone.\n")
