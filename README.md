# Transmission-Line Wave Visualizer — EENG530

Interactive, animated visualization of voltage and current wave propagation on a
lossless transmission line, for **EENG530 — Passive RF & Microwave Devices**
(Colorado School of Mines). Live at **https://tl.mwphotonics.com**.

The app animates the classic **bounce-diagram (lattice) solution**: a Thévenin
source (V₀, Zs) switched on at t = 0 drives a line of characteristic impedance
Z₀ terminated in ZL. Every reflection at each end is summed causally:

```
V(x,t) = V⁺(t − x/v) + V⁻(t + x/v)        I(x,t) = [V⁺ − V⁻]/Z₀
ΓL = (ZL − Z0)/(ZL + Z0)                  ΓS = (Zs − Z0)/(Zs + Z0)
V⁺₀ = V0·Z0/(Zs + Z0)
forward  bounce n:  V⁺₀ (ΓS ΓL)ⁿ   launched at t = 2nT
backward bounce n:  V⁺₀ ΓL (ΓS ΓL)ⁿ launched at t = (2n+1)T,   T = ℓ/v
```

## Features

- **Excitations**: switched-on time-harmonic sinusoid, step, rectangular pulse,
  Gaussian pulse.
- **Terminations**: arbitrary complex ZL and Zs in harmonic mode (incl. open /
  short / reactive presets); resistive terminations in pulse modes (where the
  drawn waveforms are *exact*, since resistive reflection is frequency-flat).
- **Line length in wavelengths** (harmonic mode), 0.05 λ – 3 λ.
- Steady-state **standing-wave envelope** ±|V(x)| from the exact closed form,
  V⁺/V⁻ **wave decomposition**, animated **lattice diagram** with per-bounce
  amplitudes, **staircase build-up** of the end voltages vs time, and live
  readouts of ΓL, ΓS, VSWR and Zin.
- Classroom **scenario presets** (matched, open, short, 2:1 mismatch,
  quarter-wave transformer, resonant ring-up, echoes, …).

No build step, no dependencies — plain HTML/CSS/JS, hosted on GitHub Pages.

## Physics provenance & validation

The engine is a direct port of the course MATLAB scripts in [`matlab/`](matlab/)
(`tline_step_response.m`, `tline_sinusoidal_transient.m`), which were
independently re-derived and numerically validated (bounce sums match the
closed-form steady state to ~1e−12; step responses converge to
V∞ = V₀RL/(Rs+RL) to 1e−9).

Run the JS engine's own test suite:

```
node tests/physics_check.mjs
```

**Documented idealization** (harmonic mode with reactive ZL or Zs): each
wavefront is reflected by the phasor Γ(jω) evaluated at the drive frequency;
the decaying natural response a real L/C produces at each wavefront arrival is
omitted (time constant ≲ a fraction of a period for |X| ~ Z₀). The steady-state
standing wave is exact regardless. With resistive terminations the animation is
exact at all times.

## Structure

```
index.html          app shell + theory notes
css/style.css
js/tline.js         physics engine (bounce series, closed-form steady state)
js/plots.js         canvas plotting + lattice diagram
js/app.js           UI state, scenarios, animation loop
tests/physics_check.mjs
matlab/             original course MATLAB scripts
```

## License

MIT — see [LICENSE](LICENSE).
