// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4i :
//       le DÉTACHEMENT d'une affaire depuis la fiche d'un contact
// @spec docs/SPEC-contacts.md §18.2 (aucune fonction nouvelle : `detacherContact` est celle de 4c),
//       §18.3 (les onze mesures, et les quatre qui décident), §18.4 (où le geste s'ancre, et la
//       place de la confirmation dans une ligne de tableau), §18.5 (dictionnaire FERMÉ des refus),
//       §18.6 (de quoi le geste a l'air), §18.7 (contrat de comportement, cas a à m)
// @spec docs/DESIGN_SYSTEM.md §5.27 (ce geste), §5.21 (le même geste dans l'autre sens, dont il
//       hérite), §5.24 (le tableau qui le porte), §5.13 (confirmation DANS LE FLUX, jamais en
//       modale), §5.3 (bouton destructif), §6 (une confirmation NOMME son objet), §9 (icônes)
// @spec docs/SPEC-permissions-rls.md §7 (un refus silencieux est zéro ligne, jamais une erreur)
//
// TROIS ISSUES, ET LA TROISIÈME DOIT ÊTRE DITE (§18.3, mesure 2). Une SUPPRESSION est filtrée par
// la clause `USING` de `card_contacts_suppression`, qui rend la ligne INVISIBLE À L'ÉCRITURE :
// PostgREST rend `200` et zéro ligne, SANS aucune erreur, sur une ligne qui EXISTE et qui reste en
// base. C'est l'écart mesuré avec le RATTACHEMENT de 4h, filtré par `WITH CHECK`, qui REJETTE la
// ligne et rend un `403` explicite. Faire disparaître la ligne sur ce silence annoncerait un
// détachement qui n'a pas eu lieu — le mensonge que `CLAUDE.md` §18 interdit.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT, et c'est MESURÉ (§18.3, mesure 7) : la LECTRICE RÉUSSIT ce
// détachement sur « Assistant IA support — Nordis » et se voit opposer le silence sur « Refonte
// intranet Ville de Lyon », deux affaires qu'elle LIT l'une comme l'autre. Les droits fins de
// `CRM-012` divergent d'une affaire à l'autre POUR UN MÊME PROFIL. Griser la commande « parce que
// l'utilisateur est lecteur » lui retirerait un geste que la base lui accorde.

