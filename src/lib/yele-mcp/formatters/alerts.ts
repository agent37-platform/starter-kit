// Les alertes et incidents de l'instance.

import { TELEGRAM_READY_PHASE } from "../hermes-layout.ts";
import { masquerSecrets } from "../secrets.ts";
import type { DiscoveredExpert, IncidentAlertData } from "../types.ts";

/** The Telegram group's state, in words, from the phase telegram.json gives. */
function telegramState(phase: string | null): string {
  if (phase === null) return "non configurée";
  return phase === TELEGRAM_READY_PHASE ? "🟢 Opérationnelle" : "⚠️ En cours de configuration";
}

export function formatAlertesEtIncidents(
  data: IncidentAlertData | null,
  experts?: DiscoveredExpert[],
  targetExpert?: string
): string {
  if (!data) {
    return "### 🛡️ Diagnostic de Santé & Alertes\n\nLes alertes de l'instance n'ont pas pu être lues pour le moment.";
  }

  const cleanTarget = targetExpert ? targetExpert.trim().toLowerCase() : undefined;
  const incidents = cleanTarget
    ? data.incidents.filter((i) => i.expert.toLowerCase().includes(cleanTarget))
    : data.incidents;

  const avertissements = cleanTarget
    ? data.avertissements.filter((a) => a.expert.toLowerCase().includes(cleanTarget))
    : data.avertissements;

  let out = `### 🛡️ Diagnostic de Santé, Alertes & Incidents\n\n`;

  if (incidents.length === 0) {
    out += `**Statut global : 🟢 AUCUN INCIDENT DÉTECTÉ**\n\n`;
    out +=
      data.totalCronsScanned > 0
        ? `- **Santé des Routines & Crons** : 🟢 **0 incident détecté** sur ${data.totalCronsScanned} exécutions enregistrées.\n`
        : `- **Santé des Routines & Crons** : aucune exécution enregistrée, donc **0 incident détecté**.\n`;
    out += `- **Passerelle Telegram** : ${telegramState(data.telegramPhase)}.\n\n`;
  } else {
    out += `**Statut global : 🔴 ${incidents.length} INCIDENT(S) DÉTECTÉ(S)**\n\n`;
    out += `#### 🚨 Incidents Critiques :\n`;
    for (const inc of incidents) {
      out += `- **${inc.expert}** : ${inc.error || inc.note || "Erreur non spécifiée"}\n`;
    }
    out += `\n`;
  }

  if (avertissements.length > 0) {
    out += `#### ⚠️ Points d'attention & Avertissements (${avertissements.length}) :\n`;
    for (const av of avertissements.slice(0, 10)) {
      out += `- **${av.expert}** : ${av.message || `Outil ${av.outil} en état '${av.etat}'`}\n`;
    }
  }

  return masquerSecrets(out);
}
