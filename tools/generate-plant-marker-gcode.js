#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../tmp/prints/peppermint-plant-marker.gcode');

const MM_PER_IN = 25.4;
const TAG_W = 3 * MM_PER_IN;
const TAG_H = 1.5 * MM_PER_IN;
const SPIKE_L = 4.5 * MM_PER_IN;
const SPIKE_TOP_W = 15;
const SPIKE_TIP_W = 3;
const BASE_Z = 2.0;
const RAISED_Z = 2.8;
const LAYER_H = 0.2;
const LINE_W = 0.45;
const FILAMENT_D = 1.75;
const E_PER_MM = (LINE_W * LAYER_H) / (Math.PI * (FILAMENT_D / 2) ** 2);
const TRAVEL = 4500;
const PRINT = 1800;
const TEXT_PRINT = 900;

let x = 0;
let y = 0;
let z = 0;
let e = 0;
const g = [];

function emit(line = '') {
  g.push(line);
}

function moveTo(nx, ny, nz = z, f = TRAVEL) {
  z = nz;
  emit(`G0 X${nx.toFixed(3)} Y${ny.toFixed(3)} Z${z.toFixed(3)} F${f}`);
  x = nx;
  y = ny;
}

function extrudeTo(nx, ny, f = PRINT) {
  const d = Math.hypot(nx - x, ny - y);
  e += d * E_PER_MM;
  emit(`G1 X${nx.toFixed(3)} Y${ny.toFixed(3)} E${e.toFixed(5)} F${f}`);
  x = nx;
  y = ny;
}

function polygonAtY(poly, yy) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y <= yy && b.y > yy) || (b.y <= yy && a.y > yy)) {
      const t = (yy - a.y) / (b.y - a.y);
      xs.push(a.x + t * (b.x - a.x));
    }
  }
  xs.sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
  return spans;
}

function insetPoly(poly, inset) {
  return poly.map((p) => {
    const cx = TAG_W / 2;
    const cy = (SPIKE_L + TAG_H) / 2;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dx / len) * inset, y: p.y - (dy / len) * inset };
  });
}

function drawPolygon(poly, offset = 0) {
  const p = offset ? insetPoly(poly, offset) : poly;
  moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) extrudeTo(p[i].x, p[i].y);
  extrudeTo(p[0].x, p[0].y);
}

function fillPolygon(poly, spacing = 0.9) {
  const minY = Math.min(...poly.map((p) => p.y));
  const maxY = Math.max(...poly.map((p) => p.y));
  let reverse = false;
  for (let yy = minY + 1.1; yy <= maxY - 1.1; yy += spacing) {
    const spans = polygonAtY(poly, yy);
    for (const [a, b] of spans) {
      if (b - a < 1.5) continue;
      const sx = a + 0.7;
      const ex = b - 0.7;
      if (!reverse) {
        moveTo(sx, yy);
        extrudeTo(ex, yy);
      } else {
        moveTo(ex, yy);
        extrudeTo(sx, yy);
      }
      reverse = !reverse;
    }
  }
}

const strokes = {
  A: ['top', 'ul', 'ur', 'mid'],
  B: ['left', 'top', 'mid', 'bot', 'ur', 'lr'],
  C: ['top', 'left', 'bot'],
  D: ['left', 'top', 'bot', 'ur', 'lr'],
  E: ['top', 'mid', 'bot', 'left'],
  F: ['top', 'mid', 'left'],
  G: ['top', 'left', 'bot', 'lr', 'mid'],
  H: ['left', 'right', 'mid'],
  I: ['top', 'bot', 'vc'],
  J: ['top', 'right', 'bot'],
  K: ['left', 'diag1', 'diag2'],
  L: ['left', 'bot'],
  M: ['left', 'right', 'diagDownL', 'diagDownR'],
  N: ['left', 'right', 'diagFull'],
  O: ['top', 'left', 'right', 'bot'],
  P: ['top', 'left', 'mid', 'ur'],
  Q: ['top', 'left', 'right', 'bot', 'tail'],
  R: ['top', 'left', 'mid', 'ur', 'diag2'],
  S: ['top', 'mid', 'bot', 'ul', 'lr'],
  T: ['top', 'vc'],
  U: ['left', 'right', 'bot'],
  V: ['vleft', 'vright'],
  W: ['left', 'right', 'diagUpL', 'diagUpR'],
  X: ['diagFull', 'diagBack'],
  Y: ['diagY1', 'diagY2', 'vcLow'],
  Z: ['top', 'bot', 'diagBack'],
};

