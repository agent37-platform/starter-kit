// Libellés des canaux, du profil principal et des modèles ; un identifiant non listé est affiché tel quel.

import { DEFAULT_MODEL, HOME_PROFILE, SESSION_SOURCES as S, SUPERVISOR_PROFILE } from "./hermes-layout.ts";

const CHANNEL_NAMES: Record<string, string> = {
  [S.app]: "Plateforme",
  [S.routine]: "Routines",
  [S.telegram]: "Telegram",
  [S.whatsapp]: "WhatsApp",
  [S.slack]: "Slack",
  [S.discord]: "Discord",
  [S.teams]: "Microsoft Teams",
  [S.googleChat]: "Google Chat",
  [S.email]: "E-mail",
  [S.oneShot]: "Exécutions ponctuelles",
  [S.editor]: "Éditeur de code (ACP)",
  [S.cli]: "Ligne de commande",
  [S.subagent]: "Tâches déléguées à des sous-agents",
};

export function channelName(source: string): string {
  return CHANNEL_NAMES[source] ?? (source || "Canal non précisé");
}

const PROFILE_NAMES: Record<string, string> = {
  [HOME_PROFILE]: "Profil principal de l'instance",
  [SUPERVISOR_PROFILE]: "Yélé",
};

/** Libellé d'un profil ; `HOME_PROFILE` et `SUPERVISOR_PROFILE` ont un libellé dédié. */
export function profileName(profile: string): string {
  return Object.hasOwn(PROFILE_NAMES, profile) ? PROFILE_NAMES[profile] : profile;
}

export function modelName(model: string): string {
  if (model === DEFAULT_MODEL) return "Modèle par défaut de l'instance";
  return model || "Modèle non précisé";
}
