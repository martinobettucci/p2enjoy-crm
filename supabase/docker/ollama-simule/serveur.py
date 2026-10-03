# @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : le simulateur du serveur Ollama, pour les preuves
# @spec docs/SPEC-ia.md §8 (les preuves n'appellent jamais le serveur réel), §11.6 (instrumentation du seul
#       développement ; scénarios), §3 (le contrat MESURÉ que le simulateur reproduit)
# @spec CRM-097 tranche T3.b — docs/SPEC-ia.md §13.5 (le scénario `modification`, dérivé du workflow vivant que la
#       fonction envoie) ; docs/JOURNAL.md décision 620
#
# Bibliothèque standard seule. Le scénario voyage comme clé — `Bearer simule-<scénario>` —, là où le serveur
# réel attend la sienne : la fonction `ia` n'a qu'un chemin d'appel, et ce sont les preuves qui choisissent.
# Réponses calquées sur celles mesurées le 2026-10-02 : `401` « clé API manquante », `403` « origine non
# autorisée pour cette clé », `/api/tags` qui sert `gemma4:e2b`, `/api/chat` à sortie structurée.

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELE = "gemma4:e2b"

VALIDE = {
    "workflow": {"nom": "Cycle d'une agence web"},
    "noeuds": [
        {"cle": "Prise_de_Contact", "libelle": "Prise de contact", "nature": "open", "probabilite": 10},
        {"cle": "Maquette", "libelle": "Maquette et devis", "nature": "open", "probabilite": 40},
        {"cle": "Gagne_Web", "libelle": "Gagné", "nature": "won", "probabilite": 100},
        {"cle": "Perdu_Web", "libelle": "Perdu", "nature": "lost", "probabilite": 0},
    ],
    "etapes": [
        {"noeud": "Prise_de_Contact", "initiale": True},
        {"noeud": "Maquette", "initiale": False},
        {"noeud": "Gagne_Web", "initiale": False},
        {"noeud": "Perdu_Web", "initiale": False},
    ],
    "transitions": [
        {"de": "Prise_de_Contact", "vers": "Maquette", "libelle": "Lancer la maquette", "commentaire_requis": False},
        {"de": "Maquette", "vers": "Gagne_Web", "libelle": "Devis signé", "commentaire_requis": False},
        {"de": "Prise_de_Contact", "vers": "Perdu_Web", "libelle": "Abandonner", "commentaire_requis": True},
        {"de": "Maquette", "vers": "Perdu_Web", "libelle": "Abandonner", "commentaire_requis": True},
    ],
    "champs": [
        {"cle": "Budget", "libelle": "Budget", "type": "money", "choix": None, "devise": "EUR", "aide": None},
        {"cle": "Type_de_site", "libelle": "Type de site", "type": "select", "choix": ["Vitrine", "E-commerce"], "devise": None, "aide": None},
    ],
    "regles": [{"champ": "Budget", "etape": "Maquette", "visibilite": "required"}],
    "exigences": [{"de": "Maquette", "vers": "Gagne_Web", "champ": "Budget"}],
}

# Conforme au schéma, mais deux étapes initiales et une transition vers une étape absente.
INCOHERENTE = json.loads(json.dumps(VALIDE))
INCOHERENTE["etapes"][1]["initiale"] = True
INCOHERENTE["transitions"].append({"de": "Gagne_Web", "vers": "Relance", "libelle": "Relancer", "commentaire_requis": False})

CONTENUS = {
    "valide": json.dumps(VALIDE, ensure_ascii=False),
    "incoherente": json.dumps(INCOHERENTE, ensure_ascii=False),
    "invalide": "Voici votre workflow : une prise de contact, puis un devis.",
}

# Le repère que la fonction pose devant le workflow vivant (`supabase/functions/ia/consignes.ts`).
REPERE_VIVANT = "Le workflow actuel (JSON) :"
QUALIFICATION = "qualification-ia"