function segmentPoints(seg, ox, oy, w, h) {
  const x0 = ox;
  const x1 = ox + w / 2;
  const x2 = ox + w;
  const y0 = oy;
  const y1 = oy + h / 2;
  const y2 = oy + h;
  return {
    top: [x0, y2, x2, y2],
    mid: [x0, y1, x2, y1],
    bot: [x0, y0, x2, y0],
    left: [x0, y0, x0, y2],
    right: [x2, y0, x2, y2],
    ul: [x0, y1, x0, y2],
    ur: [x2, y1, x2, y2],
    lr: [x2, y0, x2, y1],
    vc: [x1, y0, x1, y2],
    vcLow: [x1, y0, x1, y1],
    diag1: [x0, y1, x2, y2],
    diag2: [x0, y1, x2, y0],
    diagFull: [x0, y2, x2, y0],
    diagBack: [x0, y0, x2, y2],
    diagDownL: [x0, y2, x1, y1],
    diagDownR: [x2, y2, x1, y1],
    diagUpL: [x0, y0, x1, y1],
    diagUpR: [x2, y0, x1, y1],
    diagY1: [x0, y2, x1, y1],
    diagY2: [x2, y2, x1, y1],
    vleft: [x0, y2, x1, y0],
    vright: [x2, y2, x1, y0],
    tail: [x1, y1, x2, y0],
  }[seg];
}

function drawText(text) {
  const letterW = 5.1;
  const letterH = 14;
  const gap = 1.35;
  const totalW = text.length * letterW + (text.length - 1) * gap;
  const startX = (TAG_W - totalW) / 2;
  const baseY = SPIKE_L + 12.0;
  const passes = [-0.35, 0.35];
  for (let pass = 0; pass < 4; pass++) {
    const off = passes[pass % passes.length];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const list = strokes[ch] || [];
      const ox = startX + i * (letterW + gap);
      for (const seg of list) {
        const pts = segmentPoints(seg, ox, baseY, letterW, letterH);
        if (!pts) continue;
        const [x1, y1, x2, y2] = pts;
        const horiz = Math.abs(y2 - y1) < Math.abs(x2 - x1);
        moveTo(x1, y1 + (horiz ? off : 0));
        extrudeTo(x2, y2 + (horiz ? off : 0), TEXT_PRINT);
      }
    }
  }
}

const poly = [
  { x: (TAG_W - SPIKE_TIP_W) / 2, y: 0 },
  { x: (TAG_W - SPIKE_TOP_W) / 2, y: SPIKE_L },
  { x: 0, y: SPIKE_L },
  { x: 0, y: SPIKE_L + TAG_H },
  { x: TAG_W, y: SPIKE_L + TAG_H },
  { x: TAG_W, y: SPIKE_L },
  { x: (TAG_W + SPIKE_TOP_W) / 2, y: SPIKE_L },
  { x: (TAG_W + SPIKE_TIP_W) / 2, y: 0 },
];

emit('; Peppermint garden plant identification marker');
emit('; Body: 3.0 in x 1.5 in; spike: 4.5 in; raised text');
emit('M140 S60');
emit('M104 S210');
emit('G21');
emit('G90');
emit('M82');
emit('G28');
emit('M190 S60');
emit('M109 S210');
emit('G92 E0');
emit('G0 Z5 F3000');

for (let layer = 1; layer <= Math.round(BASE_Z / LAYER_H); layer++) {
  z = +(layer * LAYER_H).toFixed(3);
  emit(`; base layer ${layer}`);
  moveTo(poly[0].x, poly[0].y, z);
  drawPolygon(poly);
  drawPolygon(poly, 0.9);
  fillPolygon(poly, layer <= 3 ? 0.65 : 1.1);
}

for (let layer = 1; layer <= Math.round((RAISED_Z - BASE_Z) / LAYER_H); layer++) {
  z = +(BASE_Z + layer * LAYER_H).toFixed(3);
  emit(`; raised PEPPERMINT layer ${layer}`);
  moveTo(0, 0, z);
  drawText('PEPPERMINT');
}

emit('G0 Z8 F3000');
emit('M104 S0');
emit('M140 S0');
emit('G90');
emit('G0 X80 Y160 F3000');
emit('M84');
emit('; end');

fs.writeFileSync(OUT, g.join('\n') + '\n');
console.log(OUT);
