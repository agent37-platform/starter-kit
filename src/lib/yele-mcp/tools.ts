// Les outils du serveur MCP de Yélé (supervision en lecture seule) : nom, description, paramètres.

export const YELE_TOOLS = [
  {
    name: "analyser_activite_experts",
    description:
      "Inspecte l'activité récente des experts de l'entreprise : qui a travaillé aujourd'hui, qui est inactif, le nombre de tâches/sessions traitées et la dernière heure d'activité.",
    inputSchema: {
      type: "object",
      properties: {
        periode: {
          type: "string",
          enum: ["aujourdhui", "7_jours", "30_jours"],
          description: "La période d'analyse (par défaut 'aujourdhui').",
        },
      },
    },
  },
  {
    name: "lire_rapport_journalier",
    description:
      "Lit le rapport journalier (daily log) généré par le plugin Hermes Memory / Wiki pour une date donnée. Donne le compte-rendu des actions réalisées, des décisions et des apprentissages clés.",
    inputSchema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "La date au format YYYY-MM-DD, ou 'aujourdhui', ou 'hier'.",
        },
      },
    },
  },
  {
    name: "auditer_outils_connecteurs",
    description:
      "Vérifie l'état de santé de tous les connecteurs (Composio, MCP, Telegram) et liste les outils associés à chaque expert (actifs, déconnectés ou en échec).",
    inputSchema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          description: "Optionnel : filtrer pour un expert précis (ex: 'fatima', 'kouassi').",
        },
      },
    },
  },
  {
    name: "consulter_livrables_recents",
    description:
      "Liste les derniers livrables et documents produits par les experts dans le dossier Livrables (Word, Excel, PowerPoint, PDF), avec nom, auteur, date et taille.",
    inputSchema: {
      type: "object",
      properties: {
        limite: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Nombre maximum de livrables à retourner (défaut: 10).",
        },
      },
    },
  },
  {
    name: "statistiques_et_analytique",
    description:
      "Fournit une analyse chiffrée et des statistiques globales sur l'équipe d'experts : répartition de l'activité, taux de réussite des routines, volume de production et tendances d'usage.",
    inputSchema: {
      type: "object",
      properties: {
        vue: {
          type: "string",
          enum: ["synthese", "routines", "usage"],
          description: "La vue analytique souhaitée (défaut 'synthese').",
        },
      },
    },
  },
  {
    name: "consulter_canaux_et_telegram",
    description:
      "Consulte la configuration et l'état des canaux de communication de l'équipe : groupe Telegram du forum Yelema, bot Telegram officiel, association des topics/fils par expert, lien d'invitation et adresses e-mail des experts.",
    inputSchema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          description: "Optionnel : nom ou identifiant de profil de l'expert, pour son topic et son adresse e-mail.",
        },
      },
    },
  },
  {
    name: "analyser_consommation_tokens_et_couts",
    description:
      "Analyse la consommation de tokens d'IA, les volumes d'inférence et la distribution des modèles (Claude Opus 5.5, default) pour chaque expert ou pour toute l'instance. Permet de savoir qui consomme le plus/moins, les moyennes par routine et la durée des exécutions.",
    inputSchema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          description: "Optionnel : nom ou identifiant de l'expert pour un audit détaillé de sa consommation.",
        },
        periode: {
          type: "string",
          enum: ["aujourdhui", "7_jours", "30_jours", "tout"],
          description: "La période, en jours UTC entiers (par défaut 'tout' : depuis le début).",
        },
      },
    },
  },
  {
    name: "consulter_routines_et_planning",
    description:
      "Liste les routines de chaque expert (ou d'un expert précis) : actives, en pause ou proposées, leur horaire, leur prochaine et leur dernière exécution.",
    inputSchema: {
      type: "object",
      properties: {
        expert: { type: "string", description: "Optionnel : nom ou identifiant de l'expert." },
      },
    },
  },
  {
    name: "consulter_historique_routine",
    description:
      "Dit si les routines ont tourné : dernière exécution et nombre d'exécutions sur 7 jours pour toute l'équipe ; pour un expert précis, ses dernières exécutions avec leur résultat (envoyée, rien à signaler, échec).",
    inputSchema: {
      type: "object",
      properties: {
        expert: { type: "string", description: "Optionnel : nom ou identifiant de l'expert, pour le résultat de chaque exécution." },
      },
    },
  },
  {
    name: "consulter_alertes_et_incidents",
    description:
      "Supervise la santé du système, surveille les alertes opérationnelles et détecte les incidents : échecs de crons ou routines, connecteurs non connectés ou défaillants, et statut des passerelles de messagerie.",
    inputSchema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          description: "Optionnel : filtrer les alertes et l'état de santé pour un expert précis.",
        },
      },
    },
  },
  {
    name: "consulter_appels_et_voix",
    description:
      "Consulte la configuration du canal vocal, le statut des appels et les derniers briefs d'avant-appel préparés automatiquement pour les experts (contexte récent, dernières tâches et historique).",
    inputSchema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          description: "Optionnel : nom ou identifiant de l'expert pour son brief d'appel, ou laisser vide pour toute l'équipe.",
        },
      },
    },
  },
  {
    name: "rechercher_dans_la_memoire",
    description:
      "Recherche un terme, un sujet ou une information clé dans les mémoires durables d'entreprise et les historiques de tous les experts (ou d'un expert précis). Idéal pour retrouver des décisions, des consignes ou des faits sans chercher date par date.",
    inputSchema: {
      type: "object",
      properties: {
        requete: {
          type: "string",
          description: "Le mot-clé ou la phrase à rechercher (ex: 'réunion', 'budget', 'client', 'partenariat').",
        },
        expert: {
          type: "string",
          description: "Optionnel : limiter la recherche à un expert précis.",
        },
      },
      required: ["requete"],
    },
  },
  {
    name: "consulter_skills_experts",
    description:
      "Consulte le référentiel des compétences métiers (skills), méthodologies et modes opératoires déclarés pour chaque expert (ou pour un expert précis).",
    inputSchema: {
      type: "object",
      properties: {
        expert: {
          type: "string",
          description: "Optionnel : nom ou identifiant de l'expert pour détailler ses compétences métiers.",
        },
      },
    },
  },
  {
    name: "trouver_une_commande",
    description:
      "Trouve la commande d'Expert qui répond à un besoin (« comment je fais pour préparer un devis ? ») : quel Expert, le nom de la commande en mots, ce qu'elle fait, un exemple et ce qu'il faut préciser. Sans besoin, liste les commandes de chaque Expert. À utiliser avant de citer une commande : n'en citer aucune autre.",
    inputSchema: {
      type: "object",
      properties: {
        besoin: { type: "string", description: "Ce que l'utilisateur veut faire, en ses mots (ex: 'relancer un client', 'faire un devis')." },
        expert: { type: "string", description: "Optionnel : limiter à un Expert (nom ou identifiant de profil)." },
      },
    },
  },
  {
    name: "diagnostiquer_configuration",
    description:
      "Diagnostique la configuration générale de l'instance Hermes en toute sécurité (clés d'API et secrets automatiquement masqués). Vérifie les passerelles actives, les modèles configurés et la mémoire.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
] as const;
