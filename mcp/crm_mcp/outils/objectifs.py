# @spec CRM-104 (docs/BACKLOG.md) — tranche T6 : les six outils de la famille `objectifs` (décisions 673 et 674)
# @spec docs/SPEC-mcp.md §9.2 nonies (la liste fixée, le bloc placé automatiquement, jamais la géométrie ni la couleur,
#       l'ancre `block`, aucune suppression d'un bloc ni d'une flèche), §9.1 (les lectures et écritures du canevas de la
#       webapp : `objectifs.ts`, `objectifs-ecriture.ts`), §9.3 ; docs/SPEC-goals.md §1 (l'avancement est manuel, jamais
#       calculé), §2.3 (sens d'une flèche), §2.4 (une flèche relie deux blocs du même tableau), §4.1 (un bloc lié à un
#       channel fermé est invisible)
"""Les canevas d'objectifs, sous l'identité de la personne : lire, ajouter un bloc ou une flèche, modifier un bloc,
archiver un tableau.

Les mêmes tables que le canevas de la webapp (`goal_boards`, `goal_blocks`, `goal_links`) ; la base décide qui écrit un
tableau, refuse une flèche entre deux tableaux, en boucle ou en double, et un avancement hors de 0 à 100.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from crm_mcp.crm import ClientCrm, Reponse
from crm_mcp.politique import Declaration, MoteurPolitique, RefusCrm, appel_courant, introuvable, traduire_refus

#: La taille d'un bloc neuf posé par l'écran (`TAILLE_BLOC_NEUF` de `objectifs-ecriture.ts`), et l'écart laissé à droite.
LARGEUR_BLOC, HAUTEUR_BLOC, ECART = 220, 120, 40
COLONNES_TABLEAU = "id,name,description,position,archived_at"
COLONNES_BLOC = (
    "id,title,body,fill_percent,channel_id,pos_x,pos_y,width,height,"
    "channels!goal_blocks_channel_id_fkey(id,name,deleted_at)"
)
COLONNES_FLECHE = "id,source_block_id,target_block_id,direction,label"
COLONNES_BLOC_ECRIT = "id,board_id,title,body,fill_percent,channel_id,pos_x,pos_y"


def _refus(reponse: Reponse, genre: str, valeur: Any) -> ToolError:
    corps = reponse.corps if isinstance(reponse.corps, dict) else {}
    message = str(corps.get("message") or "")
    if corps.get("code") == "23505":
        return RefusCrm("Refusé par le CRM : link_exists — an arrow already joins these two blocks.")
    if "même tableau" in message:
        return RefusCrm("Refusé par le CRM : blocks_of_another_board — an arrow joins two blocks of the same board.")
    contrainte = re.search(r'constraint "([a-z_]+_check)"', message)
    if corps.get("code") == "23514" and contrainte:
        return RefusCrm(f"Refusé par le CRM : {contrainte.group(1)} — a value is not allowed.")
    return traduire_refus(reponse, genre, valeur)


def _une_ligne(reponse: Reponse, genre: str, valeur: Any) -> dict[str, Any]:
    if not reponse.reussie:
        raise _refus(reponse, genre, valeur)
    lignes = reponse.corps if isinstance(reponse.corps, list) else []
    if len(lignes) != 1:
        raise RefusCrm(introuvable(genre, valeur))
    return lignes[0]


def bloc_lu(b: dict[str, Any]) -> dict[str, Any]:
    channel = b.get("channels") or None
    return {
        "id": b["id"],
        "title": b["title"],
        "body": b.get("body"),
        "fill_percent": b.get("fill_percent"),
        "channel": None if not channel else {"id": channel["id"], "name": channel["name"]},
    }


def visible(b: dict[str, Any]) -> bool:
    """Un bloc lié à un channel que la personne ne lit pas, ou mis à la corbeille, est invisible (SPEC-goals §4.1) : la
    RLS a filtré le channel, l'identifiant reste."""
    if b.get("channel_id") is None:
        return True
    channel = b.get("channels")
    return bool(channel) and channel.get("deleted_at") is None


def a_droite(blocs: list[dict[str, Any]]) -> tuple[int, int]:
    """Où poser un bloc neuf : à droite du bloc le plus à droite, à la hauteur du plus haut ; l'origine sur un tableau
    vide. Le canevas n'impose aucune grille : cette règle n'est qu'un placement lisible, que l'écran pourra déplacer."""
    if not blocs:
        return 0, 0
    droite = max(float(b["pos_x"]) + float(b["width"]) for b in blocs)
    haut = min(float(b["pos_y"]) for b in blocs)
    return round(droite) + ECART, round(haut)


