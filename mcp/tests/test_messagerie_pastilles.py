# @verifies CRM-104 (docs/BACKLOG.md) — le catalogue du connecteur, où la famille `messagerie` ajoute ses outils (docs/SPEC-mcp.md §9.2 bis)
# @verifies CRM-141 (docs/BACKLOG.md) — tranche T5 : les pastilles d'un mail dans le connecteur — la déclaration des deux
#           outils (famille `messagerie`, `consulter` et `modifier`, ancre `mail_label`), la liste des pastilles et de leur
#           descriptif (archivées en dernier), `crm_mail_get` qui rend `labels` posées et `labels_state`, la pose et le
#           retrait par `set_message_label`, les refus nommés, et la matrice qui ferme sans la case `modifier`
# @verifies docs/SPEC-mcp.md §9.2 duovicies, §6.2 (tout identifiant est une ancre), §9.3 ; docs/SPEC-mail-subsystem.md
#           §31.4 ; docs/JOURNAL.md décision 924 (l'assistant juge seul ; aucun outil ne sollicite le LLM du CRM)
"""Le CRM simulé de `test_messagerie.py`, augmenté de `set_message_label` ; la vraie base est éprouvée par
`tests/test_integration_messagerie_pastilles.py`."""

from __future__ import annotations

from typing import Any

import pytest
from fastmcp.exceptions import ToolError
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from crm_mcp.outils import messagerie_pastilles
from crm_mcp.outils.messagerie_pastilles import ordonner_pastilles, posees_lues

from .conftest import ESPACE_A
from .test_messagerie import (
    MESSAGE_HTML,
    MESSAGE_TEXTE,
    PASTILLE_DEVIS,
    PASTILLE_LEAD,
    PASTILLE_NEWS,
    CrmMessagerie,
    Monde,
)


class CrmPastilles(CrmMessagerie):
    def __init__(self) -> None:
        super().__init__()
        self.poses_demandees: list[dict[str, Any]] = []
        self.refus_pose: tuple[int, Any] | None = None

    async def rpc_messagerie(self, requete: Request) -> Response:
        if requete.path_params["fonction"] != "set_message_label":
            return await super().rpc_messagerie(requete)
        if self._personne(requete) is None:
            return JSONResponse({"message": "JWT invalide"}, status_code=401)
        corps = await requete.json()
        self.poses_demandees.append(corps)
        if self.refus_pose is not None:
            return JSONResponse(self.refus_pose[1], status_code=self.refus_pose[0])
        self.poses = [p for p in self.poses if p["label_id"] != corps["p_label_id"]] + [
            {"message_id": corps["p_message_id"], "label_id": corps["p_label_id"], "source": "manual",
             "applied": corps["p_applied"], "pastille": {"name": "devis", "archived_at": None}}
        ]
        return Response(status_code=204)


class MondePastilles(Monde):
    def __init__(self) -> None:
        super().__init__(CrmPastilles(), (messagerie_pastilles,))
        self.simule.droits |= {("sujet-thomas", ESPACE_A, "messagerie", "modifier")}


@pytest.fixture
async def monde():
    m = MondePastilles()
    yield m
    await m.crm.fermer()


def test_l_ordre_et_les_poses() -> None:
    assert [p["name"] for p in ordonner_pastilles([
        {"id": "3", "name": "Newsletter", "archived_at": "x"},
        {"id": "2", "name": "lead", "archived_at": None},
        {"id": "1", "name": "Devis", "archived_at": None},
    ])] == ["Devis", "lead", "Newsletter"]
    # Une ligne retirée à la main n'est pas une pastille posée.
    assert posees_lues([
        {"label_id": "b", "source": "manual", "applied": False, "pastille": {"name": "B"}},
        {"label_id": "a", "source": "llm", "applied": True, "pastille": {"name": "A", "archived_at": None}},
    ]) == [{"label_id": "a", "name": "A", "source": "llm", "archived": False}]


