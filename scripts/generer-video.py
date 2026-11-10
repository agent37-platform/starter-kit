#!/usr/bin/env python3
import argparse
import datetime
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple


def remove_accents(text: str) -> str:
    """Retire les accents pour normaliser un nom de dossier en ASCII."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def detect_expert() -> str:
    """Détecte dynamiquement le nom de l'expert actif depuis l'environnement ou le profil courant."""
    for var in ("EXPERT_NAME", "HERMES_PROFILE", "PROFILE", "EXPERT", "AGENT_NAME", "HERMES_AGENT_NAME"):
        val = os.environ.get(var)
        if val and val.strip():
            return remove_accents(val.strip()).capitalize()

    cwd = os.getcwd()
    curr = cwd
    for _ in range(4):
        soul = os.path.join(curr, "SOUL.md")
        if os.path.exists(soul):
            try:
                with open(soul, "r", encoding="utf-8") as f:
                    txt = f.read(600)
                    m = re.search(r"^name:\s*['\"]?([^'\"\r\n]+)", txt, re.MULTILINE)
                    if m and m.group(1).strip():
                        return remove_accents(m.group(1).strip()).capitalize()
            except Exception:
                pass
        parent = os.path.dirname(curr)
        if parent == curr:
            break
        curr = parent

    system_reserved = {
        "workspace", "default", "node", "home", "root", "scripts", "skills", "shared", "videos",
        getpass.getuser().lower(),
    }
    patterns = [
        r"/\.hermes/profiles/([^/]+)",
        r"/hermes-experts/([^/]+)",
        r"/agents/([^/]+)",
        r"/\.openclaw/workspace-([^/]+)",
        r"/Livrables/([^/]+)",
    ]
    for p in patterns:
        m = re.search(p, cwd)
        if m:
            val = m.group(1).lower()
            if val not in system_reserved and not val.startswith("."):
                return remove_accents(m.group(1)).capitalize()

    home = os.path.expanduser("~")
    for active_f in (os.path.join(home, ".hermes", "active_profile"), os.path.join(home, ".hermes", "profile")):
        if os.path.exists(active_f):
            try:
                with open(active_f, "r", encoding="utf-8") as f:
                    name = f.read().strip()
                    if name:
                        return remove_accents(name).capitalize()
            except Exception:
                pass

    return "Contenu"


def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text[:40] or "video"


def get_default_dest(expert: str, sujet: str, echantillon: bool = False) -> str:
    now = datetime.datetime.now()
    prefix = now.strftime("%y%m%d")
    slug = slugify(sujet)
    ext = "mp3" if echantillon else "mp4"
    tag = "echantillon_" if echantillon else ""
    filename = f"{prefix}_{tag}{slug}.{ext}"
    livrables_root = os.environ.get("LIVRABLES_DIR") or os.path.join(os.path.expanduser("~"), "Livrables")
    expert_dir = os.path.join(os.path.expanduser(livrables_root), expert)
    videos_dir = os.path.join(expert_dir, "Videos")
    os.makedirs(videos_dir, exist_ok=True)
    return os.path.join(videos_dir, filename)


def find_uv_binary() -> Optional[str]:
    """Cherche l'exécutable uv sur le système."""
    uv_bin = shutil.which("uv")
    if uv_bin:
        return uv_bin

    candidates = [
        os.path.expanduser("~/.local/bin/uv"),
        os.path.expanduser("~/.cargo/bin/uv"),
        "/usr/local/bin/uv",
        "/usr/bin/uv",
    ]
    for path in candidates:
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def find_local_mpt() -> Tuple[Optional[str], Optional[List[str]]]:
    """
    Détecte l'installation locale de MoneyPrinterTurbo et retourne:
    (mpt_dir, runner_cmd_prefix) ou (None, None).
    """
    candidates = [
        os.environ.get("MONEYPRINTER_DIR"),
        os.path.expanduser("~/MoneyPrinterTurbo"),
        "/home/node/MoneyPrinterTurbo",
        "/opt/MoneyPrinterTurbo",
    ]
    for d in candidates:
        if not d or not os.path.isdir(d):
            continue
        cli_py = os.path.join(d, "cli.py")
        if not os.path.isfile(cli_py):
            continue

        # 1. Priorité: uv avec Python 3.11 (recommandation officielle upstream)
        uv_bin = find_uv_binary()
        if uv_bin:
            return d, [uv_bin, "run", "--python", "3.11", "python", "cli.py"]

        # 2. Environnement virtuel .venv existant
        venv_py = os.path.join(d, ".venv", "bin", "python")
        if os.path.isfile(venv_py) and os.access(venv_py, os.X_OK):
            return d, [venv_py, "cli.py"]

        # 3. Python 3.11 direct
        py311 = shutil.which("python3.11") or os.path.expanduser("~/.local/bin/python3.11")
        if py311 and os.path.isfile(py311) and os.access(py311, os.X_OK):
            return d, [py311, "cli.py"]

    return None, None


