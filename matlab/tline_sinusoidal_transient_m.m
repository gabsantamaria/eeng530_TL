%% TLINE_SINUSOIDAL_TRANSIENT
%  Educational animation of voltage and current propagation on a lossless
%  transmission line excited by a *step-modulated sinusoid*
%
%         vs(t) = V0 * cos(omega t + phi) * u(t)
%
%  with possibly COMPLEX source impedance Zs and load impedance ZL.
%  The animation shows the transient that builds up from the moment the
%  sinusoid is switched on, through multiple reflections, and eventually
%  settles into the steady-state standing-wave pattern.
%
%  Circuit topology
%  ----------------
%      vs(t) ---[Zs]---+==============================+---[ZL]---|
%                      |                              |
%                      x = 0        Z0 (real), v, L   x = L
%
%  Physics (single-frequency, phasor bookkeeping in time domain)
%  -------------------------------------------------------------
%  Each "bounce" of the initial wavefront is represented by a complex
%  phasor that carries both its magnitude and its phase shift.  The
%  instantaneous voltage contribution of bounce m is
%
%       V_m(x,t) = Re{ A_m * exp(j omega (t - tau_m(x))) } * u(t - tau_m(x))
%
%  where tau_m(x) is its causal arrival time at position x and
%  A_m is a complex amplitude that accumulates successive reflection
%  coefficients.  Summing all forward bounces gives V+(x,t) and all
%  backward bounces V-(x,t).  The total fields are
%
%       V(x,t) = V+(x,t) + V-(x,t)
%       I(x,t) = ( V+(x,t) - V-(x,t) ) / Z0        (Z0 assumed real)
%
%  Reflection coefficients (complex, frequency-dependent in general):
%
%       Gamma_L = (ZL - Z0) / (ZL + Z0)
%       Gamma_S = (Zs - Z0) / (Zs + Z0)
%
%  Initial launched-wave phasor (voltage divider at x = 0):
%
%       V+_0 = V0 * exp(j*phi) * Z0 / (Zs + Z0)
%
%  Bounces (T = L/v one-way transit time):
%       forward  wave n, launched at source at t = 2 n T,
%           A_fw(n) = V+_0 * (Gamma_S * Gamma_L)^n
%       backward wave n, launched at load  at t = (2n+1) T,
%           A_bw(n) = V+_0 * Gamma_L * (Gamma_S * Gamma_L)^n
%
%  Instructive experiments to try
%  ------------------------------
%     * purely resistive matched load  : ZL = Z0            (no reflections)
%     * open circuit                    : ZL = 1e12         (|GL| = 1)
%     * reactive load                   : ZL = 1j*Z0, -1j*Z0
%     * complex source                  : Zs = 25 + 1j*40
%     * off-resonance vs. half-wave     : change the frequency so that
%                                         omega * T = k*pi   (electrical
%                                         length = k * half wavelengths)
%
%  Steady state (t >> N*T) is the familiar phasor solution:
%
%       V(x) = V+_0 [ exp(-j k x) + Gamma_L exp(-j k (2L - x)) ] /
%                   ( 1 - Gamma_S Gamma_L exp(-j 2 k L) )
%
%  which the animation is compared against at the end.
%
%  Usage: edit the USER PARAMETERS block and run.
%
% ---------------------------------------------------------------------

clear;  clc;  close all;

%% =============== USER PARAMETERS ====================================
V0    = 1.0;              % peak source amplitude (V)
phi   = 0;                % source phase at t = 0   (rad)
freq  = 300e6;            % excitation frequency (Hz)
Zs    = 50;       % *complex* source impedance (Ohm)
Z0    = 50;               % line characteristic impedance (Ohm, real)
ZL    = 141.12 - 1j*105.55;      % *complex* load impedance  (Ohm)
L     = 1.0;              % line length (m)
v     = 2e8;              % propagation velocity (m/s)   (~2c/3)
Nref  = 14;               % number of reflections (round trips) to include
Nx    = 600;              % spatial samples along the line
Nt    = 1200;             % number of time frames
frameRate = 60;           % target frames/sec
saveGIF   = false;        % set true to record the animation as a GIF
gifName   = 'tline_sinusoid.gif';

%% =============== DERIVED QUANTITIES =================================
omega = 2*pi*freq;
k     = omega/v;                        % wavenumber on the line
lam   = 2*pi/k;                         % wavelength on the line
T     = L/v;                            % one-way transit time
Tper  = 1/freq;                         % sinusoidal period