def ajouter(serveur: FastMCP, moteur: MoteurPolitique, crm: ClientCrm) -> None:
    async def crm_goal_board_list(
        workspace: Annotated[str, Field(description="Workspace id or slug, from crm_workspace_list")],
        include_archived: Annotated[bool, Field(description="Also list archived boards")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        parametres = {
            "workspace_id": f"eq.{appel.espace}",
            "select": COLONNES_TABLEAU,
            "order": "position.asc,name.asc,id.asc",
        }
        if not include_archived:
            parametres["archived_at"] = "is.null"
        reponse = await crm.lire(appel.jeton, "goal_boards", parametres)
        if not reponse.reussie or not isinstance(reponse.corps, list):
            raise _refus(reponse, "workspace", workspace)
        return {
            "boards": [
                {"id": t["id"], "name": t["name"], "description": t.get("description"), "archived": t.get("archived_at") is not None}
                for t in reponse.corps
            ]
        }

    moteur.enregistrer(
        serveur,
        crm_goal_board_list,
        Declaration(famille="objectifs", action="consulter", espace="workspace:workspace"),
        titre="List goal boards (objectifs)",
        description="Lists the goal boards (FR: tableaux d'objectifs) of a workspace, in their order; archived ones on request.",
    )

    async def crm_goal_board_get(
        board_id: Annotated[str, Field(description="The goal board id")],
    ) -> dict[str, Any]:
        appel = appel_courant()
        tableau = _une_ligne(
            await crm.lire(
                appel.jeton, "goal_boards", {"id": f"eq.{board_id}", "select": f"{COLONNES_TABLEAU},ecriture_permise"}
            ),
            "board",
            board_id,
        )
        blocs = await crm.lire(
            appel.jeton,
            "goal_blocks",
            {"board_id": f"eq.{board_id}", "select": COLONNES_BLOC, "order": "pos_y.asc,pos_x.asc,id.asc"},
        )
        fleches = await crm.lire(
            appel.jeton,
            "goal_links",
            {"board_id": f"eq.{board_id}", "select": COLONNES_FLECHE, "order": "created_at.asc,id.asc"},
        )
        for reponse in (blocs, fleches):
            if not reponse.reussie or not isinstance(reponse.corps, list):
                raise _refus(reponse, "board", board_id)
        lisibles = [b for b in blocs.corps if visible(b)]
        ids = {b["id"] for b in lisibles}
        return {
            "id": tableau["id"],
            "name": tableau["name"],
            "description": tableau.get("description"),
            "archived": tableau.get("archived_at") is not None,
            "can_write": tableau.get("ecriture_permise") is True,
            "note": "fill_percent is entered by people, never computed. Blocks are in reading order (top to bottom, "
            "left to right).",
            "blocks": [bloc_lu(b) for b in lisibles],
            "links": [
                {k: f.get(k) for k in ("id", "source_block_id", "target_block_id", "direction", "label")}
                for f in fleches.corps
                if f["source_block_id"] in ids and f["target_block_id"] in ids
            ],
        }

    moteur.enregistrer(
        serveur,
        crm_goal_board_get,
        Declaration(famille="objectifs", action="consulter", espace="board:board_id"),
        titre="Read a goal board",
        description=(
            "Reads a goal board as text: its blocks in reading order (title, text, progress percentage entered by "
            "people, linked channel) and the arrows between them with their direction; can_write says whether you may "
            "change it."
        ),
    )

    async def crm_goal_block_add(
        board_id: Annotated[str, Field(description="The goal board id")],
        title: Annotated[str, Field(min_length=1, max_length=200)],
        body: Annotated[str | None, Field(description="Optional text", max_length=2000)] = None,
        fill_percent: Annotated[int, Field(description="Progress entered by people, 0 to 100", ge=0, le=100)] = 0,
        channel_id: Annotated[str | None, Field(description="Optional channel the block stands for")] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        blocs = await crm.lire(
            appel.jeton, "goal_blocks", {"board_id": f"eq.{board_id}", "select": "pos_x,pos_y,width"}
        )
        if not blocs.reussie or not isinstance(blocs.corps, list):
            raise _refus(blocs, "board", board_id)
        x, y = a_droite(blocs.corps)
        corps: dict[str, Any] = {
            "board_id": board_id,
            "title": title.strip(),
            "fill_percent": fill_percent,
            "pos_x": x,
            "pos_y": y,
            "width": LARGEUR_BLOC,
            "height": HAUTEUR_BLOC,
        }
        if body is not None and body.strip():
            corps["body"] = body.strip()
        if channel_id is not None:
            corps["channel_id"] = channel_id
        reponse = await crm.ecrire(
            appel.jeton, "POST", "goal_blocks", parametres={"select": COLONNES_BLOC_ECRIT}, corps=corps
        )
        return {"block": _une_ligne(reponse, "board", board_id)}

    moteur.enregistrer(
        serveur,
        crm_goal_block_add,
        Declaration(famille="objectifs", action="ajouter", espace="board:board_id", autres=("channel:channel_id",)),
        titre="Add a block to a goal board",
        description=(
            "Adds a block to a goal board: title, optional text, progress (0–100, entered, never computed) and an "
            "optional linked channel. It is placed to the right of the existing blocks; moving or resizing it stays a "
            "gesture of the web app."
        ),
    )

    async def crm_goal_link_add(
        board_id: Annotated[str, Field(description="The goal board id")],
        source_block_id: Annotated[str, Field(description="The block the arrow starts from")],
        target_block_id: Annotated[str, Field(description="The block the arrow points to")],
        direction: Annotated[Literal["forward", "backward", "both"], Field(description="Arrow direction")] = "forward",
        label: Annotated[str | None, Field(description="Optional label", max_length=200)] = None,
    ) -> dict[str, Any]:
        appel = appel_courant()
        corps: dict[str, Any] = {
            "board_id": board_id,
            "source_block_id": source_block_id,
            "target_block_id": target_block_id,
            "direction": direction,
        }
        if label is not None and label.strip():
            corps["label"] = label.strip()
        reponse = await crm.ecrire(appel.jeton, "POST", "goal_links", parametres={"select": COLONNES_FLECHE}, corps=corps)
        return {"link": _une_ligne(reponse, "board", board_id)}

    moteur.enregistrer(
        serveur,
        crm_goal_link_add,
        Declaration(
            famille="objectifs",
            action="ajouter",
            espace="board:board_id",
            autres=("block:source_block_id", "block:target_block_id"),
        ),
        titre="Add an arrow between two goal blocks",
        description=(
            "Draws an arrow between two blocks of the same goal board (forward, backward or both), with an optional "
            "label. Refused if the arrow already exists or joins a block to itself."
        ),
    )

    async def crm_goal_block_update(
        block_id: Annotated[str, Field(description="The goal block id")],
        title: Annotated[str | None, Field(min_length=1, max_length=200)] = None,
        body: Annotated[str | None, Field(description="Empty string clears it", max_length=2000)] = None,
        fill_percent: Annotated[int | None, Field(ge=0, le=100)] = None,
        channel_id: Annotated[str | None, Field(description="Link the block to this channel")] = None,
        unlink_channel: Annotated[bool, Field(description="Remove the linked channel")] = False,
    ) -> dict[str, Any]:
        appel = appel_courant()
        if channel_id is not None and unlink_channel:
            raise ToolError("Give channel_id or unlink_channel, not both.")
        corps: dict[str, Any] = {}
        if title is not None:
            corps["title"] = title.strip()
        if body is not None:
            corps["body"] = body.strip() or None
        if fill_percent is not None:
            corps["fill_percent"] = fill_percent
        if channel_id is not None:
            corps["channel_id"] = channel_id
        if unlink_channel:
            corps["channel_id"] = None
        if not corps:
            raise ToolError("Give at least one field to change.")
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "goal_blocks",
            parametres={"id": f"eq.{block_id}", "select": COLONNES_BLOC_ECRIT},
            corps=corps,
        )
        return {"block": _une_ligne(reponse, "block", block_id)}

    moteur.enregistrer(
        serveur,
        crm_goal_block_update,
        Declaration(famille="objectifs", action="modifier", espace="block:block_id", autres=("channel:channel_id",)),
        titre="Update a goal block",
        description=(
            "Changes a goal block's title, text, progress (0–100) or linked channel; only the fields given are written. "
            "Its position, size and colour stay gestures of the web app."
        ),
    )

    async def crm_goal_board_archive(
        board_id: Annotated[str, Field(description="The goal board id")],
        archived: Annotated[bool, Field(description="true to archive, false to restore")] = True,
    ) -> dict[str, Any]:
        appel = appel_courant()
        reponse = await crm.ecrire(
            appel.jeton,
            "PATCH",
            "goal_boards",
            parametres={"id": f"eq.{board_id}", "select": COLONNES_TABLEAU},
            corps={"archived_at": datetime.now(UTC).isoformat() if archived else None},
        )
        ligne = _une_ligne(reponse, "board", board_id)
        return {"board": {"id": ligne["id"], "name": ligne["name"], "archived": ligne.get("archived_at") is not None}}

    moteur.enregistrer(
        serveur,
        crm_goal_board_archive,
        Declaration(famille="objectifs", action="supprimer", espace="board:board_id"),
        titre="Archive or restore a goal board",
        description="Archives a goal board (it leaves the list, nothing is destroyed) or restores it with archived=false.",
        destructif=True,
    )
