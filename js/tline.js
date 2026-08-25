/* tline.js — lossless transmission-line bounce-series physics engine.
 *
 * Faithful port of the MATLAB teaching scripts
 *   tline_step_response.m / tline_sinusoidal_transient.m  (EENG530).
 *
 * Normalized units:
 *   harmonic mode : source period = 1, wavelength lambda = 1, v = 1
 *                   -> line length L = l/lambda (user input), transit T = L periods
 *   pulse modes   : one-way transit time T = 1, line length L = 1, v = 1
 *
 * Physics (forward/backward wave decomposition):
 *   V(x,t) = V+(t - x/v) + V-(t + x/v),   I(x,t) = (V+ - V-)/Z0
 *   GammaL = (ZL - Z0)/(ZL + Z0),  GammaS = (Zs - Z0)/(Zs + Z0)
 *   V+_0   = V0 e^{j phi} Z0/(Zs + Z0)            (harmonic, phasor)
 *   V+_0   = V0 Z0/(Rs + Z0)                      (pulse, real)
 *   forward  bounce n: amp V+_0 (GS GL)^n, launched at source at t = 2nT
 *   backward bounce n: amp V+_0 GL (GS GL)^n, launched at load at t = (2n+1)T
 * Steady state (harmonic, exact sum of the series):
 *   Vss(x) = V+_0 [e^{-j b x} + GL e^{-j b (2L-x)}] / (1 - GS GL e^{-j 2 b L})
 */
