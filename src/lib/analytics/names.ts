import { catalogToolkit, composioLogoUrl } from "../integration-catalog.ts";
import { MCP_DIRECTORY } from "../mcp-directory.ts";
import { modelName } from "../yele-mcp/labels.ts";

/** Identifiant mis en forme : séparateurs `-` et `_` remplacés par des espaces, première lettre en capitale. */
export function humanize(id: string): string {
  const text = id.replace(/[-_]+/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : id;
}

// Début d'une précision après le titre : deux-points, tiret entre espaces, barre, parenthèse, point-virgule.
const TITLE_END = /\s*(?::|;|\||\(|\s[-–—]\s|\n)/;

/** Titre d'un expert : le texte avant sa première précision, sans ponctuation finale. */
export function expertTitle(text: string): string {
  return text.split(TITLE_END)[0].replace(/[\s.,]+$/, "").trim();
}

/** Libellé d'un modèle : celui du back-office pour son id complet ou son id sans fournisseur, sinon `modelName`. */
export function modelLabel(model: string, labels: Record<string, string> | null): string {
  const bare = model.split("/").pop() ?? model;
  return labels?.[model] ?? labels?.[bare] ?? modelName(model);
}

/** Libellé d'une compétence : dernier segment de son nom, mis en forme. */
export function skillLabel(name: string): string {
  return humanize(name.split("/").filter(Boolean).pop() ?? name);
}

/** Libellé d'un serveur MCP : son nom dans l'annuaire, sinon sa clé mise en forme. */
export function mcpServerLabel(key: string): string {
  return MCP_DIRECTORY.find((e) => e.key.toLowerCase() === key.toLowerCase())?.name ?? humanize(key);
}

/** Nom et logo d'un connecteur : nom du compte connecté, sinon du catalogue, sinon slug mis en forme. */
export function connectorLabel(slug: string, connectedName: string | null): { name: string; logo: string } {
  const known = catalogToolkit(slug);
  return { name: connectedName ?? known?.name ?? humanize(slug), logo: known?.logo ?? composioLogoUrl(slug) };
}
