"""Génère src/lib/expert-commands.data.ts depuis le paquet des Experts (hermes-experts, dossier 8-commandes)."""
# Usage : python3 scripts/gen-expert-commands.py <clone de hermes-experts> src/lib/expert-commands.data.ts
import os, re, glob, json, sys
SRC = sys.argv[1]; OUT = sys.argv[2]
COMMON = {  # libellé client, ce qui manque (None = rien d'obligatoire), un fichier suffit ?
 "s": ("Chercher sur le web", "le sujet à chercher", False),
 "onboarding": ("Faire connaissance", None, False),
 "historique": ("Retrouver un client ou un dossier", "le nom du client ou du dossier", False),
 "livrable": ("Remettre le document en ligne", None, False),
 "etat": ("Où en est le travail", None, False),
 "configuration": ("Son installation", None, False),
 "relire": ("Relire avant envoi", "le texte ou le document à relire", True),
 "couche": ("Le contexte local d'un sujet", "le sujet", False),
 "point": ("Le point de la journée", None, False),
 "taches": ("Les tâches en cours", None, False),
 "valeur": ("Ce qui a été produit", None, False),
 "memoire": ("Sa mémoire de l'entreprise", None, False),
 "outils": ("Ses outils", None, False),
 "email": ("Rédiger un e-mail", "le destinataire et l’objet", False),
 "resume": ("Résumer un document", "le document à résumer", True),
 "feedback": ("Donner un avis sur un livrable", "votre avis", False),
 "routines": ("Ses routines", None, False),
 "tableau": ("Son tableau de bord", None, False),
}
NEED = {"devis": "le client", "prospects": "la cible", "rdv": "le client", "appeldoffres": "l’appel d’offres",
        "contrat": "la personne ou le contrat", "attestation": "la personne", "mise-en-demeure": "le destinataire",
        "post": "le sujet du post", "visuel": "le visuel voulu", "maquette": "ce qu’il faut maquetter", "annonce": "le poste",
        "fichedeposte": "le poste", "entretien": "le candidat", "reclamation": "la réclamation", "fne": "la facture à préparer",
        "justificatif": "la dépense", "courrier": "le courrier"}
def label(phrase):
    p = phrase.rstrip(".")
    for sep in (" : ", ", ", " ou ", " et ", " (", " sans ", " avec ", " pour "):
        i = p.find(sep)
        if i > 0 and len(p[:i].split()) >= 2: p = p[:i]
    return p[0].upper() + p[1:]
def examples(t):
    m = re.search(r"## Exemple\s*\n\s*\n(.*)", t)
    return re.findall(r"`([^`]+)`", m.group(1)) if m else []
experts, defs = {}, {}
for d in sorted(glob.glob(f"{SRC}/*/skills/*/8-commandes")):
    key = d[len(SRC)+1:].split("/")[0]
    names = []
    for c in sorted(os.listdir(d)):
        f = f"{d}/{c}/SKILL.md"
        if not os.path.exists(f) or c in ("commandes",): continue
        t = open(f).read()
        desc = re.search(r'^description:\s*"(.*?)"\s*$', t, re.M).group(1)
        phrase = re.search(r"Commande /\S+\.\s*(.*?)\s*Utiliser", desc).group(1)
        exs = examples(t)
        bare = any(e.strip() == f"/{c}" for e in exs)
        cands = [e[len(c)+2:] for e in exs if e.startswith(f"/{c} ")]
        cands = [e for e in cands if not e.startswith("(") and "<" not in e]
        ex = next((e for e in cands if "joint" not in e), cands[0] if cands else "")
        joint = any("joint" in e for e in exs)
        if c in COMMON:
            lab, need, files = COMMON[c]
            common = True
        else:
            lab, files, common = label(phrase), joint, False
            need = NEED.get(c) or ("le document" if any(e.startswith(f"/{c} (") and "joint" in e for e in exs) else None)
        dk = c if common else f"{key}:{c}"
        defs.setdefault(dk, {"cmd": c, "label": lab, "phrase": phrase, "example": ex, "need": need, "fileOk": files, "common": common})
        names.append(dk)
    experts[key] = names
with open(OUT, "w") as o:
    o.write("// Généré par scripts/gen-expert-commands.py depuis le paquet des Experts (dossier 8-commandes). Ne pas modifier à la main.\n")
    o.write("import type { ExpertCommand } from \"./expert-commands\";\n\n")
    lines = [f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in defs.items()]
    o.write("export const COMMAND_DEFS: Record<string, ExpertCommand> = {\n" + ",\n".join(lines) + "\n};\n\n")
    o.write("export const EXPERT_COMMANDS: Record<string, string[]> = " + json.dumps(experts, ensure_ascii=False) + ";\n")
print(len(experts), "experts", len(defs), "définitions")
for k, v in defs.items():
    if not v["common"] and k.startswith(("kouassi", "fatima", "mamadou")): print(k, "|", v["label"], "|", v["example"], "|", v["need"])
