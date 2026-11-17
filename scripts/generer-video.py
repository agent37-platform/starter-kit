#!/usr/bin/env python3
import argparse
import datetime
import json
import os
import re
import select
import shutil
import subprocess
import sys
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple


def plain(text: str) -> str:
    """Texte sans accents et en minuscules, pour comparer des noms de dossiers."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).casefold()


def livrables_root() -> str:
    """Dossier des livrables de l'instance (~/Livrables), chemin réel."""
    root = os.environ.get("LIVRABLES_DIR") or os.path.join(os.path.expanduser("~"), "Livrables")
    return os.path.realpath(os.path.expanduser(root))


def safe_segment(text: str, max_len: int = 80) -> Optional[str]:
    """Nom utilisable comme dossier : sans séparateur, sans `..`, sans point initial ; None sinon."""
    cleaned = re.sub(r"[\\/\x00-\x1f]", " ", text).strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)[:max_len].strip()
    if not cleaned or ".." in cleaned:
        return None
    return cleaned


def expert_candidates(explicit: Optional[str]) -> List[str]:
    """Noms possibles de l'expert, le plus sûr d'abord : --expert, variables de nom, SOUL.md, profil Hermes."""
    names: List[str] = []
    if explicit and explicit.strip():
        names.append(explicit.strip())
    for var in ("EXPERT_NAME", "EXPERT", "AGENT_NAME", "HERMES_AGENT_NAME"):
        if os.environ.get(var, "").strip():
            names.append(os.environ[var].strip())
    curr = os.getcwd()
    for _ in range(4):
        soul = os.path.join(curr, "SOUL.md")
        if os.path.isfile(soul):
            try:
                with open(soul, "r", encoding="utf-8") as f:
                    m = re.search(r"^name:\s*['\"]?([^'\"\r\n]+)", f.read(600), re.MULTILINE)
                if m and m.group(1).strip():
                    names.append(m.group(1).strip())
            except OSError:
                pass
            break
        parent = os.path.dirname(curr)
        if parent == curr:
            break
        curr = parent
    profile = next((os.environ[v].strip() for v in ("HERMES_PROFILE", "PROFILE") if os.environ.get(v, "").strip()), "")
    if not profile:
        m = re.search(r"/\.hermes/profiles/([^/]+)", os.getcwd())
        profile = m.group(1) if m else ""
    if profile and profile not in ("default", "yele"):
        key = profile.split("__", 1)[-1]
        names.append(key[:1].upper() + key[1:].lower())
    return names


def resolve_expert_folder(explicit: Optional[str]) -> str:
    """
    Dossier de l'expert dans les livrables : un dossier existant dont le nom correspond (accents et
    casse ignorés) à l'un des noms possibles, sinon le premier nom possible tel qu'écrit.
    """
    candidates = [c for c in (safe_segment(n) for n in expert_candidates(explicit)) if c]
    if not candidates:
        raise ValueError("Expert introuvable : précisez --expert avec le nom de l'expert.")
    root = livrables_root()
    existing = [d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))] if os.path.isdir(root) else []
    for name in candidates:
        for first in (name, name.split(" ")[0]):
            match = next((d for d in existing if plain(d) == plain(first)), None)
            if match:
                return match
    return candidates[0]


def slugify(text: str) -> str:
    text = plain(text)
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[\s_-]+", "-", text).strip("-")
    return text[:40] or "video"


def default_dest(expert_folder: str, sujet: str, echantillon: bool = False) -> str:
    """<Livrables>/<Expert>/<Sujet>/<AAMMJJ>_[echantillon_]<slug>.mp4|mp3"""
    subject_folder = safe_segment(sujet, 60) or "Vidéo"
    prefix = datetime.datetime.now().strftime("%y%m%d")
    tag = "echantillon_" if echantillon else ""
    ext = "mp3" if echantillon else "mp4"
    return os.path.join(livrables_root(), expert_folder, subject_folder, f"{prefix}_{tag}{slugify(sujet)}.{ext}")


