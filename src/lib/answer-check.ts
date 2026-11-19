import { isRecord, recordsOf } from "./llm-accounts.ts";
import { llmRefusalMessage } from "./llm.ts";

// Vérification des réponses de l'instance du membre (back office : `/app/judge`). Avant de partir, une
// réponse qui affirme un fait est relue par un modèle qui en cherche la preuve dans les outils appelés.
// Nul = le fournisseur et le modèle de l'Expert. Le mode (note seulement ou reprise) se règle chez Yelema.

export interface CheckChoice {
  provider: string | null;
  providerLabel: string | null;
  model: string | null;
}

export interface AnswerCheckView {
  source: "instance" | "global";
  effective: CheckChoice & { mode: "observation" | "relance" };
  own: CheckChoice;
  providers: { value: string; label: string }[];
  /** Le fournisseur choisi n'a plus de compte sur l'instance : celui de l'Expert sert. */
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
  return {
    source: o.source === "instance" ? "instance" : "global",
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