import { Unlink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { detacherContact, type NatureRefusRattachement } from '../lib/contacts'
import type { ClientCrm } from '../lib/supabase'

/**
 * Le dictionnaire FERMÉ des refus, jamais le message du serveur (§18.5, règle du §12.5).
 *
 * **DEUX NATURES SONT STRUCTURELLEMENT INATTEIGNABLES ICI, ET ELLES PARTAGENT LE TEXTE DE
 * `unknown`.** `deja-rattache` (`23505`) suppose une INSERTION, et `contact-inconnu` (`23503`)
 * suppose une clé étrangère à éprouver — une suppression n'en éprouve aucune. Leur donner un texte
 * propre ferait entrer dans le produit une phrase que **rien** ne peut afficher, donc qu'aucune
 * preuve ne peut éprouver. Le dictionnaire reste exhaustif parce que le type l'impose.
 *
 * `sans-effet` n'y figure PAS, et c'est le point du §18.3 : elle n'est ni un succès ni une erreur,
 * elle a son propre message.
 */
const MESSAGES_REFUS: Readonly<Record<NatureRefusRattachement, CleTraduction>> = {
	forbidden: 'contact.detach.refus.forbidden',
	network: 'contact.detach.refus.network',
	unknown: 'contact.detach.refus.unknown',
	'deja-rattache': 'contact.detach.refus.unknown',
	'contact-inconnu': 'contact.detach.refus.unknown',
}

/** Clé de l'issue « sans effet », déclarée pour que le contrôle de clés mortes la voie (§10). */
const CLE_SANS_EFFET: CleTraduction = 'contact.detach.noeffect'

export type ProprietesCommandeDetachement = {
	/** L'affaire dont on détacherait le contact — son identifiant sert de clé d'exclusivité. */
	readonly idCard: string
	readonly confirmationOuverte: boolean
	readonly onDemander: () => void
	readonly commande: React.Ref<HTMLButtonElement>
}

/**
 * La commande d'une ligne, dans la QUATRIÈME COLONNE du tableau des affaires (§18.4, §5.27).
 *
 * **Elle n'est jamais démontée**, à la différence des commandes de 4g et de 4h : sa confirmation
 * vit sur une LIGNE DISTINCTE, et la retirer ferait sauter la hauteur de la ligne du dessus au
 * moment précis où l'on demande à l'utilisateur de lire. Elle est seulement DÉSACTIVÉE tant que sa
 * confirmation est ouverte — il n'y a rien à rouvrir. Ce n'est pas une garde de droit (§18.6),
 * c'est une commande sans objet, comme l'est celle de 4h sans affaire choisie.
 */
export function CommandeDetachementAffaire({
	idCard,
	confirmationOuverte,
	onDemander,
	commande,
}: ProprietesCommandeDetachement) {
	return (
		<Button
			ref={commande}
			taille="compacte"
			disabled={confirmationOuverte}
			onClick={onDemander}
			data-testid="detacher-affaire-contact"
			data-card={idCard}
		>
			<Unlink aria-hidden="true" size={14} strokeWidth={2} />
			{t('contact.detach.action')}
		</Button>
	)
}

export type ProprietesConfirmationDetachement = {
	readonly client: ClientCrm
	readonly idCard: string
	readonly idContact: string
	/** Le titre de l'affaire, que la confirmation NOMME (§6, §18.6). */
	readonly titre: string
	/**
	 * Le geste est retombé : `message` vaut `null` sur un succès, et porte le texte à afficher sur
	 * les deux autres issues. La fiche est RELUE dans les trois cas (§18.6).
	 */
	readonly onGeste: (message: string | null) => void
	readonly onAnnuler: () => void
}

/**
 * La confirmation, DANS LE FLUX du document et jamais en modale (§5.13, §5.27).
 *
 * Elle NOMME L'AFFAIRE, et non le contact (§6) : c'est le §12.6 retourné, le contact étant ici le
 * décor — on lit sa fiche — et l'affaire la variable. Elle dit aussi que le RÔLE part avec le
 * rattachement : c'est la seule donnée que le geste détruit sans reprise.
 */
export function ConfirmationDetachementAffaire({
	client,
	idCard,
	idContact,
	titre,
	onGeste,
	onAnnuler,
}: ProprietesConfirmationDetachement) {
	const [enVol, setEnVol] = useState(false)
	const premier = useRef<HTMLButtonElement>(null)

	// Le focus ENTRE dans le bouton de confirmation à l'ouverture (§5.13, cas b du §18.7). Il peut
	// entrer au montage, à la différence du sélecteur de 4h : ce bouton n'est jamais `disabled` au
	// premier rendu, la confirmation ne lisant rien.
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const confirmer = useCallback(async () => {
		setEnVol(true)
		// `detacherContact` est celle de 4c, INCHANGÉE (§18.2). Son `.select('contact_id')` est ce
		// qui rend l'issue « zéro ligne touchée » OBSERVABLE : sans lui, PostgREST ne renverrait
		// aucun corps et le refus silencieux de la politique serait indistinguable d'un succès.
		const resultat = await detacherContact(client, idCard, idContact)
		setEnVol(false)
		if (resultat.statut === 'appliquee') {
			onGeste(null)
			return
		}
		// « SANS EFFET » N'EST NI UN SUCCÈS NI UNE ERREUR (§18.3, mesures 2 et 3). La clause `USING`
		// a filtré la ligne avant la suppression : rien n'a changé, et l'écran le dit plutôt que
		// d'annoncer un détachement qui n'a pas eu lieu. Un refus de droit et une ligne déjà partie
		// sont INDISTINGUABLES par construction, et un seul message les couvre — il n'affirme ni
		// l'un ni l'autre. La fiche est RELUE dans les deux cas.
		onGeste(
			resultat.statut === 'sans-effet'
				? t(CLE_SANS_EFFET)
				: t(MESSAGES_REFUS[resultat.refus.nature]),
		)
	}, [client, idCard, idContact, onGeste])

	return (
		// LA CONFIRMATION RESTE LISIBLE QUAND LE TABLEAU DÉFILE, ET C'EST UN DÉFAUT TROUVÉ PAR LA
		// VÉRIFICATION VISUELLE (`CLAUDE.md` §16), à 390 px.
		//
		// Le tableau des affaires vit dans un conteneur `.indique-debordement-x` (§12.6) : sous
		// 390 px, ses quatre colonnes le font défiler horizontalement, et cliquer « Détacher » y
		// pousse le défilement vers la droite pour amener la commande dans le champ. La ligne de
		// confirmation, qui appartient au même conteneur, se retrouvait alors AMPUTÉE SUR SA
		// GAUCHE : la question nommant l'affaire — précisément ce que le §6 exige de lire avant un
		// geste destructeur — sortait de l'écran.
		//
		// `sticky left-0` épingle le bloc au bord visible du conteneur plutôt qu'à celui du tableau,
		// et la borne de largeur le maintient dans la fenêtre. Sur un écran large, la largeur de la
		// cellule est inférieure à cette borne, qui ne s'applique donc pas : le rendu du §5.27 est
		// INCHANGÉ là où il était déjà correct. Ce n'est pas un contournement du débordement — le
		// tableau défile toujours —, c'est la reconnaissance que ce bloc porte de la PROSE et non
		// une donnée tabulaire.
		<div
			data-testid="confirmation-detachement-affaire"
			data-card={idCard}
			className="sticky left-0 max-w-[calc(100vw-2rem)] flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 my-2"
		>
			<p className="font-medium">{t('contact.detach.confirm.title', { titre })}</p>
			<p className="text-sm text-text-2">{t('contact.detach.confirm.body')}</p>
			<div className="flex gap-2">
				<Button
					ref={premier}
					variante="destructif"
					disabled={enVol}
					onClick={() => void confirmer()}
					data-testid="confirmer-detachement-affaire"
				>
					{enVol ? t('contact.detach.pending') : t('contact.detach.confirm.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler} data-testid="annuler-detachement-affaire">
					{t('contact.detach.cancel')}
				</Button>
			</div>
		</div>
	)
}
