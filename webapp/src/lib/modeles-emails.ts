// @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2b : L'ÉCRAN
// @spec docs/SPEC-modeles-emails.md §9.2 (ce que l'écran lit), §9.3 (le guichet des variables et
//       l'insertion dans le champ), §9.5 (les trois sources de la prévisualisation), §9.6 (ce que
//       `variables_nulles` rend), §9.8 (le dictionnaire fermé des refus)
// @spec docs/SPEC-modeles-emails.md §2.5 (ce que la base refuse), §2.7 (contrat d'API de la
//       table), §8.3 (contrat de `public.rendre_modele_email`), §8.8 (contrat d'API du rendu)
// @spec docs/DESIGN_SYSTEM.md §5.39 (la surface) ; docs/SPEC-permissions-rls.md §7 (le refus est
//       zéro ligne, jamais une erreur)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE ET N'AJOUTE AUCUNE RÈGLE. Il lit `mail_templates` sous la RLS
// de la migration `0055`, y écrit par les routes REST de cette même table — il n'existe aucune RPC
// d'écriture, et c'est un choix de la spécification (§2.6) : la règle tient entièrement dans les
// quatre politiques —, et appelle `public.rendre_modele_email` (`0056`) et
// `public.mail_template_variables` (`0057`).
//
// IL NE REND JAMAIS LE MESSAGE DU SERVEUR, et le motif est ici plus étroit que l'INC-193 des
// identités : le corps d'un refus de contrainte de PostgREST porte le champ `details`, qui contient
// la LIGNE FAUTIVE ENTIÈRE — c'est-à-dire le corps du modèle, jusqu'à 20 000 caractères (§9.8). Un
// refus est **classé** en une issue du dictionnaire fermé ci-dessous, et rien du serveur n'atteint
// l'écran.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit — §9.2
// ---------------------------------------------------------------------------------------------

/** Un modèle d'email tel que la liste et la fiche ont besoin de le connaître — §9.2, §9.4. */
export type ModeleEmail = Pick<
	Database['public']['Tables']['mail_templates']['Row'],
	'id' | 'workspace_id' | 'name' | 'subject' | 'body_text'
>

/**
 * Colonnes réellement demandées. Exportées pour que les tests vérifient la requête émise.
 *
 * `created_by` en est ABSENTE, et ce n'est pas un oubli : la colonne est une **trace, jamais un
 * droit** (§2.2), aucune politique ne la lit (§2.7 ligne 14), et l'écran ne la montre pas. Ne pas
 * lire ce qu'on ne montre pas est la discipline des deux modules jumeaux.
 *
 * `created_at` et `updated_at` en sont absentes pour la même raison : la liste du §5.39 ne porte
 * aucune date, un modèle n'ayant pas d'histoire à rendre.
 *
 * LA COMPOSITION EST UN GABARIT `as const` : `supabase-js` type la réponse à partir du **littéral**
 * passé à `select`, et une concaténation élargirait le type à `string`, ce qui ferait retomber la
 * ligne rendue sur `GenericStringError`.
 */
export const COLONNES_MODELE_EMAIL = 'id, workspace_id, name, subject, body_text' as const

/**
 * Les modèles visibles par l'appelant, triés par nom.
 *
 * LE TRI SUIT LA TÊTE DE LIGNE (§9.4) : le nom est la clé, `mail_templates_workspace_name_key` le
 * rendant unique par workspace sur sa forme normalisée.
 *
 * La RLS de `0055` fait tout le tri des droits : tout membre du workspace LIT, y compris la
 * lectrice (§2.6). Un appelant anonyme reçoit `200` et zéro ligne — un filtrage, jamais une erreur
 * (§2.7 ligne 1).
 */