def modification(messages):
    """La cible d'une modification : le workflow vivant SANS sa deuxième étape ni rien qui la vise, avec l'étape
    « qualification-ia » après l'initiale, reliée à l'initiale et à l'étape qui suivait la retirée. `remappages`
    reste vide : la destination des affaires de l'étape retirée revient à l'administrateur."""
    vivant = None
    for message in messages:
        lignes = str(message.get("content", "")).split("\n")
        if REPERE_VIVANT in lignes:
            vivant = json.loads(lignes[lignes.index(REPERE_VIVANT) + 1])
    if not isinstance(vivant, dict) or len(vivant.get("etapes", [])) < 3:
        return "Je ne vois aucun workflow à faire évoluer."
    etapes = vivant["etapes"]
    retiree, suivante = etapes[1]["noeud"], etapes[2]["noeud"]
    initiale = next((e["noeud"] for e in etapes if e["initiale"]), etapes[0]["noeud"])
    cible = dict(vivant)
    cible["noeuds"] = [{"cle": QUALIFICATION, "libelle": "Qualification", "nature": "open", "probabilite": 30}]
    restantes = [e for e in etapes if e["noeud"] != retiree]
    rang = next(i for i, e in enumerate(restantes) if e["noeud"] == initiale) + 1
    cible["etapes"] = restantes[:rang] + [{"noeud": QUALIFICATION, "initiale": False}] + restantes[rang:]
    cible["transitions"] = [t for t in vivant["transitions"] if retiree not in (t["de"], t["vers"])] + [
        {"de": initiale, "vers": QUALIFICATION, "libelle": "Qualifier", "commentaire_requis": False},
        {"de": QUALIFICATION, "vers": suivante, "libelle": "Engager", "commentaire_requis": False},
    ]
    cible["regles"] = [r for r in vivant["regles"] if r["etape"] != retiree]
    cible["exigences"] = [x for x in vivant["exigences"] if retiree not in (x["de"], x["vers"])]
    cible["remappages"] = []
    return json.dumps(cible, ensure_ascii=False)


class Simulateur(BaseHTTPRequestHandler):
    def _repondre(self, statut, corps):
        donnees = json.dumps(corps, ensure_ascii=False).encode("utf-8")
        self.send_response(statut)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(donnees)))
        self.end_headers()
        self.wfile.write(donnees)

    def _scenario(self):
        """Rend le scénario, ou répond lui-même le refus du serveur réel et rend None."""
        autorisation = self.headers.get("authorization", "")
        if not autorisation.startswith("Bearer ") or autorisation[7:].strip() == "":
            self._repondre(401, {"error": "clé API manquante"})
            return None
        cle = autorisation[7:].strip()
        scenario = cle[len("simule-"):] if cle.startswith("simule-") else ""
        if scenario == "cle_refusee" or (scenario not in CONTENUS and scenario != "modification"):
            self._repondre(403, {"error": "origine non autorisée pour cette clé"})
            return None
        return scenario

    def do_GET(self):
        if self.path == "/sante":
            self._repondre(200, {"statut": "ok"})
            return
        if self.path != "/api/tags":
            self._repondre(404, {"error": "introuvable"})
            return
        if self._scenario() is None:
            return
        self._repondre(200, {"models": [{"name": "all-minilm:latest"}, {"name": MODELE}]})

    def do_POST(self):
        if self.path != "/api/chat":
            self._repondre(404, {"error": "introuvable"})
            return
        longueur = int(self.headers.get("content-length", "0") or "0")
        corps = json.loads(self.rfile.read(longueur) or b"{}")
        scenario = self._scenario()
        if scenario is None:
            return
        if corps.get("stream") is not False or not isinstance(corps.get("format"), dict):
            self._repondre(400, {"error": "sortie structurée attendue"})
            return
        self._repondre(200, {
            "model": corps.get("model", MODELE),
            "message": {
                "role": "assistant",
                "content": modification(corps.get("messages", [])) if scenario == "modification" else CONTENUS[scenario],
            },
            "done": True,
            "prompt_eval_count": 537,
            "eval_count": 668,
            "total_duration": 1_000_000,
        })

    def log_message(self, format, *args):  # noqa: A002 — signature imposée par BaseHTTPRequestHandler
        # Une ligne par requête, sans corps ni en-tête : la clé n'est jamais écrite.
        print(json.dumps({"service": "ollama-simule", "requete": self.requestline.split(" ")[:2]}), flush=True)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", 11434), Simulateur).serve_forever()
