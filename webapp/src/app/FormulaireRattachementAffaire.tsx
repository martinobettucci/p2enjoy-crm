// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4h :
//       le rattachement d'une affaire depuis la fiche d'un contact
// @spec docs/SPEC-contacts.md §17.2 (où le geste s'ancre), §17.3 (ce que le sélecteur lit, et les
//       trois mesures qui l'ont décidé), §17.4 (les huit mesures d'autorisation, et le refus qui
//       NE ressemble PAS à celui de 4g), §17.5 (ce que le formulaire envoie),
//       §17.6 (de quoi il a l'air), §17.7 (contrat de comportement, cas a à n),
//       §17.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.26 (ce geste), §5.21 (le même geste dans l'autre sens, dont il
//       hérite), §5.13 (formulaire DANS LE FLUX, jamais en modale ; focus entrant puis rendu),
//       §5.7 (champs), §5.7 ter (un refus n'efface pas la saisie), §5.8 (états), §9 (icônes Lucide)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
//
// L'ÉCRAN NE CALCULE AUCUN DROIT, ET AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE selon le rôle (§17.6).
// La règle vit dans `card_contacts_insertion` ; une commande grisée ferait passer une décision de
// la base pour une décision d'écran (`CLAUDE.md` §10). MESURÉ : un business developer RÉUSSIT ce
// geste (§17.4, mesure 10), la politique portant sur le droit d'écriture de l'affaire et non sur un
// rôle de workspace.
//
// AUCUNE MENTION « SANS EFFET » N'A D'OBJET ICI, ET C'EST L'ÉCART MESURÉ AVEC 4g. Une insertion est
// filtrée par la clause WITH CHECK, qui REJETTE la ligne : la lectrice reçoit un `403` EXPLICITE
// (§17.4, mesure 9). La modification d'un contact, elle, est filtrée par la clause USING, qui rend
// la ligne invisible à l'écriture et rend `200` avec zéro ligne sans aucune erreur (§16.3). Écrire
// ici un message « sans effet » décrirait une issue que la base ne produit pas.

