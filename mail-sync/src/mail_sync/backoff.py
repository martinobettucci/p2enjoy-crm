# @spec CRM-059 (docs/BACKLOG.md) — reprise d'un envoi, et ce qui ne se reprend pas
# @spec docs/SPEC-mail-subsystem.md §20.3 (le backoff et sa borne), §7 (la file ne perd pas)
# @spec docs/JOURNAL.md décision 331
#
# CE MODULE NE PARLE À PERSONNE : ni SMTP, ni HTTP, ni SQL. Il décide, à partir d'un code d'échec
# et d'un compte de tentatives, si l'on rejoue et dans combien de temps — ce qui rend la règle
# éprouvable **sans serveur**, comme la Definition of Done l'exige (« pytest sur le backoff »).
#
# LA DISTINCTION QUI GOUVERNE TOUT : une PANNE se rejoue, un REFUS non. Un serveur injoignable
# reviendra ; un mot de passe faux ne deviendra pas juste en attendant. Les confondre produit l'un
# ou l'autre de deux défauts symétriques — perdre un message qu'un délai aurait sauvé, ou harceler
# un serveur avec une erreur qu'il redira à l'identique (décision 331).

from __future__ import annotations

from dataclasses import dataclass

#: Codes de PANNE : le transport a échoué, et il peut réussir plus tard. Ce sont ceux que
#: `smtp_probe.classer_panne_smtp` produit pour une défaillance de connexion ou de protocole.
PANNES_REJOUABLES: frozenset[str] = frozenset(
    {"connection_refused", "timeout", "tls_failed", "protocol_error"}
)

#: Première attente, en secondes. Une minute : assez pour qu'un redémarrage de serveur aboutisse,
#: assez peu pour qu'un utilisateur ne croie pas son message perdu.
DELAI_INITIAL_SECONDES = 60

#: Facteur de progression. Quatre plutôt que deux : à deux, la cinquième tentative tomberait encore
#: dans le quart d'heure, et un serveur en panne prolongée serait interrogé une dizaine de fois pour
#: rien. À quatre, la quatrième attente dépasse l'heure — l'ordre de grandeur d'une panne réelle.
FACTEUR = 4

#: Nombre maximal de tentatives — la cinquième est celle qui échoue définitivement, comme le §20.3
#: le tabule. LA BORNE COMPTE AUTANT QUE LA PROGRESSION : sans elle, un message adressé à un
#: domaine disparu resterait en file pour toujours, et l'exploitant croirait qu'il finira par
#: partir.
TENTATIVES_MAX = 5


@dataclass(frozen=True)
class Reprise:
    """Ce qu'il advient d'un envoi qui vient d'échouer."""

    rejouer: bool
    #: Délai avant la prochaine tentative, en secondes. Nul lorsqu'on ne rejoue pas.
    delai_secondes: int
    #: Le code retenu, tel qu'il sera écrit dans `last_error` — assaini par la base.
    code: str


def decider(code: str, tentatives: int) -> Reprise:
    """Décide du sort d'un envoi échoué.

    `tentatives` est le nombre de tentatives DÉJÀ faites, celle qui vient d'échouer comprise.

    UN REFUS NE SE REJOUE PAS, QUEL QUE SOIT LE COMPTE : `auth_failed` à la première tentative est
    déjà définitif. Attendre ne changera pas un mot de passe.
    """

    if code not in PANNES_REJOUABLES:
        return Reprise(rejouer=False, delai_secondes=0, code=code)
    if tentatives >= TENTATIVES_MAX:
        # LA BORNE EST ATTEINTE : le code d'origine est conservé, et non remplacé par un
        # « trop de tentatives » qui ferait perdre la cause réelle.
        return Reprise(rejouer=False, delai_secondes=0, code=code)
    return Reprise(
        rejouer=True,
        delai_secondes=DELAI_INITIAL_SECONDES * (FACTEUR ** max(tentatives - 1, 0)),
        code=code,
    )


def delais_prevus() -> tuple[int, ...]:
    """La suite des attentes, dans l'ordre — utile aux preuves et à la documentation.

    Elle est CALCULÉE, non recopiée : une table écrite à la main dans le manuel diverge du code au
    premier ajustement, et c'est alors la documentation qui ment.
    """

    return tuple(
        decider("timeout", tentative).delai_secondes for tentative in range(1, TENTATIVES_MAX)
    )
