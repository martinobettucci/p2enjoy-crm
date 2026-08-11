# @spec CRM-059 (docs/BACKLOG.md) — backfill par lots et progression reprenable
# @spec docs/SPEC-mail-subsystem.md §20.6 (le backfill par lots), §20.6 bis (le plan de relève),
#       §20.6 bis.2 (`sync_state` porte une plage), §20.6 bis.3 (deux passes, le courant d'abord),
#       §20.6 bis.4 (premier contact), §20.6 bis.5 (`backfill_months = 0` supprime la passe),
#       §20.6 bis.6 (ce que le plan ne fait pas)
# @spec docs/JOURNAL.md décision 342
#
# CE MODULE NE PARLE À AUCUN SERVEUR. Il décide **ce qu'il faut demander** ; l'ingestion le demande.
# La séparation est celle du §20.10.2, pour la même raison : une décision pure se prouve sans pile,
# et c'est la seule partie du backfill qui soit vérifiable dans un environnement sans IMAP.
#
# Il ne décide pas non plus ce qu'il faut FAIRE des messages : l'ingestion, le dédoublonnage et le
# classement sont livrés par `CRM-054` et ne changent pas ici.

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta


#: Nombre de messages d'historique rapatriés par tour et par dossier.
#:
#: **CE N'EST PAS UNE MESURE**, et le §20.6 bis.3 le dit aussi. C'est un ordre de grandeur choisi
#: pour qu'un tour reste court devant un intervalle de veille de soixante secondes. Il devra être
#: mesuré le jour où une vraie boîte historique sera relevée ; d'ici là il est nommé plutôt que
#: dissimulé (`CLAUDE.md` §21 : ne pas optimiser sans mesure — ce qui n'interdit pas de choisir une
#: borne, seulement de la présenter comme mesurée).
LOT_BACKFILL = 200

#: Nombre de jours par mois retenu pour traduire `backfill_months` en une date.
#:
#: Trente jours, et non un calcul calendaire. `backfill_months` exprime une **profondeur
#: approximative** — « environ six mois d'historique » —, jamais une date d'anniversaire : personne
#: ne remarquera qu'une borne à six mois tombe le 28 février plutôt que le 2 mars, et un calcul
#: calendaire exact ferait dépendre le plan du mois où il est exécuté.
JOURS_PAR_MOIS = 30


@dataclass(frozen=True)
class EtatDossier:
    """La plage contiguë d'UID déjà rapatriée pour un dossier — §20.6 bis.2.

    `None` sur les deux bornes = **rien n'a jamais été rapatrié** de ce dossier. C'est différent
    d'un dossier vide, que le serveur signale en ne rendant aucun UID.

    La plage est contiguë **par construction** et non par hypothèse : les deux passes du §20.6 bis.3
    ne peuvent que l'étendre par le haut ou par le bas, jamais créer de trou.
    """

    uid_min: int | None = None
    uid_max: int | None = None

    @property
    def vierge(self) -> bool:
        return self.uid_min is None or self.uid_max is None

    @classmethod
    def depuis_json(cls, brut: object) -> "EtatDossier":
        """Lit ce que `sync_state` porte, sans jamais lever sur une valeur inattendue.

        `sync_state` est un `jsonb` libre : il peut porter la forme d'une version antérieure, ou
        avoir été édité à la main. Une forme non reconnue est traitée comme **vierge** — le dossier
        redescend alors son courant du jour, ce qui ne perd rien (la base dédoublonne) et ne
        redescend pas la boîte. Lever ferait échouer la relève d'un compte pour un état illisible.
        """

        if not isinstance(brut, dict):
            return cls()
        minimum = brut.get("uid_min")
        maximum = brut.get("uid_max")
        if not isinstance(minimum, int) or not isinstance(maximum, int):
            return cls()
        if isinstance(minimum, bool) or isinstance(maximum, bool):
            # `bool` est un `int` en Python : sans cette garde, `{"uid_min": true}` deviendrait 1.
            return cls()
        if minimum < 1 or maximum < minimum:
            # Un UID vaut au moins 1, et une plage inversée n'est pas une plage.
            return cls()
        return cls(uid_min=minimum, uid_max=maximum)

    def vers_json(self) -> dict[str, int]:
        if self.uid_min is None or self.uid_max is None:
            return {}
        return {"uid_min": self.uid_min, "uid_max": self.uid_max}


@dataclass(frozen=True)
class PasseCourante:
    """Ce qu'il faut demander pour le courrier neuf.

    Exactement l'une des deux formes est renseignée :

      * `depuis_uid` — la boîte a déjà un état : `UID SEARCH UID <depuis_uid>:*` ;
      * `depuis_date` — premier contact : `UID SEARCH SINCE <depuis_date>` (§20.6 bis.4).
    """

    depuis_uid: int | None
    depuis_date: date | None