def confined_dest(path: str) -> str:
    """Chemin de sortie réel, refusé s'il sort des livrables."""
    root = livrables_root()
    real = os.path.realpath(os.path.expanduser(path))
    if os.path.commonpath([root, real]) != root or real == root:
        raise ValueError(f"Le fichier de sortie doit être dans {root}.")
    return real


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
    """Crée config.toml depuis l'exemple s'il manque, et y écrit PEXELS_API_KEY / PIXABAY_API_KEY de l'environnement."""
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
        for name, key in (("pexels_api_keys", pexels_key), ("pixabay_api_keys", pixabay_key)):
            if key:
                updated = re.sub(rf"^{name}\s*=\s*\[[^\]\n]*\]", lambda _m, n=name, k=key: f"{n} = [{json.dumps(k)}]", updated, count=1, flags=re.MULTILINE)
        if updated != content:
            with open(cfg_path, "w", encoding="utf-8") as f:
                f.write(updated)
    except OSError as e:
        print(f"⚠️ config.toml non mis à jour : {e}", file=sys.stderr)


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
    proc = subprocess.Popen(cmd, cwd=mpt_dir, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert proc.stdout is not None and proc.stderr is not None
    buffers = {proc.stdout.fileno(): b"", proc.stderr.fileno(): b""}
    stdout_lines: List[str] = []

    def take_lines(fd: int, final: bool = False) -> None:
        parts = re.split(rb"[\r\n]", buffers[fd])
        buffers[fd] = b"" if final else parts.pop()
        for raw in parts:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            if fd == proc.stdout.fileno():
                stdout_lines.append(line)
            elif any(k in line for k in ("generation activity:", "combining video:", "generating video:", "azure_tts_v1")):
                print(f"   [MPT] {line}")
            elif any(k in line for k in ("ERROR", "Exception", "Traceback")):
                print(f"   ⚠️ [MPT Log] {line}", file=sys.stderr)

    open_fds = set(buffers)
    while open_fds:
        if time.time() - start_time > timeout_sec:
            proc.kill()
            proc.wait()
            raise TimeoutError(f"Délai d'attente dépassé ({timeout_sec}s) lors de la génération vidéo CLI.")
        ready, _, _ = select.select(list(open_fds), [], [], 0.5)
        for fd in ready:
            chunk = os.read(fd, 65536)
            if not chunk:
                open_fds.discard(fd)
                take_lines(fd, final=True)
                continue
            buffers[fd] += chunk
            take_lines(fd)
    proc.wait()

    if proc.returncode != 0:
        raise RuntimeError(f"Échec de cli.py (code {proc.returncode}). Vérifiez les logs ci-dessus.")

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

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    shutil.copy2(generated_path, dest_path)

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
    parser.add_argument("--voix-validee", action="store_true", help="Accepté pour les skills qui le passent ; sans effet")
    parser.add_argument("--echantillon", action="store_true", help="Génère uniquement un échantillon vocal (.mp3) pour validation")
    parser.add_argument("--sortie", default="", help="Chemin du fichier de sortie (.mp4 ou .mp3), dans les livrables")
    parser.add_argument("--source", default="pexels", help="Source des médias vidéo (pexels, pixabay, local)")
    parser.add_argument("--materiaux", default="", help="Chemins de vidéos/images locales séparés par virgule (si source=local)")
    parser.add_argument("--materiel", nargs="*", default=[], help="Liste de fichiers locaux pour le montage (alias compatibilité skill)")
    parser.add_argument("--termes", default="", help="Mots-clés de recherche vidéo séparés par virgule")
    parser.add_argument("--timeout-attente", type=int, default=300, help="Délai max d'attente en secondes")
    parser.add_argument("--delai", type=int, default=None, help="Alias de --timeout-attente (compatibilité skill)")

    args = parser.parse_args()

    try:
        expert = resolve_expert_folder(args.expert)
        dest_path = confined_dest(args.sortie or default_dest(expert, args.sujet, echantillon=args.echantillon))
    except (ValueError, OSError) as e:
        print(f"❌ {e}", file=sys.stderr)
        sys.exit(1)
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
