# Analytics

Page `Paramètres · Personnel · Analytics` (`/parametres/analytics`). Chaque membre y voit la consommation de
sa propre instance et de ses experts.

## Accès

- Route : `GET /api/agents/{id}/analytics`.
- `requireAgentAccess(id)` : seul le propriétaire de l'instance obtient une réponse. Tout autre appel
  reçoit `404`, avant toute lecture et avant le cache.

## Paramètres de la requête

| Paramètre | Valeurs | Défaut |
|---|---|---|
| `period` | `aujourdhui`, `7_jours`, `30_jours`, `90_jours` | `30_jours` |
| `granularity` | `jour`, `semaine` (du lundi), `mois` | `jour` |
| `experts` | identifiants de profil, séparés par des virgules | aucun |
| `channels` | sources de session (`agent37-gateway`, `telegram`…) | aucun |
| `models` | identifiants de modèle | aucun |
| `routines` | clés `profil/idRoutine` | aucun |

- Valeurs inconnues : remplacées par le défaut.
- Filtres : 50 valeurs au plus, 200 caractères au plus chacune, sans caractère de contrôle ni virgule
  (`src/lib/analytics/query.ts`).
- `aujourdhui` est toujours découpé par heure ; `granularity` ne s'applique qu'aux périodes en jours.
- Toutes les heures et tous les jours sont en UTC.

## Sources lues

Lues en parallèle par la route, chacune en 45 s au plus (`READ_DEADLINE_MS`, sous `maxDuration` = 60 s).
Une source en échec ou hors délai vaut `null`.

| Source | Lecteur | Contenu |
|---|---|---|
| Sessions | `src/lib/yele-mcp/session-usage/` | `state.db` de chaque profil, en lecture seule |
| Configuration | `src/lib/yele-mcp/instance-setup.ts` | routines et serveurs MCP par profil |
| Experts | `src/lib/yele-mcp/discover-experts.ts` | nom et description de chaque `SOUL.md` |
| Livrables | `src/lib/yele-mcp/deliverables.ts` | fichiers de `~/Livrables` |
| Canaux | `listPlatforms` (`src/lib/hermes-messaging.ts`) | canaux activés ou configurés, et leur état |
| Connecteurs | `listConnections` (`src/lib/composio.ts`) | comptes Composio du propriétaire |
| Libellés des modèles | back-office, `llmModels` | nom lisible de chaque identifiant de modèle |
| Titres des experts | catalogue du back-office | titre court, sinon rôle |

### Lecteur des sessions

- Par profil, depuis les tables `sessions`, `session_model_usage` et `messages`.
- Lignes de consommation par créneau, profil, canal, modèle et routine :
  - créneau : heure UTC sur les 2 derniers jours (`HOURLY_DAYS`), jour UTC avant ;
  - profondeur : 92 jours (`KEEP_DAYS`).
- Tokens : entrée + sortie + cache lu + cache écrit, répartis par modèle selon `session_model_usage`.
- Sessions, messages et durée : comptés sur le modèle principal de la session.
- Invocations d'outils, de compétences (`skill_view`) et d'actions Composio : même créneau, avec les
  dimensions de la session appelante.
- Un profil illisible n'ajoute rien et figure dans `unreadable`.
- Aucun coût n'est lu.

### Transport

`src/lib/yele-mcp/python-reader.ts` :

- Paramètres : passés en JSON base64.
- Résultat : compressé.
- Au-delà de 384 Ko : lu par morceaux depuis un fichier temporaire de l'instance (`mkstemp`, `0600`),
  avec contrôle SHA-256, puis supprimé.
- Limites : 64 Mo compressés, 256 Mo décompressés.

## Cache

- Une lecture par instance est gardée 60 s. Elle est servie périmée jusqu'à 15 min pendant sa relecture,
  ou en cas de panne.
- Une lecture dont les sessions ont échoué n'est jamais gardée.
- Navigateur : une réponse par requête (période, regroupement, filtres) est gardée 60 s ; plus ancienne,
  elle est affichée pendant qu'une nouvelle est demandée.

## Calcul

`computeAnalytics` (`src/lib/analytics/compute.ts`) :

1. Fenêtre de la période et tranches de la courbe (`period.ts`).
2. Lignes de la période, puis lignes qui passent les filtres (`filters.ts`). Chaque ligne porte profil,
   canal, modèle et routine : un filtre s'applique aux totaux, à la courbe et à tous les onglets.
3. Une ligne sans consommation (canal connecté, routine active) ne passe un filtre que si elle porte la
   dimension filtrée (`matchesKnownDims`).
