/**
 * The Créations each Expert offers behind « Créer » in its chat (Leslie, 19/11): five or six models,
 * each one at a single Expert, from the catalogue v4 of the `creations` skill (hermes-experts,
 * `references/catalogue.md`). Picking one sends « Créer : <model> », the phrase the skill answers.
 */
export type CreationType = "suivi" | "page" | "formulaire" | "mini-app" | "presentation";
export interface CreationModel {
  name: string;
  type: CreationType;
  /** « Chaque matin », « En direct », « À la demande »… */
  update: string;
}
export const CREATION_TYPE_LABEL: Record<CreationType, string> = {
  suivi: "Tableau de suivi",
  page: "Page à partager",
  formulaire: "Formulaire",
  "mini-app": "Mini-app",
  presentation: "Présentation",
};
const M: Record<string, [string, CreationType, string][]> = {
  djeneba: [
    ["Pilotage de la direction", "suivi", "Chaque matin"],
    ["Suivi des décisions du comité", "suivi", "Après chaque réunion"],
    ["Feuille de route trimestrielle", "page", "Chaque semaine"],
    ["Rapport mensuel aux actionnaires", "presentation", "Chaque mois"],
    ["Indicateurs de l'entreprise", "suivi", "Chaque matin"],
    ["Rapport hebdomadaire", "presentation", "Chaque lundi"],
  ],
  kouassi: [
    ["Pipeline des prospects", "suivi", "Chaque matin"],
    ["Relances à faire", "suivi", "Chaque matin"],
    ["Rendez-vous de la semaine", "page", "Chaque matin"],
    ["Prise de commande terrain", "mini-app", "En direct"],
    ["Catalogue produits avec prix", "page", "Chaque semaine"],
  ],
  sena: [
    ["Suivi des devis", "suivi", "Chaque matin"],
    ["Proposition commerciale en ligne", "presentation", "À la demande"],
    ["Simulateur de devis", "mini-app", "À la demande"],
    ["Contrats clients à renouveler", "suivi", "Chaque semaine"],
    ["Réponse à un appel d'offres", "presentation", "À la demande"],
  ],
  aminata: [
    ["Suivi des commerciaux", "suivi", "Chaque matin"],
    ["Explorateur de ventes", "mini-app", "Chaque matin"],
    ["Commissions des commerciaux", "suivi", "Chaque mois"],
    ["Comptes clients à surveiller", "suivi", "Chaque semaine"],
    ["Objectifs du trimestre", "page", "Chaque mois"],
  ],
  seydou: [
    ["Veille des appels d'offres", "suivi", "Chaque matin"],
    ["Calendrier des dépôts", "suivi", "Chaque jour"],
    ["Fiche marché", "page", "À la demande"],
    ["Bilan des marchés du trimestre", "presentation", "Chaque trimestre"],
    ["Alerte appels d'offres", "formulaire", "En direct"],
  ],
  fatima: [
    ["Calendrier éditorial", "suivi", "Chaque jour"],
    ["Résultats des campagnes", "suivi", "Chaque matin"],
    ["Page de lancement produit", "page", "À la demande"],
    ["Jeu concours", "formulaire", "En direct"],
    ["Inscription à un événement", "formulaire", "En direct"],
  ],
  koffi: [
    ["Studio des visuels", "suivi", "Chaque jour"],
    ["Demande de visuel", "formulaire", "En direct"],
    ["Mini charte de marque", "page", "À la demande"],
    ["Cartes de visite en ligne", "page", "À la demande"],
    ["Validation de maquettes", "mini-app", "En direct"],
    ["Banque d'images", "page", "Chaque semaine"],
  ],
  aya: [
    ["Suivi des créateurs", "suivi", "Chaque semaine"],
    ["Brief créateur", "page", "À la demande"],
    ["Candidature créateur", "formulaire", "En direct"],
    ["Résultats par créateur", "suivi", "Chaque semaine"],
    ["Bilan de campagne d'influence", "presentation", "À la demande"],
  ],
  yao: [
    ["Veille concurrentielle", "suivi", "Chaque semaine"],
    ["Statistiques des réseaux", "suivi", "Chaque matin"],
    ["Rapport de campagne", "presentation", "À la demande"],
    ["Étude de marché en ligne", "page", "À la demande"],
    ["Revue de presse", "page", "Chaque semaine"],
  ],
  fatou: [
    ["Tableau RH", "suivi", "Chaque mois"],
    ["Contrôle de la pré-paie", "suivi", "Chaque mois"],
    ["Demande de congé", "formulaire", "En direct"],
    ["Calendrier des absences", "page", "En direct"],
    ["Déclarations sociales", "suivi", "Chaque mois"],
  ],
  adjoua: [
    ["Suivi des recrutements", "suivi", "Chaque matin"],
    ["Page carrière", "page", "Chaque semaine"],
    ["Formulaire de candidature", "formulaire", "En direct"],
    ["Grille d'entretien", "mini-app", "En direct"],
    ["Vivier de candidats", "suivi", "Chaque semaine"],
  ],
  lamine: [
    ["Planning d'intégration", "page", "À la demande"],
    ["Livret d'accueil", "page", "À la demande"],
    ["Plan de formation", "suivi", "Chaque mois"],
    ["Inscription à une formation", "formulaire", "En direct"],
    ["Évaluation d'une formation", "formulaire", "En direct"],
    ["Dossiers FDFP", "suivi", "Chaque semaine"],
  ],
  cheikh: [
    ["Contrats de travail à suivre", "suivi", "Chaque semaine"],
    ["Demande d'avis droit du travail", "formulaire", "En direct"],
    ["Baromètre social", "formulaire", "Chaque trimestre"],
    ["Procédures disciplinaires en cours", "suivi", "Chaque semaine"],
    ["Règlement intérieur en ligne", "page", "À la demande"],
  ],
  mamadou: [
    ["Trésorerie à 13 semaines", "suivi", "Chaque matin"],
    ["Rapport financier mensuel", "presentation", "Chaque mois"],
    ["Note de frais", "formulaire", "En direct"],
    ["Clôture du mois", "suivi", "Chaque jour"],
    ["Calendrier fiscal", "suivi", "Chaque semaine"],
  ],
  kadiatou: [
    ["Factures fournisseurs à payer", "suivi", "Chaque matin"],
    ["Échéancier des paiements", "suivi", "Chaque matin"],
    ["Bon à payer", "mini-app", "En direct"],
    ["Dépôt de facture fournisseur", "formulaire", "En direct"],
    ["Relevé fournisseur", "page", "À la demande"],
  ],
  daouda: [
    ["Créances clients", "suivi", "Chaque matin"],
    ["Relances de recouvrement", "suivi", "Chaque matin"],
    ["Caisse du jour", "mini-app", "En direct"],
    ["Relevé de compte client", "page", "À la demande"],
    ["Suivi des encaissements", "suivi", "Chaque matin"],
  ],
  rokia: [
    ["Budget contre réalisé", "suivi", "Chaque mois"],
    ["Marges par produit", "suivi", "Chaque mois"],
    ["Simulateur de business plan", "mini-app", "À la demande"],
    ["Rapport de gestion mensuel", "presentation", "Chaque mois"],
    ["Demande de budget", "formulaire", "Une fois par an"],
  ],
  awa: [
    ["Questions fréquentes", "page", "Chaque semaine"],
    ["Suivi de ma demande", "page", "En direct"],
    ["Messages des clients", "suivi", "Chaque heure"],
    ["Formulaire de contact", "formulaire", "En direct"],
    ["Réponses à valider", "mini-app", "En direct"],
  ],
  akissi: [
    ["Enquête de satisfaction", "formulaire", "En direct"],
    ["Avis clients du mois", "suivi", "Chaque semaine"],
    ["Programme de fidélité", "page", "À la demande"],
    ["Clients à risque de départ", "suivi", "Chaque semaine"],
    ["Carte de fidélité", "mini-app", "En direct"],
  ],
  ousmane: [
    ["Délais de réponse", "suivi", "Chaque matin"],
    ["Engagements de service", "page", "Chaque mois"],
    ["Contrôle qualité des réponses", "mini-app", "Chaque semaine"],
    ["Rapport qualité mensuel", "presentation", "Chaque mois"],
    ["Signaler un manquement", "formulaire", "En direct"],
  ],
  malick: [
    ["Réclamations clients", "suivi", "Chaque heure"],
    ["Formulaire de réclamation", "formulaire", "En direct"],
    ["Demande de garantie", "formulaire", "En direct"],
    ["Suivi des réparations", "suivi", "Chaque matin"],
    ["Fiche d'intervention", "mini-app", "En direct"],
  ],
  salif: [
    ["Stock et ruptures", "suivi", "Chaque matin"],
    ["Inventaire", "mini-app", "En direct"],
    ["Lots bientôt périmés", "suivi", "Chaque matin"],
    ["Mouvements de stock", "suivi", "Chaque jour"],
    ["Demande de sortie de stock", "formulaire", "En direct"],
  ],
  ali: [
    ["Demande d'achat", "mini-app", "En direct"],
    ["Suivi des commandes fournisseurs", "suivi", "Chaque matin"],
    ["Suivi des imports", "suivi", "Chaque jour"],
    ["Comparatif de devis fournisseurs", "page", "À la demande"],
    ["Annuaire des fournisseurs", "page", "Chaque semaine"],
  ],
  sidiki: [
    ["Tournées et livraisons", "suivi", "Chaque heure"],
    ["Bon de livraison signé", "mini-app", "En direct"],
    ["Suivi de commande client", "page", "En direct"],
    ["Planning des livreurs", "suivi", "Chaque jour"],
    ["Suivi de la flotte", "suivi", "Chaque semaine"],
  ],
  assita: [
    ["Demande d'intervention", "formulaire", "En direct"],
    ["Suivi des prestataires", "suivi", "Chaque semaine"],
    ["Contrats et assurances à renouveler", "suivi", "Chaque semaine"],
    ["Réservation de salle", "mini-app", "En direct"],
    ["Guide des services généraux", "page", "À la demande"],
  ],
  alioune: [
    ["Pipeline des opportunités", "suivi", "Chaque semaine"],
    ["Note d'investissement en ligne", "presentation", "À la demande"],
    ["Data room", "page", "À la demande"],
    ["Lettre aux investisseurs", "presentation", "Chaque trimestre"],
    ["Levée de fonds", "suivi", "Chaque semaine"],
  ],
  fifame: [
    ["Pipeline de sourcing", "suivi", "Chaque semaine"],
    ["Fiche entreprise repérée", "page", "À la demande"],
    ["Candidature au fonds", "formulaire", "En direct"],
    ["Rapport de sourcing mensuel", "presentation", "Chaque mois"],
    ["Événements à couvrir", "page", "Chaque semaine"],
  ],
  ibrahim: [
    ["Registre des contrats", "suivi", "Chaque semaine"],
    ["Contentieux en cours", "suivi", "Chaque semaine"],
    ["Demande d'avis juridique", "formulaire", "En direct"],
    ["Calendrier des obligations", "suivi", "Chaque semaine"],
    ["Conditions générales en ligne", "page", "À la demande"],
    ["Vérification d'un partenaire", "mini-app", "À la demande"],
  ],
  aicha: [
    ["Portefeuille de participations", "suivi", "Chaque mois"],
    ["Collecte des reportings", "formulaire", "Chaque trimestre"],
    ["Alertes du portefeuille", "suivi", "Chaque mois"],
    ["Fiche participation", "page", "Chaque trimestre"],
    ["Rapport d'impact", "presentation", "Chaque trimestre"],
  ],
};

/** The Expert's models, by its catalogue key; none for an Expert outside the catalogue. */
export function creationsOf(key: string | null | undefined): CreationModel[] {
  return (key ? M[key] : undefined)?.map(([name, type, update]) => ({ name, type, update })) ?? [];
}

/** Made once, on request; every other model keeps itself up to date (or takes answers live). */
export const isOnDemand = (m: CreationModel) => m.update === "À la demande";

/** What the composer sends for a model, or to describe something else. */
export const creationMessage = (m: CreationModel) => `Créer : ${m.name}`;
export const CREATION_OTHER = "Créer : ";
