import type { IntegrationToolkit } from "@/lib/types";

// Composio serves a logo per toolkit slug at a fixed URL scheme, so the catalog below can resolve
// app icons without a remote round-trip. Live search results carry their own `logo` from the API.
// The catalog's own logos are copied in public/logos/composio (scripts/logos-composio.mjs) and served
// by the app, with the page: logos.composio.dev answered slowly. Any other slug keeps Composio's address.
const LOCAL_LOGOS = new Set([
  "gmail", "googledrive", "googlecalendar", "googlesheets", "googledocs", "outlook", "microsoft_teams",
  "one_drive", "slack", "notion", "canva", "facebook", "instagram", "linkedin", "hubspot", "airtable",
  "quickbooks", "calendly", "zoom", "dropbox", "trello",
]);

export const COMPOSIO_LOGOS_ORIGIN = "https://logos.composio.dev";

export function composioLogoUrl(slug: string) {
  const key = slug.toLowerCase();
  return LOCAL_LOGOS.has(key) ? `/logos/composio/${key}.svg` : `${COMPOSIO_LOGOS_ORIGIN}/api/${encodeURIComponent(slug)}`;
}

/** A logo the app serves itself (no reason to wait for it to scroll into view). */
export const isLocalLogo = (url: string | null | undefined): boolean => !!url && url.startsWith("/logos/");

function toolkit(slug: string, name: string, description: string): IntegrationToolkit {
  return {
    slug,
    name,
    description,
    logo: composioLogoUrl(slug),
    enabled: true,
    isNoAuth: false,
    authSchemes: ["OAUTH2"],
  };
}

// The tools shown before any search, with French descriptions. Search reaches the full catalog
// (1 000+ apps); a result that is also listed here keeps its French description.
export const DEFAULT_INTEGRATION_TOOLKITS: IntegrationToolkit[] = [
  toolkit("gmail", "Gmail", "Lire, trier et envoyer des e-mails"),
  toolkit("googledrive", "Google Drive", "Ranger et retrouver les fichiers"),
  toolkit("googlecalendar", "Google Agenda", "Prendre et déplacer des rendez-vous"),
  toolkit("googlesheets", "Google Sheets", "Tableaux et suivis"),
  toolkit("googledocs", "Google Docs", "Rédiger et partager des documents"),
  toolkit("outlook", "Outlook", "E-mails et agenda Microsoft 365"),
  toolkit("microsoft_teams", "Microsoft Teams", "Réunions et messages d’équipe"),
  toolkit("one_drive", "OneDrive", "Fichiers Microsoft 365"),
  toolkit("slack", "Slack", "Écrire dans vos canaux"),
  toolkit("notion", "Notion", "Lire et mettre à jour vos pages"),
  toolkit("canva", "Canva", "Créer et exporter des visuels"),
  toolkit("facebook", "Facebook", "Publier sur votre page"),
  toolkit("instagram", "Instagram", "Publier et suivre votre compte"),
  toolkit("linkedin", "LinkedIn", "Publier et suivre votre page"),
  toolkit("hubspot", "HubSpot", "Contacts, affaires et relances"),
  toolkit("airtable", "Airtable", "Bases de données d’équipe"),
  toolkit("quickbooks", "QuickBooks", "Factures et dépenses"),
  toolkit("calendly", "Calendly", "Prise de rendez-vous"),
  toolkit("zoom", "Zoom", "Réunions vidéo"),
  toolkit("dropbox", "Dropbox", "Fichiers partagés"),
  toolkit("trello", "Trello", "Tableaux de projets"),
];

const BY_SLUG = new Map(DEFAULT_INTEGRATION_TOOLKITS.map((t) => [t.slug, t]));

// The catalog entry for a slug (French name and description), if it is one of ours.
export function catalogToolkit(slug: string): IntegrationToolkit | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}

// The catalog sorted by use, for the filters above it (Leslie, 03/11). A tool found by a search has no
// group: it shows under « Tous » only.
export const INTEGRATION_GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Messagerie et agenda", slugs: ["gmail", "outlook", "googlecalendar", "microsoft_teams", "slack", "zoom", "calendly"] },
  { label: "Documents et fichiers", slugs: ["googledrive", "googledocs", "googlesheets", "one_drive", "dropbox", "notion", "airtable", "trello"] },
  { label: "Ventes et finance", slugs: ["hubspot", "quickbooks"] },
  { label: "Réseaux et création", slugs: ["linkedin", "facebook", "instagram", "canva"] },
];
