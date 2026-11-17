# MoneyPrinterTurbo (mode CLI) — Intégration Back-Office & Image Instance

La vidéo est générée sur l'instance, par l'expert, en ligne de commande. L'app n'appelle pas
MoneyPrinterTurbo : elle n'a ni route ni clé pour lui, et lit la vidéo produite comme tout fichier du drive.

## 1. Fichier à copier dans l'image Docker

- **Source (`agent37-yelema-version`)** : `scripts/generer-video.py`
- **Destination dans l'image de l'instance (dépôt `Yelema-ai/yelema-hermes`)** : `/home/node/.yelema/bin/generer-video.py` (`chmod +x`).
  `scripts/build-image.sh` construit l'image de l'app, pas celle de l'instance : il ne copie pas ce script.

## 2. Pré-requis dans l'image de l'instance

1. Dépôt `MoneyPrinterTurbo` cloné dans `/home/node/MoneyPrinterTurbo` (contenant `cli.py` et `config.example.toml`).
2. Environnement Python 3.11 prêt via `uv` (`uv run --python 3.11 python cli.py`) ou `.venv/bin/python` dans le dossier du dépôt.
3. Police de sous-titres `BeVietnamPro-Bold.ttf` présente dans `resource/fonts/` (ou définie via `MONEYPRINTER_FONT_NAME`).

## 3. Variables d'environnement de l'instance

- `PEXELS_API_KEY` : clé API Pexels écrite par le script dans `pexels_api_keys` de `config.toml` à chaque exécution (une clé changée remplace l'ancienne).
- `PIXABAY_API_KEY` *(optionnel)* : clé API Pixabay écrite de même dans `pixabay_api_keys`.
- `MONEYPRINTER_DIR` *(optionnel)* : surcharge le chemin du dépôt (`~/MoneyPrinterTurbo`, `/home/node/MoneyPrinterTurbo`, `/opt/MoneyPrinterTurbo`).
- `LIVRABLES_DIR` *(optionnel)* : surcharge le dossier racine de sortie (`~/Livrables`).
- `MONEYPRINTER_DEFAULT_VOICE` *(optionnel)* : voix TTS par défaut (`fr-FR-VivienneMultilingualNeural`).
- `MONEYPRINTER_FONT_NAME` *(optionnel)* : police de sous-titres par défaut (`BeVietnamPro-Bold.ttf`).

## 4. Fonctionnement de `scripts/generer-video.py`

1. Trouve le dossier de l'expert dans les livrables. Noms possibles, dans l'ordre : `--expert`, `EXPERT_NAME`, `EXPERT`, `AGENT_NAME`, `HERMES_AGENT_NAME`, le `name:` du
   `SOUL.md` du dossier courant, la clé du profil Hermes (`HERMES_PROFILE`, `PROFILE` ou le chemin
   `~/.hermes/profiles/<profil>`, partie après `__`). Un dossier existant de `~/Livrables` dont le nom
   correspond (accents et casse ignorés, nom complet ou prénom) est pris tel quel ; sinon le premier nom
   possible, tel qu'écrit. Sans nom possible, ou avec un nom contenant `/` ou `..`, le script s'arrête.
2. Exécute directement `cli.py` en sous-processus avec timeout strict (`--delai` / `--timeout-attente`, 300 s par défaut) :
   - `--echantillon` : génère un extrait vocal `.mp3` (`--stop-at audio`).
   - Rendu vidéo : génère un `.mp4` avec sous-titres mot à mot (`--subtitle-enabled --subtitle-display-mode word_by_word --stop-at video`).
3. Copie le fichier généré vers `<LIVRABLES_DIR>/<Expert>/<Sujet>/<AAMMJJ>_<slug>.mp4` (ou `_echantillon_<slug>.mp3`) :
   un livrable par sujet, comme le reste du drive. `--sortie` est refusé hors de `LIVRABLES_DIR`.
   Au-delà du délai, le processus est arrêté et attendu ; la progression sans fin de ligne (tqdm) ne bloque pas la lecture.
4. Supprime le dossier temporaire `storage/tasks/<task_id>` après la copie.
5. Émet une ligne `RESULT_JSON:{...}` sur `stdout` avec `ok`, `sample`, `taskId`, `file`, `filename`, `sizeMb`, `mode: "cli"`.

## 5. Streaming vidéo côté App (`agent37-yelema-version`)

- `src/app/api/agents/[id]/files/content/route.ts` transmet l'en-tête `Range` à l'instance et renvoie son statut (200, 206, 416) avec ses `Content-Range` et `Accept-Ranges`, pour la lecture vidéo HTML5.

