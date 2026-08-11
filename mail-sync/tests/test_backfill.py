# @verifies CRM-059 (docs/BACKLOG.md) — plan de relève et backfill par lots
# @verifies docs/SPEC-mail-subsystem.md §20.6 bis.2 (`sync_state` porte une plage, lecture
#           tolérante), §20.6 bis.3 (deux passes, le courant d'abord, du plus récent au plus
#           ancien), §20.6 bis.4 (premier contact : le courrier du jour), §20.6 bis.5
#           (`backfill_months = 0` supprime la passe)
# @verifies docs/JOURNAL.md décision 342
#
# Ces preuves n'ouvrent aucune connexion : le plan est une décision pure, et c'est précisément ce
# qui la rend vérifiable dans un environnement sans IMAP.

from __future__ import annotations

from datetime import date

import pytest

from mail_sync.backfill import (
    JOURS_PAR_MOIS,
    LOT_BACKFILL,
    EtatDossier,
    borne_backfill,
    etendre,
    planifier_dossier,
    retenir_lot,
)


AUJOURD_HUI = date(2026, 8, 11)


# ---------------------------------------------------------------------------------------------
# §20.6 bis.2 — la plage, et sa lecture tolérante
# ---------------------------------------------------------------------------------------------


def test_un_etat_absent_est_vierge_et_non_une_erreur():
    assert EtatDossier().vierge is True
    assert EtatDossier.depuis_json(None).vierge is True
    assert EtatDossier.depuis_json({}).vierge is True


def test_une_plage_valide_est_lue():
    etat = EtatDossier.depuis_json({"uid_min": 10, "uid_max": 42})
    assert (etat.uid_min, etat.uid_max) == (10, 42)
    assert etat.vierge is False


@pytest.mark.parametrize(
    "brut",
    [
        "pas un objet",
        {"uid_min": "10", "uid_max": 42},
        {"uid_min": 10},
        {"uid_max": 42},
        {"uid_min": 0, "uid_max": 42},  # un UID vaut au moins 1
        {"uid_min": 50, "uid_max": 10},  # plage inversée
    ],
)
def test_une_forme_non_reconnue_est_traitee_comme_vierge_sans_lever(brut):
    # `sync_state` est un `jsonb` libre : il peut porter la forme d'une version antérieure ou avoir
    # été édité à la main. Lever ferait échouer la relève d'un compte pour un état illisible ; le
    # traiter comme vierge fait redescendre le courant du jour, ce qui ne perd rien.
    assert EtatDossier.depuis_json(brut).vierge is True


def test_un_booleen_n_est_pas_lu_comme_un_uid():
    # `bool` est un `int` en Python : sans garde explicite, `True` deviendrait l'UID 1.
    assert EtatDossier.depuis_json({"uid_min": True, "uid_max": True}).vierge is True


def test_l_aller_retour_json_conserve_la_plage():
    etat = EtatDossier(uid_min=3, uid_max=9)
    assert EtatDossier.depuis_json(etat.vers_json()) == etat
    assert EtatDossier().vers_json() == {}


# ---------------------------------------------------------------------------------------------
# §20.6 bis.5 — la borne d'historique
# ---------------------------------------------------------------------------------------------


def test_zero_supprime_la_passe_et_ne_la_borne_pas_a_aujourd_hui():
    # La nuance compte : une passe bornée à zéro émettrait une requête inutile par tour et par
    # dossier, pour ne rien rapporter.
    assert borne_backfill(AUJOURD_HUI, 0) is None


def test_une_profondeur_negative_est_traitee_comme_zero_et_ne_leve_pas():
    # La contrainte `CHECK` de la base la rend déjà impossible ; lever ici punirait le service pour
    # une faute qui ne peut pas se produire.
    assert borne_backfill(AUJOURD_HUI, -3) is None


def test_la_profondeur_est_traduite_en_date():
    assert borne_backfill(AUJOURD_HUI, 1) == date(2026, 7, 12)
    attendu = AUJOURD_HUI.toordinal() - 6 * JOURS_PAR_MOIS
    assert borne_backfill(AUJOURD_HUI, 6).toordinal() == attendu


