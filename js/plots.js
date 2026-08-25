/* plots.js — lightweight canvas plotting for the transmission-line visualizer */
(function (global) {
  'use strict';

  function niceStep(span, target) {
    var raw = span / target;
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var norm = raw / mag;
    var step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
    return step * mag;
  }

  function Plot(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.margin = Object.assign({ l: 46, r: 12, t: 8, b: 30 }, this.opts.margin || {});
  }

  Plot.prototype.resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var rect = this.canvas.getBoundingClientRect();
    var W = Math.max(50, Math.round(rect.width)), H = Math.max(50, Math.round(rect.height));
    if (this.canvas.width !== W * dpr || this.canvas.height !== H * dpr) {
      this.canvas.width = W * dpr; this.canvas.height = H * dpr;
    }
    this.W = W; this.H = H;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  Plot.prototype.begin = function (xmin, xmax, ymin, ymax) {
    this.resize();
    this.xmin = xmin; this.xmax = xmax; this.ymin = ymin; this.ymax = ymax;
    var m = this.margin;
    this.pw = this.W - m.l - m.r; this.ph = this.H - m.t - m.b;
    var css = getComputedStyle(document.documentElement);
    this.colAxis = css.getPropertyValue('--axis').trim() || '#8a93a3';
    this.colGrid = css.getPropertyValue('--grid').trim() || '#e3e7ee';
    this.colText = css.getPropertyValue('--muted').trim() || '#5b6472';
    this.ctx.clearRect(0, 0, this.W, this.H);
  };

  Plot.prototype.sx = function (x) { return this.margin.l + (x - this.xmin) / (this.xmax - this.xmin) * this.pw; };
  Plot.prototype.sy = function (y) { return this.margin.t + (1 - (y - this.ymin) / (this.ymax - this.ymin)) * this.ph; };

  Plot.prototype.clipPlot = function () {
    var m = this.margin;
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(m.l, m.t, this.pw, this.ph);
    this.ctx.clip();
  };
  Plot.prototype.unclip = function () { this.ctx.restore(); };

  Plot.prototype.axes = function (xLabel, yLabel, xTickFmt) {
    var ctx = this.ctx, m = this.margin;
    ctx.font = '11px system-ui, sans-serif';
    ctx.lineWidth = 1;
    // grid + x ticks
    var step = niceStep(this.xmax - this.xmin, 8);
    var x0 = Math.ceil(this.xmin / step) * step, x;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (x = x0; x <= this.xmax + 1e-9; x += step) {
      var px = this.sx(x);
      ctx.strokeStyle = this.colGrid;
      ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + this.ph); ctx.stroke();
      ctx.fillStyle = this.colText;
      ctx.fillText(xTickFmt ? xTickFmt(x) : (+x.toFixed(6)).toString(), px, m.t + this.ph + 4);
    }
    // grid + y ticks
    step = niceStep(this.ymax - this.ymin, 5);
    var y0 = Math.ceil(this.ymin / step) * step, y;
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (y = y0; y <= this.ymax + 1e-9; y += step) {
      var py = this.sy(y);
      ctx.strokeStyle = (Math.abs(y) < step * 1e-6) ? this.colAxis : this.colGrid;
      ctx.beginPath(); ctx.moveTo(m.l, py); ctx.lineTo(m.l + this.pw, py); ctx.stroke();
      ctx.fillStyle = this.colText;
      ctx.fillText((+y.toPrecision(3)).toString(), m.l - 5, py);
    }
    // frame
    ctx.strokeStyle = this.colAxis;
    ctx.strokeRect(m.l, m.t, this.pw, this.ph);
    // labels
    ctx.fillStyle = this.colText;
    if (xLabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(xLabel, m.l + this.pw / 2, this.H - 2); }
    if (yLabel) {
      ctx.save();
      ctx.translate(11, m.t + this.ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }
  };

  Plot.prototype.line = function (xs, ys, style) {
    var ctx = this.ctx;
    this.clipPlot();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width || 2;
    ctx.globalAlpha = style.alpha != null ? style.alpha : 1;
    ctx.setLineDash(style.dash || []);
    ctx.beginPath();
    for (var k = 0; k < xs.length; k++) {
      var px = this.sx(xs[k]), py = this.sy(ys[k]);
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    this.unclip();
  };

  Plot.prototype.hline = function (y, style) {
    var ctx = this.ctx;
    if (y < this.ymin || y > this.ymax) return;
    ctx.strokeStyle = style.color; ctx.lineWidth = style.width || 1;
    ctx.setLineDash(style.dash || [5, 4]);
    ctx.beginPath(); ctx.moveTo(this.margin.l, this.sy(y)); ctx.lineTo(this.margin.l + this.pw, this.sy(y)); ctx.stroke();
    ctx.setLineDash([]);
    if (style.label) {
      ctx.fillStyle = style.color; ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(style.label, this.margin.l + 4, this.sy(y) - 2);
    }
  };

  Plot.prototype.vline = function (x, style) {
    var ctx = this.ctx;
    if (x < this.xmin || x > this.xmax) return;
    ctx.strokeStyle = style.color; ctx.lineWidth = style.width || 1;
    ctx.setLineDash(style.dash || []);
    ctx.beginPath(); ctx.moveTo(this.sx(x), this.margin.t); ctx.lineTo(this.sx(x), this.margin.t + this.ph); ctx.stroke();
    ctx.setLineDash([]);
  };

  Plot.prototype.endMarkers = function (srcLabel, loadLabel) {
    var ctx = this.ctx, y = this.margin.t + this.ph;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = this.colText;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText(srcLabel, this.margin.l + 3, y - 3);
    ctx.textAlign = 'right'; ctx.fillText(loadLabel, this.margin.l + this.pw - 3, y - 3);
  };

  /* ---- lattice (bounce) diagram: x horizontal, time downward -------------- */
  function drawLattice(plot, model, t, colors, fmtAmp) {
    var segs = model.lattice;
    if (!segs.length) return;
    var tMax = Math.min(segs[segs.length - 1].t1, Math.max(model.tEnd, segs[0].t1 * 4));
    plot.begin(0, model.L, 0, tMax);
    // axes: time increases downward -> invert via sy mapping trick: use ymin=0,ymax=tMax but flip
    var m = plot.margin, ctx = plot.ctx;
    function px(x) { return plot.sx(x); }
    function py(tt) { return m.t + (tt / tMax) * plot.ph; }
    // grid: one line per transit time T
    ctx.font = '10px system-ui, sans-serif';
    for (var tt = 0; tt <= tMax + 1e-9; tt += model.T) {
      ctx.strokeStyle = plot.colGrid;
      ctx.beginPath(); ctx.moveTo(m.l, py(tt)); ctx.lineTo(m.l + plot.pw, py(tt)); ctx.stroke();
      var kT = Math.round(tt / model.T);
      if (kT % 2 === 0 || model.lattice.length <= 12) {
        ctx.fillStyle = plot.colText; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillText(kT + 'T', m.l - 4, py(tt));
      }
      if (kT > 400) break;
    }
    ctx.strokeStyle = plot.colAxis;
    ctx.strokeRect(m.l, m.t, plot.pw, plot.ph);
    // source / load rails
    ctx.strokeStyle = plot.colAxis; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px(0), m.t); ctx.lineTo(px(0), m.t + plot.ph); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px(model.L), m.t); ctx.lineTo(px(model.L), m.t + plot.ph); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.fillStyle = plot.colText; ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left'; ctx.fillText('source', m.l + 2, m.t - 1 + 10);
    ctx.textAlign = 'right'; ctx.fillText('load', m.l + plot.pw - 2, m.t - 1 + 10);

    ctx.save();
    ctx.beginPath(); ctx.rect(m.l, m.t, plot.pw, plot.ph); ctx.clip();
    var maxAbs = segs[0].abs || 1e-30;
    for (var k = 0; k < segs.length; k++) {
      var s = segs[k];
      if (s.t0 > tMax) break;
      var frac = t <= s.t0 ? 0 : t >= s.t1 ? 1 : (t - s.t0) / (s.t1 - s.t0);
      var col = s.dir === 'fw' ? colors.fw : colors.bw;
      var wgt = Math.max(0.75, 3.2 * s.abs / maxAbs);
      // faint full path
      ctx.globalAlpha = 0.25; ctx.strokeStyle = col; ctx.lineWidth = wgt;
      ctx.beginPath(); ctx.moveTo(px(s.x0), py(s.t0)); ctx.lineTo(px(s.x1), py(s.t1)); ctx.stroke();
      // travelled part
      if (frac > 0) {
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(px(s.x0), py(s.t0));
        ctx.lineTo(px(s.x0 + (s.x1 - s.x0) * frac), py(s.t0 + (s.t1 - s.t0) * frac));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // amplitude label on the first few bounces
      if (k < 8) {
        var mx = px((s.x0 + s.x1) / 2), my = py((s.t0 + s.t1) / 2);
        ctx.fillStyle = col; ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(fmtAmp(s), mx, my - 2);
      }
    }
    // current-time line
    if (t >= 0 && t <= tMax) {
      ctx.strokeStyle = colors.now; ctx.lineWidth = 1.4; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(m.l, py(t)); ctx.lineTo(m.l + plot.pw, py(t)); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    // x label
    ctx.fillStyle = plot.colText; ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('position along line →   (time ↓)', m.l + plot.pw / 2, plot.H - 2);
  }

  global.TLPlots = { Plot: Plot, drawLattice: drawLattice };
})(window);
