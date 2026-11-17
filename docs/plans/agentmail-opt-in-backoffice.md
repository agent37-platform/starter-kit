# AgentMail à la demande (opt-in par expert et par instance) — Intégration Back-Office

## 1. Modèle de données & Nomenclature

1. **Rattachement par instance / utilisateur** :
   - Chaque boîte est identifiée par `(tenantApp, ownerMember, expertKey)` (ou `(tenantApp, agentId, expertKey)`).
   - Chaque membre du workspace gère uniquement les boîtes attribuées aux experts de son instance (`agentId`).
2. **Nomenclature des adresses e-mail** :
   - Format : `{expert}.{initiales}.{entreprise}@agentmail.to`
     - `{expert}` : `displayName` nettoyé (ou `expertKey` en fallback).
     - `{initiales}` : initiales en minuscules ASCII du nom et prénom de l'utilisateur (ex. `"Christy B."` -> `cb`, `"Paul Kouassi"` -> `pk`), ou les 2 premières lettres alphanumériques en cas de mot unique / e-mail. Elles distinguent, dans un même workspace, les experts de même nom de plusieurs utilisateurs (même règle que `userInitials()` de l'app).
     - `{entreprise}` : `subdomain` nettoyé du workspace.
   - Collision : fallback automatique `{expert}.{initiales}2.{entreprise}` jusqu'à `5` (puis suffixe court alphanumérique).

## 2. Contrat HTTP attendu par l'app (`agent37-yelema-version`)

### `GET /api/v1/app/mail/inboxes?agentId=<id>`

- Retourne `200` avec `{ "items": MailInbox[] }` filtré sur le membre appelant et son `agentId` (liste vide `[]` lorsque le module est actif et qu'aucune boîte n'a encore été attribuée).
- Retourne `404` lorsque le module AgentMail est désactivé.

### `POST /api/v1/app/mail/inboxes`

Crée la boîte AgentMail d'un expert à la demande de l'utilisateur.

- **En-têtes** : `Authorization: Bearer <token>`, `X-Workspace-Id: <id>`.
- **Corps JSON** :
  ```json
  {
    "expert": "koffi",
    "agentId": "inst-1",
    "displayName": "Amina"
  }
  ```
  - `expert` *(obligatoire)* : `/^[a-z0-9][a-z0-9_-]{0,63}$/`
  - `agentId` : `/^[A-Za-z0-9_-]{1,128}$/`. L'app l'envoie toujours, après avoir vérifié que l'instance est celle du membre connecté (`requireAgentAccess`) ; le back-office le vérifie de nouveau.
  - `displayName` *(optionnel)* : nettoyé (caractères autorisés `/[^\p{L}\p{N} .'-]/gu`, max 60 caractères).
- **Traitement back-office** :
  1. Vérifier que le module AgentMail est actif, que le membre appartient au workspace et possède cette instance (`agentId`) avec cet expert.
  2. Si une boîte active existe déjà pour `(space.id, ownerMember/agentId, expertKey)`, la retourner en `200` (ou `409`).
  3. Créer la boîte sur AgentMail (`POST /pods/{pod_id}/inboxes`) avec `username` au format `{expert}.{initiales}.{entreprise}`, `display_name`, et `client_id = tenant-${space.tenantId}.${agentId ?? memberId}.${expertKey}`.
  4. Enregistrer la ligne dans `mail-inboxes` et retourner `201` avec l'objet `MailInbox` :
     ```json
     {
       "expert": "koffi",
       "agentId": "inst-1",
       "address": "amina.pk.acme@agentmail.to",
       "sendEnabled": true,
       "canSend": true,
       "externalAllowed": false
     }
     ```

### `DELETE /api/v1/app/mail/inboxes/{expert}?agentId=<id>`

Supprime définitivement la boîte AgentMail d'un expert.

- **En-têtes** : `Authorization: Bearer <token>`, `X-Workspace-Id: <id>`.
- **Traitement back-office** :
  1. Vérifier que le module AgentMail est actif et que le membre possède cette instance/boîte.
  2. Appeler `DELETE /v0/inboxes/{inbox_id}` chez AgentMail puis supprimer ou marquer `retired` la ligne dans `mail-inboxes`.
  3. Retourner `200` avec `{ "deleted": true }`.

### Messages, envoi, réponse, pièces jointes, droits

- Les routes `/api/v1/app/mail/inboxes/{expert}/messages…` désignent la boîte **du membre appelant** pour cet
  expert : un membre n'a qu'une instance, donc au plus une boîte par expert. Le back-office la retrouve par
  `(tenantApp, ownerMember, expertKey)`.
- Envoi : l'app ne transmet que `to` (1 à 20 adresses vérifiées), `subject` (sans retour à la ligne, 998
  caractères au plus), `text` et `attachments` (`filename`, `contentType`, `content` en base64, 20 au plus).
  Réponse : `text` et `attachments` seulement.
- Droits (`/api/v1/app/mail/rights`) : réglages de l'entreprise par expert, réservés aux administrateurs ;
  ils s'appliquent à toutes les boîtes de cet expert.

### Exigences communes

- Un refus est une phrase en français écrite par le back-office : jamais le texte d'AgentMail, que l'app
  affiche tel quel au membre.
- À la création et à la suppression, le back-office met à jour `~/.yelema/mail.json` (`addresses`, par
  identifiant de profil) sur l'instance concernée : Yélé y lit les adresses des experts.

## 3. Fichiers à adapter dans `yelema-platform`

1. `apps/control-plane/src/modules/connectors/collections/MailInboxes.ts` : ajouter `ownerMember` / `agentId` et indexer sur `['tenantApp', 'ownerMember', 'expertKey']` (ou `agentId`).
2. `apps/control-plane/src/modules/connectors/lib/mailAddress.ts` : ajouter `userInitials()` et générer `{expert}.{initiales}.{entreprise}` dans `inboxUsernames()`.
3. `apps/control-plane/src/modules/connectors/lib/mailInboxes.ts` : remplacer le provisionnement automatique de `reconcileInboxes()` par `provisionInboxOnDemand()` et `deleteInboxOnDemand()`.
4. `apps/control-plane/src/modules/app-api/mail.ts` et routes `/api/v1/app/mail/inboxes` : supporter `agentId` sur `GET` et exposer `POST` et `DELETE`.

## 4. Fichiers implémentés dans `agent37-yelema-version`

- `src/lib/mail.ts` & `src/lib/mail.test.ts` : types `MailInbox` / `CreateMailInboxInput`, `isMailAgentId()`, `userInitials()`, `sanitizeInboxDisplayName()`, `parseCreateMailInboxInput()`, `inboxOf()`, `parseMailDraft()`, `parseMailReply()`.
- `src/lib/backoffice.ts` : `mailInboxes(token, agentId)`, `createMailInbox(token, input)`, `deleteMailInbox(token, expert, agentId)`.
- `src/app/api/mail/inboxes/route.ts` : `GET`, `POST`, `DELETE`, l'instance exigée et vérifiée comme celle du membre (`requireAgentAccess`).
- `src/components/experts/useMailInboxes.ts` : état et cache par instance (`enabled`, `createInbox`, `deleteInbox`).
- `src/components/AgentWorkspace.tsx` : icône e-mail avec badge croix rouge et info-bulle au survol lorsque l'expert n'a pas d'adresse.
- `src/components/experts/ExpertEmails.tsx` : attribution précédée d'un avertissement : un nom modifié renomme d'abord l'expert, et l'adresse n'est créée que si ce renommage a réussi ; suppression avec confirmation.
