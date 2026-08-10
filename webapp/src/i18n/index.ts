// @spec CRM-007 (docs/BACKLOG.md) — fonction de traduction
// @spec CRM-041 (docs/BACKLOG.md) — clés **paramétrées**, exigées par le repli du libellé d'une
//       transition (docs/SPEC-workflow-engine.md §7.5)
// @spec docs/DESIGN_SYSTEM.md §10 (clés stables, français par défaut) ; docs/SPEC-webapp.md §10
// @spec CLAUDE.md §23 (jamais de phrase construite par concaténation)
//
// `t` n'accepte que les clés déclarées : une clé inconnue est une **erreur de compilation**,
// pas une chaîne manquante découverte à l'exécution.
//
// La langue par défaut, et seule langue livrée, est le français. Le jour où une seconde langue
// arrive, `LANGUE_PAR_DEFAUT` devient le repli et `t` prend la langue courante en dernier
// paramètre ; les clés, elles, ne bougent pas — c'est tout l'objet de leur stabilité.
//
// SUBSTITUTION DE PARAMÈTRES, ajoutée par `CRM-041` (docs/JOURNAL.md décision 180). Le §7.5 de
// `docs/SPEC-workflow-engine.md` exige que le repli « Passer à *<étape cible>* » soit « composé par
// une clé de traduction paramétrée et **jamais par concaténation dans le composant** ». La première
// livraison du board écrivait `` `${t('board.transition.fallback')} ${etape.libelle}` `` : l'ordre
// des mots du français s'y trouvait figé dans du JSX, et une langue qui place son complément avant
// son verbe n'aurait eu aucun moyen de le corriger (CLAUDE.md §23).
//
// Le format est délibérément **minimal** : des accolades autour d'un nom, remplacées telles quelles.
// Ni pluriel, ni genre, ni format de nombre — aucune de ces règles n'est nécessaire aujourd'hui, et
// une bibliothèque de messages les apporterait toutes avec elle, au prix de la garantie que la
// décision 43 a retenue : une clé inconnue ne compile pas.
//
// Un paramètre absent de la chaîne est **ignoré en silence**, mais un marqueur sans valeur reste
// **visible** tel quel : il vaut mieux voir `{etape}` dans l'interface et corriger la clé, que de
// lire une phrase amputée dont rien ne signale qu'il y manque un mot.

import { fr, type CleTraduction } from './fr'

export const LANGUE_PAR_DEFAUT = 'fr' as const

export type Langue = typeof LANGUE_PAR_DEFAUT

/** Valeurs substituées aux marqueurs `{nom}` d'une clé paramétrée. */
export type ParametresTraduction = Readonly<Record<string, string>>

const dictionnaires: Readonly<Record<Langue, Readonly<Record<CleTraduction, string>>>> = {
	fr,
}

const MARQUEUR = /\{([a-zA-Z]+)\}/g

export function t(
	cle: CleTraduction,
	parametres?: ParametresTraduction,
	langue: Langue = LANGUE_PAR_DEFAUT,
): string {
	const modele = dictionnaires[langue][cle]
	if (parametres === undefined) return modele
	return modele.replace(MARQUEUR, (marqueur, nom: string) =>
		Object.hasOwn(parametres, nom) ? (parametres[nom] as string) : marqueur,
	)
}

export type { CleTraduction }
export { fr }