def ensure_mpt_config(mpt_dir: str) -> None:
    """S'assure que config.toml existe et synchronise PEXELS_API_KEY / PIXABAY_API_KEY depuis l'environnement."""
    cfg_path = os.path.join(mpt_dir, "config.toml")
    example_path = os.path.join(mpt_dir, "config.example.toml")
    if not os.path.isfile(cfg_path) and os.path.isfile(example_path):
        shutil.copy2(example_path, cfg_path)

    if not os.path.isfile(cfg_path):
        return

    pexels_key = (os.environ.get("PEXELS_API_KEY") or "").strip()
    pixabay_key = (os.environ.get("PIXABAY_API_KEY") or "").strip()
    if not pexels_key and not pixabay_key:
        return

    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            content = f.read()
        updated = content
        if pexels_key and "pexels_api_keys = []" in updated:
            updated = updated.replace("pexels_api_keys = []", f'pexels_api_keys = ["{pexels_key}"]', 1)
        if pixabay_key and "pixabay_api_keys = []" in updated:
            updated = updated.replace("pixabay_api_keys = []", f'pixabay_api_keys = ["{pixabay_key}"]', 1)
        if updated != content:
            with open(cfg_path, "w", encoding="utf-8") as f:
                f.write(updated)
    except Exception:
        pass


