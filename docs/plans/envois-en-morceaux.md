# Envois de plus de 4 Mo, en morceaux (20/11/26)

Leslie, 20/11 : « sur web, même sur app, on n'arrive pas à télécharger des documents de plus de 4 Mo ».
Vercel refuse tout corps de requête au-delà de 4,5 Mo avant qu'une route le voie. Option retenue (Leslie, A) :
le navigateur et le téléphone découpent le fichier en morceaux de **3 Mo**, jusqu'à **25 Mo** ; le back office
garde les morceaux et les recolle. Un fichier de 4 Mo ou moins passe comme avant, sans rien changer.

## Côté app (fait, cette demande de fusion)

- `src/lib/upload-parts.ts` : les étapes (début, morceaux, fin), un morceau coupé par le réseau est renvoyé deux fois.
- Routes, toutes de simples relais avec la session du membre (ou le jeton du téléphone, `bearer-access.ts`) :
  - `POST /api/uploads` `{ name, type, size, parts }` → `{ id }` (refuse plus de 25 Mo : 413) ;
  - `POST /api/uploads/{id}/parts/{n}` octets bruts, 3 Mo au plus (413 au-delà) ;
  - `POST /api/uploads/{id}/complete` `{ to }` ;
  - `DELETE /api/uploads/{id}` (envoi arrêté ou raté).
- `to` dit où va le fichier :
  - `{ kind: "chat", agentId }` et `{ kind: "drive", agentId, path, overwrite }` : l'app lit le fichier recollé et
    l'écrit elle-même sur l'instance (mêmes contrôles qu'un petit fichier : `requireAgentAccess`, `assertInDrive`),
    puis demande au back office de jeter sa copie ;
  - `{ kind: "memory", title, unit }` et `{ kind: "memory-version", item }` : le back office range le document
    dans la mémoire d'entreprise lui-même.
- Tant que le back office répond 404 sur `/app/uploads`, l'app dit « Ce fichier dépasse 4 Mo », comme avant.

## Côté back office (à faire, Sélim)

| Appel | Corps | Réponse |
|---|---|---|
| `POST /api/v1/app/uploads` | JSON `{ name, type, size, parts }` | `201 { id }` |
| `PUT /api/v1/app/uploads/{id}/parts/{n}` | octets bruts, ≤ 3 Mo, `n` de 0 à `parts - 1` | `200 { ok: true }` (renvoyer le même `n` remplace) |
| `GET /api/v1/app/uploads/{id}/file` | | le fichier recollé, `Content-Type` = `type`, `Content-Disposition: attachment; filename*=UTF-8''<name>` ; `409` s'il manque un morceau |
| `POST /api/v1/app/uploads/{id}/memory` | `{ title, unit }` ou `{ item }` | comme `POST /app/memory/items` (`{ id }`) ou `…/versions` (`{ id, version }`) |
| `DELETE /api/v1/app/uploads/{id}` | | `200 { ok: true }` |

- Un envoi appartient au membre qui l'a commencé : tout autre membre reçoit 404.
- Refuser `size` > 25 Mo, un morceau > 3 Mo, `n` hors bornes, et un total recollé différent de `size`.
- Pour la mémoire, les mêmes contrôles qu'un dépôt d'aujourd'hui (droit de déposer dans `unit`, vrai type du fichier).
- Jeter les morceaux d'un envoi non terminé au bout d'une heure.
- Les routes de l'app attendent au plus 120 s par morceau et 300 s pour la fin.

Essai local (20/11) : un PDF de 20 Mo joint au chat passe en 7 morceaux (6 × 3 Mo + 2 Mo) par les vraies routes
de l'app vers un faux back office ; le même déposé au Contexte va jusqu'au bout (`complete` 200) ; 26 Mo et un
morceau de 3 Mo + 1 octet sont refusés (413).
