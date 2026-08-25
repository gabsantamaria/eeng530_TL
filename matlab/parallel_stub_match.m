function [d1, d2] = parallel_stub_match(ZL, Z0, stub_type)
% PARALLEL_STUB_MATCH  Design a single shunt-stub matching network.
%
%   [d1, d2] = parallel_stub_match(ZL, Z0, stub_type)
%
%   Designs a parallel (shunt) single-stub matching network that matches a
%   load impedance ZL to a transmission line of characteristic impedance Z0.
%   Both the main line and the stub have characteristic impedance Z0.
%
%   SELECTION RULE:
%       1) Choose the SHORTEST positive d1.
%       2) For that d1, choose the SHORTEST positive d2.
%
%   INPUTS:
%       ZL        - Load impedance (complex, in Ohms)
%       Z0        - Characteristic impedance of the lines (real, in Ohms)
%       stub_type - 'short' for short-circuited stub
%                   'open'  for open-circuited stub
%
%   OUTPUTS:
%       d1 - Distance from load to stub (in wavelengths)
%       d2 - Length of the stub          (in wavelengths)
%
%   THEORY (admittance form):
%       yL = 1/zL = GL + j*BL,  zL = ZL/Z0.
%       At distance d, looking toward the load:
%           y(d) = ( yL + j*t ) / ( 1 + j*yL*t ),     t = tan(beta*d)
%       Setting Re{y(d1)} = 1 gives the quadratic
%           (GL^2 + BL^2 - GL) * t^2  -  2*BL*t  +  (GL - GL^2 - BL^2) = 0
%       which has the closed-form solutions
%           t = ( BL +/- sqrt( GL*((GL-1)^2 + BL^2) ) ) / ( GL^2 + BL^2 - GL )
%       (Special case GL = 1: linear equation, t = -BL/2.)
%       At that location y(d1) = 1 + j*B; the stub provides bs = -B so the
%       total admittance is 1.
%
%   EXAMPLE (Pozar, Example 5.2):
%       [d1, d2] = parallel_stub_match(60 - 80j, 50, 'short');
%       % expected: d1 = 0.1104 lambda,  d2 = 0.0950 lambda

    % ---------- Input validation ----------
    if nargin < 3
        stub_type = 'short';
    end
    stub_type = lower(stub_type);
    if ~(strcmp(stub_type, 'short') || strcmp(stub_type, 'open'))
        error('stub_type must be ''short'' or ''open''.');
    end

    % ---------- Normalized load admittance ----------
    zL = ZL / Z0;
    yL = 1 / zL;
    GL = real(yL);
    BL = imag(yL);

    % ---------- Solve for t = tan(beta*d1) such that Re{y(d1)} = 1 ----------
    denom = GL^2 + BL^2 - GL;
    if abs(denom) < 1e-12
        % Reduces to a linear equation -> single solution
        % -2*BL*t + (GL - GL^2 - BL^2) = 0  =>  t = (GL - GL^2 - BL^2)/(2*BL)
        if abs(BL) < 1e-12
            % yL is already real and equal to 1: load is already matched.
            t_solutions = 0;
        else
            t_solutions = (GL - GL^2 - BL^2) / (2*BL);
        end
    else
        discriminant = GL * ((GL - 1)^2 + BL^2);
        if discriminant < 0
            error('No real solution exists. Check the load impedance.');
        end
        sqrt_term = sqrt(discriminant);
        t1 = (BL + sqrt_term) / denom;
        t2 = (BL - sqrt_term) / denom;
        t_solutions = [t1, t2];
    end

    % ---------- Convert each t to the shortest positive d1 (in wavelengths) ----------
    % beta*d1 = atan(t);  d1/lambda = atan(t)/(2*pi).  Wrap into [0, 0.5).
    d1_candidates = zeros(size(t_solutions));
    for k = 1:length(t_solutions)
        d_temp = atan(t_solutions(k)) / (2*pi);
        if d_temp < 0
            d_temp = d_temp + 0.5;   % tan has period pi -> add lambda/2
        end
        d1_candidates(k) = d_temp;
    end

    % ---------- For each candidate, compute B = Im{y(d1)} and required bs ----------
    bs_required = zeros(size(t_solutions));
    for k = 1:length(t_solutions)
        d_k = d1_candidates(k);
        beta_d = 2*pi*d_k;
        y_in = (yL + 1j*tan(beta_d)) / (1 + 1j*yL*tan(beta_d));
        bs_required(k) = -imag(y_in);
    end

    % ---------- Convert each required susceptance to the shortest positive d2 ----------
    % Short stub:  y_stub = -j*cot(beta*L)  =>  bs = -cot(beta*L)
    %                                       =>  tan(beta*L) = -1/bs
    % Open stub :  y_stub =  j*tan(beta*L)  =>  bs =  tan(beta*L)
    d2_candidates = zeros(size(t_solutions));
    for k = 1:length(t_solutions)
        bs = bs_required(k);
        if strcmp(stub_type, 'short')
            if abs(bs) < 1e-12
                d_temp = 0.25;       % bs = 0  ->  L = lambda/4
            else
                d_temp = atan(-1/bs) / (2*pi);
            end
        else  % open
            d_temp = atan(bs) / (2*pi);
        end
        if d_temp <= 0
            d_temp = d_temp + 0.5;   % shortest positive length
        end
        d2_candidates(k) = d_temp;
    end

    % ---------- Selection: SHORTEST d1 first, then (only if tied) shortest d2 ----------
    [d1_min, idx_min] = min(d1_candidates);
    tol = 1e-9;
    tied = find(abs(d1_candidates - d1_min) < tol);
    if length(tied) > 1
        [~, j] = min(d2_candidates(tied));
        idx_min = tied(j);
    end

    d1 = d1_candidates(idx_min);
    d2 = d2_candidates(idx_min);

    % ---------- Display results ----------
    fprintf('\n--- Parallel Stub Matching Network Design ---\n');
    fprintf('Load impedance        ZL = %.4f %+ .4fj  Ohms\n', real(ZL), imag(ZL));
    fprintf('Char. impedance       Z0 = %.4f Ohms\n', Z0);
    fprintf('Stub termination      :  %s-circuited\n', stub_type);
    fprintf('---------------------------------------------\n');
    fprintf('All candidate solutions:\n');
    for k = 1:length(d1_candidates)
        marker = '   ';
        if k == idx_min, marker = ' * '; end
        fprintf('%sd1 = %.4f lambda,  d2 = %.4f lambda\n', ...
                marker, d1_candidates(k), d2_candidates(k));
    end
    fprintf('   (* selected: shortest d1, then shortest d2)\n');
    fprintf('---------------------------------------------\n');
    fprintf('Selected design:\n');
    fprintf('   d1 = %.4f lambda\n', d1);
    fprintf('   d2 = %.4f lambda\n', d2);
    fprintf('---------------------------------------------\n');

    % ---------- Verification ----------
    beta_d1 = 2*pi*d1;
    y_in = (yL + 1j*tan(beta_d1)) / (1 + 1j*yL*tan(beta_d1));
    beta_d2 = 2*pi*d2;
    if strcmp(stub_type, 'short')
        y_stub = -1j * cot(beta_d2);
    else
        y_stub =  1j * tan(beta_d2);
    end
    y_total = y_in + y_stub;
    fprintf('Verification:\n');
    fprintf('   y at stub location  = %.4f %+ .4fj\n', real(y_in), imag(y_in));
    fprintf('   y of stub           = %.4f %+ .4fj\n', real(y_stub), imag(y_stub));
    fprintf('   y total (should=1)  = %.4f %+ .4fj\n', real(y_total), imag(y_total));
    fprintf('---------------------------------------------\n\n');
end