GL    = (ZL - Z0) / (ZL + Z0);          % complex load reflection coeff.
GS    = (Zs - Z0) / (Zs + Z0);          % complex source reflection coeff.
Vp0   = V0 * exp(1j*phi) * Z0 / (Zs + Z0);   % first forward-wave phasor

fprintf('\n=== Sinusoidal-step transmission-line simulation ===\n');
fprintf('  frequency   f       = %.4g Hz\n', freq);
fprintf('  wavelength  lambda  = %.4g m\n' , lam);
fprintf('  elec. length L/lam  = %.4g\n'   , L/lam);
fprintf('  transit time T      = %.4g s  (=%.3g periods)\n', T, T/Tper);
fprintf('  Gamma_L |.|  = %.3f ,  angle = %+6.1f deg\n', abs(GL),  angle(GL)*180/pi );
fprintf('  Gamma_S |.|  = %.3f ,  angle = %+6.1f deg\n', abs(GS),  angle(GS)*180/pi );
fprintf('  V+_0  |.|    = %.4f V, angle = %+6.1f deg\n', abs(Vp0), angle(Vp0)*180/pi);

x = linspace(0, L, Nx);
t = linspace(0, Nref*T, Nt);

%% =============== WAVE AMPLITUDES (COMPLEX) & LAUNCH TIMES ============
n       = 0:Nref-1;
A_fw    = Vp0        * (GS.*GL).^n;       % forward-wave phasor amps
A_bw    = Vp0 .* GL  * (GS.*GL).^n;       % backward-wave phasor amps
t_fw    = 2*n*T;                          % forward launch times (source)
t_bw    = (2*n+1)*T;                      % backward launch times (load)

%% =============== ANALYTIC STEADY-STATE (phasor) =====================
%  Closed-form sum of the infinite bounce series
denom  = 1 - GS.*GL .* exp(-1j*2*k*L);
Vss_ph =  Vp0 .* ( exp(-1j*k*x) + GL .* exp(-1j*k*(2*L - x)) ) ./ denom;
Iss_ph =  Vp0 .* ( exp(-1j*k*x) - GL .* exp(-1j*k*(2*L - x)) ) ./ denom / Z0;

%% =============== FIGURE SET-UP ======================================
fig = figure('Color','w','Position',[60 60 1020 760], ...
             'Name','Transmission line - sinusoidal step excitation');

% ---- Voltage subplot
axV = subplot(2,1,1);
hV      = plot(x, zeros(size(x)),'b', 'LineWidth',2); hold on;
hVenvP  = plot(x,  abs(Vss_ph), 'b:',  'LineWidth',1);   % steady-state envelope
hVenvN  = plot(x, -abs(Vss_ph), 'b:',  'LineWidth',1);
yline(0,'k:');
Vlim = 1.25 * max([abs(Vp0), max(abs(Vss_ph))]) * 2;
ylim([-Vlim  Vlim]);  xlim([0 L]);
xlabel('position   x   (m)');
ylabel('voltage   V(x,t)   (V)');
legend({'V(x,t)','\pm|V_{ss}(x)|'},'Location','best','AutoUpdate','off');
grid on;

% ---- Current subplot
axI = subplot(2,1,2);
hI      = plot(x, zeros(size(x)),'r', 'LineWidth',2); hold on;
hIenvP  = plot(x,  abs(Iss_ph), 'r:',  'LineWidth',1);
hIenvN  = plot(x, -abs(Iss_ph), 'r:',  'LineWidth',1);
yline(0,'k:');
Ilim = 1.25 * max([abs(Vp0)/Z0, max(abs(Iss_ph))]) * 2;
ylim([-Ilim  Ilim]);  xlim([0 L]);
xlabel('position   x   (m)');
ylabel('current   I(x,t)   (A)');
legend({'I(x,t)','\pm|I_{ss}(x)|'},'Location','best','AutoUpdate','off');
grid on;

% source / load markers
for ax = [axV axI]
    plot(ax, 0, 0, 'ks','MarkerFaceColor',[.85 .85 .85],'MarkerSize',10);
    plot(ax, L, 0, 'ko','MarkerFaceColor',[.85 .85 .85],'MarkerSize',10);
end

sgtitle(sprintf( ...
  ['Sinusoidal step:  V_0 = %.2g V,  f = %.3g Hz,  \\phi = %.2g rad\n' ...
   'Z_s = %s \\Omega,    Z_0 = %.3g \\Omega,    Z_L = %s \\Omega\n' ...
   'L = %.3g m,   v = %.2g m/s,   T = %.3g s,   L/\\lambda = %.3g,   ' ...
   '|\\Gamma_S|=%.3f,  |\\Gamma_L|=%.3f'], ...
   V0, freq, phi, cstr(Zs), Z0, cstr(ZL), L, v, T, L/lam, abs(GS), abs(GL)), ...
   'FontSize', 10);

