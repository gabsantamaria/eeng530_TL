// physics_check.mjs — verify the JS bounce-series engine against closed-form results.
// Run:  node tests/physics_check.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TL = require('../js/tline.js');
const TLC = require('../js/cascade.js');

let failures = 0;
function check(name, got, want, tol) {
  const err = Math.abs(got - want);
  const ok = err <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  got=${got.toPrecision(8)} want=${want.toPrecision(8)} err=${err.toExponential(2)}`);
}

function sampleOne(m, t, x) {
  const xs = new Float64Array([x]);
  const out = { vf: new Float64Array(1), vb: new Float64Array(1), v: new Float64Array(1), i: new Float64Array(1) };
  m.sample(t, xs, out);
  return { v: out.v[0], i: out.i[0], vf: out.vf[0], vb: out.vb[0] };
}

// ---------- 1. step response: DC convergence -------------------------------
for (const [Rs, RL] of [[1, 10], [25, 100], [75, 150], [10, 0]]) {
  const m = TL.build({ mode: 'step', V0: 1, Z0: 50, Zs: { re: Rs, im: 0 }, ZL: { re: RL, im: 0 }, lenLambda: 1 });
  const s = sampleOne(m, 5000, 0.37);
  check(`step Rs=${Rs} RL=${RL}: V→V∞`, s.v, RL / (Rs + RL), 2e-3);
  check(`step Rs=${Rs} RL=${RL}: I→I∞`, s.i, 1 / (Rs + RL), 2e-4);
}
// open circuit
{
  const m = TL.build({ mode: 'step', V0: 1, Z0: 50, Zs: { re: 25, im: 0 }, ZL: { re: Infinity, im: 0 }, lenLambda: 1 });
  const s = sampleOne(m, 5000, 0.5);
  check('step open: V→V0', s.v, 1, 2e-3);
  check('step open: I→0', s.i, 0, 2e-4);
  // voltage doubling at the load right after first arrival
  const d = sampleOne(m, 1.05, 1);
  check('step open: V(load, T+) = 2 V+0', d.v, 2 * 50 / 75, 1e-12);
}
// matched load: single wave, V = V+0 after wavefront
{
  const m = TL.build({ mode: 'step', V0: 1, Z0: 50, Zs: { re: 25, im: 0 }, ZL: { re: 50, im: 0 }, lenLambda: 1 });
  const s = sampleOne(m, 0.6, 0.5);
  check('step matched: V = V+0 mid-line', s.v, 50 / 75, 1e-12);
  check('step matched: no backward wave', s.vb, 0, 1e-15);
}
// causality: quiet before the wavefront
{
  const m = TL.build({ mode: 'step', V0: 1, Z0: 50, Zs: { re: 25, im: 0 }, ZL: { re: 100, im: 0 }, lenLambda: 1 });
  check('step causality: V=0 ahead of front', sampleOne(m, 0.4, 0.5).v, 0, 1e-15);
}

// ---------- 2. harmonic: bounce sum -> exact steady state ------------------
const cases = [
  { Zs: { re: 50, im: 0 }, ZL: { re: 141.12, im: -102.55 }, l: 1.5, name: 'MATLAB default' },
  { Zs: { re: 50, im: 0 }, ZL: { re: 50, im: 0 }, l: 1.5, name: 'matched' },
  { Zs: { re: 50, im: 0 }, ZL: { re: Infinity, im: 0 }, l: 1.25, name: 'open' },
  { Zs: { re: 50, im: 0 }, ZL: { re: 0, im: 0 }, l: 1.25, name: 'short' },
  { Zs: { re: 25, im: 40 }, ZL: { re: 10, im: 0 }, l: 0.85, name: 'complex source' },
  { Zs: { re: 50, im: 0 }, ZL: { re: 0, im: 50 }, l: 2.0, name: 'ZL=+j50' },
];
for (const c of cases) {
  const m = TL.build({ mode: 'harmonic', V0: 1, Z0: 50, Zs: c.Zs, ZL: c.ZL, lenLambda: c.l, phi: 0 });
  const tBig = 2 * m.Nb * m.T + 7.31;
  let maxErr = 0, maxAmp = 1e-30;
  for (let k = 0; k <= 40; k++) {
    const x = c.l * k / 40;
    const s = sampleOne(m, tBig, x);
    const ss = m.ssV(x), si = m.ssI(x);
    const c0 = Math.cos(2 * Math.PI * tBig), s0 = Math.sin(2 * Math.PI * tBig);
    const vEx = ss.re * c0 - ss.im * s0;
    const iEx = si.re * c0 - si.im * s0;
    maxErr = Math.max(maxErr, Math.abs(s.v - vEx), 50 * Math.abs(s.i - iEx));
    maxAmp = Math.max(maxAmp, Math.hypot(ss.re, ss.im));
  }
  check(`harmonic ${c.name}: bounce sum = closed form`, maxErr / maxAmp, 0, 2e-3);
}
// standing-wave envelope of an open line: max 2|V+0|/|D|, null at λ/4 from load
{
  const m = TL.build({ mode: 'harmonic', V0: 1, Z0: 50, Zs: { re: 50, im: 0 }, ZL: { re: Infinity, im: 0 }, lenLambda: 1.25 });
  const vAtLoad = Math.hypot(m.ssV(1.25).re, m.ssV(1.25).im);
  const vAtNull = Math.hypot(m.ssV(1.25 - 0.25).re, m.ssV(1.25 - 0.25).im);
  check('open line envelope: max at load = 1 (Zs=Z0)', vAtLoad, 1, 1e-12);
  check('open line envelope: null λ/4 from load', vAtNull, 0, 1e-12);
}
// Zin of a quarter-wave section: Z0^2/ZL
{
  const m = TL.build({ mode: 'harmonic', V0: 1, Z0: 50, Zs: { re: 50, im: 0 }, ZL: { re: 100, im: 0 }, lenLambda: 0.25 });
  check('λ/4 transformer: Zin = Z0²/ZL', m.Zin.re, 25, 1e-9);
  check('λ/4 transformer: Im{Zin} = 0', m.Zin.im, 0, 1e-9);
}

// ---------- 3. rect pulse: echo bookkeeping --------------------------------
{
  // Rs=25 (GS=-1/3), RL=100 (GL=+1/3), w=0.25
  const m = TL.build({ mode: 'rect', V0: 1, Z0: 50, Zs: { re: 25, im: 0 }, ZL: { re: 100, im: 0 }, lenLambda: 1, pulseWidth: 0.25 });
  const A = 50 / 75;
  check('rect: incident amp mid-line', sampleOne(m, 0.6, 0.5).v, A, 1e-12);
  check('rect: quiet between echoes', sampleOne(m, 0.95, 0.5).v, 0, 1e-12);
  check('rect: first echo amp = GL*A', sampleOne(m, 1.6, 0.5).v, A / 3, 1e-12);
  check('rect: second pass amp = GS*GL*A', sampleOne(m, 2.6, 0.5).v, -A / 9, 1e-12);
}

// ---------- 4. gaussian pulse: shape preservation + reflection -------------
{
  const m = TL.build({ mode: 'gauss', V0: 1, Z0: 50, Zs: { re: 50, im: 0 }, ZL: { re: 0, im: 0 }, lenLambda: 1, pulseWidth: 0.2 });
  const t0 = m.gaussT0;
  // peak passes mid-line at t = 0.5 + t0 with amplitude 0.5
  check('gauss: peak amplitude mid-line', sampleOne(m, 0.5 + t0, 0.5).v, 0.5, 1e-6);
  // short: inverted echo, peak at mid-line at t = 1.5 + t0
  check('gauss short: inverted echo', sampleOne(m, 1.5 + t0, 0.5).v, -0.5, 1e-6);
  // total V at short-circuit load is 0 at all times
  check('gauss short: V(load)=0 always', Math.abs(sampleOne(m, 1.0 + t0, 1).v), 0, 1e-9);
}

// ---------- 5. cascaded sections (frequency-domain engine) -----------------
{
  // degenerate cascade (two 50-ohm sections) must reproduce the single-line engine (step)
  const mc = TLC.build({ mode: 'step', V0: 1, Zs: { re: 25, im: 0 }, ZL: { re: 100, im: 0 }, sections: [{ Z0: 50, len: 0.5 }, { Z0: 50, len: 0.5 }] });
  const ms = TL.build({ mode: 'step', V0: 1, Z0: 50, Zs: { re: 25, im: 0 }, ZL: { re: 100, im: 0 }, lenLambda: 1 });
  let e = 0;
  for (let ti = 0; ti < 40; ti++) {
    const tt = Math.min(0.27 + ti * 0.5, mc.tEnd - 0.1);
    for (const x of [0.1, 0.5, 0.9]) e = Math.max(e, Math.abs(sampleOne(mc, tt, x).v - sampleOne(ms, tt, x).v));
  }
  check('cascade degenerate step = single line', e, 0, 1e-3);
  // quarter-wave transformer: 70.71-ohm lambda/4 section matches 100 ohm to 50 ohm
  const mq = TLC.build({ mode: 'harmonic', V0: 1, Zs: { re: 50, im: 0 }, ZL: { re: 100, im: 0 }, sections: [{ Z0: 50, len: 0.4 }, { Z0: Math.SQRT1_2 * 100, len: 0.25 }] });
  check('cascade λ/4 transformer: Re{Zin} = 50', mq.Zin.re, 50, 1e-6);
  check('cascade λ/4 transformer: Im{Zin} = 0', mq.Zin.im, 0, 1e-6);
  // DC through three mixed sections
  const md = TLC.build({ mode: 'step', V0: 1, Zs: { re: 25, im: 0 }, ZL: { re: 60, im: 0 }, sections: [{ Z0: 50, len: 0.5 }, { Z0: 75, len: 0.3 }, { Z0: 30, len: 0.2 }] });
  const sd = sampleOne(md, md.tEnd * 0.98, 0.55);
  check('cascade step DC voltage', sd.v, 60 / 85, 2e-3);
  check('cascade step DC current', sd.i, 1 / 85, 2e-3 / 30);
  // junction echo bookkeeping, rect pulse: rho = (100-50)/150 = 1/3
  const me = TLC.build({ mode: 'rect', V0: 1, Zs: { re: 50, im: 0 }, ZL: { re: 100, im: 0 }, sections: [{ Z0: 50, len: 1 }, { Z0: 100, len: 1 }], pulseWidth: 0.25 });
  check('cascade rect: incident', sampleOne(me, 0.6, 0.5).v, 0.5, 2e-3);
  check('cascade rect: junction echo', sampleOne(me, 1.6, 0.5).v, 0.5 / 3, 2e-3);
  check('cascade rect: transmitted', sampleOne(me, 1.6, 1.5).v, 2 / 3, 2e-3);
  // strong source mismatch (Rs=1): degenerate cascade must match the exact engine,
  // and the response must be causal (V = 0 ahead of the first wavefront)
  const mh = TLC.build({ mode: 'step', V0: 1, Zs: { re: 1, im: 0 }, ZL: { re: 10, im: 0 }, sections: [{ Z0: 50, len: 0.5 }, { Z0: 50, len: 0.5 }] });
  const mhs = TL.build({ mode: 'step', V0: 1, Z0: 50, Zs: { re: 1, im: 0 }, ZL: { re: 10, im: 0 }, lenLambda: 1 });
  let eh = 0;
  for (let ti = 0; ti < 50; ti++) {
    const tt = Math.min(0.23 + ti * 0.4, mh.tEnd - 0.1);
    for (const x of [0.1, 0.5, 0.9]) eh = Math.max(eh, Math.abs(sampleOne(mh, tt, x).v - sampleOne(mhs, tt, x).v));
  }
  check('cascade degenerate step Rs=1 = single line', eh, 0, 1e-3);
  const mz = TLC.build({ mode: 'step', V0: 1, Zs: { re: 1, im: 0 }, ZL: { re: 10, im: 0 }, sections: [{ Z0: 50, len: 0.5 }, { Z0: 75, len: 0.3 }, { Z0: 30, len: 0.2 }] });
  let acausal = 0;
  for (const tt of [0.05, 0.2, 0.35, 0.6]) acausal = Math.max(acausal, Math.abs(sampleOne(mz, tt, Math.min(0.95, tt + 0.15)).v));
  check('cascade causality: quiet ahead of the front', acausal, 0, 5e-4);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
