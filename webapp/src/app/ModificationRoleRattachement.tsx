// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4j :
//       la MODIFICATION DU RÔLE d'un rattachement, depuis la fiche d'un contact
// @spec docs/SPEC-contacts.md §19.2 (une fonction nouvelle, et `role` SEUL dans le corps),
//       §19.3 (les quinze mesures, et les quatre qui décident), §19.4 (où le geste s'ancre, et
//       l'exclusivité entre les deux gestes de la ligne), §19.5 (dictionnaire FERMÉ des refus),
//       §19.6 (de quoi le geste a l'air), §19.7 (contrat de comportement, cas a à p)
// @spec docs/DESIGN_SYSTEM.md §5.28 (ce geste), §5.27 (le geste voisin, dont il hérite la place),
//       §5.25 (le refus silencieux qui doit être dit, et la saisie conservée), §5.13 (formulaire
//       DANS LE FLUX, jamais en modale), §5.7 (champs), §5.7 ter (un refus n'efface pas la
//       saisie), §6 (un geste nomme son objet), §9 (icônes Lucide)
// @spec docs/SPEC-permissions-rls.md §7 (un refus silencieux est zéro ligne, jamais une erreur)
//
// TROIS ISSUES, ET LA TROISIÈME DOIT ÊTRE DITE (§19.3, mesure 2). Une MISE À JOUR est filtrée par
// la clause `USING` de `card_contacts_maj`, qui rend la ligne INVISIBLE À L'ÉCRITURE : PostgREST
// rend `200` et zéro ligne, SANS aucune erreur, sur une ligne qui EXISTE et qui reste en base avec
// son rôle. Cette sous-tranche rejoint donc 4g et 4i, non 4h — dont le refus est un `403` explicite,
// une INSERTION étant filtrée par `WITH CHECK`, qui REJETTE la ligne. Refermer le formulaire sur ce
// silence annoncerait une modification qui n'a pas eu lieu.
//
// L'ÉCRAN NE CALCULE AUCUN DROIT, et c'est MESURÉ (§19.3, mesure 7) : la LECTRICE RÉUSSIT cette
// modification sur « Assistant IA support — Nordis » et se voit opposer le silence sur « Refonte
// intranet Ville de Lyon », deux affaires qu'elle LIT l'une comme l'autre. Les droits fins de
// `CRM-012` divergent d'une affaire à l'autre POUR UN MÊME PROFIL.

import { PencilLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { modifierRoleRattachement, type NatureRefusRole } from '../lib/contacts'
import type { ClientCrm } from '../lib/supabase'

/**
 * Le dictionnaire FERMÉ des refus, jamais le message du serveur (§19.5, règle du §12.5).
 *
 * **`saisie-invalide` REÇOIT UN TEXTE PROPRE LÀ OÙ LES DEUX AUTRES INATTEIGNABLES PARTAGENT CELUI
 * D'`unknown`, ET L'ÉCART EST MOTIVÉ.** `deja-rattache` (`23505`) suppose une insertion sur une clé
 * déjà prise, et `contact-inconnu` (`23503`) une clé étrangère à éprouver : une écriture du seul
 * `role` n'en fait ni l'une ni l'autre, et ces deux natures sont impossibles PAR CONSTRUCTION.
 * `saisie-invalide` (`23514`), elle, est une issue que la base produit RÉELLEMENT — mesurée deux
 * fois, sur la chaîne vide et sur la chaîne blanche (§19.3, mesures 8 et 10) —, et que seule la
 * normalisation de `modifierRoleRattachement` empêche d'atteindre. Lui donner le texte fourre-tout
 * d'`unknown` masquerait une cause connue derrière « une erreur est survenue » (`CLAUDE.md` §18).
 *
 * `sans-effet` n'y figure PAS, et c'est le point du §19.3 : elle n'est ni un succès ni une erreur,
 * elle a son propre message.
 */
const MESSAGES_REFUS: Readonly<Record<NatureRefusRole, CleTraduction>> = {
	forbidden: 'contact.role.refus.forbidden',
	network: 'contact.role.refus.network',
	'saisie-invalide': 'contact.role.refus.invalid',
	unknown: 'contact.role.refus.unknown',
	'deja-rattache': 'contact.role.refus.unknown',
	'contact-inconnu': 'contact.role.refus.unknown',
}

/** Clé de l'issue « sans effet », déclarée pour que le contrôle de clés mortes la voie (§10). */
const CLE_SANS_EFFET: CleTraduction = 'contact.role.noeffect'

/** Classes du contrôle de saisie, celles du §5.7 : 40 px de haut, bordure, fond de surface. */
const CLASSES_CONTROLE = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3'

export type ProprietesCommandeRole = {
	/** L'affaire dont on modifierait le rôle — son identifiant sert de clé d'exclusivité. */
	readonly idCard: string
	readonly blocOuvert: boolean
	readonly onDemander: () => void
	readonly commande: React.Ref<HTMLButtonElement>
}

/**
 * La commande d'une ligne, PREMIÈRE des deux de la quatrième colonne (§19.4, §5.28).
 *
 * **L'ordre est : modifier le rôle, puis détacher.** Le geste qui CORRIGE précède le geste qui
 * RETIRE, comme la colonne gauche de la fiche d'affaire place « Modifier » avant le bloc de
 * corbeille (§5.3, §5.3 ter). Un geste destructeur ne se pose jamais en premier sous le pointeur.
 *
 * **Elle n'est jamais démontée**, comme sa voisine et pour le motif du §18.4 : son retrait ferait
 * sauter la hauteur de la ligne au moment précis où l'on demande à l'utilisateur de lire. Elle est
 * DÉSACTIVÉE tant qu'un bloc de CETTE ligne est ouvert — le sien ou celui du détachement —, ce qui
 * n'est pas une garde de droit (§19.6) mais une commande sans objet.
 */
export function CommandeRoleRattachement({
	idCard,
	blocOuvert,
	onDemander,
	commande,
}: ProprietesCommandeRole) {
	return (
		<Button
			ref={commande}
			variante="secondaire"
			taille="compacte"
			disabled={blocOuvert}
			onClick={onDemander}
			data-testid="modifier-role-affaire"
			data-card={idCard}
		>
			<PencilLine aria-hidden="true" size={14} strokeWidth={2} />
			{t('contact.role.action')}
		</Button>
	)
}

export type ProprietesFormulaireRole = {
	readonly client: ClientCrm
	readonly idCard: string
	readonly idContact: string
	/** Le titre de l'affaire, que le formulaire NOMME (§6, §19.6). */
	readonly titre: string
	/** Le rôle courant, dont le champ est PRÉREMPLI — `null` donne un champ VIDE (cas c du §19.7). */
	readonly role: string | null
	/** La modification a abouti : la fiche prend le rôle rendu et NE RELIT RIEN (§19.6, §16.7). */
	readonly onModifie: (role: string | null) => void
	readonly onFermer: () => void
}

/**
 * Le formulaire, DANS LE FLUX du document et jamais en modale (§5.13, §5.28).
 *
 * Il NOMME L'AFFAIRE, et non le contact (§6) : c'est le §12.6 retourné, le contact étant ici le
 * décor — on lit sa fiche — et l'affaire la variable. Sans ce nom, un formulaire ouvert sous une
 * ligne d'un tableau qui défile ne dirait plus quel rattachement il modifie.
 */
export function FormulaireRoleRattachement({
	client,
	idCard,
	idContact,
	titre,
	role,
	onModifie,
	onFermer,
}: ProprietesFormulaireRole) {
	// LE CHAMP EST PRÉREMPLI DU RÔLE COURANT (§5.25, cas b du §19.7) : c'est précisément ce que l'on
	// vient corriger. Une colonne nulle donne un champ VIDE, jamais le texte « null » — la règle du
	// §5.9 appliquée à la saisie.
	const [saisie, setSaisie] = useState(role ?? '')
	const [enVol, setEnVol] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const champ = useRef<HTMLInputElement>(null)

	// Le focus ENTRE dans le champ à l'ouverture (§5.13, cas b du §19.7). Il peut entrer au montage,
	// à la différence du sélecteur de 4h : ce champ n'est jamais `disabled`, le formulaire ne lisant
	// rien. Le champ est le premier contrôle du bloc, et c'est là que la saisie commence.
	useEffect(() => {
		champ.current?.focus()
	}, [])

	const envoyer = useCallback(async () => {
		setEnVol(true)
		setMessage(null)
		// `role` SEUL part dans le corps, et c'est la mesure 12 qui l'impose (§19.2) : un `PATCH`
		// portant `card_id` DÉPLACERAIT le rattachement. La normalisation — blanc vaut `null` — vit
		// dans la fonction, où les mesures 8 et 10 l'ont placée.
		const resultat = await modifierRoleRattachement(client, idCard, idContact, saisie)
		setEnVol(false)
		if (resultat.statut === 'modifiee') {
			// Cas h du §19.7 : le formulaire se ferme, la cellule du rôle porte la NOUVELLE valeur, et
			// AUCUN message n'est affiché — la cellule EST la confirmation, et en écrire une seconde
			// dirait deux fois la même chose (§5.7 ter). Le rôle transmis est celui que la BASE a
			// enregistré, jamais celui que l'appelant a tapé.
			onModifie(resultat.role)
			return
		}
		// UN REFUS ET UN « SANS EFFET » LAISSENT LE FORMULAIRE OUVERT, ET LA SAISIE EST CONSERVÉE
		// (§5.7 ter, §5.25, cas l et m du §19.7). C'EST L'ÉCART AVEC LE §18.6, où la confirmation se
		// ferme dans les trois issues : là-bas il n'y a RIEN À CONSERVER, une confirmation ne portant
		// aucune saisie. Ici le rôle tapé est un travail de l'utilisateur, et le perdre pour une
		// erreur qui n'est pas la sienne serait la valeur par défaut trompeuse que `CLAUDE.md` §18
		// interdit.
		//
		// « SANS EFFET » N'EST NI UN SUCCÈS NI UNE ERREUR (§19.3, mesures 2 et 3). La clause `USING`
		// a filtré la ligne avant la mise à jour : rien n'a changé, et l'écran le dit plutôt que
		// d'annoncer une modification qui n'a pas eu lieu. Un refus de droit et un rattachement
		// disparu sont INDISTINGUABLES par construction, et un seul message les couvre.
		setMessage(
			resultat.statut === 'sans-effet'
				? t(CLE_SANS_EFFET)
				: t(MESSAGES_REFUS[resultat.refus.nature]),
		)
	}, [client, idCard, idContact, onModifie, saisie])

	return (
		// LE BLOC RESTE LISIBLE QUAND LE TABLEAU DÉFILE (§5.27, §5.28), et c'est la règle que la
		// vérification visuelle de 4i a posée pour TOUTE confirmation ou tout formulaire placé dans
		// une ligne de tableau défilant : `sticky left-0` l'épingle au bord visible du conteneur, et
		// la borne de largeur le maintient dans la fenêtre. Sur un écran large la borne ne s'applique
		// pas, la cellule étant plus étroite, et le rendu est INCHANGÉ.
		<div
			data-testid="formulaire-role-affaire"
			data-card={idCard}
			className="sticky left-0 max-w-[calc(100vw-2rem)] flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 my-2"
		>
			<p className="font-medium">{t('contact.role.title', { titre })}</p>
			<div className="flex flex-col gap-1">
				<label htmlFor={`role-rattachement-${idCard}`} className="text-sm text-text-2">
					{t('contact.role.field')}
				</label>
				{/*
				  AUCUNE GARDE DE LONGUEUR, ET C'EST MESURÉ (§19.3, mesure 14) : la base accepte un
				  rôle de cinq cents caractères et le rend entier. Poser un `maxLength` serait une
				  règle de produit que personne n'a prise (`CLAUDE.md` §10) ; la cellule du tableau
				  borne déjà l'AFFICHAGE à `32ch` avec son `title`, ce qui est une règle de rendu.
				*/}
				<input
					id={`role-rattachement-${idCard}`}
					ref={champ}
					type="text"
					value={saisie}
					onChange={(evenement) => setSaisie(evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-role-rattachement"
					aria-describedby={`role-rattachement-${idCard}-aide`}
				/>
				<p id={`role-rattachement-${idCard}-aide`} className="text-sm text-text-3">
					{t('contact.role.help')}
				</p>
			</div>
			{message === null ? null : (
				<p
					role="alert"
					data-testid="message-role-affaire"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{message}
				</p>
			)}
			<div className="flex gap-2">
				{/*
				  LE BOUTON D'ENVOI EST PRIMAIRE, JAMAIS DESTRUCTIF (§19.6) : corriger un rôle n'efface
				  rien qui ne se refasse par le même formulaire, et la teinte de danger est réservée à
				  ce qui détruit (§1, §6). C'est l'écart avec la confirmation VOISINE du §5.27, et il
				  est écrit pour qu'on ne recopie pas une teinte sans son motif.

				  IL N'EST JAMAIS DÉSACTIVÉ PAR L'ÉTAT DU CHAMP : un champ vide est un envoi LÉGITIME
				  — c'est l'effacement de la mesure 9 —, à la différence de la commande d'envoi de 4h,
				  qui n'a rien à envoyer sans affaire choisie.
				*/}
				<Button
					variante="primaire"
					disabled={enVol}
					onClick={() => void envoyer()}
					data-testid="confirmer-role-affaire"
				>
					{enVol ? t('contact.role.pending') : t('contact.role.submit')}
				</Button>
				<Button variante="secondaire" onClick={onFermer} data-testid="annuler-role-affaire">
					{t('contact.role.cancel')}
				</Button>
			</div>
		</div>
	)
}
