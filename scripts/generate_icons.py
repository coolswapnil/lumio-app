"""
Lumio Knowledge Beacon — Icon Generator (Pillow renderer)
Concept C.3: unified beacon-bookmark silhouette, blue->indigo gradient,
purple focus node, negative-space L channel.

All shapes are computed in a 160x160 coordinate space then upscaled
to the target resolution with LANCZOS for maximum quality.

Outputs written to ../assets/:
  icon.png            1024x1024
  adaptive-icon.png   1024x1024
  monochrome-icon.png 1024x1024
  logo-light.png       512x512
  logo-dark.png        512x512
  splash.png          2048x2048
"""

import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).parent.parent / "assets"
OUT.mkdir(exist_ok=True)

# ── Design constants (160x160 space) ─────────────────────────────────
# Beacon-bookmark body polygon (unified single silhouette)
BODY_PTS = [(28,52),(80,10),(132,52),(132,152),(80,114),(28,152)]
# Negative-space L channel polygon
L_PTS    = [(62,70),(62,100),(114,100),(114,115),(46,115),(46,70)]
# Focus node
NX, NY   = 62, 100
NODE_R   = 6.05   # disc radius
GLOW_R   = 15.4   # halo radius

# Colours
C_BLUE      = (29,  78, 216)   # #1d4ed8
C_INDIGO    = (67,  56, 202)   # #4338ca
C_DARK_BG1  = (16,  20,  42)   # #10142a
C_DARK_BG2  = ( 8,  10,  20)   # #080a14
C_SPLASH_BG = (15,  23,  42)   # #0f172a
C_LAVENDER  = (167,139,250)    # #a78bfa
C_PURPLE1   = (139, 92,246)    # #8b5cf6
C_PURPLE2   = (124, 58,237)    # #7C3AED
WHITE       = (255,255,255)


# ── Low-level drawing helpers ────────────────────────────────────────

def scale_pts(pts, factor):
    return [(x*factor, y*factor) for x,y in pts]


def linear_gradient(img: Image.Image, x0,y0,x1,y1, c0, c1, alpha=255):
    """
    Paint a linear gradient over the given RGBA image in-place using
    a pre-computed colour band. This is a simple axis-aligned helper.
    We blend from c0 at (x0,y0) direction to c1 at (x1,y1) using
    per-pixel distance projection.
    """
    W, H = img.size
    pix = img.load()
    dx = x1 - x0
    dy = y1 - y0
    length_sq = dx*dx + dy*dy
    for py in range(H):
        for px in range(W):
            if length_sq == 0:
                t = 0.0
            else:
                t = ((px-x0)*dx + (py-y0)*dy) / length_sq
            t = max(0.0, min(1.0, t))
            r = int(c0[0] + (c1[0]-c0[0])*t)
            g = int(c0[1] + (c1[1]-c0[1])*t)
            b = int(c0[2] + (c1[2]-c0[2])*t)
            existing = pix[px,py]
            if existing[3] > 0:
                pix[px,py] = (r, g, b, existing[3])


def make_canvas(W, H, bg_rgba=(0,0,0,0)):
    img = Image.new("RGBA", (W,H), bg_rgba)
    return img


def draw_body_gradient(draw, pts, W, H, scale):
    """Draw the bookmark beacon body with a top-left->bottom-right blue->indigo gradient."""
    # We draw the polygon in solid indigo first, then composite a blue mask
    # using a simple per-row gradient approximation.
    spoly = scale_pts(pts, scale)
    
    # Create gradient layer
    grad = Image.new("RGBA", (W,H), (0,0,0,0))
    gd   = ImageDraw.Draw(grad)
    gd.polygon(spoly, fill=(*C_INDIGO, 255))
    
    # Create blue mask polygon
    blue_layer = Image.new("RGBA", (W,H), (0,0,0,0))
    bd = ImageDraw.Draw(blue_layer)
    bd.polygon(spoly, fill=(*C_BLUE, 255))
    
    # Blend: compute per-pixel diagonal gradient mask
    mask = Image.new("L", (W,H), 0)
    md   = ImageDraw.Draw(mask)
    steps = W+H
    for i in range(steps):
        val = int(255 * (1 - i/steps))
        # diagonal stripe
        md.line([(i,0),(0,i)], fill=val, width=2)
    
    out = Image.composite(blue_layer, grad, mask)
    return out


def draw_radial_glow(img: Image.Image, cx, cy, r_inner, r_outer, colour, max_alpha=210):
    """Paint a radial gradient glow disc directly onto img (RGBA)."""
    W, H = img.size
    draw = ImageDraw.Draw(img, "RGBA")
    # Draw concentric circles from outside in, decreasing alpha
    steps = int(r_outer - r_inner) + 1
    for i in range(steps, -1, -1):
        frac = 1.0 - (i / (steps+1)) if steps > 0 else 1.0
        alpha = int(max_alpha * (1-frac)**0.6)  # gentle falloff
        rr = r_inner + i
        draw.ellipse(
            [cx-rr, cy-rr, cx+rr, cy+rr],
            fill=(*colour, alpha)
        )