import { Link2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import {
	rattacherContact,
	type AffaireRattachable,
	type NatureRefusRattachement,
} from '../lib/contacts'
import type { ClientCrm } from '../lib/supabase'

/**
 * Le dictionnaire FERMÉ des refus, jamais le message du serveur (§5.21, règle du §12.5).
 *
 * **`contact-inconnu` ET `forbidden` PARTAGENT LE MÊME TEXTE, ET C'EST MESURÉ** (§17.4, mesure 12) :
 * une affaire INEXISTANTE rend `403` / `42501`, exactement comme un droit manquant, parce que
 * `app.can_write_card` est faux avant que la clé étrangère ne soit seulement éprouvée. Le code
 * `23503` — que le §12.5 distingue parce que le CONTACT y était la variable — est donc
 * **inatteignable depuis cette surface**, où c'est l'AFFAIRE qui varie. Les deux causes sont
 * indistinguables par construction (situation du §15.4), et inventer deux messages que la mesure ne
 * sait pas séparer affirmerait à l'utilisateur une cause que l'on ignore.
 */
const MESSAGES_REFUS: Readonly<Record<NatureRefusRattachement, CleTraduction>> = {
	'deja-rattache': 'contact.attach.refus.alreadyAttached',
	'contact-inconnu': 'contact.attach.refus.forbidden',
	forbidden: 'contact.attach.refus.forbidden',
	network: 'contact.attach.refus.network',
	unknown: 'contact.attach.refus.unknown',
}

/** Classes du contrôle de saisie, celles du §5.7 : 40 px de haut, bordure, fond de surface. */
const CLASSES_CONTROLE = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3'

export type ProprietesFormulaireRattachementAffaire = {
	readonly client: ClientCrm
	readonly idWorkspace: string
	readonly idContact: string
	/** Les affaires offertes, DÉJÀ privées de celles auxquelles ce contact est rattaché (§17.6). */
	readonly affaires: EtatAsync<readonly AffaireRattachable[]>
	/** Relance la lecture de la liste — l'action de reprise du cas l (§5.8, §5.22). */
	readonly onRelireAffaires: () => void
	/** Le rattachement a été accepté : la fiche se relit (§17.6). */
	readonly onRattachee: () => void
	readonly onFermer: () => void
}

/**
 * Le formulaire, DANS LE FLUX du document et jamais en modale (§5.13, §5.26).
 *
 * Le motif propre à cette surface : **le tableau des affaires est ce qui dit à quelles affaires le
 * contact est déjà rattaché**, et une modale recouvrirait la réponse à la question que l'on se pose
 * en ouvrant le geste.
 */
export function FormulaireRattachementAffaire({
	client,
	idWorkspace,
	idContact,
	affaires,
	onRelireAffaires,
	onRattachee,
	onFermer,
}: ProprietesFormulaireRattachementAffaire) {
	const [idCard, setIdCard] = useState('')
	const [role, setRole] = useState('')
	const [enVol, setEnVol] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const premierChamp = useRef<HTMLSelectElement>(null)
	const focusEntre = useRef(false)

	/**
	 * LE FOCUS ENTRE DANS LE SÉLECTEUR DÈS QU'IL EST FOCALISABLE (§5.13, cas b du §17.7).
	 *
	 * **Il ne peut PAS entrer au montage, et c'est un défaut trouvé PAR LA PREUVE unitaire.** Le
	 * sélecteur est `disabled` tant que la liste se lit (§5.22), et **un élément désactivé ne reçoit
	 * pas le focus** : un effet à dépendances vides visait un contrôle qui le refusait, et ouvrir le
	 * formulaire au clavier laissait le focus sur le document — exactement le défaut que le §5.13
	 * interdit, déplacé de la fermeture vers l'ouverture.
	 *
	 * L'effet suit donc l'état de la liste, et le drapeau garantit qu'il n'entre **qu'une fois** :
	 * une relecture demandée par le cas l ne doit pas reprendre le focus pendant la saisie, ce qui
	 * serait le vol de focus que le §5.7 quater proscrit. **Aucune temporisation** (`CLAUDE.md` §18) :
	 * c'est le cycle de rendu de React qui ordonne les deux gestes.
	 */
	useEffect(() => {
		if (focusEntre.current) return
		const selecteur = premierChamp.current
		if (selecteur === null || selecteur.disabled) return
		selecteur.focus()
		focusEntre.current = true
	})

	const envoyer = useCallback(async () => {
		if (idCard === '') return
		setEnVol(true)
		setMessage(null)
		// `rattacherContact` est celle de 4c, INCHANGÉE (§17.5) : elle envoie déjà les quatre
		// colonnes d'un bloc et traduit un rôle vide en `null`, ce que la mesure 11 exige — la
		// contrainte `card_contacts_role_check` refuse la chaîne vide par `400` / `23514`.
		const resultat = await rattacherContact(client, { idWorkspace, idCard, idContact, role })
		setEnVol(false)
		if (resultat.statut === 'appliquee') {
			// Cas f du §17.7 : le formulaire se referme, le focus revient à la commande (le retour
			// est différé d'un tour de rendu par la fiche), et la fiche est RELUE — jamais complétée
			// localement. La relecture rapporte l'état d'archivage et l'adresse de l'affaire ajoutée,
			// que le sélecteur ne connaissait pas (§17.6).
			onRattachee()
			return
		}
		// UN REFUS N'EFFACE PAS LA SAISIE (§5.7 ter) et LE FORMULAIRE RESTE OUVERT : l'affaire
		// choisie et le rôle tapé restent à l'écran avec leur explication. Rejeter une saisie sans
		// le dire est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
		setMessage(t(MESSAGES_REFUS[resultat.refus.nature]))
	}, [client, idCard, idContact, idWorkspace, onRattachee, role])

	// Cas l du §17.7 : la liste n'a pas pu être lue. Le contrôle est DÉSACTIVÉ et porte son action
	// de reprise, qui relit réellement — l'unique dérogation à la règle du §5.7 ter, bornée par le
	// §5.22 : il n'y a rien à choisir, et un `select` vide mais actif serait une commande morte.
	if (affaires.statut === 'erreur') {
		return (
			<Cadre>
				<p
					role="alert"
					data-testid="erreur-affaires-rattachables"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{t('contact.attach.list.error')}
				</p>
				<div className="flex gap-2">
					<Button taille="compacte" onClick={onRelireAffaires} data-testid="relire-affaires">
						{t('contact.attach.list.retry')}
					</Button>
					<Button variante="secondaire" onClick={onFermer}>
						{t('contact.attach.cancel')}
					</Button>
				</div>
			</Cadre>
		)
	}

	const enChargement = affaires.statut !== 'pret'
	const offertes = affaires.statut === 'pret' ? affaires.donnees : []

	// Cas m du §17.7 : aucune affaire lisible, ou toutes déjà rattachées. Aucun sélecteur vide n'est
	// rendu — un contrôle sans option serait une commande morte (§5.10, §5.21). Les deux vides
	// portent des textes DISTINCTS : « cet espace de travail n'a aucune affaire » et « elles sont
	// toutes déjà rattachées » ne disent pas la même chose, et les confondre effacerait un fait.
	if (!enChargement && offertes.length === 0) {
		return (
			<Cadre>
				<p data-testid="aucune-affaire-rattachable" className="text-sm text-text-3">
					{t('contact.attach.noneAvailable')}
				</p>
				<div className="flex gap-2">
					<Button variante="secondaire" onClick={onFermer}>
						{t('contact.attach.cancel')}
					</Button>
				</div>
			</Cadre>
		)
	}

	return (
		<Cadre>
			<div className="flex flex-col gap-1">
				<label htmlFor="rattachement-affaire" className="text-sm text-text-2">
					{t('contact.attach.deal')}
				</label>
				<select
					id="rattachement-affaire"
					ref={premierChamp}
					value={idCard}
					disabled={enChargement}
					aria-busy={enChargement}
					onChange={(evenement) => setIdCard(evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-affaire"
				>
					{enChargement ? (
						<option value="">{t('contact.attach.loading')}</option>
					) : (
						<>
							<option value="">{t('contact.attach.dealPlaceholder')}</option>
							{offertes.map((affaire) => (
								<option key={affaire.id} value={affaire.id}>
									{/*
									  UNE AFFAIRE ARCHIVÉE PORTE LA MENTION DE SON ARCHIVAGE (§17.3,
									  §5.26). La base ACCEPTE ce rattachement — mesuré `201` —, et
									  l'exclure poserait une règle de produit que personne n'a prise.
									  La mention est un TEXTE dans le libellé, jamais une teinte : une
									  `option` native ne porte ni icône ni pilule, et le §1 interdit
									  qu'une couleur porte seule une information. Le titre est une
									  DONNÉE, la mention une traduction : elles se composent ici parce
									  qu'une `option` n'admet aucun balisage.
									*/}
									{affaire.archivee
										? t('contact.attach.dealArchived', { titre: affaire.titre })
										: affaire.titre}
								</option>
							))}
						</>
					)}
				</select>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor="rattachement-affaire-role" className="text-sm text-text-2">
					{t('contact.attach.role')}
				</label>
				<input
					id="rattachement-affaire-role"
					type="text"
					value={role}
					onChange={(evenement) => setRole(evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-role-affaire"
					aria-describedby="rattachement-affaire-role-aide"
				/>
				<p id="rattachement-affaire-role-aide" className="text-sm text-text-3">
					{t('contact.attach.roleHelp')}
				</p>
			</div>
			{message === null ? null : (
				<p
					role="alert"
					data-testid="refus-rattachement-affaire"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{message}
				</p>
			)}
			<div className="flex gap-2">
				{/*
				  LA COMMANDE N'EST JAMAIS ÉTEINTE PAR UN RÔLE (§17.6). Elle l'est tant qu'aucune
				  affaire n'est CHOISIE, ce qui est autre chose : il n'y a alors rien à envoyer, et
				  l'état désactivé reste lisible et s'explique par le sélecteur juste au-dessus (§8).
				*/}
				<Button
					variante="primaire"
					disabled={enVol || idCard === ''}
					onClick={() => void envoyer()}
					data-testid="confirmer-rattachement-affaire"
				>
					{enVol ? t('contact.attach.pending') : t('contact.attach.submit')}
				</Button>
				<Button variante="secondaire" onClick={onFermer}>
					{t('contact.attach.cancel')}
				</Button>
			</div>
		</Cadre>
	)
}

/** Le cadre commun aux trois visages du formulaire — même surface, mêmes rayons (§5.21). */
function Cadre({ children }: { readonly children: React.ReactNode }) {
	return (
		<div
			data-testid="formulaire-rattachement-affaire"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
		>
			{children}
		</div>
	)
}

/**
 * La commande qui OUVRE le geste, extraite pour que la fiche la monte sans dupliquer ses classes.
 *
 * Elle porte l'icône `Link2` du §5.21 — c'est le même geste, dans l'autre sens, et lui donner une
 * autre icône ferait lire deux gestes différents.
 */
export function CommandeRattachementAffaire({
	commande,
	onOuvrir,
}: {
	readonly commande: React.Ref<HTMLButtonElement>
	readonly onOuvrir: () => void
}) {
	return (
		<div>
			<Button ref={commande} onClick={onOuvrir} data-testid="ouvrir-rattachement-affaire">
				<Link2 aria-hidden="true" size={16} strokeWidth={2} />
				{t('contact.attach.action')}
			</Button>
		</div>
	)
}
