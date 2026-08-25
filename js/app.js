/* app.js — UI state, animation loop, and wiring for the TL visualizer */
(function () {
  'use strict';

  var TLb = window.TL, P = window.TLPlots;

  // ---------------- state ------------------------------------------------
  var state = {
    mode: 'harmonic',            // 'harmonic' | 'step' | 'rect' | 'gauss'
    V0: 1, Z0: 50,
    Rs: 50, Xs: 0,
    RL: 141.12, XL: -102.55, loadOpen: false,
    lenLambda: 1.5,
    pulseWidth: 0.25,
    showComponents: false, showEnvelope: true,
    showCurrent: true, showLattice: true, showHistory: true,
  };
  var model = null;
  var t = 0, playing = true, speed = 0.4, lastFrame = null;
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
    'gauss-open': { label: 'Pulse — Gaussian, open load (reflection flips nothing)', p: { mode: 'gauss', Rs: 50, Xs: 0, RL: 50, XL: 0, loadOpen: true, pulseWidth: 0.2 } },
    'gauss-short': { label: 'Pulse — Gaussian, short load (inverted echo)', p: { mode: 'gauss', Rs: 50, Xs: 0, RL: 0, XL: 0, loadOpen: false, pulseWidth: 0.2 } },
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
    model = TLb.build({
      mode: state.mode, V0: state.V0, Z0: state.Z0,
      Zs: currentZs(), ZL: currentZL(),
      lenLambda: state.lenLambda, pulseWidth: state.pulseWidth, phi: 0,
    });
    xs = new Float64Array(NX);
    for (var k = 0; k < NX; k++) xs[k] = model.L * k / (NX - 1);
    out = { vf: new Float64Array(NX), vb: new Float64Array(NX), v: new Float64Array(NX), i: new Float64Array(NX) };

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
    if (model.Vinf != null) { vMax = Math.max(vMax, Math.abs(model.Vinf)); iMax = Math.max(iMax, Math.abs(model.Iinf) * 1e3); }
    vLim = vMax * 1.18; iLim = iMax * 1.18;

    // history of V at source end and load end
    hist.ts = new Float64Array(hist.n); hist.v0 = new Float64Array(hist.n); hist.vL = new Float64Array(hist.n);
    var x2 = new Float64Array([0, model.L]);
    var o3 = { vf: new Float64Array(2), vb: new Float64Array(2), v: new Float64Array(2), i: new Float64Array(2) };
    for (j = 0; j < hist.n; j++) {
      var tj = model.tEnd * j / (hist.n - 1);
      model.sample(tj, x2, o3);
      hist.ts[j] = tj; hist.v0[j] = o3.v[0]; hist.vL[j] = o3.v[1];
    }

    if (!keepT) { t = 0; playing = true; }
    if (t > model.tEnd && !model.harmonic) t = model.tEnd;
    updateReadouts();
    updateSchematic();
    updateWarnings();
    document.body.setAttribute('data-mode', state.mode);
  }

  // ---------------- readouts / schematic / warnings -----------------------
  function updateReadouts() {
    $('roGL').textContent = fmtMagAng(model.GL);
    $('roGS').textContent = fmtMagAng(model.GS);
    $('roVSWR').textContent = isFinite(model.VSWR) ? fmt(model.VSWR, 2) : '∞';
    $('roT').textContent = model.harmonic ? fmt(model.T, 3) + ' periods' : 'T (normalized)';
    var zin = $('roZinRow');
    if (model.harmonic && model.Zin) {
      zin.style.display = '';
      $('roZin').textContent = isFinite(model.Zin.re) ? fmtC(model.Zin) + ' Ω' : '∞';
    } else zin.style.display = 'none';
    var vinf = $('roVinfRow');
    if (model.Vinf != null) {
      vinf.style.display = '';
      $('roVinf').textContent = fmt(model.Vinf, 3) + ' V,  ' + fmt(model.Iinf * 1e3, 2) + ' mA';
    } else vinf.style.display = 'none';
    $('roNb').textContent = model.Nb + (model.Nb >= 300 ? ' (capped)' : '');
  }

  function updateSchematic() {
    $('schZs').textContent = 'Zs = ' + fmtC(currentZs()) + ' Ω';
    $('schZL').textContent = 'ZL = ' + (state.loadOpen ? 'open' : fmtC(currentZL()) + ' Ω');
    $('schZ0').textContent = 'Z0 = ' + fmt(state.Z0, 1) + ' Ω,  ' +
      (model.harmonic ? 'ℓ = ' + fmt(state.lenLambda, 3) + ' λ' : 'delay T');
    $('schVs').textContent = state.mode === 'harmonic' ? 'V0 cos(2πt)·u(t)'
      : state.mode === 'step' ? 'V0 · u(t)'
      : state.mode === 'rect' ? 'V0 · rect pulse' : 'V0 · Gaussian pulse';
  }

  function updateWarnings() {
    var msgs = [];
    if (model.resonance) msgs.push('Near resonance: |1 − Γ<sub>S</sub>Γ<sub>L</sub>e<sup>−j2βℓ</sup>| ≈ 0 — steady-state amplitude is very large (envelope hidden, lossless line).');
    if (model.noSteadyState) msgs.push('|Γ<sub>S</sub>Γ<sub>L</sub>| = 1 on a lossless line: the bounce sum never settles. Showing the first ' + model.Nb + ' bounces.');
    else if (model.convergenceWarning) msgs.push('|Γ<sub>S</sub>Γ<sub>L</sub>| ≈ 1 — convergence is slow; the first ' + model.Nb + ' bounces are shown.');
    var el = $('warnings');
    el.innerHTML = msgs.map(function (m) { return '<div class="warn">⚠ ' + m + '</div>'; }).join('');
    el.style.display = msgs.length ? '' : 'none';
  }

  // ---------------- drawing ----------------------------------------------
  var vPlot, iPlot, histPlot, latPlot;

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

  function xTickLabel(x) {
    return (+x.toFixed(4)).toString();
  }

  function draw() {
    model.sample(t, xs, out);
    var xlabel = model.harmonic ? 'position along the line   x / λ' : 'position along the line   x / L';

    // ---- voltage plot
    vPlot.begin(0, model.L, -vLim, vLim);
    vPlot.axes(xlabel, 'V(x,t)   (V)', xTickLabel);
    if (state.showEnvelope && model.envV && !model.resonance) {
      var neg = new Float64Array(NX);
      for (var k = 0; k < NX; k++) neg[k] = -model.envV[k];
      vPlot.line(xs, model.envV, { color: css('--env'), width: 1.2, dash: [3, 3] });
      vPlot.line(xs, neg, { color: css('--env'), width: 1.2, dash: [3, 3] });
    }
    if (model.Vinf != null) vPlot.hline(model.Vinf, { color: css('--v'), dash: [6, 4], label: 'V∞ = ' + fmt(model.Vinf, 3) + ' V' });
    if (state.showComponents) {
      vPlot.line(xs, out.vf, { color: css('--vfw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
      vPlot.line(xs, out.vb, { color: css('--vbw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
    }
    vPlot.line(xs, out.v, { color: css('--v'), width: 2.4 });
    vPlot.endMarkers('◼ source (Zs)', 'load (ZL) ⬤');
    var leg = [{ label: 'V(x,t)', color: css('--v') }];
    if (state.showComponents) leg.push({ label: 'V⁺ (forward)', color: css('--vfw') }, { label: 'V⁻ (backward)', color: css('--vbw') });
    if (state.showEnvelope && model.envV && !model.resonance) leg.push({ label: '±|V(x)| steady state', color: css('--env') });
    legend(vPlot, leg);

    // ---- current plot
    if (state.showCurrent) {
      var iMA = new Float64Array(NX), fMA = new Float64Array(NX), bMA = new Float64Array(NX);
      for (k = 0; k < NX; k++) { iMA[k] = out.i[k] * 1e3; fMA[k] = out.vf[k] / model.Z0 * 1e3; bMA[k] = -out.vb[k] / model.Z0 * 1e3; }
      iPlot.begin(0, model.L, -iLim, iLim);
      iPlot.axes(xlabel, 'I(x,t)   (mA)', xTickLabel);
      if (state.showEnvelope && model.envI && !model.resonance) {
        var negI = new Float64Array(NX);
        for (k = 0; k < NX; k++) negI[k] = -model.envI[k];
        iPlot.line(xs, model.envI, { color: css('--env'), width: 1.2, dash: [3, 3] });
        iPlot.line(xs, negI, { color: css('--env'), width: 1.2, dash: [3, 3] });
      }
      if (model.Iinf != null) iPlot.hline(model.Iinf * 1e3, { color: css('--i'), dash: [6, 4], label: 'I∞ = ' + fmt(model.Iinf * 1e3, 2) + ' mA' });
      if (state.showComponents) {
        iPlot.line(xs, fMA, { color: css('--vfw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
        iPlot.line(xs, bMA, { color: css('--vbw'), width: 1.5, dash: [6, 3], alpha: 0.9 });
      }
      iPlot.line(xs, iMA, { color: css('--i'), width: 2.4 });
      legend(iPlot, [{ label: 'I(x,t) = (V⁺ − V⁻)/Z0', color: css('--i') }]);
    }

    // ---- lattice diagram
    if (state.showLattice) {
      P.drawLattice(latPlot, model, t,
        { fw: css('--vfw'), bw: css('--vbw'), now: css('--now') },
        function (s) {
          return model.harmonic ? fmt(s.abs, 2) + '∠' + fmt(s.arg * 180 / Math.PI, 0) + '°'
                                : (s.re >= 0 ? '+' : '') + fmt(s.re, 3) + ' V';
        });
    }

    // ---- time-history plot
    if (state.showHistory) {
      var hLim = vLim;
      histPlot.begin(0, model.tEnd, -hLim, hLim);
      histPlot.axes(model.harmonic ? 'time  (periods)' : 'time  (units of T)', 'V at ends  (V)', xTickLabel);
      if (model.Vinf != null) histPlot.hline(model.Vinf, { color: css('--axis'), dash: [4, 4] });
      histPlot.line(hist.ts, hist.v0, { color: css('--hsrc'), width: 1.6 });
      histPlot.line(hist.ts, hist.vL, { color: css('--hload'), width: 1.6 });
      histPlot.vline(Math.min(t, model.tEnd), { color: css('--now'), width: 1.4, dash: [4, 3] });
      legend(histPlot, [{ label: 'V(source end, t)', color: css('--hsrc') }, { label: 'V(load, t)', color: css('--hload') }]);
    }

    // ---- time readout + scrub
    var tr = model.harmonic
      ? 't = ' + fmt(t, 2) + ' periods  =  ' + fmt(t / model.T, 2) + ' T'
      : 't = ' + fmt(t, 2) + ' T';
    $('timeReadout').textContent = tr;
    if (!scrubbing) $('scrub').value = Math.round(Math.min(t / model.tEnd, 1) * 1000);
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
  }

  // ---------------- UI wiring --------------------------------------------
  var scrubbing = false;

  function bindNumber(id, key, cb) {
    var el = $(id);
    el.value = state[key];
    el.addEventListener('change', function () {
      var v = parseFloat(el.value);
      if (!isFinite(v)) { el.value = state[key]; return; }
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
    sel.value = 'harm-complex';
    sel.addEventListener('change', function () {
      if (sel.value === 'custom') return;
      Object.assign(state, SCENARIOS[sel.value].p);
      syncInputs(); rebuild();
    });

    // mode radios
    document.querySelectorAll('input[name=mode]').forEach(function (r) {
      r.addEventListener('change', function () {
        if (r.checked) { state.mode = r.value; $('scenario').value = 'custom'; rebuild(); }
      });
    });

    bindNumber('inRs', 'Rs');
    bindNumber('inXs', 'Xs');
    bindNumber('inRL', 'RL');
    bindNumber('inXL', 'XL');
    bindNumber('inZ0', 'Z0');

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
      t = Math.min(2 * model.Nb * model.T, 400 * model.T) + 1;
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

    window.addEventListener('resize', function () { if (model) draw(); });

    syncInputs();
    rebuild();
    requestAnimationFrame(frame);
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