def rounded_rect_mask(W, H, rx):
    """Return an L mask for rounded-rectangle clipping."""
    mask = Image.new("L", (W,H), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0,0,W-1,H-1], radius=rx, fill=255)
    return mask


def add_sheen(img: Image.Image, pts, scale, opacity=0.10):
    """Overlay a top-left diagonal white sheen on the shape."""
    W, H = img.size
    sheen = Image.new("RGBA", (W,H), (0,0,0,0))
    sd = ImageDraw.Draw(sheen)
    # Upper half of body
    upper_pts = scale_pts([(28,52),(80,10),(132,52),(132,100),(28,100)], scale)
    sd.polygon(upper_pts, fill=(255,255,255, int(255*opacity)))
    # Gaussian blur to soften
    sheen = sheen.filter(ImageFilter.GaussianBlur(radius=scale*8))
    img.alpha_composite(sheen)


def add_crease(img: Image.Image, scale, opacity=0.07):
    """Add a very subtle outer-edge highlight on the chevron sides only."""
    W, H = img.size
    crease = Image.new("RGBA", (W,H), (0,0,0,0))
    cd = ImageDraw.Draw(crease)
    alpha = int(255 * opacity)
    w = max(1, int(scale * 0.8))
    # Left chevron edge
    cd.line(scale_pts([(28,52),(80,10)], scale), fill=(255,255,255,alpha), width=w)
    # Right chevron edge
    cd.line(scale_pts([(80,10),(132,52)], scale), fill=(255,255,255,alpha), width=w)
    img.alpha_composite(crease)


def render_icon(size: int, bg_color, round_corners=True, transparent_bg=False):
    """
    Render full-colour icon at `size`x`size`.
    bg_color: RGBA tuple for background and L channel fill.
    round_corners: clip to rounded rectangle (for icon.png / adaptive).
    transparent_bg: if True, L channel and bg use (0,0,0,0).
    """
    W = H = size
    scale = size / 160.0
    
    # 1. Background
    if transparent_bg:
        img = make_canvas(W, H, (0,0,0,0))
        l_fill = (0,0,0,0)
    else:
        img = make_canvas(W, H, bg_color)
        l_fill = bg_color

    # 2. Body gradient
    body_layer = draw_body_gradient(None, BODY_PTS, W, H, scale)
    img.alpha_composite(body_layer)

    # 3. Sheen
    add_sheen(img, BODY_PTS, scale, opacity=0.10)

    # 4. Crease
    add_crease(img, scale, opacity=0.12)

    # 5. Punch out L channel
    l_layer = Image.new("RGBA", (W,H), (0,0,0,0))
    ld = ImageDraw.Draw(l_layer)
    ld.polygon(scale_pts(L_PTS, scale), fill=l_fill)
    img.alpha_composite(l_layer)

    # 6. Focus node glow (purple radial)
    glow_layer = Image.new("RGBA", (W,H), (0,0,0,0))
    # outer soft halo
    draw_radial_glow(glow_layer,
                     cx=int(NX*scale), cy=int(NY*scale),
                     r_inner=int(NODE_R*scale),
                     r_outer=int(GLOW_R*scale),
                     colour=C_PURPLE1, max_alpha=200)
    img.alpha_composite(glow_layer)

    # 7. Lavender disc
    disc = Image.new("RGBA", (W,H), (0,0,0,0))
    dd = ImageDraw.Draw(disc)
    nr = NODE_R * scale
    cx, cy = NX*scale, NY*scale
    dd.ellipse([cx-nr, cy-nr, cx+nr, cy+nr], fill=(*C_LAVENDER, 235))
    img.alpha_composite(disc)

    # 8. White inner core
    core = Image.new("RGBA", (W,H), (0,0,0,0))
    crd = ImageDraw.Draw(core)
    cr = 2.6 * scale
    crd.ellipse([cx-cr, cy-cr, cx+cr, cy+cr], fill=(255,255,255,234))
    img.alpha_composite(core)

    # 9. Apex dot
    apex = Image.new("RGBA", (W,H), (0,0,0,0))
    apd = ImageDraw.Draw(apex)
    ar = 2.4 * scale
    apx, apy = 80*scale, 10*scale
    apd.ellipse([apx-ar, apy-ar, apx+ar, apy+ar], fill=(255,255,255,102))
    img.alpha_composite(apex)

    # 10. Round corners
    if round_corners and not transparent_bg:
        rx = int(34 * scale)
        mask = rounded_rect_mask(W, H, rx)
        img.putalpha(mask)

    return img


