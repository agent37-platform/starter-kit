const compact = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("fr-FR");

/** Nombre abrégé : 214 255 962 → « 214,3 M ». */
export function formatCompact(n: number): string {
  return compact.format(n);
}

/** Nombre entier avec séparateurs : 1340 → « 1 340 ». */
export function formatWhole(n: number): string {
  return whole.format(Math.round(n));
}

const UNITS = ["o", "Ko", "Mo", "Go", "To"];

export function formatBytes(n: number): string {
  let v = n;
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? v : v.toFixed(1).replace(".", ",")} ${UNITS[u]}`;
}
