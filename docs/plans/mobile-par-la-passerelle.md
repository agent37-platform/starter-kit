# Contrat : l'app mobile lit son instance par le site

> Étape 7 du plan « back-office hors du chemin de l'utilisateur » (accord du responsable produit).
> Pendant côté mobile : branche `perf/donnees-par-la-passerelle` de `yelema-app-voix-mobile`.
> **STATUT : codé le 2026-11-05 sur `perf/ouverture-instantanee`, non poussé, non déployé.**

## 1. Ce qui change

Le téléphone lit la liste de ses livrables, leurs fichiers et le fil d'événements de son instance sur
l'app web du client (`https://<client>.app.yelema.ai`), qui relaie la passerelle d'exécution (arbre du
disque gardé là-bas, renouvelé par les fins de tour). Le back-office n'est plus sur ce chemin, sauf
pour les images d'aperçu, qu'il est seul à rendre (Gotenberg + `pdftoppm`).

## 2. Authentification : le jeton du back-office, sans cookie

- En-têtes : `Authorization: Bearer <jeton d'accès de l'app>` + `X-Workspace-Id: <espace>`.
- **Seulement** en `GET`/`HEAD` sur `/api/agents/<id>/deliverables`, `files/tree`, `files/content`,
  `files/thumb`, `events`, et pour le chat `chat/sessions`, `chat/sessions/<id>`, `chat/by-profile`,
  `chat/responses/<id>/stream` ; en `POST` seulement sur `chat/files` (pièce jointe vers « Pièces jointes »), `chat/responses`, `chat/responses/<id>/cancel`,
  `approval` et `steer` (`src/lib/bearer-access.ts`). Le téléphone lit et écrit ainsi les MÊMES
  conversations que le web (gardées sur l'instance) ; ni suppression, ni renommage, ni partage.
  Pour les salons : `GET /api/buzz` (adresse du relais, annuaire, salons) et `POST` sur
  `/api/buzz/devices` (la clé publique du téléphone, la privée ne quitte pas le téléphone),
  `/api/buzz/salons` (ouvrir un salon) et `/api/buzz/sent` (prévenir qu'on a écrit, jamais le texte).
  Les messages vont du téléphone au relais, signés par sa clé, comme le navigateur ; ni renommage,
  ni suppression de salon, ni invités depuis le téléphone. Ailleurs, ou avec un cookie
  de session présent, l'en-tête est ignoré : le cookie garde la main.
- Le proxy (`src/lib/supabase/middleware.ts`) vérifie le jeton contre le JWKS du projet Supabase
  (signature ES256, émetteur, audience, échéance) : expiré, falsifié ou JWKS injoignable ⇒ `401`.
  `X-Workspace-Id` différent du client de l'adresse ⇒ `404`, avant toute vérification.
- Le jeton devient alors la session de **cette seule requête** (jamais renouvelée ni posée en cookie)
  et descend le chemin du cookie : `requireAgentAccess` (le back-office dit l'instance de ce membre,
  l'identifiant demandé doit être le sien, sinon `404`), siège d'équipe ou d'entreprise compris. Un
  jeton ne lit donc que l'instance de son membre, exactement comme le cookie.
- Pas de CORS : seul le téléphone (natif) s'en sert ; l'aperçu web de l'app reste sur le back-office.

## 3. Routes

| Route | Réponse |
|---|---|
| `GET /api/agents/<id>/deliverables` | `{ items: Deliverable[] }`, **même forme et mêmes règles** que `GET /api/v1/app/deliverables` du back-office (mêmes `id`, `expertId`, `folder`, tri, filtres), sans `pages`. `503` si l'arbre est incomplet (un dossier non listé lirait comme des livrables disparus). `404` hors connexion par le back-office ou sans clé de lien. |
| `GET /api/agents/<id>/files/signed?p=&e=&s=` | Le fichier d'un lien signé, **sans session** : HMAC (clé dérivée d'`AGENT37_API_KEY`) sur client + instance + chemin + échéance, 15 min, chemin sous `Livrables/<Expert>/` sans segment caché ni `_…`. En-têtes comme le back-office (`inline`, `nosniff`, CSP `sandbox`). |
| `GET /api/agents/<id>/files/tree`, `files/content`, `files/thumb`, `events` | Inchangées, ouvertes au jeton (§ 2). |

Règles de forme reprises du back-office : `src/lib/deliverables-shape.ts` (miroir pur de
`modules/app-api/deliverables.ts`, mêmes cas de test).

## 4. Côté mobile (replis)

- L'adresse du site et l'instance viennent de `/me` (`workspace.host`, `instance.id`).
- Liste : le site ; à la première lecture le back-office est lu en même temps et répond seul si le
  site n'a pas encore répondu (jamais plus lent qu'avant). Route absente (`404`, site plus ancien) :
  back-office, site redemandé après 10 min. Refus ou panne : back-office.
- Aperçus : pris de la dernière liste du back-office par livrable et version, relue seulement pour un
  aperçu pas encore connu (10 min, 2 min pour une seule page, 1 min pour un fichier absent de sa réponse).
- Fil d'événements au premier plan hors appel : `files.changed`, `instance.changed`, `job.done`
  (`deliverables`) relisent la liste après 4 s de calme (15 s au plus), puis 12 s plus tard. Tant
  qu'il vit, plus de relecture minutée. `404`/`401` : arrêté jusqu'au prochain retour au premier plan.

## 5. Ce que le back-office peut cesser de servir (une fois site et mobile déployés)

- `GET /api/v1/app/deliverables/file` (les liens viennent du site) — à garder tant que des
  téléphones plus anciens sont en service.
- Les relectures de `GET /api/v1/app/deliverables` à chaque retour au premier plan / push : elle n'est
  plus lue que pour les aperçus (première ouverture, nouveau livrable, toutes les 10 min au plus).
- Il garde `GET /api/v1/app/deliverables/page` et le rendu des aperçus, jusqu'à ce que le site sache
  les rendre.