(function (global) {
  'use strict';

  var TWO_PI = 2 * Math.PI;

  // ---------- complex helpers ({re, im} objects; hot loops use scalars) ----
  function C(re, im) { return { re: re, im: im || 0 }; }
  function cadd(a, b) { return C(a.re + b.re, a.im + b.im); }
  function csub(a, b) { return C(a.re - b.re, a.im - b.im); }
  function cmul(a, b) { return C(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
  function cdiv(a, b) {
    var d = b.re * b.re + b.im * b.im;
    return C((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
  }
  function cabs(a) { return Math.hypot(a.re, a.im); }
  function carg(a) { return Math.atan2(a.im, a.re); }
  function expj(th) { return C(Math.cos(th), Math.sin(th)); }

  // Reflection coefficient of impedance Z on a line of (real) Z0.
  // Z.re === Infinity encodes an open circuit -> Gamma = +1.
  function reflFromZ(Z, Z0) {
    if (!isFinite(Z.re) || !isFinite(Z.im)) return C(1, 0);
    return cdiv(C(Z.re - Z0, Z.im), C(Z.re + Z0, Z.im));
  }

  // number of bounces (fw or bw) that have arrived at local delay tt
  // bounce n arrives when tt >= 2 n T  ->  count = floor(tt/2T) + 1
  function nArrived(tt, twoT, Nb) {
    if (tt < 0) return 0;
    var m = Math.floor(tt / twoT) + 1;
    return m < Nb ? m : Nb;
  }

  /* build(p) -> model
   * p = { mode: 'harmonic'|'step'|'rect'|'gauss',
   *       V0, Z0, Zs:{re,im}, ZL:{re,im} (re may be Infinity),
   *       lenLambda, pulseWidth, phi }
   */
  function build(p) {
    var mode = p.mode;
    var harmonic = (mode === 'harmonic');
    var Z0 = p.Z0, V0 = p.V0;
    var ZL = p.ZL, Zs = p.Zs;

    var L = harmonic ? p.lenLambda : 1;
    var T = L;                 // v = 1 in both normalizations
    var twoT = 2 * T;
    var omega = TWO_PI;        // harmonic: period = 1
    var beta = TWO_PI;         // harmonic: lambda = 1

    var GL = reflFromZ(ZL, Z0);
    var GS = reflFromZ(Zs, Z0);
    var gm = cmul(GS, GL);     // round-trip reflection product
    var gmAbs = cabs(gm);

    // ----- number of bounces needed for |gm|^Nb < 1e-4 (capped) ------------
    var NB_MAX = 300;
    var Nb, convergenceWarning = false, noSteadyState = false;
    if (gmAbs < 1e-9) {
      Nb = 1;
    } else if (gmAbs >= 1 - 1e-9) {
      // |GS*GL| >= 1: lossless resonance (or unphysical growth) — never settles
      noSteadyState = true;
      convergenceWarning = true;
      Nb = gmAbs > 1 + 1e-9
        ? Math.min(NB_MAX, Math.max(1, Math.ceil(Math.log(1e6) / Math.log(gmAbs))))
        : NB_MAX;
    } else {
      Nb = Math.ceil(Math.log(1e-4) / Math.log(gmAbs));
      if (!isFinite(Nb) || Nb > NB_MAX) {
        Nb = NB_MAX;
        convergenceWarning = Math.pow(gmAbs, NB_MAX) > 0.02;
      }
      if (Nb < 1) Nb = 1;
    }

    // ----- first launched wave --------------------------------------------
    var Vp0;                   // complex phasor (harmonic) or real amp (pulse)
    if (harmonic) {
      Vp0 = cmul(cmul(C(V0, 0), expj(p.phi || 0)), cdiv(C(Z0, 0), cadd(Zs, C(Z0, 0))));
    } else {
      Vp0 = C(V0 * Z0 / (Zs.re + Z0), 0);
    }

    // ----- per-bounce amplitudes and prefix sums --------------------------
    // harmonic: c_fw[n] = A_fw[n] e^{-j 2 w n T} = Vp0 (gm e^{-j2wT})^n
    //           V_f(x,t) = Re{ e^{j w (t - x)} * Cf[m_f] }
    // pulse:    V_f(x,t) = Sf[m_f] * g-shape handling (step/rect) or loop (gauss)
    var CfRe = new Float64Array(Nb + 1), CfIm = new Float64Array(Nb + 1);
    var CbRe = new Float64Array(Nb + 1), CbIm = new Float64Array(Nb + 1);
    var Sf = new Float64Array(Nb + 1), Sb = new Float64Array(Nb + 1);
    var Afw = [], Abw = [];    // raw per-bounce amplitudes (for lattice diagram)
    var n, termF, termB, rot;
    if (harmonic) {
      rot = cmul(gm, expj(-2 * omega * T));   // round-trip factor incl. delay phase
      termF = Vp0;
      termB = cmul(Vp0, GL);
      var af = Vp0, ab = cmul(Vp0, GL);       // raw (no delay-phase) amplitudes
      for (n = 0; n < Nb; n++) {
        CfRe[n + 1] = CfRe[n] + termF.re; CfIm[n + 1] = CfIm[n] + termF.im;
        CbRe[n + 1] = CbRe[n] + termB.re; CbIm[n + 1] = CbIm[n] + termB.im;
        Afw.push(af); Abw.push(ab);
        termF = cmul(termF, rot); termB = cmul(termB, rot);
        af = cmul(af, gm); ab = cmul(ab, gm);
      }
    } else {
      var ampF = Vp0.re, rr = GS.re * GL.re, gl = GL.re;
      for (n = 0; n < Nb; n++) {
        Sf[n + 1] = Sf[n] + ampF;
        Sb[n + 1] = Sb[n] + ampF * gl;
        Afw.push(C(ampF, 0)); Abw.push(C(ampF * gl, 0));
        ampF *= rr;
      }
    }

    // ----- exact steady-state phasors (harmonic) --------------------------
    var D = null, resonance = false;
    if (harmonic) {
      D = csub(C(1, 0), cmul(gm, expj(-2 * beta * L)));
      resonance = cabs(D) < 0.05;
    }
    function ssV(x) {          // steady-state voltage phasor at x
      var e1 = expj(-beta * x), e2 = cmul(GL, expj(-beta * (2 * L - x)));
      return cdiv(cmul(Vp0, cadd(e1, e2)), D);
    }
    function ssI(x) {          // steady-state current phasor at x (amps)
      var e1 = expj(-beta * x), e2 = cmul(GL, expj(-beta * (2 * L - x)));
      return cdiv(cmul(Vp0, csub(e1, e2)), cmul(D, C(Z0, 0)));
    }

    // ----- scalar readouts -------------------------------------------------
    var VSWR = cabs(GL) > 0.9999 ? Infinity : (1 + cabs(GL)) / (1 - cabs(GL));
    var Zin = null;
    if (harmonic) {
      var Gin = cmul(GL, expj(-2 * beta * L));
      var den = csub(C(1, 0), Gin);
      Zin = (cabs(den) < 1e-6) ? C(Infinity, 0)
                               : cmul(C(Z0, 0), cdiv(cadd(C(1, 0), Gin), den));
    }
    var Vinf = null, Iinf = null;
    if (mode === 'step') {
      if (!isFinite(ZL.re)) { Vinf = V0; Iinf = 0; }
      else if (Zs.re + ZL.re === 0) { Vinf = 0; Iinf = Infinity; } // ideal source into a short
      else { Vinf = V0 * ZL.re / (Zs.re + ZL.re); Iinf = V0 / (Zs.re + ZL.re); }
    }

    // ----- pulse-shape parameters -----------------------------------------
    var w = p.pulseWidth || 0.5;           // rect width / gaussian FWHM (units of T)
    var sigma = w / 2.3548200450309493;    // FWHM -> sigma
    var t0 = 4 * sigma;                    // causal delay of gaussian center

    // suggested animation end time
    var tEnd;
    if (harmonic) {
      tEnd = Math.min(2 * Nb * T, 60 * T) + 2;
      if (tEnd < 6) tEnd = 6;
    } else {
      tEnd = Math.min(2 * Nb * T, 60 * T) + 2 * T + (mode === 'step' ? 0 : (mode === 'gauss' ? t0 + 5 * sigma : w));
    }

    /* sample(t, xs, out) — fill out.vf/out.vb/out.v/out.i at time t
     * xs: Float64Array of positions in [0, L]; out arrays same length. */
    function sample(t, xs, out) {
      var k, x, tf, tb, mf, mb, vf, vb, c, s;
      var N = xs.length;
      if (harmonic) {
        for (k = 0; k < N; k++) {
          x = xs[k];
          tf = t - x;
          mf = nArrived(tf, twoT, Nb);
          if (mf > 0) {
            c = Math.cos(omega * tf); s = Math.sin(omega * tf);
            vf = c * CfRe[mf] - s * CfIm[mf];
          } else vf = 0;
          tb = t - T - (L - x);
          mb = nArrived(tb, twoT, Nb);
          if (mb > 0) {
            c = Math.cos(omega * tb); s = Math.sin(omega * tb);
            vb = c * CbRe[mb] - s * CbIm[mb];
          } else vb = 0;
          out.vf[k] = vf; out.vb[k] = vb;
          out.v[k] = vf + vb; out.i[k] = (vf - vb) / Z0;
        }
      } else if (mode === 'step') {
        for (k = 0; k < N; k++) {
          x = xs[k];
          vf = Sf[nArrived(t - x, twoT, Nb)];
          vb = Sb[nArrived(t - T - (L - x), twoT, Nb)];
          out.vf[k] = vf; out.vb[k] = vb;
          out.v[k] = vf + vb; out.i[k] = (vf - vb) / Z0;
        }
      } else if (mode === 'rect') {
        for (k = 0; k < N; k++) {
          x = xs[k];
          tf = t - x; tb = t - T - (L - x);
          vf = Sf[nArrived(tf, twoT, Nb)] - Sf[nArrived(tf - w, twoT, Nb)];
          vb = Sb[nArrived(tb, twoT, Nb)] - Sb[nArrived(tb - w, twoT, Nb)];
          out.vf[k] = vf; out.vb[k] = vb;
          out.v[k] = vf + vb; out.i[k] = (vf - vb) / Z0;
        }
      } else { // gauss
        var inv2s2 = 1 / (2 * sigma * sigma), cut = 5 * sigma, u, m2;
        for (k = 0; k < N; k++) {
          x = xs[k];
          tf = t - x; tb = t - T - (L - x);
          vf = 0; vb = 0;
          for (m2 = 0; m2 < Nb; m2++) {
            u = tf - m2 * twoT - t0;
            if (u < -cut) break;                    // later bounces even earlier
            if (u <= cut) vf += Afw[m2].re * Math.exp(-u * u * inv2s2);
          }
          for (m2 = 0; m2 < Nb; m2++) {
            u = tb - m2 * twoT - t0;
            if (u < -cut) break;
            if (u <= cut) vb += Abw[m2].re * Math.exp(-u * u * inv2s2);
          }
          out.vf[k] = vf; out.vb[k] = vb;
          out.v[k] = vf + vb; out.i[k] = (vf - vb) / Z0;
        }
      }
    }

    // ----- lattice-diagram segments ---------------------------------------
    var MAX_SEG = 60;
    var lattice = [];
    for (n = 0; n < Math.min(Nb, MAX_SEG); n++) {
      lattice.push({ dir: 'fw', n: n, x0: 0, t0: 2 * n * T, x1: L, t1: (2 * n + 1) * T,
                     abs: cabs(Afw[n]), arg: carg(Afw[n]), re: Afw[n].re });
      lattice.push({ dir: 'bw', n: n, x0: L, t0: (2 * n + 1) * T, x1: 0, t1: (2 * n + 2) * T,
                     abs: cabs(Abw[n]), arg: carg(Abw[n]), re: Abw[n].re });
    }

    return {
      mode: mode, harmonic: harmonic,
      Z0: Z0, V0: V0, L: L, T: T, omega: omega, beta: beta,
      GL: GL, GS: GS, gm: gm, gmAbs: gmAbs, Vp0: Vp0,
      Nb: Nb, tEnd: tEnd,
      convergenceWarning: convergenceWarning, noSteadyState: noSteadyState,
      resonance: resonance,
      VSWR: VSWR, Zin: Zin, Vinf: Vinf, Iinf: Iinf,
      pulseWidth: w, sigma: sigma, gaussT0: t0,
      sample: sample, ssV: ssV, ssI: ssI,
      lattice: lattice,
      cabs: cabs, carg: carg,
    };
  }

  var api = { build: build, C: C, cadd: cadd, csub: csub, cmul: cmul, cdiv: cdiv,
              cabs: cabs, carg: carg, expj: expj, reflFromZ: reflFromZ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TL = api;
})(typeof window !== 'undefined' ? window : globalThis);
