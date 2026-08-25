%% TLINE_STEP_RESPONSE
%  Educational animation of voltage and current propagation on a lossless
%  transmission line excited by a step source and terminated by a resistor.
%
%  Circuit topology
%  ----------------
%      Vs(t) ---[Rs]---+==============================+---[RL]---|
%                      |                              |
%                      x = 0        Z0, v, L          x = L
%
%  Physics (lossless line, forward/backward wave decomposition)
%  ------------------------------------------------------------
%    V(x,t) = V+(t - x/v) + V-(t + x/v)
%    I(x,t) = ( V+(t - x/v) - V-(t + x/v) ) / Z0
%
%  At the source (x = 0)                  :  GS = (Rs - Z0)/(Rs + Z0)
%  At the load  (x = L)                   :  GL = (RL - Z0)/(RL + Z0)
%  First launched wave (voltage divider)  :  V+_0 = V0 * Z0/(Rs + Z0)
%
%  Successive bounces build up as a geometric series:
%      forward-wave n  launched at t = 2 n T       , amplitude V+_0 (GS GL)^n
%      backward-wave n launched at t = (2n+1) T    , amplitude V+_0 GL (GS GL)^n
%  where T = L / v is the one-way transit time.
%
%  Steady-state check  (t -> infinity):
%      V_inf = V0 * RL / (Rs + RL)      ,   I_inf = V0 / (Rs + RL)
%  which the simulation converges to.
%
%  Try these instructive cases:
%     matched load     : RL = Z0        (no reflections)
%     open  circuit    : RL = Inf       (GL = +1, voltage doubling)
%     short circuit    : RL = 0         (GL = -1, current doubling)
%     matched source   : Rs = Z0        (one reflection only, GS = 0)
%
%  Usage:  just run the script.  Edit the USER PARAMETERS block below.
%
% ---------------------------------------------------------------------

clear;  clc;  close all;

%% =============== USER PARAMETERS ====================================
V0    = 1.0;        % step-source amplitude (V)
Rs    = 1;         % source internal resistance (Ohm)
Z0    = 50;         % line characteristic impedance (Ohm)
RL    = 10;        % load resistance (Ohm)       --  try 50, 0, Inf, 150
L     = 1.0;        % line length (m)
v     = 2e8;        % propagation velocity (m/s)  (~2c/3)
Nref  = 100;         % number of reflections (round trips) to include
Nx    = 500;        % spatial samples along the line
Nt    = 8000;        % time steps in the animation
frameRate = 60;     % rough target frames per second
saveGIF   = false;  % set true to save an animated GIF
gifName   = 'tline_animation.gif';

%% =============== DERIVED QUANTITIES =================================
T   = L/v;                                     % one-way transit time
if isinf(RL)
    GL = 1;                                    % open circuit
else
    GL = (RL - Z0)/(RL + Z0);                  % load reflection coeff.
end
GS  = (Rs - Z0)/(Rs + Z0);                     % source reflection coeff.
Vp0 = V0 * Z0 / (Rs + Z0);                     % first forward voltage
Vss = V0 * RL_safe(RL) / (Rs + RL_safe(RL));   % steady-state voltage
Iss = V0 / (Rs + RL_safe(RL));                 % steady-state current
if isinf(RL), Vss = V0; Iss = 0; end           % fix open-circuit limits

fprintf('\n=== Transmission-line step-response simulation ===\n');
fprintf('  one-way transit time  T   = %.4g  s\n' , T);
fprintf('  load   reflection  GL     = %+0.4f\n'  , GL);
fprintf('  source reflection  GS     = %+0.4f\n'  , GS);
fprintf('  first forward wave V+_0   = %.4f V\n'  , Vp0);
fprintf('  steady-state  V_inf = %.4f V , I_inf = %.4f A\n', Vss, Iss);

x = linspace(0, L, Nx);
t = linspace(0, Nref*T, Nt);

%% =============== WAVE AMPLITUDES & LAUNCH TIMES =====================
n    = 0:Nref-1;
A_fw = Vp0        * (GS*GL).^n;   % forward-wave amplitudes
A_bw = Vp0 * GL   * (GS*GL).^n;   % backward-wave amplitudes
t_fw = 2*n*T;                     % launch times at the source
t_bw = (2*n+1)*T;                 % launch times at the load

%% =============== FIGURE SET-UP ======================================
fig = figure('Color','w','Position',[80 80 980 720],'Name', ...
             'Transmission line - step response');

% --- Voltage subplot
axV = subplot(2,1,1);
hV  = plot(x, zeros(size(x)),'b','LineWidth',2); hold on;
yline(0,'k:'); yline(Vss,'b--','V_{\infty}','LabelHorizontalAlignment','left');
Vlim = max(abs([Vp0 Vss 2*Vp0 2*Vss]))*1.3 + eps;
ylim([-Vlim  Vlim]);  xlim([0 L]);
xlabel('position   x   (m)');
ylabel('voltage   V(x,t)   (V)');
grid on;

