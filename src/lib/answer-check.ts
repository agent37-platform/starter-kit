import { isRecord, recordsOf } from "./llm-accounts.ts";
import { llmRefusalMessage } from "./llm.ts";

// Vérification des réponses de l'instance du membre (back office : `/app/judge`). Avant de partir, une
// réponse qui affirme un fait est relue par un modèle qui en cherche la preuve dans les outils appelés.
// Nul = le fournisseur et le modèle de l'Expert. Sans choix : `default` (un autre fournisseur de l'espace s'il y en a
// un). Le mode (note seulement ou reprise) se règle chez Yelema.

export interface CheckChoice {
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
}

export type CheckDefaultReason = "autre_fournisseur" | "meme_fournisseur" | "client_sensible";

export interface AnswerCheckView {
  source: "instance" | "global";
  /** Sans choix du membre ni de Yelema : le premier autre fournisseur des comptes, sinon celui de l'Expert (toujours pour un client sensible). */
  default: CheckChoice & { reason: CheckDefaultReason };
  effective: CheckChoice & { mode: "observation" | "relance" };
  own: CheckChoice;
  providers: { value: string; label: string }[];
  /** Le fournisseur choisi n'a plus de compte sur l'instance : le défaut sert. */
  lost: boolean;
  /** Fournisseurs sans compte, à ajouter d'abord ; `keys` : leurs entrées du catalogue des comptes. */
  others: { value: string; label: string; keys: string[] }[];
  /** Faux tant que l'espace n'a pas ses propres comptes : un compte ajouté deviendrait le modèle des Experts. */
  canAdd: boolean;
}

const PROVIDER = /^(custom:[A-Za-z][A-Za-z0-9_-]{1,39}|[a-z0-9][a-z0-9-]{0,63})$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function choiceOf(v: unknown): CheckChoice {
  const o = isRecord(v) ? v : {};
  return { provider: str(o.provider), providerLabel: str(o.providerLabel), model: str(o.model) };
}

/** La réponse du back office, réduite à ce que l'écran affiche. */
export function readAnswerCheck(v: unknown): AnswerCheckView {
  const o = isRecord(v) ? v : {};
  const effective = isRecord(o.effective) ? o.effective : {};
  const fallback = choiceOf(o.default);
  const other = isRecord(o.default) && o.default.reason === "autre_fournisseur" && !!fallback.provider && !!fallback.model;
  return {
    source: o.source === "instance" ? "instance" : "global",
    default: { ...fallback, reason: other ? "autre_fournisseur" : isRecord(o.default) && o.default.reason === "client_sensible" ? "client_sensible" : "meme_fournisseur" },
    effective: { ...choiceOf(effective), mode: effective.mode === "relance" ? "relance" : "observation" },
    own: choiceOf(o.own),
    providers: recordsOf(o.providers, (p) => (str(p.value) && str(p.label) ? { value: p.value as string, label: p.label as string } : null)),
    lost: o.lost === true,
    others: recordsOf(o.others, (p) => {
      const keys = Array.isArray(p.keys) ? p.keys.filter((k): k is string => typeof k === "string" && PROVIDER.test(k)) : [];
      return str(p.value) && str(p.label) && keys.length ? { value: p.value as string, label: p.label as string, keys } : null;
    }),
    canAdd: o.canAdd === true,
  };
}

/** Le libellé du défaut (dans le choix) et la phrase sous le choix quand rien n'est choisi. */
export function checkDefault(view: AnswerCheckView): { label: string; line: string } {
  const d = view.default;
  const label = d.reason === "autre_fournisseur" ? `Par défaut : ${d.providerLabel ?? d.provider} · ${d.model}` : "Par défaut : même modèle que l’Expert";
  if (d.reason === "client_sensible" && !view.effective.provider && !view.effective.model) return { label, line: "Même modèle que l’Expert (client à données sensibles)." };
  const e = view.effective;
  const isDefault = d.reason === "autre_fournisseur" ? e.provider === d.provider && e.model === d.model : !e.provider && !e.model;
  if (!isDefault) return { label, line: `Réglé par Yelema : ${e.providerLabel ?? e.provider ?? "fournisseur de l’Expert"}${e.model ? ` · ${e.model}` : ""}.` };
  return { label, line: d.reason === "autre_fournisseur" ? "Un autre fournisseur relit les réponses de l’Expert." : "Le modèle de l’Expert relit ses propres réponses : un compte d’IA chez un autre fournisseur le remplacerait." };
}

/** Le corps envoyé au back office : fournisseur et modèle seulement, jamais le mode. */
export function parseCheckChoice(body: unknown): { provider: string; model: string } | null {
  if (!isRecord(body)) return null;
  const { provider, model } = body;
  if (typeof provider !== "string" || typeof model !== "string") return null;
  if ((provider && !PROVIDER.test(provider)) || (model && !MODEL.test(model))) return null;
  return { provider, model };
}

export function answerCheckRefusal(code: string): string | null {
  if (code === "bad_judge") return "Ce fournisseur n’a pas de compte sur votre espace : ajoutez d’abord sa clé dans vos comptes d’IA.";
  return llmRefusalMessage(code);
}
