/*
 * Small stars: space above the home sky, and the backdrop of the work page.
 *
 *   starfield(canvas);       // one screen of stars
 *   starfield(canvas, 1.5);  // a canvas 1.5 screens tall
 *
 * Seeded, and laid out one screen-height at a time, so both pages draw the same
 * first screen: the climb from the home page ends on the very stars the work
 * page opens with.
 */
function starfield(canvas, screens = 1) {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight / screens; // one screen
  if (!W || !H) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * screens * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  let s = 20261122;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const TINTS = ['242, 238, 230', '242, 238, 230', '201, 207, 221', '255, 207, 138']; // cream, silver and gold, as styles.css
  const count = Math.round((W * H) / 3200);
  for (let k = 0; k < screens; k++) {
    for (let i = 0; i < count; i++) {
      const x = rnd() * W;
      const y = (k + rnd()) * H;
      const big = rnd() ** 4; // most are specks; a few are a little brighter
      g.fillStyle = `rgba(${TINTS[(rnd() * TINTS.length) | 0]}, ${0.2 + 0.15 * rnd() + 0.6 * big})`;
      g.beginPath();
      g.arc(x, y, 0.35 + 0.9 * big, 0, 7);
      g.fill();
    }
  }
}
