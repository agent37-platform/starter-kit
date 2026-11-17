// L'identité d'un expert : son nom affiché, son rôle, et la façon de le reconnaître dans une demande.

import type { DiscoveredExpert } from "./types.ts";

/** Formate le nom et le rôle d'un expert pour l'affichage */
export function formatExpertDisplayName(exp: DiscoveredExpert | string): string {
  if (typeof exp === "string") {
    return exp.charAt(0).toUpperCase() + exp.slice(1);
  }
  const role = expertRole(exp, "");
  return role ? `${exp.name} (${role})` : exp.name;
}

/** Le rôle par lequel commence la description d'un expert (avant `:` ou `;`). */
export function expertRole(exp: { description?: string } | undefined, fallback = "Expert"): string {
  return exp?.description ? exp.description.split(/[:;]/)[0].trim() : fallback;
}

/** Matches an expert by profile id (`client__expert`), the part after `__`, or its name. */
export function isExpert(exp: { id: string; name: string }, wanted: string): boolean {
  const w = wanted.trim().toLowerCase();
  const id = exp.id.toLowerCase();
  return !!w && (id === w || id.endsWith(`__${w}`) || exp.name.toLowerCase() === w);
}