export async function lireModelesEmails(
	client: ClientCrm,
): Promise<EtatAsync<readonly ModeleEmail[]>> {
	try {
		const reponse = await client
			.from('mail_templates')
			.select(COLONNES_MODELE_EMAIL)
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * La liste fermée des douze variables, telle que la base la porte — §9.3.
 *
 * ELLE N'EST JAMAIS RECOPIÉE ICI, et c'est la décision du §9.3 : `app.mail_template_variables()`
 * est la source unique (§3), le schéma `app` n'est pas exposé par PostgREST — mesuré,
 * `PGRST_DB_SCHEMAS` vaut `public,storage,graphql_public` —, et la migration `0057` pose donc un
 * guichet public qui DÉLÈGUE. Une treizième variable ajoutée au §2.4 paraîtra dans la palette de
 * l'écran sans qu'on touche à l'interface.
 */
export async function lireVariablesModele(
	client: ClientCrm,
): Promise<EtatAsync<readonly string[]>> {
	try {
		const reponse = await client.rpc('mail_template_variables')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data ?? [])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Ce que l'écran écrit — §9.8
// ---------------------------------------------------------------------------------------------

/**
 * La saisie de la fiche, telle que le composant la porte.
 *
 * `idModele` vaut `null` pour une création. Les trois textes partent **tels quels** vers la base,
 * sans `trim` ni garde : `app.btrim_blancs` est appliqué par les contraintes (§2.2), et normaliser
 * ici doublerait une règle de la base — ce que le §5.3 ter interdit.
 */
export type SaisieModeleEmail = {
	readonly idWorkspace: string
	/** `null` = création ; sinon, l'identifiant du modèle modifié. */
	readonly idModele: string | null
	readonly nom: string
	readonly objet: string
	readonly corps: string
}

/**
 * Les issues d'une écriture — dictionnaire fermé du §9.8.
 *
 * Chacune correspond à une réponse mesurée par `e2e/api/modeles-emails.spec.ts` (§2.7), jamais à
 * une hypothèse. `inconnu` est le **repli nommé** : nommer « je ne sais pas » est une réponse, la
 * déguiser en une cause précise n'en est pas une.
 */
export type IssueEcritureModele =
	/** `201` sur une création, `200` sur une modification : la ligne est rendue. */
	| 'enregistre'
	/** `403`, `42501` : la lectrice n'insère pas (§2.7 ligne 6). */
	| 'refus'
	/**
	 * `200` et `[]` sur un `PATCH` : la politique ne consent pas, et la base ne lève AUCUNE erreur
	 * (§2.7 ligne 7, `docs/SPEC-permissions-rls.md` §7). L'écran le dit en toutes lettres plutôt
	 * que d'annoncer un succès qui n'a pas eu lieu.
	 */
	| 'zero-ligne'
	/** `400`, `23514`, `mail_templates_subject_variables` ou `_body_variables` (§2.5 d et e). */
	| 'variable-inconnue-objet'
	| 'variable-inconnue-corps'
	/** `400`, `23514`, `mail_templates_name_borne` (§2.5 h). */
	| 'nom-borne'
	/** `400`, `23514`, `mail_templates_subject_borne` (§2.5 k, l). */
	| 'objet-borne'
	/** `400`, `23514`, `mail_templates_body_borne` (§2.5 k, l). */
	| 'corps-borne'
	/** `409`, `23505`, `mail_templates_workspace_name_key` (§2.5 i). */
	| 'nom-pris'
	/** `401` : la session n'existe plus. */
	| 'session-expiree'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'reseau'
	/** Tout le reste. L'interface ne prétend pas savoir, et ne recopie pas le serveur. */
	| 'inconnu'

/**
 * Classe une réponse d'écriture en une issue du dictionnaire fermé.
 *
 * ON CLASSE SUR DES IDENTIFIANTS STABLES, JAMAIS SUR DE LA PROSE : les noms de contrainte sont des
 * identifiants du schéma, versionnés par la migration `0055`, et `e2e/api/modeles-emails.spec.ts`
 * les mesure dans le message rendu par PostgREST. Le message n'est ni rendu, ni journalisé : il
 * entre ici, il en sort une issue.
 *
 * LES DEUX CONTRAINTES DE VARIABLES SONT DISTINGUÉES, et c'est pour cela que la migration `0055`
 * en nomme deux plutôt qu'une (§2.3) : sans cette distinction, l'écran devrait deviner près de quel
 * champ poser son message.
 *
 * L'ORDRE DES TESTS COMPTE : `mail_templates_subject_variables` contient `mail_templates_subject`,
 * si bien qu'un test de borne posé d'abord capturerait un refus de variable. Les deux contraintes
 * de variables sont donc examinées AVANT les bornes.
 */
export function classerEcritureModele(
	statutHttp: number | undefined,
	message: string | null,
): IssueEcritureModele {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (message === null) {
		return statutHttp >= 200 && statutHttp < 300 ? 'enregistre' : 'inconnu'
	}
	if (message.includes('mail_templates_subject_variables')) return 'variable-inconnue-objet'
	if (message.includes('mail_templates_body_variables')) return 'variable-inconnue-corps'
	if (message.includes('mail_templates_name_borne')) return 'nom-borne'
	if (message.includes('mail_templates_subject_borne')) return 'objet-borne'
	if (message.includes('mail_templates_body_borne')) return 'corps-borne'
	if (message.includes('mail_templates_workspace_name_key')) return 'nom-pris'
	if (statutHttp === 401) return 'session-expiree'
	if (statutHttp === 403) return 'refus'
	return 'inconnu'
}

export type ResultatEcritureModele =
	| { readonly issue: 'enregistre'; readonly modele: ModeleEmail }
	| { readonly issue: Exclude<IssueEcritureModele, 'enregistre'> }

/** Le corps envoyé à la base, calculé depuis la saisie — `workspace_id` seulement à la création. */
export function corpsEcritureModele(
	saisie: SaisieModeleEmail,
): Record<string, string> {
	const corps: Record<string, string> = {
		name: saisie.nom,
		subject: saisie.objet,
		body_text: saisie.corps,
	}
	// `workspace_id` n'est envoyé QU'À LA CRÉATION : le renvoyer sur un `PATCH` proposerait de
	// déplacer un modèle d'un workspace à l'autre, geste qu'aucune spécification ne prend et que la
	// clause `with check` refuserait par zéro ligne — un refus qui se lirait comme un défaut.
	if (saisie.idModele === null) corps['workspace_id'] = saisie.idWorkspace
	return corps
}

/**
 * Écrit un modèle — création ou modification, selon que `idModele` est nul.
 *
 * LA LIGNE ÉCRITE EST RELUE PAR `select()`, et ce n'est pas un confort : c'est le seul moyen de
 * distinguer un `PATCH` **consenti** d'un `PATCH` que la politique a laissé passer sans rien
 * écrire. Sans `select()`, PostgREST rend `204` dans les deux cas, et l'écran annoncerait un succès
 * qui n'a pas eu lieu (§2.7 ligne 7).
 */
export async function enregistrerModeleEmail(
	client: ClientCrm,
	saisie: SaisieModeleEmail,
): Promise<ResultatEcritureModele> {
	try {
		const corps = corpsEcritureModele(saisie)
		const reponse =
			saisie.idModele === null
				? await client
						.from('mail_templates')
						.insert(corps as never)
						.select(COLONNES_MODELE_EMAIL)
				: await client
						.from('mail_templates')
						.update(corps as never)
						.eq('id', saisie.idModele)
						.select(COLONNES_MODELE_EMAIL)
		const issue = classerEcritureModele(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
		)
		if (issue !== 'enregistre') return { issue }
		const lignes = reponse.data ?? []
		// ZÉRO LIGNE N'EST PAS UN SUCCÈS. C'est le refus silencieux de la politique, et l'écran le
		// nomme (§9.8) plutôt que de le confondre avec un enregistrement.
		if (lignes.length === 0) return { issue: 'zero-ligne' }
		const premiere = lignes[0]
		if (premiere === undefined) return { issue: 'inconnu' }
		return { issue: 'enregistre', modele: premiere }
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre.
		void cause
		return { issue: 'reseau' }
	}
}

/** Les issues d'une suppression — mêmes causes, et le même zéro-ligne (§2.7 ligne 8, §9.7). */
export type IssueSuppressionModele =
	| 'supprime'
	| 'zero-ligne'
	| 'refus'
	| 'session-expiree'
	| 'reseau'
	| 'inconnu'

/**
 * Supprime un modèle — §9.7.
 *
 * `select()` EST INDISPENSABLE ICI, et pour une raison mesurée : la lectrice qui confirme reçoit
 * `204` et **la ligne est toujours là** (§2.7 ligne 8). Sans relecture des lignes supprimées,
 * l'écran annoncerait une suppression que la base a refusée en silence.
 */
export async function supprimerModeleEmail(
	client: ClientCrm,
	idModele: string,
): Promise<IssueSuppressionModele> {
	try {
		const reponse = await client
			.from('mail_templates')
			.delete()
			.eq('id', idModele)
			.select('id')
		if (reponse.error !== null) {
			const issue = classerEcritureModele(reponse.status, reponse.error.message)
			if (issue === 'refus' || issue === 'session-expiree' || issue === 'reseau') return issue
			return 'inconnu'
		}
		return (reponse.data ?? []).length === 0 ? 'zero-ligne' : 'supprime'
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

// ---------------------------------------------------------------------------------------------
// La prévisualisation — §9.5, §9.6
// ---------------------------------------------------------------------------------------------

/** Une affaire telle que le sélecteur de prévisualisation a besoin de la connaître — §9.5. */
export type AffairePrevisualisation = Pick<
	Database['public']['Tables']['cards']['Row'],
	'id' | 'title'
>

/** Deux colonnes, et pas une de plus : le sélecteur ne rend qu'un titre (§9.2). */
export const COLONNES_AFFAIRE_PREVISUALISATION = 'id, title' as const

/**
 * Les affaires visibles par l'appelant, triées par titre — §9.5.
 *
 * POURQUOI UNE LECTURE DÉDIÉE PLUTÔT QUE `lirePageCards`. Celle-là est **paginée** et porte une
 * vingtaine de colonnes destinées à la liste des affaires : l'employer ici rapatrierait tout un
 * écran pour n'en rendre que le titre, et sa pagination obligerait le sélecteur à défiler ou à
 * mentir sur ce qu'il propose. Deux colonnes non paginées sont la forme exacte du besoin.
 *
 * **AUCUNE LIMITE, ET C'EST UNE LIMITE NOMMÉE.** MESURÉ : le seed porte **41** affaires, ce qu'un
 * `select` rend sans peine. Un workspace qui en porterait des milliers ferait de ce sélecteur une
 * liste impraticable, et il faudrait alors une recherche — que personne n'a spécifiée. Poser
 * aujourd'hui une pagination sans mesure serait l'optimisation que `CLAUDE.md` §21 refuse ; la
 * limite est donc écrite ici plutôt que devinée par le prochain lecteur.
 *
 * Aucune affaire n'est filtrée : la RLS fait tout le tri des droits, et la lectrice ne voit pas les
 * affaires du track qui lui est fermé (§8.8 ligne 5).
 */
export async function lireAffairesPrevisualisation(
	client: ClientCrm,
): Promise<EtatAsync<readonly AffairePrevisualisation[]>> {
	try {
		const reponse = await client
			.from('cards')
			.select(COLONNES_AFFAIRE_PREVISUALISATION)
			.order('title')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Ce que `public.rendre_modele_email` rend — §8.3, les trois colonnes. */
export type RenduModeleEmail = {
	readonly subject: string
	readonly body_text: string
	/** Les trous dont la source est nulle, TRIÉS et DÉDOUBLONNÉS par la base (§8.4). */
	readonly variables_nulles: readonly string[]
}

/**
 * Les trois sources de la prévisualisation, telles que les sélecteurs les portent — §9.5.
 *
 * LES TROIS SONT DES CHAÎNES, ET LA CHAÎNE VIDE SIGNIFIE « AUCUN CHOIX » : c'est ce qu'un `select`
 * dont l'option de tête est vide rend, et la convertir dans le composant y ferait naître une garde
 * que le §5.3 ter interdit. La conversion vit ici.
 */
export type SourcesPrevisualisation = {
	readonly idModele: string
	readonly idAffaire: string
	readonly idContact: string
	readonly idIdentite: string
}

/**
 * Rend un modèle appliqué à une affaire — §8.3, §9.5.
 *
 * `null` SIGNIFIE ZÉRO LIGNE, et zéro ligne N'EST PAS UNE ERREUR : la fonction rend zéro ligne
 * lorsque le modèle ou l'affaire n'est pas lisible, et **un identifiant inconnu et un identifiant
 * masqué rendent la même chose** (§8.3). L'écran les confond dans une seule phrase, parce que les
 * distinguer divulguerait ce que le zéro-ligne cache (§9.6).
 *
 * UNE AFFAIRE NON CHOISIE N'EST PAS TRAITÉE À PART : la chaîne vide part en `null`, la fonction
 * rend zéro ligne, et l'écran affiche la même phrase. Poser ici une garde ferait deux chemins pour
 * un seul état.
 */
export async function rendreModeleEmail(
	client: ClientCrm,
	sources: SourcesPrevisualisation,
): Promise<EtatAsync<RenduModeleEmail | null>> {
	try {
		const reponse = await client.rpc('rendre_modele_email', {
			p_template_id: sources.idModele,
			p_card_id: sources.idAffaire === '' ? (null as never) : sources.idAffaire,
			p_contact_id: sources.idContact === '' ? (null as never) : sources.idContact,
			p_identity_id: sources.idIdentite === '' ? (null as never) : sources.idIdentite,
		})
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as readonly RenduModeleEmail[]
		const premiere = lignes[0]
		if (premiere === undefined) return pret(null)
		return pret({
			subject: premiere.subject,
			body_text: premiere.body_text,
			// La base rend `text[]`, jamais `null` — mais un cache de schéma périmé rend une colonne
			// absente, et un `.length` sur `undefined` ferait planter l'écran (`docs/SPEC-types.md`).
			variables_nulles: premiere.variables_nulles ?? [],
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// La palette de variables — §9.3
// ---------------------------------------------------------------------------------------------

/** Le texte d'un trou, dans la graphie EXACTE que la base accepte (§2.3). */
export function trouDe(variable: string): string {
	return `{{${variable}}}`
}

/**
 * Insère un trou dans un texte à une position donnée, et rend la position du curseur APRÈS.
 *
 * LA POSITION EST CELLE DU CURSEUR, ET NON LA FIN DU TEXTE : un rédacteur qui pose une variable au
 * milieu d'une phrase ne veut pas la voir atterrir à la fin du corps. Une position hors bornes —
 * qu'un `input` jamais visité peut rendre — est ramenée à la fin du texte, jamais rejetée : ce
 * repli est écrit ici plutôt que découvert par un `slice` silencieusement faux.
 *
 * UNE SÉLECTION EST REMPLACÉE, elle n'est pas doublée : `debut` et `fin` sont les deux bornes que
 * l'élément rend, et elles sont égales lorsque rien n'est sélectionné.
 */
export function insererTrou(
	texte: string,
	debut: number,
	fin: number,
	variable: string,
): { readonly texte: string; readonly curseur: number } {
	const trou = trouDe(variable)
	const borneDebut = Number.isFinite(debut) ? Math.min(Math.max(debut, 0), texte.length) : texte.length
	const borneFin = Number.isFinite(fin) ? Math.min(Math.max(fin, borneDebut), texte.length) : borneDebut
	return {
		texte: `${texte.slice(0, borneDebut)}${trou}${texte.slice(borneFin)}`,
		curseur: borneDebut + trou.length,
	}
}

/**
 * Le texte rendu pour une identité dans le sélecteur de prévisualisation — `libellé — adresse`.
 *
 * C'est la forme du §5.35, et pour son motif exact : deux identités d'une même personne peuvent
 * porter le même libellé, et l'adresse est leur clé.
 */
export function libelleIdentitePrevisualisation(identite: {
	readonly label: string
	readonly from_address: string
}): string {
	return `${identite.label} — ${identite.from_address}`
}

/**
 * Le texte rendu pour un contact dans le sélecteur — le nom, et l'adresse quand elle existe.
 *
 * Un contact sans adresse ne produit ni tiret ni valeur inventée : la règle de la cellule vide du
 * §5.9. Deux homonymes se distinguent alors par leur seule position, ce qui est l'état du produit —
 * `contacts` ne porte aucune autre donnée distinctive obligatoire.
 */
export function libelleContactPrevisualisation(contact: {
	readonly full_name: string
	readonly email: string | null
}): string {
	const adresse = contact.email?.trim() ?? ''
	return adresse === '' ? contact.full_name : `${contact.full_name} — ${adresse}`
}
