/* cascade.js — cascaded lossless line sections, exact frequency-domain solver.
 *
 * N sections between source and load, each with its own (real) Z0k and
 * electrical length ℓk (wavelengths in harmonic mode, transit units in pulse
 * modes; propagation velocity v = 1 is common to all sections, so β = ω).
 *
 * Method: for every FFT bin the two-port chain is solved exactly with ABCD
 * matrices (marching from the load), giving per-section forward/backward
 * amplitudes a_k(ω), b_k(ω); two inverse FFTs per section then give the
 * travelling waves p_k(t), q_k(t), and
 *     V(x,t) = p_k(t − x′) + q_k(t + x′),  I(x,t) = [p_k − q_k]/Z0k
 * inside section k (x′ measured from the section's left edge). This is the
 * exact LTI response (no bounce truncation); the only approximations are
 * time sampling and the finite periodic window (source is gated off after
 * the displayed range, with a guard tail against wrap-around).
 *
 * Reactive terminations (harmonic mode) are realized as the physical L or C
 * matching the entered reactance at the drive frequency, keeping the
 * frequency response Hermitian; entered values are exact at ω0.
 */
(function (global) {
  'use strict';

  var TWO_PI = 2 * Math.PI;

  function fft(re, im, inverse) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = (inverse ? 2 : -2) * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var ur = re[i + k], ui = im[i + k];
          var vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
          var vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
          var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
    if (inverse) for (i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  function cabs(re, im) { return Math.hypot(re, im); }

  /* termination impedance realized as R + L or R + C fixed at the entered
   * reactance for ω0 = 2π; Hermitian in ω. Returns {re, im, inf}. */
  function termZ(R, X, w) {
    if (!isFinite(R)) return { re: Infinity, im: 0, inf: true };
    if (X === 0) return { re: R, im: 0, inf: false };
    if (X > 0) return { re: R, im: w * (X / TWO_PI), inf: false };          // series L
    if (w === 0) return { re: Infinity, im: 0, inf: true };                 // series C blocks DC
    return { re: R, im: TWO_PI * X / w, inf: false };                       // series C
  }

  function reflAt(R, X, Z0) {
    if (!isFinite(R)) return { re: 1, im: 0 };
    var nr = R - Z0, ni = X, dr = R + Z0, di = X;
    var d = dr * dr + di * di;
    return { re: (nr * dr + ni * di) / d, im: (ni * dr - nr * di) / d };
  }

  function build(p) {
    var mode = p.mode, harmonic = (mode === 'harmonic');
    var V0 = p.V0;
    var secs = p.sections;
    var NS = secs.length;
    var Z0s = new Float64Array(NS), lens = new Float64Array(NS), xStart = new Float64Array(NS + 1);
    for (var k = 0; k < NS; k++) {
      Z0s[k] = secs[k].Z0; lens[k] = secs[k].len;
      xStart[k + 1] = xStart[k] + lens[k];
    }
    var L = xStart[NS], T = L;
    var Rs = p.Zs.re, Xs = harmonic ? (p.Zs.im || 0) : 0;
    var RL = p.ZL.re, XL = harmonic ? (p.ZL.im || 0) : 0;

    var GL = reflAt(RL, XL, Z0s[NS - 1]);
    var GS = reflAt(Rs, Xs, Z0s[0]);
    var gmAbs = cabs(GL.re, GL.im) * cabs(GS.re, GS.im);

    // ---- pulse-shape parameters (needed for span sizing)
    var w = p.pulseWidth || 0.5;
    var sigma = w / 2.3548200450309493, gaussT0 = 4 * sigma;
    var pulseTail = mode === 'gauss' ? gaussT0 + 5 * sigma : mode === 'rect' ? w : 0;

    // ---- settle estimate from the two strongest reflectors anywhere in the
    // chain (energy can be trapped between ANY reflector pair, not only the ends)
    var refl = [cabs(GS.re, GS.im), cabs(GL.re, GL.im)];
    for (k = 1; k < NS; k++) refl.push(Math.abs((Z0s[k] - Z0s[k - 1]) / (Z0s[k] + Z0s[k - 1])));
    refl.sort(function (a, b) { return b - a; });
    // dominant reflector against an effective opposite reflectance that
    // includes secondary paths (matches measured trapped-mode decay rates)
    var rOpp = Math.min(0.98, refl[1] + 0.5 * (refl[2] || 0));
    var rDecay = refl.length > 1 ? refl[0] * rOpp : 0;
    var noSS = gmAbs >= 1 - 1e-9;
    var Nset = rDecay < 1e-9 ? 8 : Math.ceil(Math.log(1e-4) / Math.log(rDecay));
    if (!isFinite(Nset) || Nset > 300) Nset = 300;
    Nset = Math.max(8, Nset);
    var convergenceWarning = Math.pow(rDecay, Nset) > 0.02;

    var tEnd = Math.min(2 * Nset * T, 60 * T) + 2 + pulseTail;
    var srcDur = tEnd + 2 * T;
    var guard = Math.min(2 * Nset * T, 600 * T) + 8;   // wrap-around guard tail
    var Twin = srcDur + guard;
    // adaptive resolution: fine enough for the carrier / pulse edges, capped for perf
    var dtTarget = harmonic ? 1 / 24
                 : mode === 'gauss' ? Math.max(sigma / 3, 1e-4)
                 : 0.005 * Math.max(T / NS, 0.2);
    var NFFT = 16384;
    while (NFFT < Twin / dtTarget && NFFT < 131072) NFFT *= 2;
    var dt = Twin / NFFT;
    var resolutionWarning = dt > 2.5 * dtTarget;

    var rise = Math.max(4 * dt, 0.02 * Math.max(T / NS, 0.2));
    function shape(tt) {
      if (tt < 0) return 0;
      if (mode === 'gauss') { var u = tt - gaussT0; return Math.exp(-u * u / (2 * sigma * sigma)); }
      if (mode === 'rect') {
        // finite rise/fall (band-limits the edges: no Gibbs ringing on screen)
        var eg = Math.max(4 * dt, 0.012 * T);
        if (tt < eg) return 0.5 * (1 - Math.cos(Math.PI * tt / eg));
        if (tt < w) return 1;
        if (tt < w + eg) return 0.5 * (1 + Math.cos(Math.PI * (tt - w) / eg));
        return 0;
      }
      // step & harmonic: rise, hold, gated off after srcDur (wrap guard)
      var env = tt < rise ? 0.5 * (1 - Math.cos(Math.PI * tt / rise))
              : tt < srcDur ? 1
              : tt < srcDur + 2 ? 0.5 * (1 + Math.cos(Math.PI * (tt - srcDur) / 2))
              : 0;
      return harmonic ? env * Math.cos(TWO_PI * tt) : env;
    }
    var sre = new Float64Array(NFFT), sim = new Float64Array(NFFT);
    for (var n = 0; n < NFFT; n++) sre[n] = V0 * shape(n * dt);
    fft(sre, sim, false);

    // ---- per-bin ABCD solve → per-section a(ω), b(ω)
    var aRe = [], aIm = [], bRe = [], bIm = [];
    for (k = 0; k < NS; k++) {
      aRe.push(new Float64Array(NFFT)); aIm.push(new Float64Array(NFFT));
      bRe.push(new Float64Array(NFFT)); bIm.push(new Float64Array(NFFT));
    }
    var VlR = new Float64Array(NS), VlI = new Float64Array(NS);
    var IlR = new Float64Array(NS), IlI = new Float64Array(NS);
    var resonanceHits = 0, lastNeedRel = 1;

    function solveBin(m, omega, forcePhasor) {
      // start at load: [V; I] ∝ [ZL; 1]  (open: [1; 0])
      var zl = termZ(RL, XL, Math.abs(omega));
      if (omega < 0) zl.im = -zl.im;
      var vr, vi, ir, ii;
      if (zl.inf) { vr = 1; vi = 0; ir = 0; ii = 0; }
      else { vr = zl.re; vi = zl.im; ir = 1; ii = 0; }
      for (var kk = NS - 1; kk >= 0; kk--) {
        var th = omega * lens[kk], c = Math.cos(th), s = Math.sin(th), Z = Z0s[kk];
        // Vl = c·Vr + jZ s·Ir ;  Il = (j s/Z)·Vr + c·Ir
        var nvr = c * vr - Z * s * ii;
        var nvi = c * vi + Z * s * ir;
        var nir = c * ir - (s / Z) * vi;
        var nii = c * ii + (s / Z) * vr;
        vr = nvr; vi = nvi; ir = nir; ii = nii;
        VlR[kk] = vr; VlI[kk] = vi; IlR[kk] = ir; IlI[kk] = ii;
      }
      var zs = termZ(Rs, Xs, Math.abs(omega));
      if (omega < 0) zs.im = -zs.im;
      var needR, needI;
      if (zs.inf) { needR = 1e12; needI = 0; }
      else { needR = vr + zs.re * ir - zs.im * ii; needI = vi + zs.re * ii + zs.im * ir; }
      var nn = needR * needR + needI * needI;
      var stateN = vr * vr + vi * vi + Z0s[0] * Z0s[0] * (ir * ir + ii * ii) + 1e-30;
      var floor2 = 1e-8 * stateN;
      if (nn < floor2) { nn = floor2; resonanceHits++; }
      if (forcePhasor) lastNeedRel = Math.sqrt((needR * needR + needI * needI) / stateN);
      // scale = S(ω) / need
      var SR = forcePhasor ? forcePhasor.re : sre[m], SI = forcePhasor ? forcePhasor.im : sim[m];
      var scR = (SR * needR + SI * needI) / nn;
      var scI = (SI * needR - SR * needI) / nn;
      var res = forcePhasor ? { a: [], b: [] } : null;
      for (kk = 0; kk < NS; kk++) {
        var Z2 = Z0s[kk];
        var apr = 0.5 * (VlR[kk] + Z2 * IlR[kk]), api = 0.5 * (VlI[kk] + Z2 * IlI[kk]);
        var bpr = 0.5 * (VlR[kk] - Z2 * IlR[kk]), bpi = 0.5 * (VlI[kk] - Z2 * IlI[kk]);
        var ar = apr * scR - api * scI, ai = apr * scI + api * scR;
        var br = bpr * scR - bpi * scI, bi = bpr * scI + bpi * scR;
        if (forcePhasor) { res.a.push({ re: ar, im: ai }); res.b.push({ re: br, im: bi }); }
        else { aRe[kk][m] = ar; aIm[kk][m] = ai; bRe[kk][m] = br; bIm[kk][m] = bi; }
      }
      if (forcePhasor) {
        res.Vin = { re: vr * scR - vi * scI, im: vr * scI + vi * scR };
        res.Iin = { re: ir * scR - ii * scI, im: ir * scI + ii * scR };
      }
      return res;
    }

    for (var m = 0; m < NFFT; m++) {
      var mm = m <= NFFT / 2 ? m : m - NFFT;
      solveBin(m, TWO_PI * mm / Twin, null);
    }

    // ---- inverse FFTs → travelling waves p_k(t), q_k(t)
    var pArr = [], qArr = [];
    for (k = 0; k < NS; k++) {
      fft(aRe[k], aIm[k], true); pArr.push(aRe[k]);
      fft(bRe[k], bIm[k], true); qArr.push(bRe[k]);
    }

    // ---- exact steady state at ω0 (harmonic) and DC (step)
    var ss = harmonic ? solveBin(0, TWO_PI, { re: V0, im: 0 }) : null;
    var Vinf = null, Iinf = null;
    if (mode === 'step') {
      if (!isFinite(RL)) { Vinf = V0; Iinf = 0; }
      else if (Rs + RL === 0) { Vinf = 0; Iinf = Infinity; }
      else { Vinf = V0 * RL / (Rs + RL); Iinf = V0 / (Rs + RL); }
    }

    // readouts from the ω0 phasor solve
    var Zin = null, VSWR = null;
    var resonance = harmonic && ss ? lastNeedRel < 0.05 : false;
    if (harmonic && ss && !noSS) {
      var iin2 = ss.Iin.re * ss.Iin.re + ss.Iin.im * ss.Iin.im;
      Zin = iin2 < 1e-18 ? { re: Infinity, im: 0 }
          : { re: (ss.Vin.re * ss.Iin.re + ss.Vin.im * ss.Iin.im) / iin2,
              im: (ss.Vin.im * ss.Iin.re - ss.Vin.re * ss.Iin.im) / iin2 };
    }
    var absGL = cabs(GL.re, GL.im);
    VSWR = absGL > 0.9999 ? Infinity : (1 + absGL) / (1 - absGL);

    function sectionAt(x) {
      var kk = 0;
      while (kk < NS - 1 && x > xStart[kk + 1]) kk++;
      return kk;
    }

    function ssPhasorV(x) {
      var kk = sectionAt(x), xp = x - xStart[kk];
      var c = Math.cos(TWO_PI * xp), s = Math.sin(TWO_PI * xp);
      var a = ss.a[kk], b = ss.b[kk];
      return { re: a.re * c + a.im * s + b.re * c - b.im * s,
               im: a.im * c - a.re * s + b.im * c + b.re * s };
    }
    function ssPhasorI(x) {
      var kk = sectionAt(x), xp = x - xStart[kk], Z = Z0s[kk];
      var c = Math.cos(TWO_PI * xp), s = Math.sin(TWO_PI * xp);
      var a = ss.a[kk], b = ss.b[kk];
      return { re: (a.re * c + a.im * s - b.re * c + b.im * s) / Z,
               im: (a.im * c - a.re * s - b.im * c - b.re * s) / Z };
    }

    function interp(arr, tt) {
      if (tt < 0) return 0;                      // causal
      var u = (tt / dt) % NFFT;
      var i0 = u | 0, fr = u - i0, i1 = (i0 + 1) % NFFT;
      return arr[i0] * (1 - fr) + arr[i1] * fr;
    }

    function sample(t, xs, out) {
      var N = xs.length;
      var late = harmonic ? (t > tEnd && !noSS) : (t >= tEnd);
      for (var i = 0; i < N; i++) {
        var x = xs[i], kk = sectionAt(x), xp = x - xStart[kk], Z = Z0s[kk];
        var vf, vb;
        if (late && harmonic) {
          var c = Math.cos(TWO_PI * (t - xp)), s = Math.sin(TWO_PI * (t - xp));
          var a = ss.a[kk];
          vf = a.re * c - a.im * s;
          var c2 = Math.cos(TWO_PI * (t + xp)), s2 = Math.sin(TWO_PI * (t + xp));
          var b = ss.b[kk];
          vb = b.re * c2 - b.im * s2;
        } else if (late && mode === 'step' && isFinite(Iinf)) {
          vf = 0.5 * (Vinf + Z * Iinf); vb = 0.5 * (Vinf - Z * Iinf);
        } else if (late && (mode === 'rect' || mode === 'gauss')) {
          vf = 0; vb = 0;
        } else {
          vf = interp(pArr[kk], t - xp);
          vb = interp(qArr[kk], t + xp);
        }
        out.vf[i] = vf; out.vb[i] = vb;
        out.v[i] = vf + vb; out.i[i] = (vf - vb) / Z;
        if (out.if) { out.if[i] = vf / Z; out.ib[i] = -vb / Z; }
      }
    }

    var sectionsMeta = [];
    for (k = 0; k < NS; k++) sectionsMeta.push({ Z0: Z0s[k], len: lens[k], x0: xStart[k], x1: xStart[k + 1] });

    return {
      cascade: true, mode: mode, harmonic: harmonic,
      Z0: Z0s[0], V0: V0, L: L, T: T,
      GL: GL, GS: GS, gmAbs: gmAbs,
      Nb: null, tEnd: tEnd,
      convergenceWarning: convergenceWarning, noSteadyState: noSS,
      resonance: resonance, resolutionWarning: resolutionWarning,
      VSWR: VSWR, Zin: Zin, Vinf: Vinf, Iinf: Iinf,
      pulseWidth: w, sigma: sigma, gaussT0: gaussT0,
      sample: sample,
      ssV: harmonic ? ssPhasorV : null, ssI: harmonic ? ssPhasorI : null,
      lattice: [],
      sections: sectionsMeta,
    };
  }

  var api = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TLCascade = api;
})(typeof window !== 'undefined' ? window : globalThis);
