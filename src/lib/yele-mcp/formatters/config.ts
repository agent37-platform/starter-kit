// Le diagnostic de la configuration de l'instance : seulement ce que son fichier de configuration dit.

import { masquerSecrets } from "../secrets.ts";

export function formatDiagnosticConfiguration(configRaw: string | null): string {
  let out = `### 🩺 Diagnostic de Santé de l'Instance\n\n`;
  out += `- **Moteur d'exécution** : Hermes (Agent37)\n`;

  if (configRaw) {
    const sanitized = masquerSecrets(configRaw);
    const hasTelegram = sanitized.includes("telegram");
    const hasModel = sanitized.includes("model");
    out += `- **Intégration Telegram** : ${hasTelegram ? "✅ Configurée" : "⚪ Non configurée"}\n`;
    out += `- **Modèle d'IA par défaut** : ${hasModel ? "✅ Configuré" : "⚪ Par défaut"}\n`;
  } else {
    out += `- **Fichier de configuration** : illisible pour le moment.\n`;
  }
  return out;
}
