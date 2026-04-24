// ISA Standard Atmosphere (ICAO Doc 7488)
// All quantities in SI: metres, Kelvin, kg/m³, m/s

const T0          = 288.15;   // K  sea-level temperature
const L           = 0.0065;   // K/m lapse rate (troposphere)
const TROPO_H     = 11000;    // m   tropopause altitude
const T_TROPO     = T0 - L * TROPO_H;  // 216.65 K  stratosphere temperature
const GAMMA       = 1.4;      // adiabatic index for dry air

export const RHO0  = 1.225;   // kg/m³ sea-level density
export const G_STD = 9.80665; // m/s²  standard gravity
const R_AIR        = 287.05;  // J/(kg·K) specific gas constant for dry air

// Gravitational lapse exponent: g/(L·R) - 1 = 9.80665/(0.0065·287.05) - 1 ≈ 4.256
const LAPSE_EXP = G_STD / (L * R_AIR) - 1;

export function airTemperature(h) {
  h = Math.max(0, h);
  return h <= TROPO_H ? T0 - L * h : T_TROPO;
}

export function airDensity(h) {
  h = Math.max(0, h);
  if (h <= TROPO_H) {
    const T = T0 - L * h;
    return RHO0 * Math.pow(T / T0, LAPSE_EXP);
  }
  // Isothermal stratosphere: exponential decay from tropopause value
  const rho11 = RHO0 * Math.pow(T_TROPO / T0, LAPSE_EXP);
  return rho11 * Math.exp(-G_STD * (h - TROPO_H) / (R_AIR * T_TROPO));
}

export function speedOfSound(h) {
  return Math.sqrt(GAMMA * R_AIR * airTemperature(h));
}