def run_cli_generation(
    mpt_dir: str,
    runner_prefix: List[str],
    sujet: str,
    script: str,
    aspect: str,
    voix: str,
    dest_path: str,
    expert: str,
    source: str = "pexels",
    materiaux: str = "",
    termes: str = "",
    echantillon: bool = False,
    timeout_sec: int = 300,
) -> Dict[str, Any]:
    """Exécute la génération vidéo (ou échantillon vocal) via le mode CLI autonome (cli.py)."""
    ensure_mpt_config(mpt_dir)
    action_label = "Échantillon vocal" if echantillon else "Vidéo complète"
    print(f"🎬 [MoneyPrinterTurbo CLI] Démarrage du pipeline ({action_label})...")
    print(f"   Dépôt MPT : {mpt_dir}")
    print(f"   Sujet     : '{sujet}'")
    print(f"   Format    : {aspect} | Voix : {voix} | Source : {source} | Expert : {expert}")

    cmd = list(runner_prefix)
    cmd.extend(["--video-subject", sujet])
    if script:
        cmd.extend(["--video-script", script])
    if termes:
        cmd.extend(["--video-terms", termes])
    cmd.extend(["--video-aspect", aspect])
    cmd.extend(["--voice-name", voix])
    cmd.extend(["--video-source", source])
    if materiaux:
        cmd.extend(["--video-materials", materiaux])
    if echantillon:
        cmd.extend(["--bgm-type", "none"])
        cmd.extend(["--stop-at", "audio"])
    else:
        cmd.extend(["--bgm-type", "none"])
        cmd.extend(["--subtitle-enabled"])
        cmd.extend(["--subtitle-display-mode", "word_by_word"])
        font_name = os.environ.get("MONEYPRINTER_FONT_NAME") or "BeVietnamPro-Bold.ttf"
        if os.path.isfile(os.path.join(mpt_dir, "resource", "fonts", font_name)):
            cmd.extend(["--font-name", font_name])
        cmd.extend(["--stop-at", "video"])

    start_time = time.time()
    proc = subprocess.Popen(
        cmd,
        cwd=mpt_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    stdout_lines: List[str] = []

    # Lecture asynchrone / non bloquante des flux
    import select
    while proc.poll() is None:
        if time.time() - start_time > timeout_sec:
            proc.kill()
            raise TimeoutError(f"Délai d'attente dépassé ({timeout_sec}s) lors de la génération vidéo CLI.")

        rlist, _, _ = select.select([proc.stdout, proc.stderr], [], [], 0.5)
        for stream in rlist:
            line = stream.readline()
            if not line:
                continue
            if stream is proc.stdout:
                stdout_lines.append(line.strip())
            else:
                line_str = line.strip()
                if "generation activity:" in line_str or "combining video:" in line_str or "generating video:" in line_str or "azure_tts_v1" in line_str:
                    print(f"   [MPT] {line_str}")

    # Récupérer les lignes restantes
    rest_out, rest_err = proc.communicate()
    if rest_out:
        stdout_lines.extend(line.strip() for line in rest_out.splitlines() if line.strip())
    if rest_err:
        for err_line in rest_err.splitlines():
            line_str = err_line.strip()
            if "ERROR" in line_str or "Exception" in line_str or "Traceback" in line_str:
                print(f"   ⚠️ [MPT Log] {line_str}", file=sys.stderr)

    if proc.returncode != 0:
        raise RuntimeError(f"Échec de cli.py (code {proc.returncode}). Vérifiez les logs ci-dessus.")

    # Analyse du JSON émis sur stdout par cli.py
    parsed_json: Optional[Dict[str, Any]] = None
    for line in reversed(stdout_lines):
        if line.startswith("{") and line.endswith("}"):
            try:
                candidate = json.loads(line)
                if isinstance(candidate, dict) and ("task_id" in candidate or "result" in candidate):
                    parsed_json = candidate
                    break
            except Exception:
                continue

    if not parsed_json or "result" not in parsed_json:
        raise RuntimeError(f"cli.py n'a pas renvoyé le JSON de résultat attendu sur stdout : {stdout_lines[-3:] if stdout_lines else 'vide'}")

    res_data = parsed_json.get("result", {})
    task_id = parsed_json.get("task_id", "local_cli")

    if echantillon:
        audio_file = res_data.get("audio_file")
        if not audio_file or not isinstance(audio_file, str):
            raise RuntimeError(f"Aucun fichier audio trouvé dans le résultat cli.py : {res_data}")
        generated_path = audio_file if os.path.isabs(audio_file) else os.path.join(mpt_dir, audio_file)
    else:
        videos = res_data.get("videos") or []
        if not videos or not isinstance(videos, list):
            raise RuntimeError(f"Aucune vidéo trouvée dans le résultat cli.py : {res_data}")
        generated_path = videos[0] if os.path.isabs(videos[0]) else os.path.join(mpt_dir, videos[0])

    if not os.path.isfile(generated_path) or os.path.getsize(generated_path) == 0:
        raise FileNotFoundError(f"Le fichier produit est introuvable ou vide : {generated_path}")

    # Copie vers ~/Livrables/<expert>/Videos/
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    shutil.copy2(generated_path, dest_path)

    # Nettoyage du dossier temporaire de la tâche pour préserver l'espace disque du conteneur
    if task_id and task_id != "local_cli":
        task_storage_dir = os.path.join(mpt_dir, "storage", "tasks", str(task_id))
        if os.path.isdir(task_storage_dir):
            shutil.rmtree(task_storage_dir, ignore_errors=True)

    size_mb = os.path.getsize(dest_path) / (1024 * 1024)

    if echantillon:
        print(f"✅ Échantillon vocal enregistré dans vos Livrables !")
    else:
        print(f"✅ Vidéo enregistrée dans vos Livrables !")
    print(f"   Fichier : {dest_path} ({size_mb:.2f} Mo)")
    print(f"   Moteur  : CLI autonome MoneyPrinterTurbo")

    result = {
        "ok": True,
        "sample": echantillon,
        "taskId": task_id,
        "file": dest_path,
        "filename": os.path.basename(dest_path),
        "sizeMb": round(size_mb, 2),
        "mode": "cli",
    }
    print(f"\nRESULT_JSON:{json.dumps(result)}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Générateur de vidéo pour agents Yelema via MoneyPrinterTurbo (CLI)")
    parser.add_argument("--sujet", required=True, help="Sujet ou titre de la vidéo")
    parser.add_argument("--script", default="", help="Script détaillé de la vidéo (optionnel)")
    parser.add_argument("--expert", default=None, help="Nom de l'expert (détecté automatiquement si omis)")
    parser.add_argument("--aspect", choices=["9:16", "16:9", "1:1"], default="9:16", help="Format vidéo")
    parser.add_argument("--voix", default=None, help="Voix TTS (défaut: fr-FR-VivienneMultilingualNeural)")
    parser.add_argument("--voix-validee", action="store_true", help="Confirme que l'utilisateur a validé la voix (compatibilité skill)")
    parser.add_argument("--echantillon", action="store_true", help="Génère uniquement un échantillon vocal (.mp3) pour validation")
    parser.add_argument("--sortie", default="", help="Chemin du fichier de sortie (.mp4 ou .mp3)")
    parser.add_argument("--source", default="pexels", help="Source des médias vidéo (pexels, pixabay, local)")
    parser.add_argument("--materiaux", default="", help="Chemins de vidéos/images locales séparés par virgule (si source=local)")
    parser.add_argument("--materiel", nargs="*", default=[], help="Liste de fichiers locaux pour le montage (alias compatibilité skill)")
    parser.add_argument("--termes", default="", help="Mots-clés de recherche vidéo séparés par virgule")
    parser.add_argument("--timeout-attente", type=int, default=300, help="Délai max d'attente en secondes")
    parser.add_argument("--delai", type=int, default=None, help="Alias de --timeout-attente (compatibilité skill)")

    args = parser.parse_args()

    expert = remove_accents(args.expert.strip()).capitalize() if args.expert else detect_expert()
    dest_path = args.sortie or get_default_dest(expert, args.sujet, echantillon=args.echantillon)
    dest_path = os.path.expanduser(dest_path)
    voice_name = args.voix or os.environ.get("MONEYPRINTER_DEFAULT_VOICE") or "fr-FR-VivienneMultilingualNeural"
    timeout_sec = args.delai if args.delai is not None else args.timeout_attente

    materiaux_list: List[str] = []
    if args.materiaux:
        materiaux_list.extend(os.path.abspath(os.path.expanduser(m.strip())) for m in args.materiaux.split(",") if m.strip())
    if args.materiel:
        materiaux_list.extend(os.path.abspath(os.path.expanduser(m.strip())) for m in args.materiel if m.strip())
    materiaux_str = ",".join(materiaux_list)
    source = "local" if (materiaux_str and args.source == "pexels") else args.source

    mpt_dir, runner_prefix = find_local_mpt()
    if not mpt_dir or not runner_prefix:
        print(
            "❌ Aucune installation de MoneyPrinterTurbo (cli.py) n'a été trouvée sur cette instance.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        run_cli_generation(
            mpt_dir=mpt_dir,
            runner_prefix=runner_prefix,
            sujet=args.sujet,
            script=args.script,
            aspect=args.aspect,
            voix=voice_name,
            dest_path=dest_path,
            expert=expert,
            source=source,
            materiaux=materiaux_str,
            termes=args.termes,
            echantillon=args.echantillon,
            timeout_sec=timeout_sec,
        )
    except Exception as e:
        print(f"❌ Erreur lors de l'exécution CLI : {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
