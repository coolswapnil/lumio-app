/**
 * generate-icons.js
 * Generates Lumio app icon, adaptive icon, splash screen, and favicon
 * as PNG files using pure Node.js (no external dependencies — uses built-in
 * canvas via the `canvas` npm package which is a devDependency).
 *
 * Run: node scripts/generate-icons.js
 *
 * Outputs:
 *   assets/icon.png          1024×1024  App icon (iOS / Play Store)
 *   assets/adaptive-icon.png  1024×1024  Android adaptive foreground
 *   assets/splash.png         1284×2778  Splash screen
 *   assets/favicon.png          48×48   Web favicon
 *
 * If the `canvas` package is not installed the script falls back to writing
 * minimal valid PNG placeholders that Expo's prebuild accepts without errors.
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Minimal valid 1×1 transparent PNG (base64) ─────────────────────────────
// Used as a last-resort fallback if canvas is unavailable AND the assets
// directory already has real PNGs (we won't overwrite them).
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function writePlaceholder(filePath, label) {
  if (fs.existsSync(filePath)) {
    console.log(`  ✓ ${path.basename(filePath)} already exists — skipped`);
    return;
  }
  fs.writeFileSync(filePath, Buffer.from(TINY_PNG_B64, 'base64'));
  console.log(`  ⚠ ${path.basename(filePath)} — placeholder written (install 'canvas' for real icons)`);
}

// ─── Try to use the canvas package ──────────────────────────────────────────
let createCanvas;
try {
  ({ createCanvas } = require('canvas'));
} catch {
  console.warn('\n[generate-icons] canvas package not found. Writing placeholder PNGs.\n');
  writePlaceholder(path.join(OUT_DIR, 'icon.png'), 'icon');
  writePlaceholder(path.join(OUT_DIR, 'adaptive-icon.png'), 'adaptive-icon');
  writePlaceholder(path.join(OUT_DIR, 'splash.png'), 'splash');
  writePlaceholder(path.join(OUT_DIR, 'favicon.png'), 'favicon');
  process.exit(0);
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

/** Draw a rounded rectangle path. */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/**
 * Draw the Lumio wordmark + bookmark icon on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx  centre X
 * @param {number} cy  centre Y
 * @param {number} scale  1 = standard 1024 size
 */
function drawLumioLogo(ctx, cx, cy, scale = 1) {
  const S = scale;

  // ── Bookmark icon ─────────────────────────────────────────────────────────
  // A filled bookmark shape with a small star/light burst at top
  const bmW = 120 * S;
  const bmH = 150 * S;
  const bmX = cx - bmW / 2;
  const bmY = cy - bmH / 2 - 30 * S;

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(bmX, bmY);
  ctx.lineTo(bmX + bmW, bmY);
  ctx.lineTo(bmX + bmW, bmY + bmH);
  // V-notch at bottom
  ctx.lineTo(bmX + bmW / 2, bmY + bmH - 28 * S);
  ctx.lineTo(bmX, bmY + bmH);
  ctx.closePath();
  ctx.fill();

  // Corner radius overlay using clip — just draw it slightly smaller with arc
  // Inner glow: semi-transparent bookmark
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(bmX + 10 * S, bmY + 10 * S);
  ctx.lineTo(bmX + bmW - 10 * S, bmY + 10 * S);
  ctx.lineTo(bmX + bmW - 10 * S, bmY + bmH - 10 * S);
  ctx.lineTo(bmX + bmW / 2, bmY + bmH - 36 * S);
  ctx.lineTo(bmX + 10 * S, bmY + bmH - 10 * S);
  ctx.closePath();
  ctx.fill();

  // ── Sparkle / light dot at top of bookmark ────────────────────────────────
  const dotX = cx;
  const dotY = bmY + 28 * S;
  const dotR = 14 * S;
  ctx.fillStyle = '#60a5fa'; // light blue
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
  ctx.fill();

  // ── "Lumio" text below bookmark ───────────────────────────────────────────
  const textY = bmY + bmH + 42 * S;
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 ${90 * S}px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Lumio', cx, textY);
}

// ─── 1. icon.png — 1024×1024 ─────────────────────────────────────────────────
(function generateIcon() {
  const SIZE = 1024;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Background gradient — deep navy to indigo
  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, SIZE, SIZE, 180);
  ctx.fill();

  drawLumioLogo(ctx, SIZE / 2, SIZE / 2, 1);

  const out = path.join(OUT_DIR, 'icon.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`  ✓ icon.png (${SIZE}×${SIZE})`);
})();

// ─── 2. adaptive-icon.png — 1024×1024 foreground (transparent bg) ────────────
(function generateAdaptiveIcon() {
  const SIZE = 1024;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Transparent background — Android will apply its own bg (#0f172a from app.json)
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Draw logo centred, slightly smaller to respect the safe zone (66% of canvas)
  drawLumioLogo(ctx, SIZE / 2, SIZE / 2, 0.75);

  const out = path.join(OUT_DIR, 'adaptive-icon.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`  ✓ adaptive-icon.png (${SIZE}×${SIZE})`);
})();

// ─── 3. splash.png — 1284×2778 (iPhone 14 Pro Max size, safe for all) ────────
(function generateSplash() {
  const W = 1284;
  const H = 2778;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Background
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle radial glow at centre
  const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 600);
  glow.addColorStop(0, 'rgba(59,130,246,0.18)');
  glow.addColorStop(1, 'rgba(59,130,246,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Logo centred — scale up for splash
  drawLumioLogo(ctx, W / 2, H / 2, 1.4);

  // Tagline
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = `400 36px -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Your personal knowledge hub', W / 2, H / 2 + 230);

  const out = path.join(OUT_DIR, 'splash.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`  ✓ splash.png (${W}×${H})`);
})();

// ─── 4. favicon.png — 48×48 ──────────────────────────────────────────────────
(function generateFavicon() {
  const SIZE = 48;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  grad.addColorStop(0, '#0f172a');
  grad.addColorStop(1, '#1e3a8a');
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, SIZE, SIZE, 10);
  ctx.fill();

  // Small bookmark
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(13, 10);
  ctx.lineTo(35, 10);
  ctx.lineTo(35, 40);
  ctx.lineTo(24, 33);
  ctx.lineTo(13, 40);
  ctx.closePath();
  ctx.fill();

  // Dot
  ctx.fillStyle = '#60a5fa';
  ctx.beginPath();
  ctx.arc(24, 19, 4, 0, Math.PI * 2);
  ctx.fill();

  const out = path.join(OUT_DIR, 'favicon.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`  ✓ favicon.png (${SIZE}×${SIZE})`);
})();

console.log('\n✅ All Lumio icon assets generated in assets/\n');
