# Contexte : documents au-delà de 4 Mo et autres formats (Leslie, 19/11, point 22)

Aujourd'hui un document du Contexte passe par l'app (`POST /api/memory/items`, multipart) : l'hébergeur
refuse tout corps de plus de 4,5 Mo avant qu'une route le voie, et le back office n'accepte que PDF et texte.
Leslie veut des documents de plus de 40 Mo, et d'autres formats : images, vidéos, Excel, Word, PowerPoint.

## Ce que l'app fait déjà (branche design/carte-envoi-1911)

Un fichier de plus de 4 Mo ne passe plus par l'app :

1. `POST /api/v1/app/memory/uploads` `{ name, size, type, unit }` (jeton du membre)
   → `200 { upload, url, headers? }` : `url` est une adresse d'envoi signée et courte
   (par exemple `createSignedUploadUrl` de Supabase Storage), `upload` l'identifiant de cet envoi.
   Le back office vérifie ici le droit de déposer dans `unit`, la taille et le type annoncés.
2. Le navigateur envoie le fichier lui-même : `PUT url` (corps = le fichier, `content-type` du fichier, plus `headers`).
3. `POST /api/v1/app/memory/items` `{ title, upload, unit }` : le dépôt nomme l'envoi ; le back office relit
   le fichier stocké (vrai type, vraie taille) et crée le document comme aujourd'hui.

Tant que la route 1 répond 404, l'app garde le message actuel (« dépasse 4 Mo »).

## Ce qu'il faut côté back office

- La route 1 et `upload` dans la route 3.
- Formats acceptés : PDF, Word (docx, doc), Excel (xlsx, xls, csv), PowerPoint (pptx), images (png, jpg, webp),
  vidéos (mp4, mov), audio (mp3, m4a, wav), texte (txt, md). Taille : 200 Mo au plus par fichier (à fixer).
- Ce que l'Expert en lit : texte extrait pour les documents, description ou transcription pour images,
  audio et vidéo (sinon le fichier est rangé mais l'Expert ne le comprend pas).
- La même voie pour une nouvelle version (`/versions`).