def render_monochrome(size: int):
    """White-only glyph on fully transparent background for Android 13+."""
    W = H = size
    scale = size / 160.0
    img = make_canvas(W, H, (0,0,0,0))

    # Body: white at 90% opacity
    body = Image.new("RGBA", (W,H), (0,0,0,0))
    bd = ImageDraw.Draw(body)
    bd.polygon(scale_pts(BODY_PTS, scale), fill=(255,255,255,229))
    img.alpha_composite(body)

    # L cut: fully transparent (erase body pixels)
    lmask = Image.new("L", (W,H), 255)
    lmd = ImageDraw.Draw(lmask)
    lmd.polygon(scale_pts(L_PTS, scale), fill=0)
    # Apply mask: keep alpha where lmask=255, erase where lmask=0
    r,g,b,a = img.split()
    new_a = Image.fromarray(
        __import__("PIL.ImageChops",fromlist=["multiply"]).multiply(a, lmask).tobytes(),
        mode="L"
    )
    img = Image.merge("RGBA", (r,g,b,new_a))

    # Focus node: subtle white circle (OS will tint it)
    nd = ImageDraw.Draw(img)
    nr = NODE_R * scale
    cx, cy = NX*scale, NY*scale
    nd.ellipse([cx-nr, cy-nr, cx+nr, cy+nr], fill=(255,255,255,107))
    core_r = 2.6 * scale
    nd.ellipse([cx-core_r, cy-core_r, cx+core_r, cy+core_r], fill=(255,255,255,183))

    return img


def render_splash(size: int = 2048):
    """Dark splash screen with beacon centred, no corner clipping."""
    W = H = size
    img = make_canvas(W, H, (*C_SPLASH_BG, 255))

    # Beacon occupies ~23% of canvas width, centred
    beacon_px = int(size * 0.234)   # ~480 at 2048
    scale = beacon_px / 160.0
    off_x = (W - beacon_px) / 2
    off_y = (H - beacon_px) / 2

    # Body gradient layer (rendered at beacon size, then pasted)
    body_layer = draw_body_gradient(None, BODY_PTS, beacon_px, beacon_px, scale)
    img.paste(body_layer, (int(off_x), int(off_y)), body_layer)

    # Sheen on full canvas (easier to position via offset)
    s2 = render_icon(beacon_px, (*C_SPLASH_BG, 255), round_corners=False)
    img.paste(s2, (int(off_x), int(off_y)), s2)

    return img


# ── Generate all assets ───────────────────────────────────────────────

def main():
    dark_bg = (*C_DARK_BG2, 255)

    # 1. icon.png
    print("Generating icon.png …")
    icon = render_icon(1024, dark_bg, round_corners=True)
    icon.save(str(OUT / "icon.png"), "PNG", optimize=True)
    print("  [OK] icon.png  1024x1024")

    # 2. adaptive-icon.png (full-bleed, no rounded corners — OS clips)
    print("Generating adaptive-icon.png …")
    adaptive = render_icon(1024, dark_bg, round_corners=False)
    adaptive.save(str(OUT / "adaptive-icon.png"), "PNG", optimize=True)
    print("  [OK] adaptive-icon.png  1024x1024")

    # 3. monochrome-icon.png
    print("Generating monochrome-icon.png …")
    try:
        from PIL import ImageChops
        mono = render_monochrome(1024)
        mono.save(str(OUT / "monochrome-icon.png"), "PNG", optimize=True)
        print("  [OK] monochrome-icon.png  1024x1024")
    except Exception as e:
        # Fallback: simple white-body transparent-L version
        print(f"  Monochrome fallback ({e})")
        mono = make_canvas(1024, 1024, (0,0,0,0))
        md = ImageDraw.Draw(mono)
        sc = 1024/160
        md.polygon(scale_pts(BODY_PTS, sc), fill=(255,255,255,229))
        md.polygon(scale_pts(L_PTS,    sc), fill=(0,0,0,0))
        mono.save(str(OUT / "monochrome-icon.png"), "PNG", optimize=True)
        print("  [OK] monochrome-icon.png  1024x1024 (fallback)")

    # 4. logo-light.png (transparent bg, white L channel)
    print("Generating logo-light.png …")
    logo_light = render_icon(512, (0,0,0,0), round_corners=False, transparent_bg=True)
    # Redraw L as transparent
    ll_draw = ImageDraw.Draw(logo_light)
    ll_draw.polygon(scale_pts(L_PTS, 512/160), fill=(0,0,0,0))
    logo_light.save(str(OUT / "logo-light.png"), "PNG", optimize=True)
    print("  [OK] logo-light.png  512x512")

    # 5. logo-dark.png (transparent bg, dark L channel, extra ambient glow)
    print("Generating logo-dark.png …")
    logo_dark = render_icon(512, (0,0,0,0), round_corners=False, transparent_bg=True)
    ld_draw = ImageDraw.Draw(logo_dark)
    ld_draw.polygon(scale_pts(L_PTS, 512/160), fill=(0,0,0,140))
    logo_dark.save(str(OUT / "logo-dark.png"), "PNG", optimize=True)
    print("  [OK] logo-dark.png  512x512")

    # 6. splash.png
    print("Generating splash.png …")
    splash = render_splash(2048)
    splash.save(str(OUT / "splash.png"), "PNG", optimize=True)
    print("  [OK] splash.png  2048x2048")

    print("\n[DONE]  All assets generated.")
    print(f"   Output: {OUT.resolve()}")


if __name__ == "__main__":
    main()