# ---------------------------------------------------------------------------------------------
# §20.6 bis.4 — premier contact
# ---------------------------------------------------------------------------------------------


def test_le_premier_contact_demande_le_courrier_du_jour_et_non_la_boite():
    # LE point contre-intuitif du chapitre : descendre toute la boîte au branchement ferait ce que
    # `backfill_months` sert à éviter, sans qu'on l'ait demandé.
    plan = planifier_dossier(etat=EtatDossier(), aujourd_hui=AUJOURD_HUI, backfill_months=0)
    assert plan.courante.depuis_date == AUJOURD_HUI
    assert plan.courante.depuis_uid is None


def test_le_premier_contact_ne_demande_aucun_historique_meme_si_la_profondeur_est_declaree():
    # Il n'existe encore aucun `uid_min` sous lequel chercher : l'historique commence au tour
    # suivant, une fois le courant enregistré.
    plan = planifier_dossier(etat=EtatDossier(), aujourd_hui=AUJOURD_HUI, backfill_months=12)
    assert plan.historique is None


# ---------------------------------------------------------------------------------------------
# §20.6 bis.3 — les deux passes
# ---------------------------------------------------------------------------------------------


def test_la_passe_courante_part_du_dernier_uid_connu_plus_un():
    plan = planifier_dossier(
        etat=EtatDossier(uid_min=10, uid_max=42), aujourd_hui=AUJOURD_HUI, backfill_months=0
    )
    assert plan.courante.depuis_uid == 43
    assert plan.courante.depuis_date is None


def test_la_passe_courante_n_est_jamais_bornee_par_le_lot():
    # Borner le neuf ferait prendre du retard à une boîte active sans jamais le rattraper.
    plan = planifier_dossier(
        etat=EtatDossier(uid_min=1, uid_max=5), aujourd_hui=AUJOURD_HUI, backfill_months=0
    )
    assert not hasattr(plan.courante, "lot")


def test_l_historique_descend_sous_le_plancher_et_est_borne():
    plan = planifier_dossier(
        etat=EtatDossier(uid_min=100, uid_max=200), aujourd_hui=AUJOURD_HUI, backfill_months=6
    )
    assert plan.historique is not None
    assert plan.historique.jusqu_uid == 99
    assert plan.historique.lot == LOT_BACKFILL
    assert plan.historique.borne == borne_backfill(AUJOURD_HUI, 6)


def test_aucun_historique_quand_le_plancher_est_atteint():
    # `uid_min == 1` : le plus petit UID possible est descendu, il n'y a plus rien en dessous.
    plan = planifier_dossier(
        etat=EtatDossier(uid_min=1, uid_max=200), aujourd_hui=AUJOURD_HUI, backfill_months=6
    )
    assert plan.historique is None


def test_aucun_historique_quand_la_profondeur_est_nulle():
    plan = planifier_dossier(
        etat=EtatDossier(uid_min=100, uid_max=200), aujourd_hui=AUJOURD_HUI, backfill_months=0
    )
    assert plan.historique is None
    # …mais le courant continue : couper l'historique ne coupe pas la relève.
    assert plan.courante.depuis_uid == 201


def test_le_plan_porte_TOUJOURS_une_passe_courante():
    # Le type l'impose : `courante` est obligatoire, `historique` facultatif. C'est ainsi que
    # l'ordre du §20.6 — le courrier du jour d'abord — est tenu par la structure et non par une
    # convention d'appel.
    for etat in (EtatDossier(), EtatDossier(uid_min=5, uid_max=9)):
        for mois in (0, 6):
            plan = planifier_dossier(etat=etat, aujourd_hui=AUJOURD_HUI, backfill_months=mois)
            assert plan.courante is not None


# ---------------------------------------------------------------------------------------------
# §20.6 bis.3 — le lot : du plus récent au plus ancien, rendu croissant
# ---------------------------------------------------------------------------------------------


def test_le_lot_retient_les_plus_GRANDS_uid():
    # L'historique descend du plus récent vers le plus ancien : rapatrier les plus vieux d'abord
    # servirait ceux dont personne n'a besoin tout de suite.
    assert retenir_lot([1, 2, 3, 4, 5], lot=2) == [4, 5]