4. Totaux (`totals.ts`), experts (`experts.ts`), points de la courbe (`timeline.ts`).
5. Onglets et découpage de la courbe (`dimensions.ts`, un fichier par onglet dans `dimensions/`,
   `breakdown.ts`).
6. Valeurs proposées par la boîte Filtres : calculées sans filtre.

Le profil principal et Yélé (`NOT_EXPERTS`) gardent leurs lignes de consommation mais ne comptent ni
dans les experts actifs, ni comme Top expert, ni sur la ligne « Experts actifs ».

## Écran

### En-tête

- Période, « N experts actifs sur M » (si les sessions sont lues), « Illisible : … » (profils dont les
  sessions sont illisibles).
- Sélecteurs de période et de regroupement, Filtres, « Demander à Yélé ».
- Filtres actifs en puces.

### Cartes

| Carte | Valeur | Détail |
|---|---|---|
| Consommation de la période | tokens | — |
| Messages | messages | tokens par message |
| Top expert | expert qui a consommé le plus de tokens | part de la consommation |

### Courbe

- Barres empilées selon l'onglet ouvert : 10 séries au plus, « Autres » compris.
- Ligne « Experts actifs » sur une échelle à droite.
- Tranche en cours marquée « En cours ».
- Vue « Cumulée » : total cumulé de la période.
- Dessinée à la largeur de son cadre, sans défilement horizontal.

### Onglets

| Onglet | Lignes | Consommation (%) | Volume | Nombre |
|---|---|---|---|---|
| Experts | experts de l'annuaire et profils ayant consommé ; titre de l'expert sous son nom | tokens | Tokens | Messages |
| Canaux | canaux d'accès (`ACCESS_CHANNELS`) ayant servi, et canaux connectés sans activité | tokens | Tokens | Messages |
| Routines | routines exécutées, et routines actives sans exécution ; expert, horaire, « En pause » ou « Supprimée » | tokens | Tokens | Exécutions |
| Modèles | modèles, sous leur libellé du back-office | tokens | Tokens | Messages |
| Compétences | compétences invoquées ; noms affichés pareil regroupés | invocations | — | Invocations |
| MCP | serveurs MCP invoqués, hors outils Composio | invocations | — | Invocations |
| Connecteurs | services Composio invoqués, logo, état des comptes | invocations | — | Invocations |
| Livrables | fichiers modifiés sur la période, par format | fichiers | Taille | Fichiers |

- Recherche, tri par colonne, bouton filtre sur les lignes Experts, Canaux, Routines et Modèles.
- Livrables est masqué quand un filtre est actif.
- Colonnes de largeur fixe : le texte passe à la ligne, jamais de défilement horizontal. Sur téléphone,
  la colonne Consommation est masquée.
- Couleur d'un expert : celle de sa série dans la courbe ; gris s'il est regroupé dans « Autres ».

### États

| Situation | Affichage |
|---|---|
| Sessions illisibles | cartes « Consommation illisible », courbe « Consommation illisible », onglets « Illisible » |
| Aucune ligne | « Aucune activité » |
| Recherche sans résultat | « Aucun résultat pour « … » » |
| Profil illisible | son nom dans l'en-tête, après « Illisible : » |

### Export

- « Télécharger les données » : CSV de l'onglet ouvert, recherche et filtres appliqués, en-têtes du
  tableau.
- Taille en octets.
- Une cellule qui commencerait une formule est préfixée par `'`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/app/api/agents/[id]/analytics/route.ts` | accès, lecture des sources, cache, calcul |
| `src/lib/analytics/` | calcul : `compute.ts`, `period.ts`, `filters.ts`, `query.ts`, `totals.ts`, `timeline.ts`, `experts.ts`, `deliverables.ts`, `dimensions.ts`, `dimensions/`, `breakdown.ts`, `chart.ts`, `names.ts`, `csv.ts`, `format.ts`, `types.ts` |
| `src/lib/yele-mcp/` | lecteurs de l'instance, partagés avec Yélé |
| `src/components/settings/analytics/` | écran : `AnalyticsDashboard.tsx`, `KpiCards.tsx`, `ConsumptionChart.tsx`, `DimensionsTable.tsx`, `FiltersDialog.tsx`, `PeriodPicker.tsx`, `DimensionIcon.tsx`, `colors.ts`, `useAnalytics.ts` |
| `src/app/globals.css` | couleurs `--chart-1` à `--chart-10` |

## Tests

```bash
npm test          # dont src/lib/analytics/*.test.ts et src/lib/yele-mcp/**/*.test.ts
npm run typecheck
```