% ---- Pause / Resume toggle button (top-right corner of the figure) ---
btnPause = uicontrol(fig,'Style','togglebutton','String','Pause', ...
    'Units','normalized','Position',[0.88 0.955 0.09 0.035], ...
    'FontWeight','bold','BackgroundColor',[1 0.92 0.6], ...
    'Callback', @togglePauseBtn);

pause(0.3);

%% =============== ANIMATION LOOP =====================================
dtPause = 1/frameRate;

for kk = 1:Nt
    tk = t(kk);

    % Complex forward wave V+(x,t) = sum_m A_fw(m) * exp(j*w*(t - tau))*u()
    Vfc = zeros(size(x));
    for m = 1:Nref
        tau = t_fw(m) + x/v;
        valid = (tk >= tau);
        Vfc = Vfc + valid .* A_fw(m) .* exp(1j*omega*(tk - tau));
    end

    % Complex backward wave V-(x,t)
    Vbc = zeros(size(x));
    for m = 1:Nref
        tau = t_bw(m) + (L - x)/v;
        valid = (tk >= tau);
        Vbc = Vbc + valid .* A_bw(m) .* exp(1j*omega*(tk - tau));
    end

    % Physical (real) signals
    Vtot = real(Vfc + Vbc);
    Itot = real(Vfc - Vbc) / Z0;

    set(hV, 'YData', Vtot);
    set(hI, 'YData', Itot);

    title(axV, sprintf(['V(x,t)     t = %6.2f T = %6.2f  periods = %8.2f ns'], ...
                        tk/T, tk/Tper, tk*1e9));
    title(axI, sprintf(['I(x,t)     t = %6.2f T = %6.2f  periods = %8.2f ns'], ...
                        tk/T, tk/Tper, tk*1e9));

    drawnow limitrate;

    % ---- honor the Pause/Resume button -----------------------------
    while ishandle(btnPause) && btnPause.Value == 1
        pause(0.05);
    end
    if ~ishandle(fig), break; end      % user closed the figure

    if saveGIF
        frame = getframe(fig);
        [A,map] = rgb2ind(frame2im(frame), 256);
        if kk == 1
            imwrite(A,map,gifName,'gif','LoopCount',Inf,'DelayTime',dtPause);
        else
            imwrite(A,map,gifName,'gif','WriteMode','append','DelayTime',dtPause);
        end
    end
    pause(dtPause);
end

%% =============== STEADY-STATE COMPARISON PLOT =======================
figure('Color','w','Position',[120 120 900 650], ...
       'Name','Steady-state envelope');
subplot(2,1,1);
plot(x, abs(Vss_ph),'b','LineWidth',2); hold on;
plot(x, real(Vss_ph),'b--'); plot(x, imag(Vss_ph),'b:');
grid on; xlabel('x (m)'); ylabel('V phasor');
legend('|V_{ss}(x)|','Re\{V_{ss}\}','Im\{V_{ss}\}','Location','best');
title('Analytical steady-state voltage phasor V_{ss}(x)');

subplot(2,1,2);
plot(x, abs(Iss_ph),'r','LineWidth',2); hold on;
plot(x, real(Iss_ph),'r--'); plot(x, imag(Iss_ph),'r:');
grid on; xlabel('x (m)'); ylabel('I phasor');
legend('|I_{ss}(x)|','Re\{I_{ss}\}','Im\{I_{ss}\}','Location','best');
title('Analytical steady-state current phasor I_{ss}(x)');

fprintf('\nSimulation finished.\n');
if saveGIF, fprintf('GIF written to %s\n', gifName); end

%% =============== HELPERS ============================================
function togglePauseBtn(src, ~)
%TOGGLEPAUSEBTN  Callback for the Pause/Resume toggle button.
    if src.Value
        src.String          = 'Resume';
        src.BackgroundColor = [0.70 0.95 0.70];
    else
        src.String          = 'Pause';
        src.BackgroundColor = [1.00 0.92 0.60];
    end
end

function s = cstr(z)
%CSTR   Format a complex number compactly for titles/labels.
    if imag(z) == 0
        s = sprintf('%.3g', real(z));
    elseif real(z) == 0
        s = sprintf('j%.3g', imag(z));
    else
        signc = '+';
        if imag(z) < 0, signc = '-'; end
        s = sprintf('%.3g %s j%.3g', real(z), signc, abs(imag(z)));
    end
end