def test_le_lot_est_rendu_en_ordre_CROISSANT():
    # Le `FETCH` qui suit porte alors une plage compacte, et la plage rapatriée reste contiguë.
    assert retenir_lot([9, 3, 7, 1], lot=3) == [3, 7, 9]


def test_un_lot_plus_grand_que_la_liste_rend_tout():
    assert retenir_lot([2, 1], lot=100) == [1, 2]


def test_un_lot_nul_ou_negatif_ne_rend_rien():
    assert retenir_lot([1, 2, 3], lot=0) == []
    assert retenir_lot([1, 2, 3], lot=-5) == []


def test_une_liste_vide_ne_leve_pas():
    assert retenir_lot([], lot=10) == []


# ---------------------------------------------------------------------------------------------
# §20.6 bis.2 — l'extension garde la plage contiguë
# ---------------------------------------------------------------------------------------------


def test_l_extension_d_un_etat_vierge_pose_les_deux_bornes():
    assert etendre(EtatDossier(), [7, 3, 5]) == EtatDossier(uid_min=3, uid_max=7)


def test_l_extension_vers_le_haut_ne_touche_pas_le_plancher():
    assert etendre(EtatDossier(uid_min=10, uid_max=20), [21, 25]) == EtatDossier(
        uid_min=10, uid_max=25
    )


def test_l_extension_vers_le_bas_ne_touche_pas_le_plafond():
    assert etendre(EtatDossier(uid_min=10, uid_max=20), [4, 9]) == EtatDossier(
        uid_min=4, uid_max=20
    )


def test_un_tour_sans_rien_rapatrier_laisse_l_etat_INCHANGE():
    # Écrire une plage vide effacerait la progression, et le tour suivant redescendrait tout.
    etat = EtatDossier(uid_min=10, uid_max=20)
    assert etendre(etat, []) == etat
    assert etendre(EtatDossier(), []) == EtatDossier()


def test_un_uid_deja_dans_la_plage_ne_la_modifie_pas():
    etat = EtatDossier(uid_min=10, uid_max=20)
    assert etendre(etat, [12, 15]) == etat


# ---------------------------------------------------------------------------------------------
# Preuve d'ensemble : deux tours successifs convergent au lieu de tout redescendre
# ---------------------------------------------------------------------------------------------


def test_deux_tours_successifs_ne_redescendent_pas_ce_qui_est_deja_la():
    # C'est le défaut que ce module corrige : `search(["ALL"])` redemandait la boîte à chaque tour.
    # Premier tour, boîte neuve : le courant du jour.
    plan1 = planifier_dossier(etat=EtatDossier(), aujourd_hui=AUJOURD_HUI, backfill_months=3)
    assert plan1.courante.depuis_date == AUJOURD_HUI
    etat = etendre(EtatDossier(), [500, 501, 502])

    # Deuxième tour : le courant repart de 503, et l'historique attaque SOUS 500.
    plan2 = planifier_dossier(etat=etat, aujourd_hui=AUJOURD_HUI, backfill_months=3)
    assert plan2.courante.depuis_uid == 503
    assert plan2.historique is not None
    assert plan2.historique.jusqu_uid == 499

    # Le lot d'historique descend, et le plancher suit.
    etat = etendre(etat, retenir_lot([497, 498, 499], lot=LOT_BACKFILL))
    assert (etat.uid_min, etat.uid_max) == (497, 502)

    # Troisième tour : on ne redemande jamais 497–502.
    plan3 = planifier_dossier(etat=etat, aujourd_hui=AUJOURD_HUI, backfill_months=3)
    assert plan3.courante.depuis_uid == 503
    assert plan3.historique is not None
    assert plan3.historique.jusqu_uid == 496


# ---------------------------------------------------------------------------------------------
# §20.6 bis.3 — la traduction du plan en UID, et l'ordre courant-d'abord
# ---------------------------------------------------------------------------------------------

from mail_sync.backfill import PasseCourante, PasseHistorique, PlanDossier  # noqa: E402
from mail_sync.ingestion import uids_a_relever  # noqa: E402


