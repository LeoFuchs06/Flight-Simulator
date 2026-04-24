// test_physics.js — standalone 0→M1 acceleration test
// Run: node test_physics.js
//
// Simulates horizontal sea-level acceleration from v=0 with full afterburner
// (or full throttle for A-10) at 50 % fuel load.
// No Three.js dependency — pure scalars, 10 ms timestep.
//
// ── Simplifications vs. in-game model ───────────────────────────────────────
//  • 1-D (no pitch, no lift, no gravity component along flight path)
//  • Sea level only (h = 0 m)
//  • No induced drag (negligible at these speeds)
//  • Constant dt (10 ms), forward Euler
//  • Mach limit enforced as hard stop (same as game)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── ISA Atmosphere ────────────────────────────────────────────────────────────
const T0       = 288.15, L = 0.0065, TROPO_H = 11000;
const T_TROPO  = T0 - L * TROPO_H;   // 216.65 K
const RHO0     = 1.225;
const G_STD    = 9.80665;
const R_AIR    = 287.05;
const GAMMA    = 1.4;
const LAPSE_EX = G_STD / (L * R_AIR) - 1;  // ≈ 4.256

function airDensity(h) {
  h = Math.max(0, h);
  if (h <= TROPO_H) {
    const T = T0 - L * h;
    return RHO0 * Math.pow(T / T0, LAPSE_EX);
  }
  const rho11 = RHO0 * Math.pow(T_TROPO / T0, LAPSE_EX);
  return rho11 * Math.exp(-G_STD * (h - TROPO_H) / (R_AIR * T_TROPO));
}

function speedOfSound(h) {
  const T = h <= TROPO_H ? T0 - L * Math.max(0, h) : T_TROPO;
  return Math.sqrt(GAMMA * R_AIR * T);
}

// ── Aerodynamic helpers ───────────────────────────────────────────────────────
function cd0ofMach(base, M) {
  if (M < 0.8) return base;
  if (M < 1.2) return base * (1 + 3.5 * (M - 0.8));
  return base * Math.max(1.0, 1.8 - 0.15 * (M - 1.2));
}

function thrustMachFactor(engineType, M) {
  if (engineType === 'turbojet') {
    if (M <= 2.5) return 0.85 + 0.15 * M;
    return Math.max(0.5, 1.225 - 0.5 * (M - 2.5));
  }
  return Math.max(0.4, 1.0 - 0.25 * M); // turbofan
}

// ── Aircraft data (must mirror src/aircraft.js) ───────────────────────────────
const SPECS = {
  'F-22 Raptor': {
    engineType: 'turbofan', engineCount: 2,
    dryThrustPerEngine: 116000, wetThrustPerEngine: 156000,
    emptyMass: 19700, maxFuelMass: 8200,
    wingArea: 78.0, cd0: 0.016, maxMach: 2.25,
    tsfcDry: 1.5e-5, tsfcWet: 4.5e-5,
  },
  'Eurofighter Typhoon': {
    engineType: 'turbofan', engineCount: 2,
    dryThrustPerEngine: 60000, wetThrustPerEngine: 90000,
    emptyMass: 11000, maxFuelMass: 4500,
    wingArea: 50.0, cd0: 0.018, maxMach: 2.0,
    tsfcDry: 1.5e-5, tsfcWet: 4.0e-5,
  },
  'F-35B Lightning II': {
    engineType: 'turbofan', engineCount: 1,
    dryThrustPerEngine: 125000, wetThrustPerEngine: 191000,
    emptyMass: 14650, maxFuelMass: 6125,
    wingArea: 42.7, cd0: 0.020, maxMach: 1.6,
    tsfcDry: 1.5e-5, tsfcWet: 4.5e-5,
  },
  'MiG-31 Foxhound': {
    engineType: 'turbojet', engineCount: 2,
    dryThrustPerEngine: 93000, wetThrustPerEngine: 152000,
    emptyMass: 21820, maxFuelMass: 16350,
    wingArea: 61.6, cd0: 0.024, maxMach: 2.83,
    tsfcDry: 2.5e-5, tsfcWet: 6.0e-5,
  },
  'MiG-25 Foxbat': {
    engineType: 'turbojet', engineCount: 2,
    dryThrustPerEngine: 73500, wetThrustPerEngine: 100100,
    emptyMass: 20000, maxFuelMass: 14570,
    wingArea: 61.4, cd0: 0.022, maxMach: 2.83,
    tsfcDry: 2.5e-5, tsfcWet: 6.5e-5,
  },
  'A-10 Thunderbolt II': {
    engineType: 'turbofan', engineCount: 2,
    dryThrustPerEngine: 40300, wetThrustPerEngine: null,
    emptyMass: 11321, maxFuelMass: 4990,
    wingArea: 47.0, cd0: 0.032, maxMach: 0.56,
    tsfcDry: 1.0e-5, tsfcWet: null,
  },
};

const TARGETS = {
  'F-22 Raptor':        { t: 25, tol: 5  },
  'Eurofighter Typhoon':{ t: 28, tol: 5  },
  'F-35B Lightning II': { t: 55, tol: 10 },
  'MiG-31 Foxhound':   { t: 45, tol: 10 },
  'MiG-25 Foxbat':     { t: 55, tol: 10 },
  'A-10 Thunderbolt II':{ t: null         },  // does not reach M1
};