@dataclass(frozen=True)
class PasseHistorique:
    """Ce qu'il faut demander pour un lot d'historique, ou `None` s'il n'y en a pas.

    `UID SEARCH SINCE <borne> UID 1:<jusqu_uid>`, dont on ne garde que les `lot` plus grands.
    """

    borne: date
    jusqu_uid: int
    lot: int


@dataclass(frozen=True)
class PlanDossier:
    """Le plan complet d'un dossier pour un tour."""

    courante: PasseCourante
    historique: PasseHistorique | None


def borne_backfill(aujourd_hui: date, backfill_months: int) -> date | None:
    """Traduit une profondeur en mois en une date, ou rend `None` — §20.6 bis.5.

    `None` signifie « aucune passe d'historique », et ce n'est pas la même chose qu'une borne fixée
    à aujourd'hui : une passe bornée à zéro émettrait une requête inutile à chaque tour et par
    dossier, pour ne rien rapporter.

    Une profondeur négative est traitée comme zéro plutôt que refusée : la contrainte `CHECK` de la
    base la rend déjà impossible (`backfill_months >= 0`), et lever ici ferait échouer une relève
    pour une donnée que la base garantit — c'est-à-dire punir le service pour une faute qui ne peut
    pas se produire.
    """

    if backfill_months <= 0:
        return None
    return aujourd_hui - timedelta(days=backfill_months * JOURS_PAR_MOIS)


def planifier_dossier(
    *,
    etat: EtatDossier,
    aujourd_hui: date,
    backfill_months: int,
    lot: int = LOT_BACKFILL,
) -> PlanDossier:
    """Décide ce qu'il faut demander à ce dossier, pour ce tour — §20.6 bis.3.

    L'ordre des deux passes n'est pas exprimé ici mais dans le type : la passe courante est un
    champ **obligatoire**, l'historique un champ **facultatif**. L'appelant qui traiterait
    l'historique d'abord contredirait le §20.6 — « le courrier du jour ne doit pas attendre que dix
    ans d'archives soient descendus » — et le test d'ingestion l'observe.
    """

    if etat.vierge:
        # PREMIER CONTACT : le courrier DU JOUR, jamais la boîte entière (§20.6 bis.4). Tout ce qui
        # précède le branchement est de l'historique, et l'historique ne descend que sur demande.
        courante = PasseCourante(depuis_uid=None, depuis_date=aujourd_hui)
    else:
        assert etat.uid_max is not None  # garanti par `vierge`
        courante = PasseCourante(depuis_uid=etat.uid_max + 1, depuis_date=None)

    borne = borne_backfill(aujourd_hui, backfill_months)
    if borne is None or etat.vierge or etat.uid_min is None or etat.uid_min <= 1:
        # Pas d'historique demandé, pas encore d'état sur lequel s'appuyer, ou plancher déjà
        # atteint — `uid_min == 1` signifie que le plus petit UID possible est descendu.
        return PlanDossier(courante=courante, historique=None)

    return PlanDossier(
        courante=courante,
        historique=PasseHistorique(borne=borne, jusqu_uid=etat.uid_min - 1, lot=lot),
    )


def retenir_lot(uids: list[int], lot: int) -> list[int]:
    """Garde les `lot` plus grands UID, rendus dans l'ordre CROISSANT — §20.6 bis.3.

    Deux décisions, et chacune a son motif :

      * **les plus grands d'abord** : l'historique descend du plus récent vers le plus ancien.
        L'inverse rapatrierait les archives les plus vieilles en premier, c'est-à-dire celles dont
        personne n'a besoin tout de suite ;
      * **rendus en ordre croissant** : le `FETCH` qui suit porte alors une plage compacte, et la
        plage rapatriée reste contiguë, ce dont dépend tout le §20.6 bis.2.
    """

    if lot <= 0:
        return []
    return sorted(sorted(uids, reverse=True)[:lot])


def etendre(etat: EtatDossier, uids_rapatries: list[int]) -> EtatDossier:
    """Étend la plage avec ce qui vient d'être rapatrié.

    L'extension ne peut aller que **vers le haut ou vers le bas** : c'est ce qui rend la plage
    contiguë par construction (§20.6 bis.2). Une liste vide laisse l'état inchangé — un tour qui
    n'a rien rapatrié n'a rien à enregistrer, et écrire une plage vide effacerait la progression.
    """

    if not uids_rapatries:
        return etat
    plus_petit = min(uids_rapatries)
    plus_grand = max(uids_rapatries)
    if etat.vierge:
        return EtatDossier(uid_min=plus_petit, uid_max=plus_grand)
    assert etat.uid_min is not None and etat.uid_max is not None
    return EtatDossier(
        uid_min=min(etat.uid_min, plus_petit),
        uid_max=max(etat.uid_max, plus_grand),
    )
