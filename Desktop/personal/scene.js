/*
 * Golden-hour grassland: the animated background for the site.
 *
 *   const scene = startScene(canvas, { contributions: window.CONTRIBUTIONS, onLayout, sign: 'RONIT LONGIA' });
 *   scene.relayout(); // after the page above the chart changes height
 *   scene.stop();
 *
 * Plain canvas 2D, no dependencies. The landscape is generated from a fixed
 * seed, so it is the same on every visit. The wind, clouds, birds and drifting
 * seeds are what move, and the grass parts around the pointer. The GitHub
 * contribution calendar (contributions.js) is drawn in starlight in the upper
 * sky; onLayout(rect) reports where, or null when there's no data.
 * With prefers-reduced-motion on, it draws one still frame instead.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------- palette

  const SEED = 1118;

  const COLORS = {
    sky: [
      [0, '#141d38'],
      [0.4, '#26325c'],
      [0.62, '#4d5283'],
      [0.78, '#9a7f9e'],
      [0.88, '#e2a48f'],
      [0.95, '#f8c58f'],
      [1, '#ffe0ad'],
    ],
    haze: '#f4cda0',
    // mountain ranges, far to near: [ridge, lower slopes]; each fades into haze at its foot
    ranges: [
      ['#b6a4c4', '#dcb6b4'],
      ['#9b8cb4', '#cba3ad'],
      ['#82739e', '#b6909c'],
      ['#6a5d85', '#a07e8d'],
    ],
    hillFar: ['#c8ad7a', '#a99064'],
    hillMid: ['#a08a45', '#5f4f29'],
    hillNear: ['#86723a', '#21180c'],
    grassBody: ['#7d6a37', '#2b1e0e'], // back rows, front rows
    grassRim: ['#f1d59a', '#ffd37c'], // backlit edges of the blades
    sheen: '#fff1c6', // grass catching the light as the wind bends it
    light: '#ffdc98', // rim light from the low sun
    tree: '#3a3321',
    bird: 'rgba(36, 29, 54, 0.72)',
  };

  const OV = 24; // overscan in css px, so parallax never reveals an edge
  const SHIFT = 16; // parallax travel of the nearest layer, css px
  const BANDS = 6; // depth bands of foreground grass, back to front
  const LEVELS = 4; // brightness steps per band, for the wind sheen

  // -------------------------------------------------------- math and noise

  const TAU = Math.PI * 2;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function hash(a, b) {
    let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function random(seed) {
    let s = seed | 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 1D gradient noise, about -1..1
  function noise(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    return 2 * lerp((hash(i, seed) * 2 - 1) * f, (hash(i + 1, seed) * 2 - 1) * (f - 1), u);
  }

  function fbm(x, seed) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < 4; o++) {
      sum += amp * noise(x, seed + o * 101);
      norm += amp;
      amp *= 0.5;
      x *= 2.07;
    }
    return sum / norm;
  }

  // Sharp-crested noise for mountain ridges, about 0..1
  function ridged(x, seed) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < 6; o++) {
      const n = 1 - Math.abs(noise(x, seed + o * 101));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.47;
      x *= 2.13;
    }
    return sum / norm;
  }

  // 2D value noise that wraps every `period` cells in x, 0..1
  function noise2(x, y, period, seed) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const x0 = ((ix % period) + period) % period;
    const x1 = (x0 + 1) % period;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const r0 = iy * 7919 + seed;
    const r1 = r0 + 7919;
    return lerp(lerp(hash(x0, r0), hash(x1, r0), ux), lerp(hash(x0, r1), hash(x1, r1), ux), uy);
  }

  function fbm2(x, y, period, seed) {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < 5; o++) {
      sum += amp * noise2(x, y, period, seed + o * 13);
      norm += amp;
      amp *= 0.5;
      x *= 2;
      y *= 2;
      period *= 2;
    }
    return sum / norm;
  }

  // -------------------------------------------------- color, mixed in OKLab

  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

  function lab(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = toLinear(((n >> 16) & 255) / 255);
    const g = toLinear(((n >> 8) & 255) / 255);
    const b = toLinear((n & 255) / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function rgb(c) {
    const l = (c[0] + 0.3963377774 * c[1] + 0.2158037573 * c[2]) ** 3;
    const m = (c[0] - 0.1055613458 * c[1] - 0.0638541728 * c[2]) ** 3;
    const s = (c[0] - 0.0894841775 * c[1] - 1.291485548 * c[2]) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => Math.round(toGamma(clamp(v, 0, 1)) * 255));
  }

  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  function css(c, alpha = 1) {
    const [r, g, b] = rgb(c);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ramp([[0, '#hex'], ..., [1, '#hex']]) gives t => OKLab color
  function ramp(stops) {
    const s = stops.map(([at, hex]) => [at, lab(hex)]);
    return (t) => {
      t = clamp(t, 0, 1);
      let i = 1;
      while (i < s.length - 1 && t > s[i][0]) i++;
      const [a0, c0] = s[i - 1];
      const [a1, c1] = s[i];
      return mix(c0, c1, (t - a0) / (a1 - a0));
    };
  }

  // Many stops sampled from a ramp, so the canvas gradient follows OKLab
  function paint(gradient, colorAt, steps = 16) {
    for (let i = 0; i <= steps; i++) gradient.addColorStop(i / steps, css(colorAt(i / steps)));
    return gradient;
  }

  function layer(w, h, scale) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(w * scale));
    canvas.height = Math.max(1, Math.ceil(h * scale));
    const g = canvas.getContext('2d');
    g.scale(scale, scale);
    return { canvas, g, w, h };
  }

  // A strip of soft cloud that tiles horizontally. Undersides catch the sun.
  function cloudStrip({ width, height, period, rows, cover, soft, alpha, shade, lit, seed }) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    const img = g.createImageData(width, height);
    const px = img.data;
    const density = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        density[y * width + x] = fbm2((x / width) * period, (y / height) * rows, period, seed);
      }
    }
    const a = lab(shade);
    const b = lab(lit);
    const colors = Array.from({ length: 33 }, (_, i) => rgb(mix(a, b, i / 32)));
    const reach = Math.max(1, Math.round(height * 0.08));
    for (let y = 0; y < height; y++) {
      const v = y / (height - 1);
      const fade = Math.sin(Math.PI * v) ** 0.8;
      const below = Math.min(height - 1, y + reach);
      for (let x = 0; x < width; x++) {
        const n = density[y * width + x];
        const d = smoothstep(cover, cover + soft, n) * fade;
        if (d <= 0) continue;
        const lightness = clamp(0.4 + (n - density[below * width + x]) * 8 + (v - 0.5) * 0.7, 0, 1);
        const c = colors[(lightness * 32) | 0];
        const i = (y * width + x) * 4;
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
        px[i + 3] = d * alpha * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvas;
  }

  // ---------------------------------------------------------- build a scene

  // Everything that depends on the viewport size: the landscape layers
  // (rendered once), the grass blades, the seeds and the sunlight.
  function buildScene(ctx, W, H, dpr, contributions, signText, chartTop, awardList) {
    const rnd = random(SEED);
    const portrait = H > W * 1.15;
    const horizon = H * (portrait ? 0.6 : 0.585);
    const sunR = clamp(Math.min(W, H) * 0.03, 14, 30);
    const sizeX = clamp(W / 1440, 0.45, 1.6);

    const range = (x, seed, base, height, freq) => {
      const u = x / H;
      const r = clamp((ridged(u * freq, seed) - 0.3) / 0.62, 0, 1);
      return base - H * height * r * (0.55 + 0.45 * noise(u * 0.7, seed + 7));
    };
    // far to near: foot (from the horizon), peak height and ridge frequency, as fractions of H
    const RIDGES = [
      [-0.035, 0.13, 1.7],
      [-0.012, 0.1, 2.5],
      [0.008, 0.075, 3.3],
      [0.024, 0.05, 4.4],
    ];
    const ridges = RIDGES.map(
      ([foot, height, freq], i) => (x) => range(x, SEED + 50 + i * 10, horizon + H * foot, height, freq)
    );
    const skyline = (x) => {
      let y = Infinity;
      for (const ridge of ridges) y = Math.min(y, ridge(x));
      return y;
    };

    // Rest the sun in the lowest dip of the skyline near its spot
    let sunX = W * (portrait ? 0.66 : 0.7);
    let sunY = 0;
    {
      let best = -Infinity;
      let at = sunX;
      for (let x = sunX - W * 0.07; x <= sunX + W * 0.07; x += 2) {
        let top = Infinity;
        for (let k = -2; k <= 2; k++) top = Math.min(top, skyline(x + k * sunR * 0.5));
        if (top > best) {
          best = top;
          at = x;
        }
      }
      sunX = at;
      sunY = best - sunR * 0.35;
    }

    const treeX = W * (portrait ? 0.26 : 0.2);
    const treeH = H * (portrait ? 0.075 : 0.092);
    const signCap = clamp(H * 0.1, 20, 110); // capital height of the name sign, before fitting the width
    const awardCap = clamp(H * 0.028, 11, 32); // and of the smaller award signs, before depth scaling
    // the far sign is skipped on phones, where the tree and the name leave it no room
    const awards = (Array.isArray(awardList) ? awardList : []).filter((a) => !(portrait && a.row === 0));
    // where an award sign stands, by its row: 0 = on the far hill, behind the name sign;
    // 1-3 = on the near hill, each a little further down the slope from its crest (kept where the
    // grass is short and the ground smooth: dark letters are unreadable against busy grass)
    // (band: which grass row it sits behind; dy: how far below the hill's crest, as a share of H)
    const awardRows = [{ cap: 0.75 }, { band: 2, dy: 0.042, cap: 1.1 }, { band: 3, dy: portrait ? 0.07 : 0.022, cap: 1 }, { band: 3, dy: 0.056, cap: 1.2 },
      { hill: 'B', dy: 0.054, cap: 1.05 }]; // 4: on the smooth slope of the middle hill, below the name
    const awardOpts = (a, i, grass) => ({
      cap: awardCap * awardRows[a.row].cap,
      center: a.x * W,
      maxW: W * (portrait ? 0.72 : 0.36),
      edge: W * 0.05, // keep the whole word on screen
      seed: SEED + 800 + i,
      grass,
    });
    const knoll = Math.max(W * 0.13, H * 0.12);
    // hills roll at a pace set by the shorter side, so phones still get some
    const unit = Math.min(H, W * 0.9);
    const hillAY = (x) => horizon + H * 0.032 + H * 0.022 * fbm((x / unit) * 1.6, SEED + 5);
    const hillBY = (x) =>
      horizon +
      H * 0.088 +
      H * 0.04 * fbm((x / unit) * 1.1, SEED + 6) -
      H * 0.03 * Math.exp(-(((x - treeX) / knoll) ** 2));
    const hillCY = (x) => horizon + H * 0.16 + H * 0.034 * fbm((x / unit) * 0.9, SEED + 7);

    const lowest = (f) => {
      let y = -Infinity;
      for (let x = -OV; x <= W + OV; x += 4) y = Math.max(y, f(x));
      return y;
    };

    const light = lab(COLORS.light);
    // Sunlight as a left-to-right gradient, strongest straight below the sun
    function sunlit(g, near, far, spread = W * 0.22, color = light) {
      const grad = g.createLinearGradient(-OV, 0, W + OV, 0);
      for (let i = 0; i <= 24; i++) {
        const x = lerp(-OV, W + OV, i / 24);
        grad.addColorStop(i / 24, css(color, far + (near - far) * Math.exp(-(((x - sunX) / spread) ** 2))));
      }
      return grad;
    }

    // One band of landscape (a ridge or a hill), rendered once to its own canvas
    function land(contour, o) {
      const xs = [];
      const ys = [];
      let top = Infinity;
      for (let x = -OV; x <= W + OV + 2; x += 2) {
        const y = contour(x);
        xs.push(x);
        ys.push(y);
        if (y < top) top = y;
      }
      const y0 = Math.floor(top - (o.pad || 10));
      const y1 = Math.ceil(o.bottom);
      const L = layer(W + OV * 2, y1 - y0, dpr);
      const g = L.g;
      g.translate(OV, -y0);
      const crest = new Path2D();
      crest.moveTo(xs[0], ys[0]);
      for (let i = 1; i < xs.length; i++) crest.lineTo(xs[i], ys[i]);
      const body = new Path2D(crest);
      body.lineTo(W + OV + 2, y1);
      body.lineTo(-OV, y1);
      body.closePath();
      g.fillStyle = paint(g.createLinearGradient(0, top, 0, o.fillTo || y1), o.fill, 12);
      g.fill(body);
      if (o.texture) {
        g.save();
        g.clip(body);
        for (const paintTexture of o.texture) paintTexture(g, contour, y1);
        g.restore();
      }
      if (o.rim) {
        g.lineWidth = o.rim[0];
        g.lineJoin = 'round';
        g.strokeStyle = sunlit(g, o.rim[1], o.rim[2]);
        g.stroke(crest);
      }
      if (o.decorate) o.decorate(g, contour);
      return { canvas: L.canvas, x: -OV, y: y0, w: L.w, h: L.h, depth: o.depth, body, contour };
    }

    // Short strokes of grass scattered over a hill, thickest near its crest
    function strokes(count, length, width, colors) {
      return (g, contour, bottom) => {
        for (const [color, share] of colors) {
          g.beginPath();
          for (let i = 0; i < count * share; i++) {
            const x = -OV + rnd() * (W + OV * 2);
            const top = contour(x);
            const y = top + 1 + (bottom - top) * rnd() ** 1.8;
            const l = length * (0.5 + rnd());
            g.moveTo(x, y);
            g.lineTo(x + l * (rnd() * 0.5 - 0.05), y - l);
          }
          g.strokeStyle = color;
          g.lineWidth = width;
          g.stroke();
        }
      };
    }

    // Broad, soft patches of light and shade, like uneven grass across a slope
    function patches(count, size, colors) {
      return (g, contour, bottom) => {
        for (let i = 0; i < count; i++) {
          const [color, alpha] = colors[i % colors.length];
          const x = -OV + rnd() * (W + OV * 2);
          const top = contour(x);
          const r = size * (0.6 + rnd() * 0.8);
          const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
          grad.addColorStop(0, css(lab(color), alpha));
          grad.addColorStop(1, css(lab(color), 0));
          g.save();
          g.translate(x, top + (bottom - top) * rnd() * 0.5);
          g.scale(1, 0.32);
          g.fillStyle = grad;
          g.fillRect(-r, -r, r * 2, r * 2);
          g.restore();
        }
      };
    }

    // A ragged edge of grass along a crest; backlit, so it glows near the sun
    function fringe(g, contour, step, length, color, glow) {
      const p = new Path2D();
      for (let x = -OV; x < W + OV; x += step * (0.5 + rnd())) {
        const y = contour(x) + 1;
        const l = length * (0.3 + rnd() ** 2 * 1.2);
        const lean = (rnd() - 0.35) * l * 0.6;
        p.moveTo(x, y);
        p.quadraticCurveTo(x + lean * 0.2, y - l * 0.6, x + lean, y - l);
      }
      g.lineWidth = 1;
      g.strokeStyle = color;
      g.stroke(p);
      g.strokeStyle = sunlit(g, glow, 0);
      g.stroke(p);
    }

    // A few small trees far off, for scale
    function farTrees(g, contour, color) {
      g.fillStyle = color;
      for (let i = 0; i < 8; i++) {
        const x = W * (0.04 + rnd() * 0.92);
        const s = lerp(2.2, 4.5, rnd()) * (H / 900);
        const y = contour(x) + 1;
        g.fillRect(x - 0.4, y - s * 1.4, 0.8, s * 1.4);
        g.beginPath();
        g.ellipse(x, y - s * 1.6, s * 0.9, s * 0.7, 0, 0, TAU);
        g.fill();
      }
    }

    // A lone tree, backlit: dark, with a thin rim of light on the sun side
    function tree(g, x, y, h) {
      const side = sunX > x ? 1 : -1;
      const cx = x + h * 0.04;
      const cy = y - h * 0.72;
      const rw = h * 0.6;
      const rh = h * 0.28;
      const limbs = [];
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * 0.45 + (rnd() - 0.5) * 0.2;
        limbs.push([
          cx + Math.cos(a) * rw * 0.7,
          cy + Math.sin(a) * rh * 0.5 + rh * 0.25,
          h * (0.034 - Math.abs(i - 2) * 0.007),
        ]);
      }
      const blobs = [];
      for (let i = 0; i < 110; i++) {
        const a = rnd() * TAU;
        const r = Math.sqrt(rnd());
        const s = Math.sin(a);
        blobs.push([
          cx + Math.cos(a) * r * rw,
          cy + s * r * rh * (s > 0 ? 0.55 : 1),
          h * (0.035 + rnd() * 0.05) * (1.35 - r * 0.5),
        ]);
      }
      const top = h * 1.25;
      const T = layer(h * 2, top + h * 0.1, dpr);
      const t = T.g;
      t.translate(h - x, top - y);
      const shape = (dx, dy) => {
        t.save();
        t.translate(dx, dy);
        t.beginPath();
        t.moveTo(x - h * 0.05, y + 3);
        t.quadraticCurveTo(x - h * 0.018, y - h * 0.25, x - h * 0.026, y - h * 0.5);
        t.lineTo(x + h * 0.026, y - h * 0.5);
        t.quadraticCurveTo(x + h * 0.022, y - h * 0.25, x + h * 0.055, y + 3);
        t.fill();
        t.lineCap = 'round';
        for (const [lx, ly, lw] of limbs) {
          t.lineWidth = Math.max(0.8, lw);
          t.beginPath();
          t.moveTo(x, y - h * 0.45);
          t.quadraticCurveTo((x + lx) / 2, ly + h * 0.1, lx, ly);
          t.stroke();
        }
        t.beginPath();
        for (const [bx, by, r] of blobs) {
          t.moveTo(bx + r, by);
          t.arc(bx, by, r, 0, TAU);
        }
        t.fill();
        t.restore();
      };
      t.fillStyle = t.strokeStyle = COLORS.light;
      shape(0, 0);
      t.globalCompositeOperation = 'source-atop';
      t.fillStyle = t.strokeStyle = COLORS.tree;
      shape(-1.5 * side, 1);
      g.drawImage(T.canvas, x - h, y - top, T.w, T.h);
    }

    // A sign standing along a hill's crest, backlit like the tree: dark letters
    // with a thin glowing edge towards the sun, shadows running down the slope
    // towards the viewer, and grass around their feet. Its own random numbers,
    // so the rest of the landscape stays the same with or without it.
    // o: { cap: capital height, center: x of the word's middle, maxW: widest it may be,
    //      seed, grass: colour of the tufts at its feet }
    function sign(g, contour, text, o) {
      const srnd = random(o.seed);
      let size = o.cap / 0.72; // caps are about 0.72 of the font size
      const chars = [...text];
      const fit = () => {
        g.font = `800 ${size}px ${SIGN_FONT}`;
        const widths = chars.map((c) => (c === ' ' ? size * 0.42 : g.measureText(c).width));
        return { widths, total: widths.reduce((a, b) => a + b, 0) + size * 0.1 * (chars.length - 1) };
      };
      let { widths, total } = fit();
      if (total > o.maxW) {
        size *= o.maxW / total;
        ({ widths, total } = fit());
      }
      const cap = size * 0.72;
      const letters = [];
      let x = o.center - total / 2;
      if (o.edge) x = clamp(x, o.edge, W - o.edge - total);
      chars.forEach((c, i) => {
        if (c !== ' ') letters.push({ c, w: widths[i], cx: x + widths[i] / 2, tilt: (srnd() - 0.5) * 0.04 });
        x += widths[i] + size * 0.1;
      });
      // stand on the ground, but smoothed towards a straight line so the word reads as one
      const mx = letters.reduce((s, L) => s + L.cx, 0) / letters.length;
      const my = letters.reduce((s, L) => s + contour(L.cx), 0) / letters.length;
      let sxy = 0;
      let sxx = 0;
      for (const L of letters) {
        sxy += (L.cx - mx) * (contour(L.cx) - my);
        sxx += (L.cx - mx) ** 2;
      }
      const slope = sxx ? sxy / sxx : 0;
      for (const L of letters) L.base = lerp(my + slope * (L.cx - mx), contour(L.cx), 0.35) + size * 0.1;
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';

      // shadows: long and soft, thrown down the slope towards you, leaning away from the sun
      const blur = typeof g.filter === 'string';
      if (blur) g.filter = `blur(${(size * 0.07 * dpr).toFixed(1)}px)`;
      for (const L of letters) {
        g.save();
        g.translate(L.cx, L.base);
        g.transform(1, 0, -((L.cx - sunX) / W) * 2.2, -1.5, 0, 0);
        const fade = g.createLinearGradient(0, 0, 0, -cap);
        fade.addColorStop(0, 'rgba(26, 20, 10, 0.34)');
        fade.addColorStop(1, 'rgba(26, 20, 10, 0)');
        g.fillStyle = fade;
        g.fillText(L.c, -L.w / 2, 0);
        g.restore();
      }
      if (blur) g.filter = 'none';

      // letters: fill in rim light, then cover all but the sun-facing edge with the dark face
      const pad = size * 0.4;
      const left = letters[0].cx - letters[0].w / 2 - pad;
      const right = letters[letters.length - 1].cx + letters[letters.length - 1].w / 2 + pad;
      const top = Math.min(...letters.map((L) => L.base)) - cap - pad;
      const bottom = Math.max(...letters.map((L) => L.base)) + pad;
      const T = layer(right - left, bottom - top, dpr);
      const t = T.g;
      t.translate(-left, -top);
      t.font = g.font;
      t.textAlign = 'left';
      t.textBaseline = 'alphabetic';
      const face = lab('#2c271d');
      const paint = (L, dx, dy, color) => {
        t.save();
        t.translate(L.cx + dx, L.base + dy);
        t.rotate(L.tilt);
        t.fillStyle = color;
        t.fillText(L.c, -L.w / 2, 0);
        t.restore();
      };
      for (const L of letters) {
        const lit = 0.35 + 0.65 * Math.exp(-(((L.cx - sunX) / (W * 0.25)) ** 2));
        paint(L, 0, 0, css(mix(face, light, lit)));
      }
      t.globalCompositeOperation = 'source-atop';
      for (const L of letters) paint(L, (sunX > L.cx ? -1 : 1) * 1.3, 0.9, css(face));
      g.drawImage(T.canvas, left, top, T.w, T.h);

      // grass growing up around the feet of the letters
      const tufts = new Path2D();
      for (const L of letters) {
        for (let gx = L.cx - L.w / 2 - 3; gx < L.cx + L.w / 2 + 3; gx += 0.9 + srnd() * 0.9) {
          const gy = L.base + srnd() * 2.5;
          const l = (2 + srnd() * 4) * (H / 900);
          const lean = (srnd() - 0.35) * l * 0.6;
          tufts.moveTo(gx, gy);
          tufts.quadraticCurveTo(gx + lean * 0.2, gy - l * 0.6, gx + lean, gy - l);
        }
      }
      g.lineWidth = 1;
      g.strokeStyle = o.grass;
      g.stroke(tufts);
      g.strokeStyle = sunlit(g, 0.6, 0);
      g.stroke(tufts);
      // where the word stands, so the caller can keep grass from crossing it
      const base = Math.max(...letters.map((L) => L.base));
      return { left, right, base, top: base - cap * 1.1 };
    }

    // --- sky and sun
    const sky = layer(W, H, Math.min(dpr, 1.5));
    {
      const g = sky.g;
      g.fillStyle = paint(g.createLinearGradient(0, 0, 0, horizon), ramp(COLORS.sky), 32);
      g.fillRect(0, 0, W, H);
      // sunset light spreads along the horizon, so the glow is a wide ellipse
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * 0.6);
      glow.addColorStop(0, 'rgba(255, 216, 164, 0.6)');
      glow.addColorStop(0.15, 'rgba(255, 198, 146, 0.28)');
      glow.addColorStop(0.45, 'rgba(236, 168, 146, 0.06)');
      glow.addColorStop(1, 'rgba(236, 168, 146, 0)');
      g.save();
      g.translate(sunX, sunY);
      g.scale(1, 0.6);
      g.fillStyle = glow;
      g.fillRect(-W * 2, -H * 2, W * 4, H * 4);
      g.restore();
      // a low sun is warmer at the rim, and the air squashes it slightly
      const disc = g.createRadialGradient(0, 0, 0, 0, 0, sunR * 1.3);
      disc.addColorStop(0, 'rgba(255, 249, 232, 1)');
      disc.addColorStop(0.55, 'rgba(255, 238, 200, 1)');
      disc.addColorStop(0.74, 'rgba(255, 220, 160, 1)');
      disc.addColorStop(0.82, 'rgba(255, 206, 140, 0.5)');
      disc.addColorStop(1, 'rgba(255, 196, 130, 0)');
      g.save();
      g.translate(sunX, sunY);
      g.scale(1, 0.93);
      g.fillStyle = disc;
      g.fillRect(-sunR * 1.3, -sunR * 1.3, sunR * 2.6, sunR * 2.6);
      g.restore();
    }

    // --- landscape, far to near
    const mountains = ridges.map((ridge, i) =>
      land(ridge, {
        depth: 0.05 + i * 0.05,
        bottom: lowest(ridges[i + 1] || hillAY) + 20,
        fill: ramp([[0, COLORS.ranges[i][0]], [0.55, COLORS.ranges[i][1]], [1, COLORS.haze]]),
        fillTo: horizon + H * (RIDGES[i][0] + 0.012),
        rim: [1.2, 0.55 - i * 0.1, 0],
      })
    );
    const hillA = land(hillAY, {
      depth: 0.32,
      pad: awardCap * 1.4 + 12, // room above the crest for far award signs
      bottom: lowest(hillBY) + 20,
      fill: ramp([[0, COLORS.hillFar[0]], [1, COLORS.hillFar[1]]]),
      fillTo: horizon + H * 0.1,
      texture: [
        patches(10, W * 0.08, [['#e0c792', 0.22], ['#8a7650', 0.18]]),
        strokes(W * 2.5, 2.2, 1, [
          ['rgba(220, 200, 150, 0.22)', 0.55],
          ['rgba(128, 110, 76, 0.18)', 0.45],
        ]),
      ],
      rim: [1, 0.75, 0.1],
      decorate: (g, c) => {
        farTrees(g, c, css(mix(lab(COLORS.hillFar[1]), lab(COLORS.tree), 0.55)));
        fringe(g, c, 1.6, 2.4, COLORS.hillFar[0], 0.5);
        awards.forEach((a, i) => {
          if (a.row === 0) sign(g, c, a.text, awardOpts(a, i, COLORS.hillFar[0]));
        });
      },
    });
    const hillB = land(hillBY, {
      depth: 0.5,
      pad: Math.max(treeH * 1.25, signCap * 1.4) + 12, // room above the crest for the tree and the sign
      bottom: lowest(hillCY) + 20,
      fill: ramp([[0, COLORS.hillMid[0]], [1, COLORS.hillMid[1]]]),
      fillTo: horizon + H * 0.2,
      texture: [
        patches(14, W * 0.09, [['#cbb060', 0.24], ['#3f3418', 0.22]]),
        strokes(W * 6, 3.5, 1, [
          ['rgba(206, 182, 106, 0.26)', 0.55],
          ['rgba(60, 50, 26, 0.2)', 0.45],
        ]),
      ],
      rim: [1.1, 0.8, 0.12],
      decorate: (g, c) => {
        fringe(g, c, 1.3, 4, COLORS.hillMid[0], 0.6);
        tree(g, treeX, c(treeX) + 2, treeH);
        awards.forEach((a, i) => {
          if (a.row === 4) sign(g, (x) => c(x) + awardRows[4].dy * H, a.text, awardOpts(a, i, COLORS.hillMid[0]));
        });
        if (signText) {
          sign(g, c, signText, {
            cap: signCap,
            center: W * (portrait ? 0.675 : 0.58), // right of the tree
            maxW: W * (portrait ? 0.62 : 0.66),
            seed: SEED + 777,
            grass: COLORS.hillMid[0],
          });
        }
      },
    });
    const hillC = land(hillCY, {
      depth: 0.72,
      bottom: H + OV,
      fill: ramp([[0, COLORS.hillNear[0]], [1, COLORS.hillNear[1]]]),
      texture: [
        strokes(W * 6, 7, 1.2, [
          ['rgba(160, 136, 70, 0.3)', 0.45],
          ['rgba(30, 24, 12, 0.3)', 0.55],
        ]),
      ],
      decorate: (g, c) => fringe(g, c, 1.2, 6, COLORS.hillNear[0], 0.7),
    });

    // --- award signs on the near hill, each on its own layer so it can be drawn between
    // grass rows: the nearer rows of long grass then stand in front of it
    const awardSigns = [];
    awards.forEach((a, i) => {
      const row = awardRows[a.row];
      if (!row || !row.band) return;
      const o = awardOpts(a, i, COLORS.hillNear[0]);
      const contour = (x) => hillCY(x) + row.dy * H;
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = -OV; x <= W + OV; x += 4) {
        lo = Math.min(lo, contour(x));
        hi = Math.max(hi, contour(x));
      }
      const top = Math.floor(lo - o.cap * 1.6 - 10);
      const bottom = Math.ceil(hi + o.cap * 2.6 + 10); // room for shadows down the slope
      const L = layer(W + OV * 2, bottom - top, dpr);
      L.g.translate(OV, -top);
      const where = sign(L.g, contour, a.text, o);
      awardSigns.push({ ...where, canvas: L.canvas, x: -OV, y: top, w: L.w, h: L.h, band: row.band, depth: lerp(0.72, 1, row.band / (BANDS - 1)) });
    });

    // --- foreground grass: blades in depth bands, each band drawn in a few
    // brightness levels so a whole level fills in one call
    const bx = [];
    const by = [];
    const bh = [];
    const bw = [];
    const rest = [];
    const curl = [];
    const flex = [];
    const stiff = [];
    const phase = [];
    const tone = [];
    const head = [];
    const bandStart = [];
    const bandEnd = [];
    const bodies = []; // fill per band and level
    const rims = []; // stroke per band and level: the backlit edge
    const rimWidth = [];
    const heads = [];
    const body = [lab(COLORS.grassBody[0]), lab(COLORS.grassBody[1])];
    const rim = [lab(COLORS.grassRim[0]), lab(COLORS.grassRim[1])];
    const sheen = lab(COLORS.sheen);
    const shadow = lab('#120c05');
    for (let b = 0; b < BANDS; b++) {
      const z0 = b / BANDS;
      const z1 = (b + 1) / BANDS;
      const spacing = lerp(1.6, 7.2, z0) * (W < 640 ? 1.3 : 1);
      const tipsY = [];
      let bottom = -Infinity;
      bandStart[b] = bx.length;
      for (let x = -OV; x < W + OV; x += spacing * (0.55 + rnd() * 0.9)) {
        const z = lerp(z0, z1, rnd());
        const y = lerp(hillCY(x) + 1.5, H * 1.045, z ** 1.2) + (rnd() - 0.5) * 3;
        const isHead = b >= 3 && rnd() < 0.05;
        let h = lerp(H * 0.013, H * 0.2, z ** 1.6) * (0.55 + rnd() * 0.9) * (isHead ? 1.2 : 1);
        // grass standing in front of an award sign stops short of its base, so it never crosses the letters
        for (const A of awardSigns) {
          if (b >= A.band && x > A.left - 70 && x < A.right + 70 && y > A.top - 6) {
            h = y > A.base ? Math.min(h, (y - A.base) * 0.45) : 2; // below the word: stop at its base; level with it: stay low
          }
        }
        h = Math.max(h, 2);
        bx.push(x);
        by.push(y);
        bh.push(h);
        bw.push(lerp(0.9, 4.6, z ** 1.4) * (0.75 + rnd() * 0.5) * (isHead ? 0.55 : 1));
        rest.push(0.05 + (rnd() - 0.5) * 0.34);
        curl.push((rnd() - 0.5) * 0.3);
        flex.push((0.55 + 0.6 * z) * (0.8 + rnd() * 0.4));
        stiff.push(lerp(70, 16, z) * (0.8 + rnd() * 0.4));
        phase.push(rnd() * TAU);
        // patches of lighter and darker grass, so the field isn't a flat carpet
        const patch = 0.5 + 0.5 * noise((x / H) * 3 + b * 1.7, SEED + 40);
        tone.push(clamp(rnd() * 0.55 + patch * 0.65 - 0.1, 0, 1));
        head.push(isHead ? 1 : 0);
        tipsY.push(y - h);
        bottom = Math.max(bottom, y);
      }
      bandEnd[b] = bx.length;
      tipsY.sort((p, q) => p - q);
      const top = tipsY[(tipsY.length * 0.4) | 0];
      const f = b / (BANDS - 1);
      const bodyColor = mix(body[0], body[1], f);
      const rimColor = mix(rim[0], rim[1], f);
      bodies[b] = [];
      rims[b] = [];
      for (let lv = 0; lv < LEVELS; lv++) {
        const lit = mix(bodyColor, rimColor, 0.12 + lv * 0.1);
        const grad = ctx.createLinearGradient(0, top, 0, bottom);
        grad.addColorStop(0, css(lit));
        grad.addColorStop(1, css(mix(bodyColor, shadow, 0.35)));
        bodies[b].push(grad);
        rims[b].push(sunlit(ctx, lerp(0.8, 1, lv / 3), lerp(0.36, 0.8, lv / 3), W * 0.3, mix(rimColor, sheen, lv * 0.15)));
      }
      rimWidth[b] = lerp(0.6, 1.4, f);
      heads[b] = css(mix(rimColor, sheen, 0.1), 0.85);
    }
    const grass = {
      count: bx.length,
      bandStart,
      bandEnd,
      bodies,
      rims,
      rimWidth,
      heads,
      x: Float32Array.from(bx),
      y: Float32Array.from(by),
      h: Float32Array.from(bh),
      w: Float32Array.from(bw),
      rest: Float32Array.from(rest),
      curl: Float32Array.from(curl),
      flex: Float32Array.from(flex),
      stiff: Float32Array.from(stiff),
      damp: Float32Array.from(stiff, (k) => 2 * Math.sqrt(k) * 0.24),
      phase: Float32Array.from(phase),
      tone: Float32Array.from(tone),
      head: Uint8Array.from(head),
      angle: Float32Array.from(rest),
      spin: new Float32Array(bx.length),
      level: new Uint8Array(bx.length),
    };

    // --- seeds drifting on the wind; lower on screen means nearer, so bigger
    const newSeed = (s, anywhere) => {
      const v = rnd();
      s.y = lerp(horizon + H * 0.03, H * 0.97, v);
      s.z = clamp(v * 0.75 + rnd() * 0.25, 0, 1);
      s.x = anywhere ? rnd() * W : -12;
      s.r = lerp(0.7, 2.1, s.z) * (rnd() < 0.08 ? 1.7 : 1);
      s.a = lerp(0.35, 0.85, s.z);
      s.phase = rnd() * TAU;
      return s;
    };
    const seeds = [];
    const seedCount = Math.round(clamp((W * H) / 26000, 24, 80));
    for (let i = 0; i < seedCount; i++) seeds.push(newSeed({}, true));

    const mote = layer(32, 32, 1);
    {
      const m = mote.g.createRadialGradient(16, 16, 0, 16, 16, 16);
      m.addColorStop(0, 'rgba(255, 248, 228, 1)');
      m.addColorStop(0.22, 'rgba(255, 236, 190, 0.75)');
      m.addColorStop(0.5, 'rgba(255, 220, 160, 0.18)');
      m.addColorStop(1, 'rgba(255, 210, 150, 0)');
      mote.g.fillStyle = m;
      mote.g.fillRect(0, 0, 32, 32);
    }

    // --- light over everything, and the patch of light a gust leaves on a hill
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * 0.5); // drawn squashed
    bloom.addColorStop(0, 'rgba(255, 206, 150, 0.28)');
    bloom.addColorStop(0.3, 'rgba(255, 186, 130, 0.1)');
    bloom.addColorStop(1, 'rgba(255, 170, 120, 0)');
    const flare = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 5);
    flare.addColorStop(0, 'rgba(255, 247, 228, 0.6)');
    flare.addColorStop(0.3, 'rgba(255, 230, 184, 0.22)');
    flare.addColorStop(1, 'rgba(255, 222, 170, 0)');
    const gustLight = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gustLight.addColorStop(0, 'rgba(255, 234, 186, 1)');
    gustLight.addColorStop(0.5, 'rgba(255, 226, 170, 0.45)');
    gustLight.addColorStop(1, 'rgba(255, 222, 164, 0)');

    // Gusts roll across each depth separately; nearer ones are bigger and faster
    const gusts = (every, speed, size, amp, first) => ({ every, speed, size, amp, next: first, list: [] });
    const wind = {
      near: gusts([2.6, 6], [260, 420], [110, 240], [0.28, 0.6], 0.4),
      mid: gusts([3, 7], [140, 220], [80, 150], [0.1, 0.2], 2.2),
      far: gusts([3.5, 8], [80, 140], [50, 100], [0.08, 0.15], 4),
    };

    // --- light rays fanning up from behind the mountains. Drawn small, since
    // they're soft anyway; skipped where conic gradients aren't supported.
    let rays = null;
    {
      const scale = 0.25;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(W * scale);
      canvas.height = Math.ceil(H * scale);
      const g = canvas.getContext('2d');
      if (typeof g.createConicGradient === 'function') {
        const sx = sunX * scale;
        const sy = sunY * scale;
        const fade = g.createRadialGradient(sx, sy, 0, sx, sy, Math.max(canvas.width, canvas.height) * 0.6);
        fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
        fade.addColorStop(0.06, 'rgba(0, 0, 0, 0.9)');
        fade.addColorStop(0.3, 'rgba(0, 0, 0, 0.4)');
        fade.addColorStop(0.65, 'rgba(0, 0, 0, 0.08)');
        fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        const list = [];
        for (let i = 0; i < 9; i++) {
          list.push({
            at: lerp(0.1, 0.9, (i + rnd() * 0.8) / 9), // position across the upper half-circle
            width: lerp(0.02, 0.055, rnd()),
            strength: lerp(0.06, 0.16, rnd()),
            pulse: lerp(0.15, 0.4, rnd()),
            drift: lerp(0.05, 0.12, rnd()),
            phase: rnd() * TAU,
          });
        }
        rays = { canvas, g, scale, sx, sy, fade, list };
      }
    }

    // --- a few big blades right in front of the lens, out of focus. Drawn at a
    // quarter size and blurred, then scaled up, which is cheap and looks right.
    const front = { scale: 0.25, blades: [] };
    {
      front.canvas = document.createElement('canvas');
      front.canvas.width = Math.ceil(W * front.scale);
      front.canvas.height = Math.ceil(H * front.scale);
      front.g = front.canvas.getContext('2d');
      front.blur = typeof front.g.filter === 'string' ? 'blur(2.5px)' : '';
      const girth = clamp(W / 1440, 0.6, 1.2);
      const tall = Math.min(H, W * 0.75); // on a phone, height-based lengths would cover the view
      // [x as a fraction of the width, length as a fraction of the height]; tall enough to
      // cross the bright field and horizon, where a dark out-of-focus shape actually reads
      for (const [f, len] of [[0, 0.7], [0.05, 0.55], [0.11, 0.36], [0.17, 0.22], [0.84, 0.28], [0.9, 0.48], [0.965, 0.64], [1.03, 0.76]]) {
        const k = lerp(5, 9, rnd());
        const r = (f < 0.5 ? 0.16 : -0.14) + (rnd() - 0.5) * 0.12;
        const head = rnd() < 0.4; // a thin stem with a seed head, otherwise a broad leaf
        front.blades.push({
          x: f * W,
          y: H * 1.04,
          h: tall * len * (0.85 + rnd() * 0.3),
          w: (head ? lerp(7, 10, rnd()) : lerp(36, 62, rnd())) * girth,
          rest: r,
          curl: (rnd() - 0.5) * 0.4,
          k,
          damp: 2 * Math.sqrt(k) * 0.22,
          angle: r,
          spin: 0,
          phase: rnd() * TAU,
          head,
        });
      }
    }

    // out-of-focus pollen near the lens: a soft disc with a brighter rim
    const bokeh = layer(64, 64, 1);
    {
      const m = bokeh.g.createRadialGradient(32, 32, 0, 32, 32, 32);
      m.addColorStop(0, 'rgba(255, 226, 170, 0.22)');
      m.addColorStop(0.7, 'rgba(255, 228, 176, 0.3)');
      m.addColorStop(0.86, 'rgba(255, 236, 196, 0.5)');
      m.addColorStop(1, 'rgba(255, 236, 196, 0)');
      bokeh.g.fillStyle = m;
      bokeh.g.fillRect(0, 0, 64, 64);
    }

    // --- the GitHub contribution calendar, laid out like GitHub's chart but in
    // starlight: a column per week, a row per weekday. Built last so its random
    // numbers don't reshuffle the landscape.
    let stars = null;
    let chartTopAt = null;
    const days = contributions && Array.isArray(contributions.days) ? contributions.days : null;
    if (days && days.length) {
      const DAY = 86400000;
      const first = new Date(`${days[0][0]}T00:00:00Z`).getUTCDay();
      const weeks = Math.floor((first + days.length - 1) / 7) + 1;
      const cols = W < 640 ? Math.min(weeks, 26) : weeks; // phones get the latest half-year
      // fills the page's centred column (.column in styles.css), so keep the two in step
      const column = Math.min(800, W - 48);
      const gutter = 30; // room for the Mon / Wed / Fri labels
      const cell = (column - gutter) / cols;
      const x0 = (W - column) / 2 + gutter;
      chartTopAt = chartTop ? chartTop() : H * 0.16;
      const y0 = chartTopAt + 14; // + room for the month labels
      const list = [];
      const grid = new Int16Array(cols * 7).fill(-1);
      days.forEach(([date, count, level], i) => {
        const col = Math.floor((first + i) / 7) - (weeks - cols);
        const row = (first + i) % 7;
        if (col < 0) return;
        grid[col * 7 + row] = list.length;
        list.push({
          x: x0 + (col + 0.5) * cell,
          y: y0 + (row + 0.5) * cell,
          count,
          level,
          date: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
          phase: rnd() * TAU,
          speed: lerp(0.8, 2.4, rnd()),
        });
      });
      // a month's name sits over the first column whose Sunday is in it, as on GitHub
      const sunday0 = Date.parse(`${days[0][0]}T00:00:00Z`) - first * DAY;
      const months = [];
      let prev = -1;
      for (let c = 0; c < cols; c++) {
        const d = new Date(sunday0 + (c + weeks - cols) * 7 * DAY);
        if (d.getUTCMonth() === prev) continue;
        prev = d.getUTCMonth();
        if (months.length && c - months[months.length - 1].col < 3) months.pop(); // no room for both
        months.push({ col: c, name: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
      }
      stars = { list, grid, x0, y0, cell, cols, months, reveal: 0 };
    }

    return {
      W, H, dpr, horizon, sunX, sunY, sunR, sizeX, rnd,
      sky, mountains, hillA, hillB, hillC, stars, chartTopAt,
      grass, seeds, newSeed, mote, bokeh, rays, front, awardSigns,
      bloom, flare, gustLight, wind,
      birds: { next: 6, list: [], x: 0, y: 0, v: 0, tail: 0 },
    };
  }

  // A soft cool-white glow; the sparkle version adds a bright core and spikes
  function starSprite(sparkle) {
    const size = 64;
    const m = size / 2;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const halo = g.createRadialGradient(m, m, 0, m, m, m);
    halo.addColorStop(0, 'rgba(240, 244, 255, 0.95)');
    halo.addColorStop(0.1, 'rgba(226, 234, 255, 0.6)');
    halo.addColorStop(0.32, 'rgba(204, 216, 255, 0.14)');
    halo.addColorStop(1, 'rgba(204, 216, 255, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);
    if (sparkle) {
      g.fillStyle = '#fbfcff';
      g.beginPath();
      g.arc(m, m, size * 0.08, 0, TAU);
      g.fill();
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const grad = g.createLinearGradient(m - dx * m, m - dy * m, m + dx * m, m + dy * m);
        grad.addColorStop(0, 'rgba(232, 238, 255, 0)');
        grad.addColorStop(0.5, 'rgba(244, 247, 255, 0.9)');
        grad.addColorStop(1, 'rgba(232, 238, 255, 0)');
        g.strokeStyle = grad;
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(m - dx * m, m - dy * m);
        g.lineTo(m + dx * m, m + dy * m);
        g.stroke();
      }
    }
    return c;
  }

  // the contribution chart, per level 0-4: how bright each square is, and the
  // size of the glow around it (busier days glow; the busiest also sparkle)
  const CELL_ALPHA = [0.12, 0.42, 0.62, 0.82, 0.98];
  const CELL_GLOW = [0, 14, 20, 26, 36];
  const SQUARE = 0.74; // square size as a share of the cell, leaving GitHub-like gaps
  const FONT = '12px "Bricolage Grotesque", system-ui, -apple-system, "Segoe UI", sans-serif'; // as in styles.css
  // tall, heavy capitals for the hillside sign, from fonts that come with the system
  const SIGN_FONT = '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif';

  // ------------------------------------------------------------- run it

  // options.contributions: the window.CONTRIBUTIONS object from contributions.js
  // options.onLayout(rect): called after every rebuild with the chart's position
  // options.sign: text for the sign standing on the hill, e.g. 'RONIT LONGIA'
  // options.awards: smaller signs scattered through the scene: [{ text, x, row }], x = where across
  // the width (0-1), row = 0 on the far hill behind the name, 1-3 on the near hill, deeper in the grass
  // options.chartTop(): where the chart should start (css px from the top); default 16% down
  function startScene(canvas, options = {}) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return () => {};
    const still = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contributions = options.contributions;
    const glow = starSprite(false);
    const sparkle = starSprite(true);

    // Strips that drift sideways and wrap: two cloud layers, then two of valley mist.
    // `top` is a fraction of the height, measured from the horizon when fromHorizon is set.
    const clouds = [
      {
        strip: cloudStrip({
          width: 1280, height: 128, period: 6, rows: 2.6, cover: 0.53, soft: 0.11, alpha: 0.62,
          shade: '#555779', lit: '#f3b49c', seed: SEED + 31,
        }),
        top: 0.15, height: 0.2, speed: 4, depth: 0.04, stretch: 1.7, phase: 0.3,
      },
      {
        strip: cloudStrip({
          width: 1024, height: 80, period: 5, rows: 2.2, cover: 0.5, soft: 0.13, alpha: 0.7,
          shade: '#a8869f', lit: '#ffd6a6', seed: SEED + 37,
        }),
        top: -0.2, fromHorizon: true, height: 0.13, speed: 7, depth: 0.08, stretch: 1.9, phase: 0.7,
      },
    ];
    const mist = [
      {
        strip: cloudStrip({
          width: 768, height: 48, period: 4, rows: 1.6, cover: 0.38, soft: 0.34, alpha: 0.55,
          shade: '#f2cfa6', lit: '#fbe0bb', seed: SEED + 41,
        }),
        top: -0.01, fromHorizon: true, height: 0.07, speed: 5, depth: 0.2, stretch: 1.5, phase: 0.1,
      },
      {
        strip: cloudStrip({
          width: 768, height: 48, period: 5, rows: 1.6, cover: 0.42, soft: 0.3, alpha: 0.4,
          shade: '#e9c597', lit: '#f8dbb4', seed: SEED + 43,
        }),
        top: 0.025, fromHorizon: true, height: 0.05, speed: 9, depth: 0.32, stretch: 1.5, phase: 0.6,
      },
    ];

    for (const c of [...clouds, ...mist]) c.pattern = ctx.createPattern(c.strip, 'repeat-x');

    const pointer = { x: 0, y: 0, active: false, mouse: false };
    const view = { x: 0, y: 0 }; // eased parallax offset
    let S = null;
    let time = 0;
    let last = 0;
    let raf = 0;
    let resizeTimer = 0;

    // Wind bending the foreground at x: a travelling breeze plus passing gusts.
    // Gusts have a sharp leading edge and a slow tail, like real ones.
    function windAt(x) {
      let w =
        0.075 * noise((x / S.H) * 1.4 - time * 0.38, SEED + 21) +
        0.035 * noise((x / S.H) * 4.2 - time * 1.05, SEED + 22);
      const list = S.wind.near.list;
      for (let i = 0; i < list.length; i++) {
        const g = list[i];
        const d = x - g.x;
        const q = d / (d > 0 ? g.s * 0.6 : g.s * 1.5);
        if (q > -3 && q < 3) w += g.a * Math.exp(-q * q);
      }
      return w;
    }

    function advanceGusts(G, dt) {
      if ((G.next -= dt) <= 0) {
        const rnd = S.rnd;
        G.next = lerp(G.every[0], G.every[1], rnd());
        const s = lerp(G.size[0], G.size[1], rnd()) * S.sizeX;
        G.list.push({
          x: -OV - s * 1.8,
          v: lerp(G.speed[0], G.speed[1], rnd()) * S.sizeX,
          s,
          a: lerp(G.amp[0], G.amp[1], rnd()),
        });
      }
      for (let i = G.list.length - 1; i >= 0; i--) {
        const g = G.list[i];
        g.x += g.v * dt;
        if (g.x - g.s * 4.5 > S.W + OV) G.list.splice(i, 1);
      }
    }

    function stepGrass(dt) {
      const G = S.grass;
      const px = pointer.active ? pointer.x : -1e5;
      const py = pointer.y;
      for (let b = 0; b < BANDS; b++) {
        const d = lerp(0.72, 1, b / (BANDS - 1));
        const ox = view.x * d;
        const oy = view.y * d;
        const reach = 56 + 16 * b;
        for (let i = G.bandStart[b]; i < G.bandEnd[b]; i++) {
          const x = G.x[i];
          let target =
            G.rest[i] + G.flex[i] * (windAt(x) + 0.03 * Math.sin(time * (1.1 + G.tone[i]) + G.phase[i]));
          const dx = x + ox - px;
          if (dx > -reach && dx < reach) {
            const y = G.y[i] + oy;
            if (py < y + 8 && py > y - G.h[i] - 16) {
              const f = 1 - Math.abs(dx) / reach;
              target += (dx < 0 ? -1 : 1) * f * f * 1.35;
            }
          }
          G.spin[i] += (G.stiff[i] * (target - G.angle[i]) - G.damp[i] * G.spin[i]) * dt;
          G.angle[i] += G.spin[i] * dt;
          const lv = (G.tone[i] * 1.6 + (G.angle[i] - G.rest[i]) * 5) | 0;
          G.level[i] = lv < 0 ? 0 : lv >= LEVELS ? LEVELS - 1 : lv;
        }
      }
    }

    function stepSeeds(dt) {
      for (const s of S.seeds) {
        s.x += (10 + 24 * s.z + windAt(s.x) * 80 * s.z) * dt;
        s.y += (Math.sin(time * 0.9 + s.phase) * 7 * s.z - 1.5) * dt;
        if (s.x > S.W + 12) S.newSeed(s, false);
      }
    }

    function stepFront(dt) {
      for (const b of S.front.blades) {
        const target = b.rest + 0.55 * windAt(b.x) + 0.025 * Math.sin(time * 0.7 + b.phase);
        b.spin += (b.k * (target - b.angle) - b.damp * b.spin) * dt;
        b.angle += b.spin * dt;
      }
    }

    function stepBirds(dt) {
      const F = S.birds;
      const rnd = S.rnd;
      if (!F.list.length) {
        if ((F.next -= dt) > 0) return;
        // low in the bright band above the mountains: silhouettes read there,
        // and the upper sky stays clear for text
        F.x = -60;
        F.y = S.horizon - S.H * lerp(0.13, 0.26, rnd());
        F.v = lerp(26, 40, rnd()) * clamp(S.sizeX, 0.7, 1.3);
        F.tail = 0;
        const n = 3 + ((rnd() * 5) | 0);
        for (let i = 0; i < n; i++) {
          const dx = -i * lerp(14, 28, rnd()) - rnd() * 8;
          F.tail = Math.min(F.tail, dx);
          F.list.push({
            dx,
            dy: (rnd() - 0.5) * 24 + i * (rnd() < 0.5 ? 3 : -3),
            size: lerp(5, 8, rnd()),
            phase: rnd() * TAU,
            rate: lerp(2.2, 3.2, rnd()),
            glide: rnd() * TAU,
          });
        }
        return;
      }
      F.x += F.v * dt;
      for (const b of F.list) b.phase += b.rate * TAU * dt;
      if (F.x + F.tail > S.W + 40) {
        F.list.length = 0;
        F.next = lerp(16, 36, rnd());
      }
    }

    function step(dt) {
      time += dt;
      const follow = pointer.active && pointer.mouse;
      const tx = follow ? (0.5 - pointer.x / S.W) * 2 * SHIFT : 0;
      const ty = follow ? (0.5 - pointer.y / S.H) * 0.8 * SHIFT : 0;
      const ease = 1 - Math.exp(-dt * 2.5);
      view.x += (tx - view.x) * ease;
      view.y += (ty - view.y) * ease;
      if (S.stars) S.stars.reveal += ((nearStars() ? 1 : 0) - S.stars.reveal) * (1 - Math.exp(-dt * 6));
      advanceGusts(S.wind.near, dt);
      advanceGusts(S.wind.mid, dt);
      advanceGusts(S.wind.far, dt);
      stepGrass(dt);
      stepFront(dt);
      stepSeeds(dt);
      stepBirds(dt);
    }

    // ------------------------------------------------------------- drawing

    // The star under a point, if any
    function starAt(x, y) {
      const T = S.stars;
      if (!T || !pointer.active) return null;
      const col = Math.floor((x - T.x0) / T.cell);
      const row = Math.floor((y - T.y0) / T.cell);
      if (col < 0 || row < 0 || col >= T.cols || row > 6) return null;
      const i = T.grid[col * 7 + row];
      return i < 0 ? null : T.list[i];
    }

    function nearStars() {
      const T = S.stars;
      return (
        !!T &&
        pointer.active &&
        pointer.x > T.x0 - 36 &&
        pointer.x < T.x0 + T.cell * (T.cols + 1) &&
        pointer.y > T.y0 - 24 &&
        pointer.y < T.y0 + T.cell * 9
      );
    }

    // adds a rounded square to the current path
    function square(x, y, size, radius) {
      if (ctx.roundRect) ctx.roundRect(x, y, size, size, radius);
      else ctx.rect(x, y, size, size);
    }

    function drawStars() {
      const T = S.stars;
      if (!T) return;
      const sq = T.cell * SQUARE;
      // the squares, one fill per level; empty days brighten a little while you hover
      for (let lv = 0; lv <= 4; lv++) {
        ctx.beginPath();
        for (const s of T.list) if (s.level === lv) square(s.x - sq / 2, s.y - sq / 2, sq, T.cell * 0.16);
        ctx.fillStyle = `rgba(226, 232, 255, ${CELL_ALPHA[lv] + (lv ? 0 : 0.06 * T.reveal)})`;
        ctx.fill();
      }
      // a twinkling glow around the busier days
      ctx.globalCompositeOperation = 'lighter';
      for (const s of T.list) {
        const size = CELL_GLOW[s.level];
        if (!size) continue;
        ctx.globalAlpha = (0.3 + 0.14 * s.level) * (0.7 + 0.3 * Math.sin(time * s.speed + s.phase));
        ctx.drawImage(s.level === 4 ? sparkle : glow, s.x - size / 2, s.y - size / 2, size, size);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    // Month and weekday labels, drawn after the clouds so they stay readable
    function drawLabels() {
      const T = S.stars;
      if (!T) return;
      const inset = (T.cell * (1 - SQUARE)) / 2;
      ctx.font = FONT;
      ctx.fillStyle = `rgba(226, 230, 248, ${0.62 + 0.25 * T.reveal})`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      for (const m of T.months) ctx.fillText(m.name, T.x0 + m.col * T.cell + inset, T.y0 - 4);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const [row, name] of [[1, 'Mon'], [3, 'Wed'], [5, 'Fri']]) {
        ctx.fillText(name, T.x0 - 6, T.y0 + (row + 0.5) * T.cell);
      }
      ctx.textAlign = 'left';
    }

    function drawTooltip() {
      const s = starAt(pointer.x, pointer.y);
      if (!s) return;
      const T = S.stars;
      const text = s.count
        ? `${s.count} contribution${s.count === 1 ? '' : 's'} on ${s.date}`
        : `No contributions on ${s.date}`;
      const sq = T.cell * SQUARE + 4;
      ctx.strokeStyle = 'rgba(240, 244, 255, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      square(s.x - sq / 2, s.y - sq / 2, sq, T.cell * 0.2);
      ctx.stroke();
      ctx.font = FONT;
      const w = ctx.measureText(text).width + 18;
      const h = 26;
      const x = clamp(s.x - w / 2, 8, S.W - w - 8);
      let y = s.y - T.cell * 0.6 - h - 4;
      if (y < 8) y = s.y + T.cell * 0.6 + 4; // no room above: show it below
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6);
      else ctx.rect(x, y, w, h);
      ctx.fillStyle = 'rgba(14, 18, 38, 0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
      ctx.stroke();
      ctx.fillStyle = '#f2eee6';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 9, y + h / 2 + 0.5);
    }

    function blit(L) {
      ctx.drawImage(L.canvas, L.x + view.x * L.depth, L.y + view.y * L.depth, L.w, L.h);
    }

    // A repeating pattern rather than two copies side by side: copies leave a
    // hairline where their antialiased edges meet
    function drift(c) {
      const bw = Math.max(S.W, S.H * 1.6) * c.stretch;
      const bh = S.H * c.height;
      const y = (c.fromHorizon ? S.horizon : 0) + S.H * c.top + view.y * c.depth;
      const x = ((c.phase * bw + time * c.speed) % bw) + view.x * c.depth;
      c.pattern.setTransform(new DOMMatrix().translate(x, y).scale(bw / c.strip.width, bh / c.strip.height));
      ctx.fillStyle = c.pattern;
      ctx.fillRect(0, y, S.W, bh);
    }

    function drawRays() {
      const R = S.rays;
      if (!R) return;
      const g = R.g;
      const cw = R.canvas.width;
      const ch = R.canvas.height;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, cw, ch);
      // bands of light around the sun: start pointing left and sweep over the top
      const cone = g.createConicGradient(Math.PI, R.sx, R.sy);
      const steps = 72;
      for (let i = 0; i <= steps; i++) {
        const f = i / steps;
        let a = 0;
        for (const r of R.list) {
          const d = (f - r.at - 0.015 * Math.sin(time * r.drift + r.phase)) / r.width;
          if (d > -3 && d < 3) a += r.strength * (0.55 + 0.45 * Math.sin(time * r.pulse + r.phase)) * Math.exp(-d * d);
        }
        cone.addColorStop(f * 0.5, `rgba(255, 222, 176, ${Math.min(a, 1).toFixed(3)})`);
      }
      cone.addColorStop(0.51, 'rgba(255, 222, 176, 0)');
      g.fillStyle = cone;
      g.fillRect(0, 0, cw, ch);
      // fade them out with distance from the sun
      g.globalCompositeOperation = 'destination-in';
      g.fillStyle = R.fade;
      g.fillRect(0, 0, cw, ch);
      ctx.globalCompositeOperation = 'screen';
      ctx.drawImage(R.canvas, 0, 0, S.W, S.H);
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawBirds() {
      const F = S.birds;
      if (!F.list.length) return;
      ctx.beginPath();
      for (const b of F.list) {
        const x = F.x + b.dx + view.x * 0.05;
        const y = F.y + b.dy + Math.sin(time * 0.7 + b.glide) * 4;
        const flap = smoothstep(-0.2, 0.4, Math.sin(time * 0.45 + b.glide)); // stretches of gliding
        const pose = Math.sin(b.phase) * flap + 0.35 * (1 - flap);
        const s = b.size;
        ctx.moveTo(x - s, y - pose * s * 0.75);
        ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.2 - pose * s * 0.15, x, y);
        ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.2 - pose * s * 0.15, x + s, y - pose * s * 0.75);
      }
      ctx.strokeStyle = COLORS.bird;
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    function drawSheen(L, G, below) {
      if (!G.list.length) return;
      ctx.save();
      ctx.translate(view.x * L.depth, view.y * L.depth);
      ctx.clip(L.body);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = S.gustLight;
      for (const g of G.list) {
        ctx.save();
        ctx.translate(g.x, L.contour(g.x) + below);
        ctx.scale(g.s * 1.6, below * 1.6);
        ctx.globalAlpha = g.a;
        ctx.fillRect(-1, -1, 2, 2);
        ctx.restore();
      }
      ctx.restore();
    }

    // Path every blade of one band at one brightness level: the whole blade,
    // or (rim) just its upper part, which is what catches the light
    function bladePaths(G, b, lv, rim) {
      ctx.beginPath();
      for (let i = G.bandStart[b]; i < G.bandEnd[b]; i++) {
        if (G.level[i] !== lv) continue;
        const x = G.x[i];
        const y = G.y[i];
        const h = G.h[i];
        const a = G.angle[i];
        // the base stays upright longer than the tip, so the blade bows
        const ca = a * 0.4 + G.curl[i];
        const cx = x + Math.sin(ca) * h * 0.55;
        const cy = y - Math.cos(ca) * h * 0.55;
        const tx = x + Math.sin(a) * h;
        const ty = y - Math.cos(a) * h;
        if (rim) {
          // the same curve, from 40% of the way up to the tip
          ctx.moveTo(0.36 * x + 0.48 * cx + 0.16 * tx, 0.36 * y + 0.48 * cy + 0.16 * ty);
          ctx.quadraticCurveTo(0.6 * cx + 0.4 * tx, 0.6 * cy + 0.4 * ty, tx, ty);
        } else {
          const w = G.w[i] * 0.5;
          ctx.moveTo(x - w, y);
          ctx.quadraticCurveTo(cx - w * 0.6, cy, tx, ty);
          ctx.quadraticCurveTo(cx + w * 0.6, cy, x + w, y);
        }
      }
    }

    function drawGrass() {
      const G = S.grass;
      for (let b = 0; b < BANDS; b++) {
        for (const A of S.awardSigns) if (A.band === b) blit(A); // behind this row of grass
        const d = lerp(0.72, 1, b / (BANDS - 1));
        ctx.save();
        ctx.translate(view.x * d, view.y * d);
        for (let lv = 0; lv < LEVELS; lv++) {
          bladePaths(G, b, lv, false);
          ctx.fillStyle = G.bodies[b][lv];
          ctx.fill();
          bladePaths(G, b, lv, true);
          ctx.strokeStyle = G.rims[b][lv];
          ctx.lineWidth = G.rimWidth[b];
          ctx.stroke();
        }
        ctx.beginPath();
        for (let i = G.bandStart[b]; i < G.bandEnd[b]; i++) {
          if (!G.head[i]) continue;
          const a = G.angle[i];
          const h = G.h[i];
          const len = h * 0.045;
          const wd = Math.max(0.9, G.w[i] * 0.6);
          const hx = G.x[i] + Math.sin(a) * (h + len * 0.5);
          const hy = G.y[i] - Math.cos(a) * (h + len * 0.5);
          ctx.moveTo(hx + wd * Math.cos(a), hy + wd * Math.sin(a));
          ctx.ellipse(hx, hy, wd, len, a, 0, TAU);
        }
        ctx.fillStyle = G.heads[b];
        ctx.fill();
        ctx.restore();
      }
    }

    function drawSeeds() {
      ctx.globalCompositeOperation = 'lighter';
      for (const s of S.seeds) {
        const d = 0.6 + 0.5 * s.z;
        const x = s.x + view.x * d;
        const y = s.y + view.y * d;
        const dx = x - S.sunX;
        const dy = y - S.sunY;
        const nearSun = Math.exp(-(dx * dx + dy * dy) / (S.W * S.W * 0.05));
        const glint = s.a * (0.5 + nearSun) * (0.75 + 0.25 * Math.sin(time * 1.7 + s.phase));
        if (s.z > 0.9) {
          // right by the lens: out of focus
          const r = s.r * 7;
          ctx.globalAlpha = Math.min(1, glint * 0.6);
          ctx.drawImage(S.bokeh.canvas, x - r, y - r, r * 2, r * 2);
        } else {
          const r = s.r * 3.2;
          ctx.globalAlpha = Math.min(1, glint);
          ctx.drawImage(S.mote.canvas, x - r, y - r, r * 2, r * 2);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    function drawFront() {
      const F = S.front;
      const g = F.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, F.canvas.width, F.canvas.height);
      g.setTransform(F.scale, 0, 0, F.scale, F.scale * view.x * 1.4, F.scale * view.y * 1.4);
      if (F.blur) g.filter = F.blur;
      g.beginPath();
      for (const b of F.blades) {
        const w = b.w * 0.5;
        const ca = b.angle * 0.4 + b.curl;
        b.cx = b.x + Math.sin(ca) * b.h * 0.55;
        b.cy = b.y - Math.cos(ca) * b.h * 0.55;
        b.tx = b.x + Math.sin(b.angle) * b.h;
        b.ty = b.y - Math.cos(b.angle) * b.h;
        g.moveTo(b.x - w, b.y);
        g.quadraticCurveTo(b.cx - w * 0.7, b.cy, b.tx, b.ty);
        g.quadraticCurveTo(b.cx + w * 0.7, b.cy, b.x + w, b.y);
      }
      g.fillStyle = 'rgba(20, 14, 8, 0.97)';
      g.fill();
      // the edge facing the sun glows where light comes through
      g.beginPath();
      for (const b of F.blades) {
        const w = b.w * 0.45 * (S.sunX > b.x ? 1 : -1);
        g.moveTo(b.x + w, b.y);
        g.quadraticCurveTo(b.cx + w * 0.7, b.cy, b.tx, b.ty);
      }
      g.strokeStyle = 'rgba(255, 200, 118, 0.75)';
      g.lineWidth = 4;
      g.stroke();
      // feathery seed heads on the thin stems, lit from behind
      g.beginPath();
      for (const b of F.blades) {
        if (!b.head) continue;
        for (let j = 0; j < 7; j++) {
          const t = 0.8 + j * 0.03;
          const u = 1 - t;
          const px = u * u * b.x + 2 * u * t * b.cx + t * t * b.tx;
          const py = u * u * b.y + 2 * u * t * b.cy + t * t * b.ty;
          const rot = b.angle + (j % 2 ? 0.6 : -0.6);
          const len = b.h * 0.035;
          const rx = Math.max(1.5, b.w * 0.5);
          const ex = px + Math.sin(rot) * len;
          const ey = py - Math.cos(rot) * len;
          g.moveTo(ex + rx * Math.cos(rot), ey + rx * Math.sin(rot));
          g.ellipse(ex, ey, rx, len, rot, 0, TAU);
        }
      }
      g.fillStyle = 'rgba(244, 196, 120, 0.75)';
      g.fill();
      g.filter = 'none';
      ctx.drawImage(F.canvas, 0, 0, S.W, S.H);
    }

    function draw() {
      const { W, H } = S;
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(S.sky.canvas, 0, 0, W, H);
      for (const c of clouds) drift(c);
      drawRays();
      drawBirds();
      for (const m of S.mountains) blit(m);
      drift(mist[0]);
      // in front of the clouds and mountains, so nothing hides a day on short screens
      drawStars();
      drawLabels();
      blit(S.hillA);
      drawSheen(S.hillA, S.wind.far, H * 0.022);
      drift(mist[1]);
      blit(S.hillB);
      drawSheen(S.hillB, S.wind.mid, H * 0.04);
      blit(S.hillC);
      drawGrass();
      drawSeeds();
      drawFront();
      // the low sun washes over everything in front of it
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.92 + 0.08 * Math.sin(time * 0.5);
      ctx.save();
      ctx.translate(S.sunX, S.sunY);
      ctx.scale(1, 0.62);
      ctx.fillStyle = S.bloom;
      ctx.fillRect(-W * 1.5, -H * 2, W * 3, H * 4);
      ctx.restore();
      ctx.fillStyle = S.flare;
      ctx.fillRect(S.sunX - S.sunR * 5, S.sunY - S.sunR * 5, S.sunR * 10, S.sunR * 10);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      drawTooltip();
    }

    // ------------------------------------------------------------ lifecycle

    // One calm frame: the breeze only, no gusts, birds or pointer
    function renderStill() {
      time = 0;
      const G = S.grass;
      for (let i = 0; i < G.count; i++) {
        G.angle[i] = G.rest[i] + G.flex[i] * windAt(G.x[i]);
        G.level[i] = clamp((G.tone[i] * 1.6) | 0, 0, LEVELS - 1);
      }
      for (const b of S.front.blades) b.angle = b.rest + 0.55 * windAt(b.x);
      draw();
    }

    function resize(force) {
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      if (!W || !H) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!force && S && S.W === W && S.H === H && S.dpr === dpr) return;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      S = buildScene(ctx, W, H, dpr, contributions, options.sign, options.chartTop, options.awards);
      if (options.onLayout) {
        // where the chart's squares are, so the page can line things up with it
        const T = S.stars;
        const inset = T ? (T.cell * (1 - SQUARE)) / 2 : 0;
        options.onLayout(
          T ? { x: T.x0 + inset, y: T.y0 + inset, width: T.cols * T.cell - inset * 2, height: 7 * T.cell - inset * 2 } : null
        );
      }
      // resizing clears the canvas, so paint straight away
      if (still.matches) renderStill();
      else draw();
    }

    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (last && now - last < 12) return; // hold ~60fps on 120Hz screens
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60;
      last = now;
      step(dt);
      draw();
    }

    function play() {
      if (still.matches) {
        cancelAnimationFrame(raf);
        raf = 0;
        renderStill();
      } else if (!raf) {
        last = 0;
        raf = requestAnimationFrame(tick);
      }
    }

    // With reduced motion nothing animates, so redraw when the hovered star changes
    let shownHover = null;
    function refreshStill() {
      if (!still.matches || !S || !S.stars) return;
      const reveal = nearStars() ? 1 : 0;
      const hover = starAt(pointer.x, pointer.y);
      if (reveal === S.stars.reveal && hover === shownHover) return;
      S.stars.reveal = reveal;
      shownHover = hover;
      draw();
    }

    const onPointer = (e) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.active = true;
      pointer.mouse = e.pointerType !== 'touch';
      refreshStill();
    };
    const onPointerEnd = (e) => {
      if (e.pointerType === 'touch') pointer.active = false;
      refreshStill();
    };
    const onLeave = (e) => {
      if (!e.relatedTarget) pointer.active = false;
      refreshStill();
    };
    const onBlur = () => {
      pointer.active = false;
      refreshStill();
    };
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
    };

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('pointerup', onPointerEnd, { passive: true });
    window.addEventListener('pointercancel', onPointerEnd, { passive: true });
    window.addEventListener('mouseout', onLeave);
    window.addEventListener('blur', onBlur);
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);
    still.addEventListener('change', play);

    resize();
    play();

    return {
      stop() {
        cancelAnimationFrame(raf);
        raf = 0;
        clearTimeout(resizeTimer);
        observer.disconnect();
        still.removeEventListener('change', play);
        window.removeEventListener('pointermove', onPointer);
        window.removeEventListener('pointerdown', onPointer);
        window.removeEventListener('pointerup', onPointerEnd);
        window.removeEventListener('pointercancel', onPointerEnd);
        window.removeEventListener('mouseout', onLeave);
        window.removeEventListener('blur', onBlur);
      },
      // Call when the page above the chart may have changed height (say, once web
      // fonts arrive); rebuilds only if the chart's spot actually moved
      relayout() {
        if (S && options.chartTop && S.chartTopAt !== null && Math.abs(options.chartTop() - S.chartTopAt) > 0.5) {
          resize(true);
        }
      },
    };
  }

  window.startScene = startScene;
})();
