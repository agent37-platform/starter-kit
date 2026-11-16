# Plan : l'onglet « E-mails » des experts, servi par le back-office

> Pendant, côté app, du plan maître `~/yelema-platform/docs/plans/agentmail-separation-migration.md`
> (2026-10-10). Le plan maître fait foi pour les décisions, le contrat et l'ordre des lots ; ce
> fichier ne décrit que ce qui change dans ce dépôt.
> Branche : `feat/agentmail-app`, partie de `feat/experts-profils`.
> **STATUS : approuvé le 2026-10-10 ; codé et testé sur `feat/agentmail-app` (`typecheck`, 16 tests,
> `build`), non commité. Jamais essayé contre un back-office réel : voir § 7.**

## 1. Objectif

Reprendre de la branche `feat/agentMail` (Christelle Ebou) l'écran de messagerie d'un expert, sans
rien de ce qui parlait à AgentMail : le back-office détient la clé, crée les boîtes, contrôle
chaque envoi et sert la lecture. L'app affiche et relaie.

`feat/agentMail` n'est pas fusionnée : elle part de `main`, et 21 des 45 fichiers qu'elle touche
n'existent plus sur `feat/experts-profils`.

## 2. Ce qui est décidé (plan maître, § 2)

> **Remplacé pour le modèle des boîtes** par `docs/plans/agentmail-opt-in-backoffice.md` : une boîte par
> instance (donc par membre) et par expert, créée et supprimée à la demande du membre. Ce qui suit sur
> la boîte commune ne s'applique plus.

- Une boîte **par client et par expert** (`djeneba.acme@agentmail.to`), commune aux membres qui ont
  cet expert.
