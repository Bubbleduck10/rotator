// The opening sequence. A white flash, the rainbow burst blooms, the five
// stock tiles fly in from the edges and fan out, the wordmark drops in letter by
// letter, a ring and a burst of coins, then the tiles and the wordmark fly into
// their real places on the page and the curtain lifts.
//
// Plays on every load, and not at all under prefers-reduced-motion: the inline
// script at the top of <body> decides, before first paint, so the page never
// flashes before the curtain. Any click, scroll, touch or key skips
// it. If this module never loads, a CSS failsafe lifts the curtain after 7s.
//
// Everything before the exit is CSS keyframes started by inserting the markup,
// so the whole entrance shares one clock. The exit is measured from the live
// page with the Web Animations API, so the tiles land wherever the layout
// actually put them, on any screen.

import { STOCKS } from "./config.js";

const root = document.getElementById("intro");
const html = document.documentElement;

if (root && !html.classList.contains("no-intro")) play();
else root?.remove();

function play() {
  html.classList.add("intro-playing");

  // Sizes live in CSS (tile size and fan spread per breakpoint, fly-in origins in
  // vw/vh), not in numbers read from the window here: a window can still report
  // 0x0 when this runs, in a tab that hasn't been laid out yet.
  const fanX = [-1, -0.5, 0, 0.5, 1]; // times the fan's half-width
  const fanY = [0.31, -0.02, -0.17, -0.02, 0.31]; // times the tile size
  const tilt = [-24, -12, 0, 12, 24];
  // where each tile flies in from, as a fraction of the screen
  const from = [{ x: -0.62, y: -0.3 }, { x: -0.4, y: 0.55 }, { x: 0, y: 0.62 }, { x: 0.4, y: 0.55 }, { x: 0.62, y: -0.3 }];

  const tiles = STOCKS.map((s, i) => {
    const spin = tilt[i] * 3 + (i < 2 ? -50 : i > 2 ? 50 : 0);
    return `<div class="i-tile" style="--xi:${fanX[i]};--yi:${fanY[i]};--r:${tilt[i]}deg;` +
      `--fxi:${from[i].x};--fyi:${from[i].y};--fr:${spin}deg;` +
      `--d:${(0.45 + 0.08 * i).toFixed(2)}s;z-index:${i === 2 ? 2 : 1}">` +
      `<div class="face f-${s.symbol}"><span class="sym">${s.symbol}</span></div></div>`;
  }).join("");

  root.innerHTML = `
    <div class="i-bg"></div><div class="i-rays"></div><div class="i-veil"></div>
    <div class="i-flash"></div><div class="i-streak"></div>
    <div class="i-stage">
      <div class="i-fan">${tiles}</div>
      <div class="iwm">${line("Stonk", 0)}${line("Rotator", 5)}<div class="i-ring"></div></div>
      <div class="i-tag">One coin · five stocks · every five minutes</div>
    </div>
    <div class="i-foot">$ROTATOR · Solana</div>`;

  const burst = setTimeout(coinBurst, 1500);

  let done = false;
  const skip = () => exit();
  const onKey = (e) => {
    if (!["Tab", "Shift", "Alt", "Control", "Meta"].includes(e.key)) exit();
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") exit();
  };
  const opts = { passive: true, capture: true };
  addEventListener("pointerdown", skip, opts);
  addEventListener("wheel", skip, opts);
  addEventListener("touchstart", skip, opts);
  addEventListener("keydown", onKey, opts);
  document.addEventListener("visibilitychange", onHidden);

  // at least the full entrance, and the fonts in place so the wordmark lands in
  // its real face; never longer than 4.4s whatever is still loading
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const loaded = new Promise((r) => (document.readyState === "complete" ? r() : addEventListener("load", r, { once: true })));
  Promise.all([wait(3000), Promise.race([Promise.all([document.fonts?.ready, loaded]), wait(4400)])]).then(exit);

  function exit() {
    if (done) return;
    done = true;
    clearTimeout(burst);
    removeEventListener("pointerdown", skip, opts);
    removeEventListener("wheel", skip, opts);
    removeEventListener("touchstart", skip, opts);
    removeEventListener("keydown", onKey, opts);
    document.removeEventListener("visibilitychange", onHidden);

    const FLY = 720;
    const ease = "cubic-bezier(.6,0,.2,1)";
    const onScreen = (r) => r.height > 0 && r.bottom > 0 && r.top < innerHeight;

    // tiles into the hero's tiles
    const anchor = root.querySelector(".i-fan").getBoundingClientRect();
    const ax = anchor.left + anchor.width / 2, ay = anchor.top + anchor.height / 2;
    root.querySelectorAll(".i-tile").forEach((w, i) => {
      const face = w.querySelector(".face");
      const cell = document.getElementById(`slot${i}`);
      const target = cell?.querySelector(".face");
      const cs = getComputedStyle(w);
      const start = { transform: cs.transform, opacity: cs.opacity, filter: cs.filter };
      w.style.animation = "none";
      const b = target?.getBoundingClientRect();
      let end;
      if (b && onScreen(b)) {
        const active = cell.classList.contains("on");
        const rot = active ? 0 : parseFloat(getComputedStyle(cell).getPropertyValue("--r")) || 0;
        const sc = (target.offsetWidth * (active ? 1.16 : 1)) / face.offsetWidth;
        end = { transform: `translate(-50%,-50%) translate(${b.left + b.width / 2 - ax}px,${b.top + b.height / 2 - ay}px) rotate(${rot}deg) scale(${sc})`, opacity: 1, filter: "blur(0px)" };
      } else {
        // its place is off screen: fly up and out instead
        end = { transform: `${start.transform === "none" ? "" : start.transform} translateY(-80px) scale(1.5)`, opacity: 0, filter: "blur(0px)" };
      }
      w.animate([start, end], { duration: FLY, easing: ease, fill: "forwards" });
    });

    // the wordmark into the hero's wordmark, corner to corner
    const wm = root.querySelector(".iwm");
    const heroWm = document.querySelector(".hero .wm");
    const cs = getComputedStyle(wm);
    const startT = cs.transform === "none" ? "translate(0,0) scale(1)" : cs.transform;
    wm.style.animation = "none";
    const a = wm.querySelector(".i-line").getBoundingClientRect();
    const b = heroWm?.querySelector("span")?.getBoundingClientRect();
    if (b && onScreen(b)) {
      const sc = parseFloat(getComputedStyle(heroWm).fontSize) / parseFloat(cs.fontSize);
      wm.style.transformOrigin = `${a.left - wm.getBoundingClientRect().left}px ${a.top - wm.getBoundingClientRect().top}px`;
      wm.animate([{ transform: startT }, { transform: `translate(${b.left - a.left}px,${b.top - a.top}px) scale(${sc})` }], { duration: FLY, easing: ease, fill: "forwards" });
    } else {
      wm.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-60px) scale(1.5)" }], { duration: 450, easing: ease, fill: "forwards" });
    }

    // the curtain: everything that isn't flying fades
    for (const el of root.querySelectorAll(".i-bg,.i-rays,.i-veil,.i-tag,.i-foot,.i-ring,.spark")) {
      el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: 420, easing: "ease-out", fill: "forwards" });
    }
    root.animate([{ backgroundColor: "rgba(6,3,13,1)" }, { backgroundColor: "rgba(6,3,13,0)" }], { duration: 480, easing: "ease-out", fill: "forwards" });

    setTimeout(() => {
      html.classList.remove("intro-playing");
      root.remove();
    }, FLY + 20);
  }

  function coinBurst() {
    const wm = root.querySelector(".iwm")?.getBoundingClientRect();
    if (!wm) return;
    const cx = wm.left + wm.width / 2, cy = wm.top + wm.height / 2;
    for (let k = 0; k < 22; k++) {
      const ang = (k / 22) * Math.PI * 2 + Math.random() * 0.3;
      const wide = innerWidth >= 768;
      const r = (wide ? 180 : 110) + Math.random() * (wide ? 200 : 120);
      const c = document.createElement("i");
      c.className = "spark";
      c.style.cssText = `left:${cx}px;top:${cy}px;--dx:${Math.cos(ang) * r}px;--dy:${Math.sin(ang) * r * 0.7 + 90}px;` +
        `--rot:${Math.round(Math.random() * 720 - 360)}deg;width:${14 + Math.round(Math.random() * 10)}px;height:${14 + Math.round(Math.random() * 10)}px`;
      root.appendChild(c);
      setTimeout(() => c.remove(), 1400);
    }
  }
}

/**
 * One line of the wordmark, twice: a back copy carrying the black outline and
 * the drop shadow, and a front copy carrying the fill and the gold shine. Each
 * letter animates on its own, and the two copies share timings, so they move as
 * one. The outline sits in its own layer so no letter's outline can paint over
 * its neighbour's fill.
 */
function line(word, offset) {
  const layer = (cls) =>
    `<span class="${cls}">${[...word].map((c, k) =>
      `<span class="ch" style="--d:${(0.85 + 0.06 * (offset + k)).toFixed(2)}s;--sd:${(1.7 + 0.045 * (offset + k)).toFixed(3)}s">${c}</span>`).join("")}</span>`;
  return `<span class="i-line">${layer("back")}${layer("front")}</span>`;
}