class ImapFactice:
    """Enregistre les recherches émises et rend ce qu'on lui a dit de rendre.

    Il n'imite pas un serveur IMAP : il en reproduit la seule surface que le plan emploie. Ce que
    ces preuves observent est **la recherche réellement émise**, comme `tracks.test.ts` observe la
    requête PostgREST plutôt que la seule réponse.
    """

    def __init__(self, reponses: list[list[int]]) -> None:
        self.reponses = list(reponses)
        self.recherches: list[list] = []

    def search(self, criteres):
        self.recherches.append(list(criteres))
        return self.reponses.pop(0) if self.reponses else []


def test_le_plan_courant_par_uid_emet_une_recherche_bornee_par_uid():
    imap = ImapFactice([[43, 44]])
    plan = PlanDossier(courante=PasseCourante(depuis_uid=43, depuis_date=None), historique=None)
    assert uids_a_relever(imap, plan) == [43, 44]
    assert imap.recherches == [["UID", "43:*"]]


def test_le_premier_contact_emet_une_recherche_par_DATE():
    imap = ImapFactice([[7, 8]])
    plan = PlanDossier(
        courante=PasseCourante(depuis_uid=None, depuis_date=AUJOURD_HUI), historique=None
    )
    assert uids_a_relever(imap, plan) == [7, 8]
    assert imap.recherches == [["SINCE", AUJOURD_HUI]]


def test_un_uid_deja_connu_rendu_par_la_plage_est_ECARTE():
    # `UID <n>:*` rend toujours au moins un message sur un dossier non vide — propriété d'IMAP, non
    # un défaut : la plage est bornée par le plus grand UID existant lorsqu'il est inférieur à `n`.
    # Sans ce filtre, le dernier message de la boîte serait refetché à CHAQUE tour.
    imap = ImapFactice([[42]])
    plan = PlanDossier(courante=PasseCourante(depuis_uid=43, depuis_date=None), historique=None)
    assert uids_a_relever(imap, plan) == []


def test_le_courant_passe_AVANT_l_historique_dans_la_liste_rendue():
    # C'est la règle du §20.6 : « le courrier du jour ne doit pas attendre que dix ans d'archives
    # soient descendus ». Elle est ici observable sur l'ordre de la liste.
    imap = ImapFactice([[50, 51], [10, 11, 12]])
    plan = PlanDossier(
        courante=PasseCourante(depuis_uid=50, depuis_date=None),
        historique=PasseHistorique(borne=date(2026, 2, 11), jusqu_uid=49, lot=2),
    )
    obtenus = uids_a_relever(imap, plan)
    # Les deux courants d'abord, puis le lot d'historique — les DEUX plus grands sous 49.
    assert obtenus == [50, 51, 11, 12]


def test_la_recherche_d_historique_porte_la_borne_ET_la_plage_d_uid():
    imap = ImapFactice([[], [10]])
    borne = date(2026, 2, 11)
    plan = PlanDossier(
        courante=PasseCourante(depuis_uid=50, depuis_date=None),
        historique=PasseHistorique(borne=borne, jusqu_uid=49, lot=200),
    )
    uids_a_relever(imap, plan)
    assert imap.recherches[1] == ["SINCE", borne, "UID", "1:49"]


def test_aucune_recherche_d_historique_n_est_emise_quand_il_n_y_en_a_pas():
    # `backfill_months = 0` supprime la passe : pas une requête qui ne rapporte rien (§20.6 bis.5).
    imap = ImapFactice([[1]])
    plan = PlanDossier(courante=PasseCourante(depuis_uid=1, depuis_date=None), historique=None)
    uids_a_relever(imap, plan)
    assert len(imap.recherches) == 1


def test_un_uid_hors_plage_rendu_par_le_serveur_est_ecarte_de_l_historique():
    # Défense contre un serveur qui interpréterait `1:49` largement : le plan borne, il ne suppose
    # pas. Sans ce filtre, un UID au-dessus du plancher serait recompté comme de l'historique.
    imap = ImapFactice([[], [48, 60]])
    plan = PlanDossier(
        courante=PasseCourante(depuis_uid=50, depuis_date=None),
        historique=PasseHistorique(borne=date(2026, 2, 11), jusqu_uid=49, lot=200),
    )
    assert uids_a_relever(imap, plan) == [48]