% --- Current subplot
axI = subplot(2,1,2);
hI  = plot(x, zeros(size(x)),'r','LineWidth',2); hold on;
yline(0,'k:'); yline(Iss,'r--','I_{\infty}','LabelHorizontalAlignment','left');
Ilim = max(abs([Vp0/Z0 Iss 2*Vp0/Z0 2*Iss]))*1.3 + eps;
ylim([-Ilim  Ilim]);  xlim([0 L]);
xlabel('position   x   (m)');
ylabel('current   I(x,t)   (A)');
grid on;

% --- Little source / load markers
for ax = [axV axI]
    plot(ax, 0, 0, 'ks','MarkerFaceColor',[.8 .8 .8],'MarkerSize',10);
    plot(ax, L, 0, 'ko','MarkerFaceColor',[.8 .8 .8],'MarkerSize',10);
    text(ax, 0, -0.92*ax.YLim(2), 'source (R_s)', ...
         'HorizontalAlignment','left','FontSize',9,'Color',[.3 .3 .3]);
    text(ax, L, -0.92*ax.YLim(2), 'load (R_L)', ...
         'HorizontalAlignment','right','FontSize',9,'Color',[.3 .3 .3]);
end

sgtitle(sprintf(['Step response:   V_0 = %.2g V ,   R_s = %.3g \\Omega ,   ' ...
                 'Z_0 = %.3g \\Omega ,   R_L = %s \\Omega\n' ...
                 'L = %.3g m ,   v = %.2g m/s ,   T = L/v = %.3g s ,   ' ...
                 '\\Gamma_S = %+0.2f ,   \\Gamma_L = %+0.2f'], ...
                 V0, Rs, Z0, RLstr(RL), L, v, T, GS, GL), ...
        'FontSize', 11);

% ---- Pause / Resume toggle button (top-right corner of the figure) ---
btnPause = uicontrol(fig,'Style','togglebutton','String','Pause', ...
    'Units','normalized','Position',[0.88 0.955 0.09 0.035], ...
    'FontWeight','bold','BackgroundColor',[1 0.92 0.6], ...
    'Callback', @togglePauseBtn);

pause(0.3);

%% =============== ANIMATION LOOP =====================================
dtPause = 1/frameRate;

for k = 1:Nt

    tk = t(k);

    % ----- Forward waves -------------------------------------------------
    %   forward wave  m  reaches position x when  tk >= t_fw(m) + x/v
    Vf = zeros(size(x));
    for m = 1:Nref
        arrived = (tk >= (t_fw(m) + x/v));
        Vf = Vf + A_fw(m) * arrived;
    end

    % ----- Backward waves ------------------------------------------------
    %   backward wave m reaches position x when  tk >= t_bw(m) + (L-x)/v
    Vb = zeros(size(x));
    for m = 1:Nref
        arrived = (tk >= (t_bw(m) + (L-x)/v));
        Vb = Vb + A_bw(m) * arrived;
    end

    % ----- Total voltage and current -------------------------------------
    Vtot =  Vf + Vb;
    Itot = (Vf - Vb)/Z0;

    set(hV,'YData',Vtot);
    set(hI,'YData',Itot);

    title(axV, sprintf(['V(x,t)    t = %5.2f T = %8.2f ns       ' ...
        'V+ (forward) + V- (backward)'], tk/T, tk*1e9));
    title(axI, sprintf(['I(x,t)    t = %5.2f T = %8.2f ns       ' ...
        '( V+  - V- ) / Z_0'], tk/T, tk*1e9));

    drawnow limitrate;

    % ---- honor the Pause/Resume button -----------------------------
    while ishandle(btnPause) && btnPause.Value == 1
        pause(0.05);
    end
    if ~ishandle(fig), break; end     % user closed the figure

    % ----- optional GIF capture ------------------------------------------
    if saveGIF
        frame = getframe(fig);
        im    = frame2im(frame);
        [A,map] = rgb2ind(im,256);
        if k == 1
            imwrite(A,map,gifName,'gif','LoopCount',Inf,'DelayTime',dtPause);
        else
            imwrite(A,map,gifName,'gif','WriteMode','append','DelayTime',dtPause);
        end
    end

    pause(dtPause);
end

fprintf('\nSimulation finished.\n');
if saveGIF, fprintf('GIF written to %s\n', gifName); end

%% =============== HELPER FUNCTIONS ===================================
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

function R = RL_safe(RL)
    % Returns a large but finite resistance for the open-circuit case,
    % used only for the steady-state formulas (not the wave equations).
    if isinf(RL)
        R = 1e15;
    else
        R = RL;
    end
end

function s = RLstr(RL)
    if isinf(RL)
        s = '\infty';
    else
        s = sprintf('%.3g', RL);
    end
end