// ── Simulation ────────────────────────────────────────────────────────────────
function simulate(name, spec) {
  const DT        = 0.01;        // 10 ms step
  const H         = 0;           // sea level
  const rho       = airDensity(H);
  const a_snd     = speedOfSound(H);
  const M1_V      = a_snd;       // Mach 1 at sea level ≈ 340.3 m/s
  const maxV      = spec.maxMach * a_snd;
  const hasAB     = spec.wetThrustPerEngine != null;
  const thrustSL  = (hasAB ? spec.wetThrustPerEngine : spec.dryThrustPerEngine)
                    * spec.engineCount;
  const tsfc      = hasAB ? spec.tsfcWet : spec.tsfcDry;
  const altFactor = Math.pow(rho / RHO0, 0.7);  // = 1.0 at sea level

  let v    = 0;
  let t    = 0;
  let fuel = spec.maxFuelMass * 0.5;

  // Capture interesting milestones
  let tMach08 = null, tMach095 = null;
  let maxAccel = 0;

  while (t < 600) {
    if (v >= M1_V || v >= maxV) break;

    const M       = v / a_snd;
    const mf      = thrustMachFactor(spec.engineType, M);
    const thrust  = thrustSL * altFactor * mf;
    const cd      = cd0ofMach(spec.cd0, M);
    const drag    = 0.5 * rho * v * v * spec.wingArea * cd;
    const curMass = spec.emptyMass + fuel;
    const accel   = (thrust - drag) / curMass;

    if (accel > maxAccel) maxAccel = accel;

    v    = Math.min(maxV, Math.max(0, v + accel * DT));
    fuel = Math.max(0, fuel - tsfc * thrust * DT);
    t   += DT;

    const mNow = v / a_snd;
    if (tMach08  == null && mNow >= 0.80) tMach08  = t;
    if (tMach095 == null && mNow >= 0.95) tMach095 = t;
  }

  return { time: t, mach: v / a_snd, tMach08, tMach095, maxAccel };
}

// ── Report ────────────────────────────────────────────────────────────────────
const COL = 24;
function pad(s, n) { return String(s).padEnd(n); }
function fmt(s, n) { return String(s).padStart(n); }

console.log('\n=== 0 → Mach 1 acceleration test (sea level, 50 % fuel, full AB) ===\n');
console.log(
  pad('Aircraft', COL),
  fmt('0→M1 [s]', 9),
  fmt('Target', 7),
  fmt('Δ', 6),
  fmt('0→M0.8', 8),
  fmt('0→M0.95', 9),
  fmt('Max-a [g]', 10),
  fmt('Result', 7),
);
console.log('─'.repeat(82));

for (const [name, spec] of Object.entries(SPECS)) {
  const r      = simulate(name, spec);
  const tgt    = TARGETS[name];

  let resultStr, deltaStr;
  if (tgt.t == null) {
    // A-10: should not reach M1
    const reached = r.mach >= 0.999;
    resultStr = reached ? '✗ REACHED M1' : '✓ NO M1 (correct)';
    deltaStr  = '';
  } else {
    const reached = r.mach >= 0.999;
    if (!reached) {
      resultStr = '✗ DID NOT REACH M1';
      deltaStr  = '—';
    } else {
      const delta = (r.time - tgt.t).toFixed(1);
      const ok    = Math.abs(r.time - tgt.t) <= tgt.tol;
      resultStr   = ok ? '✓ IN WINDOW' : '~ OUTSIDE';
      deltaStr    = (r.time > tgt.t ? '+' : '') + delta;
    }
  }

  const tgtStr  = tgt.t != null ? `${tgt.t}±${tgt.tol}` : 'N/A';
  const m08     = r.tMach08   != null ? r.tMach08.toFixed(1)  : '—';
  const m095    = r.tMach095  != null ? r.tMach095.toFixed(1) : '—';
  const simT    = r.mach >= 0.999 ? r.time.toFixed(1) : `M${r.mach.toFixed(2)}`;
  const aG      = (r.maxAccel / 9.81).toFixed(2);

  console.log(
    pad(name, COL),
    fmt(simT,    9),
    fmt(tgtStr,  7),
    fmt(deltaStr, 6),
    fmt(m08,     8),
    fmt(m095,    9),
    fmt(aG + ' g', 10),
    ' ' + resultStr,
  );
}

console.log('\n── Notes ──────────────────────────────────────────────────────────────');
console.log('• Turbofan Mach factor: max(0.4, 1 − 0.25·M)');
console.log('  → thrust falls with speed; trades acceleration for realism.');
console.log('• Turbojet Mach factor: 0.85 + 0.15·M (rises to M≈2.5)');
console.log('  → poor low-speed, strong high-speed (MiG-25/31 character).');
console.log('• Transonic drag: Cd0 × (1 + 3.5·(M−0.8)) peaks at M=1.2.');
console.log('  → "Mach wall" effect clearly felt between M 0.85–1.1.');
console.log('• If F-22/Eurofighter times are outside 25/28 s window, try:');
console.log('  - Reduce turbofan Mach factor to max(0.5, 1−0.15·M) for AB mode,');
console.log('  - Or increase wetThrustPerEngine by ~10–15 %.');
console.log('• Altitude run: at 11 000 m the density halves → drag halves but');
console.log('  thrust also falls; net result is usually FASTER acceleration.');
console.log('');
