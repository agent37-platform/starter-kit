// Fin d'un jeton : le caractère suivant n'appartient pas à son alphabet (base64url).
const END = "(?![A-Za-z0-9_-])";

/** Motifs masqués, dans l'ordre d'application, et le texte qui remplace chacun. */
const PATTERNS: readonly [RegExp, string][] = [
  // Clés d'IA : Anthropic (sk-ant-), OpenAI (sk-, sk-proj-), OpenRouter (sk-or-v1-) et autres sk-.
  [new RegExp(`\\bsk-[A-Za-z0-9_-]{16,}${END}`, "g"), "[CLÉ_API_MASQUÉE]"],
  // Clés de type sk_live_ / sk_test_ (Agent37, Stripe).
  [new RegExp(`\\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}${END}`, "g"), "[CLÉ_API_MASQUÉE]"],
  [new RegExp(`\\b\\d{8,11}:[A-Za-z0-9_-]{35}${END}`, "g"), "[TOKEN_BOT_TELEGRAM_MASQUÉ]"],
  [new RegExp(`\\bx(?:ox[abposr]|app)-[A-Za-z0-9-]{10,}${END}`, "g"), "[TOKEN_SLACK_MASQUÉ]"],
  [new RegExp(`\\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})${END}`, "g"), "[TOKEN_GITHUB_MASQUÉ]"],
  [new RegExp(`\\bAIza[0-9A-Za-z_-]{35}${END}`, "g"), "[CLÉ_GOOGLE_MASQUÉE]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[CLÉ_AWS_MASQUÉE]"],
  [/Bearer\s+[A-Za-z0-9_.~+/-]{16,}=*/gi, "Bearer [TOKEN_MASQUÉ]"],
  [new RegExp(`\\bey[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}${END}`, "g"), "[JWT_MASQUÉ]"],
];

// Mot de passe d'une adresse de connexion : schéma://utilisateur:mot-de-passe@hôte.
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s]+(@)/gi;
// Valeur d'un champ dont le nom désigne un secret.
const SECRET_FIELD = /(?:password|secret|token|api[_-]?key)["']?\s*[:=]\s*["']?[^"'\s]{6,}["']?/gi;

/**
 * Masque les clés d'API, tokens et secrets d'un texte brut : clés d'IA, clés sk_live_, bots
 * Telegram, Slack, GitHub, Google, AWS, Bearer, JWT, mots de passe d'adresses de connexion et
 * valeurs des champs sensibles.
 */
export function masquerSecrets(raw: string): string {
  const masked = PATTERNS.reduce((text, [pattern, label]) => text.replace(pattern, label), raw);
  return masked.replace(URL_PASSWORD, "$1[MOT_DE_PASSE_MASQUÉ]$2").replace(SECRET_FIELD, (match) => `${match.split(/[:=]/)[0]}: "[MASQUÉ]"`);
}
