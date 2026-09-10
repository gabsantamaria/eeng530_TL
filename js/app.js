/* app.js — UI state, animation loop, and wiring for the TL visualizer */
(function () {
  'use strict';

  var TLb = window.TL, P = window.TLPlots;

  // ---------------- state ------------------------------------------------
  var state = {
    mode: 'step',                // 'harmonic' | 'step' | 'rect' | 'gauss'
    V0: 1, Z0: 50,
    Rs: 1, Xs: 0,
    RL: 10, XL: 0, loadOpen: false,
    lenLambda: 1.5,
    sections: [{ Z0: 50, len: 1.5 }],   // sections[0] mirrors Z0/lenLambda; >1 -> cascade engine
    pulseWidth: 0.25,
    showComponents: false, showEnvelope: true,
    showCurrent: true, showLattice: true, showHistory: true,
    latticeRT: 10,               // round trips shown on the lattice diagram
    // axis limits: auto -> track the model; manual (auto:false) -> frozen, user-editable
    ax: {
      v:  { auto: true, val: 1 },    // V(x,t) y half-range (V)
      i:  { auto: true, val: 20 },   // I(x,t) y half-range (mA)
      ht: { auto: true, val: 10 },   // history time-axis max (T or periods)
      hv: { auto: true, val: 1 },    // history y half-range (V)
    },
    histZoom: null,
  };
  var AXIS_INPUT = { v: 'axV', i: 'axI', ht: 'axHT', hv: 'axHV' };
  var hover = { cvV: null, cvI: null, cvHist: null };
  var histDrag = null;         // {active, x0, y0, x1, y1} in CSS px while rubber-banding
  // state.histZoom (below) holds a drag-selected view {t0, t1, v0, v1}; null = no zoom
  var model = null;
  var t = 0, playing = false, speed = 0.4, lastFrame = null;
  var NX = 480;
  var xs, out, vLim = 1, iLim = 1;                 // iLim in mA
  var hist = { ts: null, v0: null, vL: null, n: 900 };

  // ---------------- scenarios -------------------------------------------
  var SCENARIOS = {
    'harm-complex': { label: 'Harmonic — complex load (MATLAB default)', p: { mode: 'harmonic', Rs: 50, Xs: 0, RL: 141.12, XL: -102.55, loadOpen: false, lenLambda: 1.5 } },
    'harm-matched': { label: 'Harmonic — matched load (no reflections)', p: { mode: 'harmonic', Rs: 50, Xs: 0, RL: 50, XL: 0, loadOpen: false, lenLambda: 1.5 } },
    'harm-open': { label: 'Harmonic — open load (full standing wave)', p: { mode: 'harmonic', Rs: 50, Xs: 0, RL: 50, XL: 0, loadOpen: true, lenLambda: 1.25 } },
    'harm-short': { label: 'Harmonic — short load (full standing wave)', p: { mode: 'harmonic', Rs: 50, Xs: 0, RL: 0, XL: 0, loadOpen: false, lenLambda: 1.25 } },
    'harm-mismatch': { label: 'Harmonic — 2:1 mismatch (ZL = 2 Z0)', p: { mode: 'harmonic', Rs: 50, Xs: 0, RL: 100, XL: 0, loadOpen: false, lenLambda: 1.5 } },
    'harm-qwave': { label: 'Harmonic — quarter-wave section (Zin = Z0²/ZL)', p: { mode: 'harmonic', Rs: 50, Xs: 0, RL: 100, XL: 0, loadOpen: false, lenLambda: 0.25 } },
    'harm-reso': { label: 'Harmonic — resonant ring-up (Rs = 1 Ω, open, ℓ = λ/4)', p: { mode: 'harmonic', Rs: 1, Xs: 0, RL: 50, XL: 0, loadOpen: true, lenLambda: 0.25 } },
    'step-default': { label: 'Step — stiff source, low-Z load (MATLAB default)', p: { mode: 'step', Rs: 1, Xs: 0, RL: 10, XL: 0, loadOpen: false } },
    'step-staircase': { label: 'Step — bounce staircase (Rs = 25, RL = 100)', p: { mode: 'step', Rs: 25, Xs: 0, RL: 100, XL: 0, loadOpen: false } },
    'step-open': { label: 'Step — open load, voltage doubling', p: { mode: 'step', Rs: 10, Xs: 0, RL: 50, XL: 0, loadOpen: true } },
    'step-short': { label: 'Step — short load, current doubling', p: { mode: 'step', Rs: 10, Xs: 0, RL: 0, XL: 0, loadOpen: false } },
    'step-msrc': { label: 'Step — matched source (single reflection)', p: { mode: 'step', Rs: 50, Xs: 0, RL: 50, XL: 0, loadOpen: true } },
    'rect-echo': { label: 'Pulse — rectangular, echoes on mismatched line', p: { mode: 'rect', Rs: 25, Xs: 0, RL: 100, XL: 0, loadOpen: false, pulseWidth: 0.25 } },
    'gauss-open': { label: 'Pulse — Gaussian, open load (V echo upright, I echo inverted)', p: { mode: 'gauss', Rs: 50, Xs: 0, RL: 50, XL: 0, loadOpen: true, pulseWidth: 0.2 } },
    'gauss-short': { label: 'Pulse — Gaussian, short load (V echo inverted, I echo upright)', p: { mode: 'gauss', Rs: 50, Xs: 0, RL: 0, XL: 0, loadOpen: false, pulseWidth: 0.2 } },
  };

  // ---------------- helpers ----------------------------------------------
  function $(id) { return document.getElementById(id); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function fmt(v, d) { return (+v.toFixed(d != null ? d : 3)).toString(); }
  function fmtC(z) {
    if (!isFinite(z.re)) return '∞';
    var r = fmt(z.re, 1), x = Math.abs(z.im) < 5e-3 ? null : fmt(Math.abs(z.im), 1);
    if (x === null) return r;
    if (Math.abs(z.re) < 5e-3) return (z.im < 0 ? '−' : '') + 'j' + x;
    return r + (z.im < 0 ? ' − j' : ' + j') + x;
  }
  function fmtMagAng(z) {
    var a = Math.hypot(z.re, z.im);
    if (a < 1e-6) return '0';
    return fmt(a, 3) + ' ∠ ' + fmt(Math.atan2(z.im, z.re) * 180 / Math.PI, 1) + '°';
  }

  function currentZL() {
    return state.loadOpen ? { re: Infinity, im: 0 }
      : { re: state.RL, im: state.mode === 'harmonic' ? state.XL : 0 };
  }
  function currentZs() {
    return { re: state.Rs, im: state.mode === 'harmonic' ? state.Xs : 0 };
  }

  // ---------------- rebuild on parameter change ---------------------------
  function rebuild(keepT) {
    state.histZoom = null;      // a zoom window from the previous model is meaningless
    histDrag = null;
    if (state.sections.length === 1) {
      state.sections[0].Z0 = state.Z0;
      state.sections[0].len = state.lenLambda;
    }
    if (state.sections.length > 1) {
      model = window.TLCascade.build({
        mode: state.mode, V0: state.V0,
        Zs: currentZs(), ZL: currentZL(),
        sections: state.sections.map(function (s) { return { Z0: s.Z0, len: s.len }; }),
        pulseWidth: state.pulseWidth,
      });
    } else {
      model = TLb.build({
        mode: state.mode, V0: state.V0, Z0: state.Z0,
        Zs: currentZs(), ZL: currentZL(),
        lenLambda: state.lenLambda, pulseWidth: state.pulseWidth, phi: 0,
      });
    }
    document.body.classList.toggle('cascade', state.sections.length > 1);
    xs = new Float64Array(NX);
    for (var k = 0; k < NX; k++) xs[k] = model.L * k / (NX - 1);
    out = { vf: new Float64Array(NX), vb: new Float64Array(NX), v: new Float64Array(NX), i: new Float64Array(NX),
            if: new Float64Array(NX), ib: new Float64Array(NX) };

    // envelope
    model.envV = null; model.envI = null;
    if (model.harmonic && !model.noSteadyState) {
      model.envV = new Float64Array(NX); model.envI = new Float64Array(NX);
      for (k = 0; k < NX; k++) {
        var sv = model.ssV(xs[k]), si = model.ssI(xs[k]);
        model.envV[k] = Math.hypot(sv.re, sv.im);
        model.envI[k] = Math.hypot(si.re, si.im) * 1e3;   // mA
      }
    }

    // y-limits: coarse scan of the actual solution
    var vMax = 1e-9, iMax = 1e-9, o2 = { vf: new Float64Array(NX), vb: new Float64Array(NX), v: new Float64Array(NX), i: new Float64Array(NX) };
    for (var j = 0; j <= 60; j++) {
      model.sample(model.tEnd * j / 60, xs, o2);
      for (k = 0; k < NX; k++) {
        var av = Math.abs(o2.v[k]), ai = Math.abs(o2.i[k]) * 1e3;
        if (av > vMax) vMax = av;
        if (ai > iMax) iMax = ai;
      }
    }
    if (model.envV && !model.resonance) {
      for (k = 0; k < NX; k++) {
        if (model.envV[k] > vMax) vMax = model.envV[k];
        if (model.envI[k] > iMax) iMax = model.envI[k];
      }
    }
    if (model.Vinf != null && isFinite(model.Vinf)) vMax = Math.max(vMax, Math.abs(model.Vinf));
    if (model.Iinf != null && isFinite(model.Iinf)) iMax = Math.max(iMax, Math.abs(model.Iinf) * 1e3);
    vLim = vMax * 1.18; iLim = iMax * 1.18;

    if (!keepT) { t = 0; setPlaying(false); }
    if (t > model.tEnd && !model.harmonic) t = model.tEnd;
    syncAxisInputs();
    computeHist();
    updateReadouts();
    updateSchematic();
    updateWarnings();
    document.body.setAttribute('data-mode', state.mode);
  }

  // resample the end-voltage history over the DISPLAYED time span, so a manual
  // (zoomed-in) t-axis gets full 900-point resolution instead of a coarse slice
  function computeHist() {
    var t0 = 0, t1;
    if (state.histZoom) { t0 = state.histZoom.t0; t1 = state.histZoom.t1; }
    else t1 = state.ax.ht.auto ? model.tEnd : state.ax.ht.val;
    hist.t0 = t0; hist.t1 = t1;
    hist.ts = new Float64Array(hist.n); hist.v0 = new Float64Array(hist.n); hist.vL = new Float64Array(hist.n);
    var x2 = new Float64Array([0, model.L]);
    var o3 = { vf: new Float64Array(2), vb: new Float64Array(2), v: new Float64Array(2), i: new Float64Array(2) };
    for (var j = 0; j < hist.n; j++) {
      var tj = t0 + (t1 - t0) * j / (hist.n - 1);
      model.sample(tj, x2, o3);
      hist.ts[j] = tj; hist.v0[j] = o3.v[0]; hist.vL[j] = o3.v[1];
    }
  }

  // keep axis inputs mirroring the auto values; manual axes keep their value
  function syncAxisInputs() {
    var autos = { v: vLim, i: iLim, ht: model.tEnd, hv: vLim };
    Object.keys(AXIS_INPUT).forEach(function (k) {
      var a = state.ax[k], inp = $(AXIS_INPUT[k]);
      if (a.auto) {
        a.val = autos[k];
        inp.value = +a.val.toPrecision(3);
      } else if (Math.abs(parseFloat(inp.value) - a.val) > 1e-12) {
        inp.value = +a.val.toPrecision(6);   // resync display only when it truly differs (project load)
      }
      var ck = $(AXIS_INPUT[k] + 'auto');
      ck.checked = a.auto;
      var zoomedHist = !!state.histZoom && (k === 'ht' || k === 'hv');
      inp.disabled = a.auto || zoomedHist;
      ck.disabled = zoomedHist;
    });
    $('histZoomReset').hidden = !state.histZoom;
  }

  // ---------------- readouts / schematic / warnings -----------------------
  function updateReadouts() {
    $('lblGL').innerHTML = model.cascade ? 'Γ<sub>L</sub> (w.r.t. last-section Z₀)' : 'Γ<sub>L</sub> = (Z<sub>L</sub>−Z₀)/(Z<sub>L</sub>+Z₀)';
    $('lblGS').innerHTML = model.cascade ? 'Γ<sub>S</sub> (w.r.t. first-section Z₀)' : 'Γ<sub>S</sub> = (Z<sub>s</sub>−Z₀)/(Z<sub>s</sub>+Z₀)';
    $('lblVSWR').textContent = model.cascade ? 'VSWR (load-end section)' : 'VSWR';
    $('roGL').textContent = fmtMagAng(model.GL);
    $('roGS').textContent = fmtMagAng(model.GS);
    $('roVSWR').textContent = isFinite(model.VSWR) ? fmt(model.VSWR, 2) : '∞';
    $('roT').textContent = model.harmonic ? fmt(model.T, 3) + ' periods'
      : model.cascade ? fmt(model.T, 3) + ' (norm. units)' : 'T (normalized)';
    var zin = $('roZinRow');
    if (model.harmonic && model.Zin) {
      zin.style.display = '';
      $('roZin').textContent = isFinite(model.Zin.re) ? fmtC(model.Zin) + ' Ω' : '∞';
    } else zin.style.display = 'none';
    var vinf = $('roVinfRow');
    if (model.Vinf != null) {
      vinf.style.display = '';
      $('roVinf').textContent = fmt(model.Vinf, 3) + ' V,  ' +
        (isFinite(model.Iinf) ? fmt(model.Iinf * 1e3, 2) + ' mA' : '∞');
    } else vinf.style.display = 'none';
    $('roNb').textContent = model.Nb == null ? 'exact (no truncation)' : model.Nb + (model.Nb >= 300 ? ' (capped)' : '');
  }

  function updateSchematic() {
    $('schZs').textContent = 'Zs = ' + fmtC(currentZs()) + ' Ω';
    $('schZL').textContent = 'ZL = ' + (state.loadOpen ? 'open' : fmtC(currentZL()) + ' Ω');
    // rebuild the line segment drawing (one span per section)
    var g = $('schTL'), NSVG = 'http://www.w3.org/2000/svg';
    while (g.firstChild) g.removeChild(g.firstChild);
    var X0 = 205, X1 = 555, total = 0;
    state.sections.forEach(function (s) { total += s.len; });
    var xpx = X0, unit = model.harmonic ? ' λ' : ' T';
    var single = state.sections.length === 1;
    state.sections.forEach(function (s, idx) {
      var wpx = (X1 - X0) * s.len / total;
      ['24', '86'].forEach(function (yy) {
        var ln = document.createElementNS(NSVG, 'line');
        ln.setAttribute('x1', xpx + (idx ? 2 : 0)); ln.setAttribute('x2', xpx + wpx);
        ln.setAttribute('y1', yy); ln.setAttribute('y2', yy);
        ln.setAttribute('class', 'tl');
        ln.setAttribute('stroke-width', idx % 2 ? 5.5 : 4);
        g.appendChild(ln);
      });
      var tx = document.createElementNS(NSVG, 'text');
      tx.setAttribute('x', xpx + wpx / 2); tx.setAttribute('y', 60);
      tx.setAttribute('text-anchor', 'middle');
      tx.textContent = single
        ? 'Z0 = ' + fmt(s.Z0, 1) + ' Ω' + (model.harmonic ? ',  ℓ = ' + fmt(s.len, 3) + unit : ',  delay T')
        : fmt(s.Z0, 0) + ' Ω · ' + fmt(s.len, 2) + unit;
      g.appendChild(tx);
      if (idx > 0) {
        var jn = document.createElementNS(NSVG, 'line');
        jn.setAttribute('x1', xpx); jn.setAttribute('x2', xpx);
        jn.setAttribute('y1', 24); jn.setAttribute('y2', 86);
        jn.setAttribute('class', 'wire');
        jn.setAttribute('stroke-dasharray', '3 3');
        g.appendChild(jn);
      }
      xpx += wpx;
    });
    $('schVs').textContent = state.mode === 'harmonic' ? 'V0 cos(2πt)·u(t)'
      : state.mode === 'step' ? 'V0 · u(t)'
      : state.mode === 'rect' ? 'V0 · rect pulse' : 'V0 · Gaussian pulse';
  }

  function updateWarnings() {
    var msgs = [];
    if (model.resonance) msgs.push('Near resonance: |1 − Γ<sub>S</sub>Γ<sub>L</sub>e<sup>−j2βℓ</sup>| ≈ 0 — steady-state amplitude is very large (envelope hidden, lossless line).');
    if (model.noSteadyState) msgs.push('|Γ<sub>S</sub>Γ<sub>L</sub>| ≥ 1 on a lossless line: the response never settles.' +
      (model.Nb == null ? ' Showing the exact response over the computed span.' : ' Showing the first ' + model.Nb + ' bounces.'));
    if (model.resolutionWarning) msgs.push('Long line / short features: the display is near its time-resolution limit — fine detail may be smoothed.');
    else if (model.convergenceWarning) msgs.push('|Γ<sub>S</sub>Γ<sub>L</sub>| ≈ 1 — convergence is slow; the first ' + model.Nb + ' bounces are shown.');
    var el = $('warnings');
    el.innerHTML = msgs.map(function (m) { return '<div class="warn">⚠ ' + m + '</div>'; }).join('');
    el.style.display = msgs.length ? '' : 'none';
  }

  // ---------------- drawing ----------------------------------------------
  var vPlot, iPlot, histPlot, latPlot;

  function drawJunctions(plot) {
    var ctx = plot.ctx;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    model.sections.forEach(function (sec, idx) {
      if (idx > 0) plot.vline(sec.x0, { color: css('--axis'), width: 1, dash: [1, 3] });
      var label = fmt(sec.Z0, 0) + ' Ω';
      var lx = plot.sx((sec.x0 + sec.x1) / 2), ly = plot.margin.t + 3;
      var tw = ctx.measureText(label).width;
      ctx.fillStyle = css('--panel') || '#fff';
      ctx.fillRect(lx - tw / 2 - 3, ly - 1, tw + 6, 13);
      ctx.fillStyle = css('--muted');
      ctx.textAlign = 'center';
      ctx.fillText(label, lx, ly);
    });
  }

  function legend(plot, items) {
    var ctx = plot.ctx, x = plot.margin.l + plot.pw - 8, y = plot.margin.t + 6;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    items.forEach(function (it) {
      ctx.fillStyle = it.color;
      ctx.fillText(it.label, x, y);
      y += 14;
    });
  }

  function draw() {
    model.sample(t, xs, out);
    var xlabel = model.harmonic ? 'position along the line   x / λ'
               : model.cascade ? 'position along the line   x   (v = 1 normalized units)'
               : 'position along the line   x / L';
    var vEff = state.ax.v.auto ? vLim : state.ax.v.val;
    var iEff = state.ax.i.auto ? iLim : state.ax.i.val;

    // ---- voltage plot
    vPlot.begin(0, model.L, -vEff, vEff);
    vPlot.axes(xlabel, 'V(x,t)   (V)');
    if (state.showEnvelope && model.envV && !model.resonance) {
      var neg = new Float64Array(NX);
      for (var k = 0; k < NX; k++) neg[k] = -model.envV[k];
      vPlot.line(xs, model.envV, { color: css('--env'), width: 1.2, dash: [3, 3] });
      vPlot.line(xs, neg, { color: css('--env'), width: 1.2, dash: [3, 3] });
    }
    if (model.Vinf != null && isFinite(model.Vinf)) vPlot.hline(model.Vinf, { color: css('--v'), dash: [6, 4], label: 'V∞ = ' + fmt(model.Vinf, 3) + ' V' });
    if (state.showComponents) {
      vPlot.line(xs, out.vf, { color: css('--vfw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
      vPlot.line(xs, out.vb, { color: css('--vbw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
    }
    vPlot.line(xs, out.v, { color: css('--v'), width: 2.4 });
    if (model.cascade) drawJunctions(vPlot);
    vPlot.endMarkers('◼ source (Zs)', 'load (ZL) ⬤');
    var leg = [{ label: 'V(x,t)', color: css('--v') }];
    if (state.showComponents) leg.push({ label: 'V⁺ (forward)', color: css('--vfw') }, { label: 'V⁻ (backward)', color: css('--vbw') });
    if (state.showEnvelope && model.envV && !model.resonance) leg.push({ label: '±|V(x)| steady state', color: css('--env') });
    legend(vPlot, leg);

    // ---- current plot
    if (state.showCurrent) {
      var iMA = new Float64Array(NX), fMA = new Float64Array(NX), bMA = new Float64Array(NX);
      for (k = 0; k < NX; k++) { iMA[k] = out.i[k] * 1e3; fMA[k] = out.if[k] * 1e3; bMA[k] = out.ib[k] * 1e3; }
      iPlot.begin(0, model.L, -iEff, iEff);
      iPlot.axes(xlabel, 'I(x,t)   (mA)');
      if (state.showEnvelope && model.envI && !model.resonance) {
        var negI = new Float64Array(NX);
        for (k = 0; k < NX; k++) negI[k] = -model.envI[k];
        iPlot.line(xs, model.envI, { color: css('--env'), width: 1.2, dash: [3, 3] });
        iPlot.line(xs, negI, { color: css('--env'), width: 1.2, dash: [3, 3] });
      }
      if (model.Iinf != null && isFinite(model.Iinf)) iPlot.hline(model.Iinf * 1e3, { color: css('--i'), dash: [6, 4], label: 'I∞ = ' + fmt(model.Iinf * 1e3, 2) + ' mA' });
      if (state.showComponents) {
        iPlot.line(xs, fMA, { color: css('--vfw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
        iPlot.line(xs, bMA, { color: css('--vbw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
      }
      iPlot.line(xs, iMA, { color: css('--i'), width: 2.4 });
      if (model.cascade) drawJunctions(iPlot);
      legend(iPlot, [{ label: model.cascade ? 'I(x,t) = (V⁺ − V⁻)/Z₀ₖ (per section)' : 'I(x,t) = (V⁺ − V⁻)/Z0', color: css('--i') }]);
    }

    // ---- hover markers on V and I plots
    var xu = model.harmonic ? ' λ' : model.cascade ? '' : ' L';
    if (hover.cvV) {
      var hx = vPlot.dataX(hover.cvV.x);
      if (hx != null) {
        var hi = Math.max(0, Math.min(NX - 1, Math.round(hx / model.L * (NX - 1))));
        var items = [{ y: out.v[hi], color: css('--v'), label: 'V = ' + fmt(out.v[hi], 3) + ' V' }];
        if (state.showComponents) {
          items.push({ y: out.vf[hi], color: css('--vfw'), label: 'V⁺ = ' + fmt(out.vf[hi], 3) + ' V' });
          items.push({ y: out.vb[hi], color: css('--vbw'), label: 'V⁻ = ' + fmt(out.vb[hi], 3) + ' V' });
        }
        vPlot.hoverMarker(xs[hi], items, 'x = ' + fmt(xs[hi], 3) + xu);
      }
    }
    if (state.showCurrent && hover.cvI) {
      var hxi = iPlot.dataX(hover.cvI.x);
      if (hxi != null) {
        var hii = Math.max(0, Math.min(NX - 1, Math.round(hxi / model.L * (NX - 1))));
        iPlot.hoverMarker(xs[hii],
          [{ y: out.i[hii] * 1e3, color: css('--i'), label: 'I = ' + fmt(out.i[hii] * 1e3, 2) + ' mA' }],
          'x = ' + fmt(xs[hii], 3) + xu);
      }
    }

    // ---- lattice diagram
    if (state.showLattice && model.cascade) {
      latPlot.begin(0, 1, 0, 1);
      var lc = latPlot.ctx;
      lc.font = '12px system-ui, sans-serif';
      lc.fillStyle = latPlot.colText;
      lc.textAlign = 'center'; lc.textBaseline = 'middle';
      lc.fillText('The bounce (lattice) diagram is drawn for single-section lines only —', latPlot.W / 2, latPlot.H / 2 - 10);
      lc.fillText('with cascaded sections, waves split at every junction.', latPlot.W / 2, latPlot.H / 2 + 10);
      $('latRTval').textContent = '';
    } else if (state.showLattice) {
      $('latRTval').textContent = Math.min(state.latticeRT, model.Nb) + ' round trips';
      P.drawLattice(latPlot, model, t,
        { fw: css('--vfw'), bw: css('--vbw'), now: css('--now') },
        function (s) {
          return model.harmonic ? fmt(s.abs, 2) + '∠' + fmt(s.arg * 180 / Math.PI, 0) + '°'
                                : (s.re >= 0 ? '+' : '') + fmt(s.re, 3) + ' V';
        }, Math.min(state.latticeRT, model.Nb));
    }

    // ---- time-history plot
    if (state.showHistory) {
      var hMin, hMax;
      if (state.histZoom) { hMin = state.histZoom.v0; hMax = state.histZoom.v1; }
      else { var histV = state.ax.hv.auto ? vLim : state.ax.hv.val; hMin = -histV; hMax = histV; }
      histPlot.begin(hist.t0, hist.t1, hMin, hMax);
      histPlot.axes(model.harmonic ? 'time  (periods)' : model.cascade ? 'time  (normalized units)' : 'time  (units of T)', 'V at ends  (V)');
      if (model.Vinf != null && isFinite(model.Vinf)) histPlot.hline(model.Vinf, { color: css('--axis'), dash: [4, 4] });
      histPlot.line(hist.ts, hist.v0, { color: css('--hsrc'), width: 1.6 });
      histPlot.line(hist.ts, hist.vL, { color: css('--hload'), width: 1.6 });
      histPlot.vline(Math.min(t, model.tEnd), { color: css('--now'), width: 1.4, dash: [4, 3] });
      if (histDrag && histDrag.active) {
        var hc = histPlot.ctx;
        hc.save();
        hc.fillStyle = 'rgba(26, 99, 196, 0.12)';
        hc.strokeStyle = 'rgba(26, 99, 196, 0.8)';
        hc.lineWidth = 1;
        hc.fillRect(Math.min(histDrag.x0, histDrag.x1), Math.min(histDrag.y0, histDrag.y1),
                    Math.abs(histDrag.x1 - histDrag.x0), Math.abs(histDrag.y1 - histDrag.y0));
        hc.strokeRect(Math.min(histDrag.x0, histDrag.x1), Math.min(histDrag.y0, histDrag.y1),
                      Math.abs(histDrag.x1 - histDrag.x0), Math.abs(histDrag.y1 - histDrag.y0));
        hc.restore();
      }
      legend(histPlot, [{ label: 'V(source end, t)', color: css('--hsrc') }, { label: 'V(load, t)', color: css('--hload') }]);
      if (hover.cvHist && !(histDrag && histDrag.active)) {
        var ht = histPlot.dataX(hover.cvHist.x);
        if (ht != null) {
          var hj = Math.max(0, Math.min(hist.n - 1, Math.round((ht - hist.t0) / (hist.t1 - hist.t0) * (hist.n - 1))));
          var td = Math.max(2, Math.min(8, 2 - Math.floor(Math.log10((hist.t1 - hist.t0) || 1))));
          var vd = Math.max(3, Math.min(8, 2 - Math.floor(Math.log10((hMax - hMin) || 1))));
          histPlot.hoverMarker(hist.ts[hj],
            [{ y: hist.v0[hj], color: css('--hsrc'), label: 'source: ' + fmt(hist.v0[hj], vd) + ' V' },
             { y: hist.vL[hj], color: css('--hload'), label: 'load: ' + fmt(hist.vL[hj], vd) + ' V' }],
            't = ' + fmt(hist.ts[hj], td) + (model.harmonic ? ' periods' : ' T'));
        }
      }
    }

    // ---- time readout + scrub
    var tr = model.harmonic
      ? 't = ' + fmt(t, 2) + ' periods  =  ' + fmt(t / model.T, 2) + ' T'
      : model.cascade ? 't = ' + fmt(t, 2) + '   (total transit ' + fmt(model.T, 2) + ')'
      : 't = ' + fmt(t, 2) + ' T';
    $('timeReadout').textContent = tr;
    $('mbTime').textContent = tr;
    if (!scrubbing) {
      var sv = Math.round(Math.min(t / model.tEnd, 1) * 1000);
      $('scrub').value = sv;
      $('mbScrub').value = sv;
    }
  }

  // ---------------- animation loop ---------------------------------------
  function frame(ts) {
    if (lastFrame == null) lastFrame = ts;
    var dt = Math.min(0.1, (ts - lastFrame) / 1000);
    lastFrame = ts;
    if (playing) {
      t += dt * speed;
      if (!model.harmonic && t >= model.tEnd) { t = model.tEnd; setPlaying(false); }
    }
    draw();
    requestAnimationFrame(frame);
  }

  function setPlaying(p) {
    playing = p;
    $('btnPlay').textContent = p ? '❚❚ Pause' : '▶ Play';
    $('mbPlay').textContent = p ? '❚❚' : '▶';
  }

  // ---------------- UI wiring --------------------------------------------
  var scrubbing = false;

  function bindNumber(id, key, cb) {
    var el = $(id);
    el.value = state[key];
    el.addEventListener('change', function () {
      var v = parseFloat(el.value);
      if (!isFinite(v)) { el.value = state[key]; return; }
      var lo = parseFloat(el.min), hi = parseFloat(el.max);
      if (isFinite(lo)) v = Math.max(lo, v);
      if (isFinite(hi)) v = Math.min(hi, v);
      state[key] = v;
      el.value = v;
      $('scenario').value = 'custom';
      (cb || rebuild)();
    });
  }

  function init() {
    vPlot = new P.Plot($('cvV'));
    iPlot = new P.Plot($('cvI'));
    histPlot = new P.Plot($('cvHist'), { margin: { l: 46, r: 10, t: 8, b: 30 } });
    latPlot = new P.Plot($('cvLat'), { margin: { l: 34, r: 10, t: 14, b: 26 } });

    // scenario select
    var sel = $('scenario');
    Object.keys(SCENARIOS).forEach(function (k2) {
      var o = document.createElement('option');
      o.value = k2; o.textContent = SCENARIOS[k2].label;
      sel.appendChild(o);
    });
    var oc = document.createElement('option');
    oc.value = 'custom'; oc.textContent = 'Custom…';
    sel.appendChild(oc);
    sel.value = 'step-default';
    sel.addEventListener('change', function () {
      if (sel.value === 'custom') return;
      if (state.sections.length > 1 &&
          !confirm('Applying a scenario resets the line to a single section. Continue?')) {
        sel.value = 'custom';
        return;
      }
      Object.assign(state, SCENARIOS[sel.value].p);
      state.sections = [{ Z0: state.Z0, len: state.lenLambda }];
      renderSections();
      syncInputs(); rebuild();
    });

    // mode radios
    document.querySelectorAll('input[name=mode]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) { state.mode = r.value; $('scenario').value = 'custom'; syncInputs(); renderSections(); rebuild(); }
      });
    });

    bindNumber('inRs', 'Rs');
    bindNumber('inXs', 'Xs');
    bindNumber('inRL', 'RL');
    bindNumber('inXL', 'XL');
    bindNumber('inZ0', 'Z0', function () { state.sections[0].Z0 = state.Z0; rebuild(); });

    $('inOpen').addEventListener('change', function () {
      state.loadOpen = $('inOpen').checked;
      $('inRL').disabled = state.loadOpen;
      $('inXL').disabled = state.loadOpen || state.mode !== 'harmonic';
      $('scenario').value = 'custom';
      rebuild();
    });

    // length slider + number
    var sl = $('slLen'), nl = $('inLen');
    function setLen(v) {
      v = Math.min(3, Math.max(0.05, v));
      state.lenLambda = v;
      state.sections[0].len = v;
      sl.value = v; nl.value = v;
      $('scenario').value = 'custom';
      rebuild();
    }
    sl.addEventListener('input', function () { setLen(parseFloat(sl.value)); });
    nl.addEventListener('change', function () { var v = parseFloat(nl.value); if (isFinite(v)) setLen(v); else nl.value = state.lenLambda; });

    // pulse width
    var sw = $('slWidth'), nw = $('inWidth');
    function setW(v) {
      v = Math.min(2, Math.max(0.02, v));
      state.pulseWidth = v;
      sw.value = v; nw.value = v;
      $('scenario').value = 'custom';
      rebuild();
    }
    sw.addEventListener('input', function () { setW(parseFloat(sw.value)); });
    nw.addEventListener('change', function () { var v = parseFloat(nw.value); if (isFinite(v)) setW(v); else nw.value = state.pulseWidth; });

    // load preset chips
    document.querySelectorAll('#loadChips button').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = b.dataset;
        state.loadOpen = d.open === '1';
        if (!state.loadOpen) { state.RL = parseFloat(d.r); state.XL = parseFloat(d.x); }
        $('scenario').value = 'custom';
        syncInputs(); rebuild();
      });
    });

    // animation controls
    $('btnPlay').addEventListener('click', function () {
      if (!playing && !model.harmonic && t >= model.tEnd) t = 0;
      setPlaying(!playing);
    });
    $('btnRestart').addEventListener('click', function () { t = 0; setPlaying(true); });
    $('btnSteady').addEventListener('click', function () {
      t = model.Nb == null ? model.tEnd + 0.01
        : Math.min(2 * model.Nb * model.T, 400 * model.T) + 1;
      if (!model.harmonic) { t = Math.min(t, model.tEnd); setPlaying(false); } 
      draw();
    });
    var sp = $('slSpeed');
    sp.addEventListener('input', function () { speed = Math.pow(10, parseFloat(sp.value)); $('speedReadout').textContent = fmt(speed, 2) + '×'; });
    sp.value = Math.log10(speed);
    $('speedReadout').textContent = fmt(speed, 2) + '×';

    var sc = $('scrub');
    sc.addEventListener('input', function () {
      scrubbing = true;
      t = parseFloat(sc.value) / 1000 * model.tEnd;
      setPlaying(false); draw();
      scrubbing = false;
    });

    // display toggles
    [['tgComp', 'showComponents'], ['tgEnv', 'showEnvelope'], ['tgCur', 'showCurrent'],
     ['tgLat', 'showLattice'], ['tgHist', 'showHistory']].forEach(function (pair) {
      var el = $(pair[0]);
      el.checked = state[pair[1]];
      el.addEventListener('change', function () {
        state[pair[1]] = el.checked;
        document.body.classList.toggle('hide-' + pair[1], !el.checked);
        draw();
      });
      document.body.classList.toggle('hide-' + pair[1], !el.checked);
    });

    // ---- cascade section editor ----
    $('btnAddSec').addEventListener('click', function () {
      if (state.sections.length >= 6) return;
      var last = state.sections[state.sections.length - 1];
      state.sections.push({ Z0: last.Z0 === 50 ? 75 : 50, len: 0.25 });
      $('scenario').value = 'custom';
      renderSections(); rebuild();
    });

    // ---- project save / load ----
    $('btnSave').addEventListener('click', function () {
      var blob = new Blob([JSON.stringify(projectData(), null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      var d = new Date(), pad = function (v) { return (v < 10 ? '0' : '') + v; };
      a.download = 'tl-project-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
    $('btnLoad').addEventListener('click', function () { $('fileLoad').click(); });
    $('fileLoad').addEventListener('change', function () {
      if ($('fileLoad').files.length) loadProjectFile($('fileLoad').files[0]);
      $('fileLoad').value = '';
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length) loadProjectFile(e.dataTransfer.files[0]);
    });

    // axis auto/manual controls
    Object.keys(AXIS_INPUT).forEach(function (k) {
      var inp = $(AXIS_INPUT[k]), ck = $(AXIS_INPUT[k] + 'auto');
      ck.checked = state.ax[k].auto;
      inp.disabled = state.ax[k].auto;
      ck.addEventListener('change', function () {
        state.ax[k].auto = ck.checked;
        if (!ck.checked) {
          // freeze at the displayed precision so the box and the axis agree
          state.ax[k].val = +state.ax[k].val.toPrecision(3);
          $(AXIS_INPUT[k]).value = state.ax[k].val;
        }
        if (model) { syncAxisInputs(); if (k === 'ht') computeHist(); }
      });
      inp.addEventListener('change', function () {
        var v = parseFloat(inp.value);
        if (!isFinite(v) || v <= 0) { inp.value = +state.ax[k].val.toPrecision(3); return; }
        var lo = parseFloat(inp.min), hi = parseFloat(inp.max);
        if (isFinite(lo)) v = Math.max(lo, v);
        if (isFinite(hi)) v = Math.min(hi, v);
        state.ax[k].val = v;
        inp.value = v;
        if (model && k === 'ht') computeHist();
      });
    });

    // drag-to-zoom on the history plot (mouse only; sets both axes and fixes them)
    (function () {
      var c = $('cvHist');
      function clampPx(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      c.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        histDrag = { active: true, x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
        e.preventDefault();
      });
      c.addEventListener('mousemove', function (e) {
        if (histDrag && histDrag.active) {
          if ((e.buttons & 1) === 0) { histDrag = null; return; }  // left button no longer held
          histDrag.x1 = e.offsetX; histDrag.y1 = e.offsetY;
        }
      });
      window.addEventListener('blur', function () { histDrag = null; });
      window.addEventListener('mouseup', function (e) {
        if (!histDrag || !histDrag.active) return;
        if (e.button !== 0) { histDrag = null; return; }           // other buttons cancel
        var d = histDrag; histDrag = null;
        if (Math.abs(d.x1 - d.x0) < 8 || Math.abs(d.y1 - d.y0) < 8) return;  // just a click
        var m = histPlot.margin;
        var pxa = clampPx(Math.min(d.x0, d.x1), m.l, m.l + histPlot.pw);
        var pxb = clampPx(Math.max(d.x0, d.x1), m.l, m.l + histPlot.pw);
        var pya = clampPx(Math.min(d.y0, d.y1), m.t, m.t + histPlot.ph);
        var pyb = clampPx(Math.max(d.y0, d.y1), m.t, m.t + histPlot.ph);
        if (pxb - pxa < 4 || pyb - pya < 4) return;
        state.histZoom = {
          t0: histPlot.dataX(pxa), t1: histPlot.dataX(pxb),
          v0: histPlot.dataY(pyb), v1: histPlot.dataY(pya),   // py grows downward
        };
        syncAxisInputs();
        computeHist();
      });
      function resetZoom() {
        if (!state.histZoom) return;
        state.histZoom = null;
        syncAxisInputs();
        computeHist();
      }
      c.addEventListener('dblclick', resetZoom);
      $('histZoomReset').addEventListener('click', resetZoom);
    })();

    // hover tracking on the three curve plots (mouse + touch)
    ['cvV', 'cvI', 'cvHist'].forEach(function (id) {
      var c = $(id);
      c.addEventListener('mousemove', function (e) { hover[id] = { x: e.offsetX, y: e.offsetY }; });
      c.addEventListener('mouseleave', function () { hover[id] = null; });
      function onTouch(e) {
        if (!e.touches.length) return;
        var r = c.getBoundingClientRect();
        hover[id] = { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
      }
      c.addEventListener('touchstart', onTouch, { passive: true });
      c.addEventListener('touchmove', onTouch, { passive: true });
      // marker intentionally persists after touchend so the value stays readable
    });

    // mobile playbar proxies the main animation controls
    $('mbPlay').addEventListener('click', function () { $('btnPlay').click(); });
    $('mbRestart').addEventListener('click', function () { $('btnRestart').click(); });
    $('mbScrub').addEventListener('input', function () {
      scrubbing = true;
      t = parseFloat($('mbScrub').value) / 1000 * model.tEnd;
      setPlaying(false); draw();
      scrubbing = false;
    });

    // lattice round-trip slider
    var slRT = $('slLatRT');
    slRT.value = state.latticeRT;
    slRT.addEventListener('input', function () {
      state.latticeRT = parseInt(slRT.value, 10) || 1;
    });

    window.addEventListener('resize', function () { if (model) draw(); });

    syncInputs();
    rebuild();
    requestAnimationFrame(frame);
  }

  // rebuild the section-editor rows (called on structural changes, not every keystroke)
  function renderSections() {
    var host = $('secRows');
    host.innerHTML = '';
    if (state.sections.length < 2) return;
    var unit = state.mode === 'harmonic' ? 'λ' : 'T';
    state.sections.forEach(function (s, idx) {
      var row = document.createElement('div');
      row.className = 'row secrow';
      row.innerHTML = '<span class="secno">' + (idx + 1) + '</span>' +
        ' Z₀ <input type="number" class="sZ" step="5" min="1" value="' + s.Z0 + '"> Ω ' +
        ' ℓ <input type="number" class="sL" step="0.05" min="0.01" max="10" value="' + s.len + '"> ' + unit +
        ' <button class="sX" title="remove section">✕</button>';
      row.querySelector('.sZ').addEventListener('change', function (e) {
        var v = parseFloat(e.target.value);
        if (!isFinite(v)) { e.target.value = s.Z0; return; }
        v = Math.max(1, Math.min(10000, v));
        s.Z0 = v; e.target.value = v;
        if (idx === 0) { state.Z0 = v; $('inZ0').value = v; }
        $('scenario').value = 'custom'; rebuild();
      });
      row.querySelector('.sL').addEventListener('change', function (e) {
        var v = parseFloat(e.target.value);
        if (!isFinite(v)) { e.target.value = s.len; return; }
        v = Math.max(0.01, Math.min(10, v));
        s.len = v; e.target.value = v;
        if (idx === 0) { state.lenLambda = v; $('slLen').value = v; $('inLen').value = v; }
        $('scenario').value = 'custom'; rebuild();
      });
      row.querySelector('.sX').addEventListener('click', function () {
        state.sections.splice(idx, 1);
        state.Z0 = state.sections[0].Z0;
        state.lenLambda = state.sections.length > 1
          ? state.sections[0].len
          : Math.max(0.05, Math.min(3, state.sections[0].len));
        if (state.sections.length === 1) state.sections[0].len = state.lenLambda;
        $('scenario').value = 'custom';
        renderSections(); syncInputs(); rebuild();
      });
      host.appendChild(row);
    });
  }

  // ---- project save / load ----
  var PROJECT_APP = 'eeng530-tl-visualizer';
  function projectData() {
    return {
      app: PROJECT_APP, version: 1, saved: new Date().toISOString(),
      state: JSON.parse(JSON.stringify({
        mode: state.mode, V0: state.V0, Z0: state.Z0, Rs: state.Rs, Xs: state.Xs,
        RL: state.RL, XL: state.XL, loadOpen: state.loadOpen,
        lenLambda: state.lenLambda, pulseWidth: state.pulseWidth,
        sections: state.sections, latticeRT: state.latticeRT,
        showComponents: state.showComponents, showEnvelope: state.showEnvelope,
        showCurrent: state.showCurrent, showLattice: state.showLattice, showHistory: state.showHistory,
        ax: state.ax, histZoom: state.histZoom,
      })),
      t: t, speed: speed,
    };
  }

  function loadProjectFile(file) {
    var rd = new FileReader();
    rd.onload = function () {
      try { applyProject(JSON.parse(rd.result)); }
      catch (err) { alert('Not a valid transmission-line project file.'); }
    };
    rd.onerror = function () { alert('Could not read the dropped file.'); };
    rd.readAsText(file);
  }

  function num(v, dflt, lo, hi) {
    v = parseFloat(v);
    if (!isFinite(v)) return dflt;
    return Math.max(lo, Math.min(hi, v));
  }

  function applyProject(pj) {
    if (!pj || pj.app !== PROJECT_APP || !pj.state) throw new Error('bad project');
    var s = pj.state;
    state.mode = ['harmonic', 'step', 'rect', 'gauss'].indexOf(s.mode) >= 0 ? s.mode : 'step';
    state.V0 = num(s.V0, 1, 0.1, 100);
    state.Rs = num(s.Rs, 50, 0, 1e6); state.Xs = num(s.Xs, 0, -1e6, 1e6);
    state.RL = num(s.RL, 50, 0, 1e6); state.XL = num(s.XL, 0, -1e6, 1e6);
    state.loadOpen = !!s.loadOpen;
    state.lenLambda = num(s.lenLambda, 1.5, 0.05, 3);
    state.pulseWidth = num(s.pulseWidth, 0.25, 0.02, 2);
    state.latticeRT = Math.round(num(s.latticeRT, 10, 1, 30));
    state.sections = (Array.isArray(s.sections) && s.sections.length ? s.sections : [{ Z0: 50, len: 1.5 }])
      .slice(0, 6).map(function (x) {
        x = (x && typeof x === 'object') ? x : {};
        return { Z0: num(x.Z0, 50, 1, 10000), len: num(x.len, 1, 0.01, 10) };
      });
    state.Z0 = state.sections[0].Z0;
    state.lenLambda = state.sections.length > 1
      ? state.sections[0].len
      : Math.max(0.05, Math.min(3, state.sections[0].len));
    ['showComponents', 'showEnvelope', 'showCurrent', 'showLattice', 'showHistory'].forEach(function (k) {
      if (typeof s[k] === 'boolean') state[k] = s[k];
    });
    if (s.ax) Object.keys(AXIS_INPUT).forEach(function (k) {
      if (s.ax[k]) { state.ax[k].auto = s.ax[k].auto !== false; state.ax[k].val = num(s.ax[k].val, state.ax[k].val, 1e-6, 1e9); }
    });
    var zm = null;
    if (s.histZoom) {
      var zc = { t0: +s.histZoom.t0, t1: +s.histZoom.t1, v0: +s.histZoom.v0, v1: +s.histZoom.v1 };
      if (isFinite(zc.t0) && isFinite(zc.t1) && zc.t1 > zc.t0 && zc.t0 >= 0 &&
          isFinite(zc.v0) && isFinite(zc.v1) && zc.v1 > zc.v0) zm = zc;
    }
    speed = num(pj.speed, 0.4, 0.02, 3);
    $('slSpeed').value = Math.log10(speed);
    $('speedReadout').textContent = fmt(speed, 2) + '×';
    $('scenario').value = 'custom';
    $('slLatRT').value = state.latticeRT;
    syncToggles();
    syncInputs();
    renderSections();
    rebuild();                       // clears histZoom by design — restore it after
    if (zm) { state.histZoom = zm; syncAxisInputs(); computeHist(); }
    t = num(pj.t, 0, 0, 1e6);
    setPlaying(false);
    draw();
  }

  function syncToggles() {
    [['tgComp', 'showComponents'], ['tgEnv', 'showEnvelope'], ['tgCur', 'showCurrent'],
     ['tgLat', 'showLattice'], ['tgHist', 'showHistory']].forEach(function (pair) {
      $(pair[0]).checked = state[pair[1]];
      document.body.classList.toggle('hide-' + pair[1], !state[pair[1]]);
    });
  }

  function syncInputs() {
    $('inRs').value = state.Rs; $('inXs').value = state.Xs;
    $('inRL').value = state.RL; $('inXL').value = state.XL;
    $('inZ0').value = state.Z0;
    $('inOpen').checked = state.loadOpen;
    $('inRL').disabled = state.loadOpen;
    $('inXL').disabled = state.loadOpen || state.mode !== 'harmonic';
    $('inXs').disabled = state.mode !== 'harmonic';
    $('slLen').value = state.lenLambda; $('inLen').value = state.lenLambda;
    $('slWidth').value = state.pulseWidth; $('inWidth').value = state.pulseWidth;
    document.querySelectorAll('input[name=mode]').forEach(function (r) { r.checked = (r.value === state.mode); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