async def test_les_declarations(monde: MondePastilles) -> None:
    liste = monde.moteur.declarations["crm_mail_label_list"]
    pose = monde.moteur.declarations["crm_mail_label_set"]
    assert (liste.famille, liste.action, liste.espace) == ("messagerie", "consulter", "workspace:workspace")
    assert (pose.famille, pose.action, pose.espace, pose.autres) == (
        "messagerie", "modifier", "message:message_id", ("mail_label:label_id",)
    )
    # Décision 924 : l'assistant juge seul — aucun outil ne demande une réévaluation au LLM du CRM.
    assert not any("reevaluat" in n or "evaluate" in n for n in monde.moteur.declarations)
    outils = await monde.outils()
    assert outils["crm_mail_label_list"].annotations.read_only_hint is True
    assert outils["crm_mail_label_set"].annotations.destructive_hint is not True


async def test_la_liste_rend_le_descriptif_et_les_archivees_en_dernier(monde: MondePastilles) -> None:
    lu = await monde.appel("crm_mail_label_list", {"workspace": ESPACE_A})
    assert lu["labels"] == [
        {"id": PASTILLE_DEVIS, "name": "devis", "color": "brand", "description": "Une demande de devis.", "archived": False},
        {"id": PASTILLE_LEAD, "name": "Lead", "color": "success", "description": "Un prospect.", "archived": False},
        {"id": PASTILLE_NEWS, "name": "Newsletter", "color": "neutral", "description": "Une lettre d'information.",
         "archived": True},
    ]


async def test_crm_mail_get_rend_les_pastilles_posees_et_l_etat(monde: MondePastilles) -> None:
    lu = await monde.appel("crm_mail_get", {"message_id": MESSAGE_TEXTE})
    assert lu["labels"] == [
        {"label_id": PASTILLE_LEAD, "name": "Lead", "source": "llm", "archived": False},
        {"label_id": PASTILLE_NEWS, "name": "Newsletter", "source": "manual", "archived": True},
    ]
    assert lu["labels_state"] == "done"
    # Un mail envoyé n'est pas évalué : aucune ligne dans la file.
    envoye = await monde.appel("crm_mail_get", {"message_id": MESSAGE_HTML})
    assert (envoye["labels"], envoye["labels_state"]) == ([], None)


async def test_poser_puis_retirer_par_la_fonction_de_la_base(monde: MondePastilles) -> None:
    pose = await monde.appel("crm_mail_label_set", {"message_id": MESSAGE_TEXTE, "label_id": PASTILLE_DEVIS})
    assert monde.simule.poses_demandees == [
        {"p_message_id": MESSAGE_TEXTE, "p_label_id": PASTILLE_DEVIS, "p_applied": True}
    ]
    assert {"label_id": PASTILLE_DEVIS, "name": "devis", "source": "manual", "archived": False} in pose["labels"]
    retrait = await monde.appel(
        "crm_mail_label_set", {"message_id": MESSAGE_TEXTE, "label_id": PASTILLE_DEVIS, "applied": False}
    )
    assert monde.simule.poses_demandees[-1]["p_applied"] is False
    assert PASTILLE_DEVIS not in [p["label_id"] for p in retrait["labels"]]


@pytest.mark.parametrize(
    ("statut", "corps", "attendu"),
    [
        (403, {"code": "42501", "message": "forbidden"}, "forbidden — reserved to whoever edits the workspace"),
        (400, {"code": "22023", "message": "label_archived"}, "label_archived — the label is archived"),
        (404, {"code": "P0002", "message": "label_not_found"}, "label_not_found — no such label"),
        (404, {"code": "P0002", "message": "message_not_found"}, "Introuvable ou hors de votre périmètre : message"),
    ],
)
async def test_les_refus_nommes(monde: MondePastilles, statut: int, corps: dict[str, Any], attendu: str) -> None:
    monde.simule.refus_pose = (statut, corps)
    with pytest.raises(ToolError) as refus:
        await monde.appel("crm_mail_label_set", {"message_id": MESSAGE_TEXTE, "label_id": PASTILLE_LEAD})
    assert attendu in str(refus.value)


async def test_la_matrice_ferme_la_pose_sans_la_case_modifier(monde: MondePastilles) -> None:
    monde.simule.droits.discard(("sujet-thomas", ESPACE_A, "messagerie", "modifier"))
    with pytest.raises(ToolError):
        await monde.appel("crm_mail_label_set", {"message_id": MESSAGE_TEXTE, "label_id": PASTILLE_LEAD})
    assert monde.simule.poses_demandees == []