- Trois réglages par boîte, indépendants : **l'expert est autorisé à envoyer** (faux au départ),
  une **restriction facultative à certains membres** (vide = tout membre qui a l'expert), et
  **l'envoi hors de l'entreprise**. Ils sont tenus par le staff de Yelema et par **l'administrateur
  du client, depuis cette app**.
- Le staff de Yelema ne lit aucun message : la lecture n'existe que par la session d'un membre.
- L'expert envoie par une commande qui appelle **directement le back-office** : aucune route de
  cette app n'est sur son chemin, aucune clé AgentMail n'entre dans ce dépôt ni dans Vercel.

## 3. Contrat avec le back-office

Toutes les routes sont sous `{BACKOFFICE_URL}/api/v1`, avec la session de l'utilisateur en
`Authorization: Bearer` et `X-Workspace-Id`, comme le reste de `src/lib/backoffice.ts`.

| Route | Qui | Rend |
|---|---|---|
| `GET /app/mail/inboxes` | Tout membre | `[{ expert, address, sendEnabled, canSend, canRead, externalAllowed }]` |
| `GET /app/mail/inboxes/{expert}/messages?page=` | `canRead` | 25 messages par page |
| `GET /app/mail/inboxes/{expert}/messages/{id}` | `canRead` | Texte, HTML tel quel, pièces jointes (noms, tailles) |
| `GET …/messages/{id}/attachments/{att}` | `canRead` | Le fichier, en flux |
| `POST /app/mail/inboxes/{expert}/messages` | `canSend` | `{ messageId, threadId, from }` |
| `POST …/messages/{id}/reply` | `canSend` | Idem |
| `GET /app/mail/rights` | Administrateur | Toutes les boîtes du client : `[{ expert, address, status, sendEnabled, senders, externalAllowed, eligible }]` |
| `PUT /app/mail/rights/{expert}` | Administrateur | `{ sendEnabled?, senders?, externalAllowed? }` ; rend la boîte à jour |

Les identifiants de message et de pièce jointe sont opaques (`[A-Za-z0-9_-]`) : ils se mettent tels
quels dans une URL.

Réponses à traiter : `403 { error: { code, message } }` est un refus du contrôle, dont le `message`
s'affiche tel quel ; `404` veut dire module coupé ou boîte invisible pour ce membre, et l'onglet ne
s'affiche pas ; `429` est le plafond du jour ; `500` une panne du fournisseur.

## 4. Fichiers

```
src/lib/mail.ts (+test)                  ← types ; garde des chemins ; destinataires ; document isolé d'un e-mail reçu
src/lib/backoffice.ts                    ← mailInboxes, mailMessages, mailMessage, mailSend, mailReply, mailAttachment, mailRights, setMailRights
src/app/api/mail/_session.ts             ← la session du membre, relayée
src/app/api/mail/inboxes/route.ts
src/app/api/mail/[expert]/messages/route.ts
src/app/api/mail/[expert]/messages/[id]/route.ts
src/app/api/mail/[expert]/messages/[id]/reply/route.ts
src/app/api/mail/[expert]/messages/[id]/attachments/[att]/route.ts
src/app/api/mail/rights/route.ts, rights/[expert]/route.ts
src/lib/expert-tabs.ts                   ← `emails` dans AGENT_TAB_IDS
src/components/AgentWorkspace.tsx        ← l'onglet, si une boîte lisible existe pour cet expert
src/components/experts/useMailInboxes.ts
src/components/experts/ExpertEmails.tsx  ← portage de l'écran de Christelle
src/app/(app)/administration/emails/page.tsx
src/components/integrations/MailRightsView.tsx
src/app/(app)/administration/layout.tsx  ← entrée « E-mails »
```

Non repris : `src/lib/agentmail.ts`, `src/app/api/webhooks/agentmail`, `scripts/agentmail.mjs`,
les paquets `agentmail` et `@x402/fetch`, `serverExternalPackages`, `AGENTMAIL_API_KEY`, la carte
« Connecté (AgentMail) » de l'onglet Canaux, la fiche de poste, l'onglet MCP, le bouton Drive.

## 5. Points d'attention

- **HTML d'un mail reçu** : affiché dans une `iframe` avec `sandbox` (ni `allow-scripts` ni
  `allow-same-origin`) et `srcDoc`. Jamais de `dangerouslySetInnerHTML` : sur la branche d'origine,
  n'importe quel expéditeur pouvait exécuter du script dans la session de l'utilisateur.
- **Les routes de l'app sont des relais minces** : elles lisent la session, valident la forme de
  `expert` et de `id` avant de les mettre dans une URL (comme `EXPERT_KEY` et `INVOICE_ID`), et
  rendent la réponse du back-office. Aucune règle d'accès n'est rejouée ici.
- **Pièces jointes** : 2,8 Mo au total à l'écran, soit moins de 4 Mo une fois en base64 (limite de
  requête de Vercel), refusé avant l'envoi.
- **Administration › E-mails** : réservée aux administrateurs (comme Facturation) ; une ligne par
  boîte, « cet expert peut envoyer », les membres du client à cocher (aucun coché = tous ceux qui
  ont l'expert), et « envoi hors de l'entreprise ».
- **Aucune variable d'environnement nouvelle. Aucune dépendance nouvelle. Aucune migration.**

## 6. Ordre

Ce dépôt n'intervient qu'aux lots 3 et 4 du plan maître, après le back-office :

| Lot | Ici |
|---|---|
| 3 | `backoffice.ts`, relais, onglet « E-mails », page Administration › E-mails |
| 4 | Affichage du motif d'un refus venu du rôle ; rien d'autre ne change |

## 7. Vérifications

Fait : `npm run typecheck`, `npm test` (16 sur 16), `npm run build`.

**Non fait, à faire en recette** contre un back-office qui a la messagerie activée, dans le navigateur : un mail contenant `<script>`
et `<img onerror>` ne s'exécute pas ; un membre sans droit ne voit pas l'onglet ; un refus s'affiche
avec la phrase du back-office ; l'administrateur autorise un membre et celui-ci envoie.
