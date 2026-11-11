# @spec CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où ces outils s'inscrivent (docs/SPEC-mcp.md §9.2)
# @spec CRM-141 (docs/BACKLOG.md) — tranche T5 : les pastilles d'un mail dans le connecteur — `crm_mail_label_list`
#       (`consulter`, les pastilles de l'espace et leur descriptif), `crm_mail_label_set` (`modifier`, par
#       `public.set_message_label` : toujours un choix manuel), et la lecture des pastilles posées que `crm_mail_get` rend
# @spec docs/SPEC-mcp.md §9.2 duovicies (famille `messagerie`, aucune case nouvelle ; ancre nouvelle `mail_label` ; refus
#       traduits), §9.1, §9.3 ; docs/SPEC-mail-subsystem.md §31.4, §31.8 ; docs/JOURNAL.md décisions 923, 924 et 926
"""Les pastilles d'un mail, sous l'identité de la personne.

L'assistant connecté JUGE LUI-MÊME (décision 924) : il lit le mail et les pastilles de l'espace — leur descriptif est ce
que le LLM du CRM lit pour décider —, puis pose ou retire. Aucun outil ne transmet une demande au LLM du CRM, ni ne demande
une réévaluation. Une pose ou un retrait est un choix manuel, que la réévaluation ne défait jamais.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastmcp import FastMCP
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

#: Les refus nommés de `public.set_message_label` (docs/SPEC-mail-subsystem.md §31.4), en phrases pour le modèle.
REFUS_PASTILLE = {
    "forbidden": "reserved to whoever edits the workspace: administrators and business developers",
    "label_archived": "the label is archived: it can be taken off an email, never put on one",
    "label_not_found": "no such label in the workspace of this email; list them with crm_mail_label_list",
}

COLONNES_PASTILLE = "id,name,color,description,archived_at"


def pastille_lue(ligne: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": ligne["id"],
        "name": ligne.get("name"),
        "color": ligne.get("color"),
        "description": ligne.get("description"),
        "archived": ligne.get("archived_at") is not None,
    }


def ordonner_pastilles(lignes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Les actives d'abord, puis les archivées ; chacune dans l'ordre du nom, sans tenir compte de la casse."""
    return sorted(lignes, key=lambda p: (p.get("archived_at") is not None, str(p.get("name") or "").casefold(), p["id"]))


def posees_lues(lignes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Les pastilles POSÉES d'un message, dans l'ordre du nom : `label_id`, `name`, `source` et `archived`."""
    posees = [
        {
            "label_id": ligne["label_id"],
            "name": (ligne.get("pastille") or {}).get("name"),
            "source": ligne.get("source"),
            "archived": (ligne.get("pastille") or {}).get("archived_at") is not None,
        }
        for ligne in lignes
        if ligne.get("applied") is True
    ]
    return sorted(posees, key=lambda p: (str(p["name"] or "").casefold(), p["label_id"]))


async def pastilles_du_message(crm: ClientCrm, jeton: str, message_id: str) -> dict[str, Any]:
    """`labels` et `labels_state` d'un message, sous le jeton de la personne — ce que `crm_mail_get` ajoute (§9.2
    duovicies). `labels_state` vaut nul pour un mail envoyé, qui n'est pas évalué."""
    poses = await crm.lire(
        jeton,
        "mail_message_labels",
        {"message_id": f"eq.{message_id}", "select": "label_id,source,applied,pastille:mail_labels(name,archived_at)"},
    )
    if not poses.reussie or not isinstance(poses.corps, list):
        raise traduire_refus(poses, "message", message_id)
    evaluation = await crm.lire(
        jeton, "mail_label_evaluations", {"message_id": f"eq.{message_id}", "select": "state", "limit": "1"}
    )
    if not evaluation.reussie or not isinstance(evaluation.corps, list):
        raise traduire_refus(evaluation, "message", message_id)
    etat = evaluation.corps[0].get("state") if evaluation.corps else None
    return {"labels": posees_lues(poses.corps), "labels_state": etat}


def refus_pastille(reponse: Reponse, message_id: str) -> Exception:
    """Le refus de `set_message_label` : un code nommé en phrase ; `message_not_found` est le refus uniforme."""
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    code = str(corps.get("message") or "")
    if code == "message_not_found":
        return RefusCrm(introuvable("message", message_id))
    if code in REFUS_PASTILLE:
        return RefusCrm(f"Refusé par le CRM : {code} — {REFUS_PASTILLE[code]}.")
    return traduire_refus(reponse, "message", message_id)


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_mail_label_list(
        workspace: Annotated[str, Field(description="Workspace slug or id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.lire(
            appel.jeton, "mail_labels", {"workspace_id": f"eq.{appel.espace}", "select": COLONNES_PASTILLE}
        )
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise traduire_refus(reponse, "workspace", workspace)
        return {"labels": [pastille_lue(p) for p in ordonner_pastilles(reponse.corps)]}

    moteur.enregistrer(
        serveur,
        crm_mail_label_list,
        Declaration(famille="messagerie", action="consulter", espace="workspace:workspace"),
        titre="List the email labels of a workspace (pastilles)",
        description=(
            "Lists the labels (pastilles) that can be put on the emails of a workspace: id, name, color, and the "
            "description — the text the CRM's own AI reads to decide whether an email carries the label; read it to decide "
            "the same way. Archived labels come last: they stay on the emails that carry them, but can no longer be put on "
            "one. Read an email's labels with crm_mail_get; put or take one with crm_mail_label_set."
        ),
    )

    async def crm_mail_label_set(
        message_id: Annotated[str, Field(description="The email message id, from crm_card_mail_list or crm_search")],
        label_id: Annotated[str, Field(description="The label id, from crm_mail_label_list")],
        applied: Annotated[bool, Field(description="True puts the label on the email; false takes it off")] = True,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.rpc(
            appel.jeton, "set_message_label", {"p_message_id": message_id, "p_label_id": label_id, "p_applied": applied}
        )
        if not reponse.reussie:
            raise refus_pastille(reponse, message_id)
        return {"message_id": message_id, **await pastilles_du_message(crm, appel.jeton, message_id)}

    moteur.enregistrer(
        serveur,
        crm_mail_label_set,
        Declaration(famille="messagerie", action="modifier", espace="message:message_id", autres=("mail_label:label_id",)),
        titre="Put or take a label on an email (pastille)",
        description=(
            "Puts a label (pastille) on an email, or takes it off with applied: false — as a person does in the inbox. "
            "It is a manual choice: the CRM's own AI never undoes it when it evaluates the email again. Reserved to whoever "
            "edits the workspace (administrators and business developers). An archived label can be taken off, never put "
            "on. Returns the labels the email now carries."
        ),
    )
