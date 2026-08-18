// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4c :
//       le rattachement d'un contact à une affaire, PREMIÈRE ÉCRITURE de la tranche
// @spec docs/SPEC-contacts.md §12.2 (où le bloc s'ancre), §12.3 (ce qu'il lit),
//       §12.4 (les treize mesures d'autorisation), §12.5 (le dictionnaire fermé des refus),
//       §12.6 (de quoi il a l'air), §12.7 (contrat de comportement, cas a à p),
//       §12.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.21 (ce bloc), §5.3 (sa place dans la colonne gauche),
//       §5.18 (la liste plate), §5.13 (formulaire et confirmation DANS LE FLUX, jamais en modale ;
//       focus entrant puis rendu), §5.8 (états), §5.6 (pilule), §6 (confirmation nommant l'objet),
//       §5.7 ter (un refus n'efface pas la saisie), §9 (icônes Lucide)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne)
//
// L'ÉCRAN NE CALCULE AUCUN DROIT, et AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE, quel que soit le
// rôle de l'appelant (§12.4). La règle vit dans `card_contacts_insertion` et
// `card_contacts_suppression` ; une commande grisée par l'interface ferait passer une décision de
// la base pour une décision d'écran (`CLAUDE.md` §10). MESURÉ : un business developer RÉUSSIT ce
// geste, la politique portant sur le droit d'écriture de la card et non sur un rôle de workspace.
//
// LE SÉLECTEUR N'OFFRE QUE LES CONTACTS NON ENCORE RATTACHÉS (§12.6). Ce n'est pas une garde de
// droit — c'est le refus d'une commande vouée à l'échec, rattacher deux fois le même contact
// rendant `409` (mesuré). Le refus `deja-rattache` reste néanmoins traduit : deux utilisateurs
// peuvent agir à la même seconde, et l'écran ne prétend pas connaître l'état du serveur.

import { Link2, Unlink } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t, type CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	detacherContact,
	libelleContactAvecOrganisation,
	lireContactsDeLAffaire,
	lireContactsDuCarnet,
	rattacherContact,
	type ContactDuCarnet,
	type ContactRattache,
	type NatureRefusRattachement,
} from '../lib/contacts'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { cheminOrganisation } from './chemins'

/**
 * Les cinq refus du dictionnaire FERMÉ du §12.5, jamais le message du serveur.
 *
 * C'est la règle déjà tenue par les codes d'incident de `CRM-059`, le classement des refus de
 * `CRM-075` et le geste de corbeille de `CRM-077` : un texte d'API n'est pas un texte pour un
 * humain, et le rendre tel quel exposerait le détail de la pile (`CLAUDE.md` §20).
 */
const MESSAGES_REFUS: Readonly<Record<NatureRefusRattachement, CleTraduction>> = {
	'deja-rattache': 'cardContacts.refus.alreadyAttached',
	'contact-inconnu': 'cardContacts.refus.unknownContact',
	forbidden: 'cardContacts.refus.forbidden',
	network: 'cardContacts.refus.network',
	unknown: 'cardContacts.refus.unknown',
}

/** Clé de l'issue « sans effet », nommée hors du JSX comme dans `RouteCard`. */
const CLE_SANS_EFFET: CleTraduction = 'cardContacts.noeffect'

/** Classes du contrôle de saisie, celles du §5.7 : 40 px de haut, bordure, fond de surface. */
const CLASSES_CONTROLE = 'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3'

export type ProprietesBlocContactsCard = {
	readonly idCard: string
	readonly idWorkspace: string
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}

/**
 * Ce que le bloc a chargé : les rattachements de l'affaire, et le carnet du workspace.
 *
 * LES DEUX SONT LUS ENSEMBLE, et c'est ce qui permet au sélecteur de n'offrir que les contacts
 * non encore rattachés sans requête supplémentaire (§12.3, §12.6).
 */
type ContenuBloc = {
	readonly rattaches: readonly ContactRattache[]
	readonly carnet: readonly ContactDuCarnet[]
}

export function BlocContactsCard({
	idCard,
	idWorkspace,
	client = clientCrm,
}: ProprietesBlocContactsCard) {
	const [etat, setEtat] = useState<EtatAsync<ContenuBloc>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage, ou périmée par une relecture, ne doit pas écraser un
	// état plus récent — même garde que `Carnet` et `EtatMessagerie`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			// Les deux lectures partent ENSEMBLE : elles ne dépendent pas l'une de l'autre, et les
			// enchaîner doublerait l'attente pour un affichage qui les exige toutes deux.
			const [lus, carnet] = await Promise.all([
				lireContactsDeLAffaire(client, idCard),
				lireContactsDuCarnet(client),
			])
			if (rang !== courant.current) return
			// La lecture du carnet en échec ne fait PAS échouer le bloc : la liste des rattachements
			// est ce que l'écran doit montrer, et un carnet illisible ne retire que le choix du
			// sélecteur — cas l du §12.7, qui a déjà son texte.
			if (lus.statut === 'erreur') {
				setEtat(enErreur(lus.erreur))
				return
			}
			if (lus.statut !== 'pret') return
			setEtat(pret({ rattaches: lus.donnees, carnet: carnet.statut === 'pret' ? carnet.donnees : [] }))
		})()
	}, [client, idCard, tentative])

	// LA LISTE EST RELUE APRÈS CHAQUE ÉCRITURE, jamais complétée localement (§5.21) : une insertion
	// optimiste contredirait l'ordre du serveur le temps d'un rendu, et masquerait un rattachement
	// posé entre-temps par un collègue.
	const relire = useCallback(() => setTentative((precedente) => precedente + 1), [])

	/**
	 * LE MESSAGE DU DÉTACHEMENT VIT ICI, ET NON DANS LA LIGNE — défaut trouvé PAR LA PREUVE E2E,
	 * qui l'a rendue intermittente avant qu'aucune relecture ne soit visible à l'œil.
	 *
	 * La cause : une relecture repasse le bloc par `chargement`, ce qui DÉMONTE la liste et la
	 * ligne avec elle. Un message porté par la ligne disparaissait donc avec son porteur, alors que
	 * le §12.7 cas o exige les DEUX — dire « sans effet » ET relire. Le corriger par une
	 * temporisation aurait été le contournement que `CLAUDE.md` §18 interdit.
	 *
	 * Il reste DANS le bloc, près de ce qui l'a causé (§5.13, §5.16) : la ligne visée peut
	 * légitimement avoir disparu — c'est même l'une des deux causes du « sans effet ».
	 */
	const [messageGeste, setMessageGeste] = useState<string | null>(null)
	const relireApresGeste = useCallback((message: string | null) => {
		setMessageGeste(message)
		setTentative((precedente) => precedente + 1)
	}, [])

	// Sans client configuré, l'application entière rend déjà l'écran de configuration manquante
	// (`AppShell`) : cette branche n'est pas atteignable en production, et un bloc qui n'aurait
	// aucun client où lire serait une surface morte (§5.10).
	if (client === null) return null

	return (
		<section
			data-testid="bloc-contacts-card"
			aria-labelledby="bloc-contacts-titre"
			className="flex flex-col gap-3 border-t border-border pt-4"
		>
			<h2 id="bloc-contacts-titre" className="text-h3">
				{t('cardContacts.title')}
			</h2>
			<ContenuBlocContacts
				etat={etat}
				idCard={idCard}
				idWorkspace={idWorkspace}
				client={client}
				onReprise={relire}
				onGeste={relireApresGeste}
				messageGeste={messageGeste}
			/>
		</section>
	)
}

function ContenuBlocContacts({
	etat,
	idCard,
	idWorkspace,
	client,
	onReprise,
	onGeste,
	messageGeste,
}: {
	readonly etat: EtatAsync<ContenuBloc>
	readonly idCard: string
	readonly idWorkspace: string
	readonly client: ClientCrm
	readonly onReprise: () => void
	readonly onGeste: (message: string | null) => void
	readonly messageGeste: string | null
}) {
	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={2} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		// L'erreur se lit DANS le bloc, jamais en tête d'écran (§5.13, §5.16), et son action de
		// reprise relance réellement les deux lectures — cas f du §12.7.
		return (
			<div className="flex flex-col items-start gap-2" data-testid="erreur-contacts-card">
				<p role="alert" className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
					{t('cardContacts.error.body')}
				</p>
				<Button taille="compacte" onClick={onReprise}>
					{t('cardContacts.error.retry')}
				</Button>
			</div>
		)
	}

	const { rattaches, carnet } = etat.donnees
	const dejaRattaches = new Set(rattaches.map((rattache) => rattache.contactId))
	const rattachables = carnet.filter((contact) => !dejaRattaches.has(contact.id))

	return (
		<>
			{rattaches.length === 0 ? (
				// L'ÉTAT VIDE GARDE SON FORMULAIRE — cas d du §12.7 : c'est le geste qui le comble,
				// la règle du §5.13 pour une surface qui agit. L'écart du §5.16 (état vide sans
				// action) valait pour la corbeille et le carnet, qui ne livrent AUCUN geste.
				<p data-testid="contacts-card-vide" className="text-text-2">
					{t('cardContacts.empty')}
				</p>
			) : (
				<ul data-testid="liste-contacts-card" aria-label={t('cardContacts.list.aria')} className="flex flex-col">
					{rattaches.map((rattache) => (
						<LigneContactRattache
							key={rattache.contactId}
							rattache={rattache}
							idCard={idCard}
							client={client}
							onGeste={onGeste}
						/>
					))}
				</ul>
			)}
			{messageGeste === null ? null : (
				// Le message du geste se lit DANS le bloc, sous la liste qu'il concerne, jamais en
				// tête d'écran (§5.13, §5.16). Il survit à la relecture, ce que le §12.7 cas o exige.
				<p
					role="alert"
					data-testid="refus-detachement"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{messageGeste}
				</p>
			)}
			<FormulaireRattachement
				rattachables={rattachables}
				carnetVide={carnet.length === 0}
				idCard={idCard}
				idWorkspace={idWorkspace}
				client={client}
				onRelire={onReprise}
			/>
		</>
	)
}

/**
 * Une ligne de la liste plate du §5.18 : le contact, son organisation, son rôle, et sa commande.
 *
 * Le nom de l'ORGANISATION est un lien vers sa fiche (§5.20) ; le nom du CONTACT n'en est pas un —
 * il n'existe pas de fiche de contact, et un lien y serait mort (§11.8, §5.10).
 */
function LigneContactRattache({
	rattache,
	idCard,
	client,
	onGeste,
}: {
	readonly rattache: ContactRattache
	readonly idCard: string
	readonly client: ClientCrm
	/** Remonte le message du geste au BLOC, qui survit à la relecture, et relit la liste. */
	readonly onGeste: (message: string | null) => void
}) {
	const [confirmation, setConfirmation] = useState(false)
	const [enVol, setEnVol] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	/**
	 * Le focus est rendu APRÈS le rendu, et c'est le défaut que la preuve clavier de `CRM-077` a
	 * trouvé : la commande est DÉMONTÉE tant que la confirmation est ouverte, si bien qu'appeler
	 * `focus()` depuis le gestionnaire d'annulation viserait une référence nulle.
	 */
	const [focusARendre, setFocusARendre] = useState(false)

	useEffect(() => {
		if (confirmation || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [confirmation, focusARendre])

	const confirmer = useCallback(async () => {
		setEnVol(true)
		const resultat = await detacherContact(client, idCard, rattache.contactId)
		setEnVol(false)
		if (resultat.statut === 'appliquee') {
			onGeste(null)
			return
		}
		// « Sans effet » n'est NI un succès NI une erreur (§12.4, conséquence 1) : la clause `USING`
		// a filtré la ligne avant la suppression, rien n'a changé, et l'écran le dit plutôt que
		// d'annoncer un détachement qui n'a pas eu lieu. La liste est RELUE dans les deux cas : la
		// ligne a pu partir entre-temps, et l'écran ne prétend pas savoir laquelle des deux causes
		// s'applique (§12.4, conséquence 2).
		onGeste(
			resultat.statut === 'sans-effet'
				? t(CLE_SANS_EFFET)
				: t(MESSAGES_REFUS[resultat.refus.nature]),
		)
	}, [client, idCard, onGeste, rattache.contactId])

	const annuler = useCallback(() => {
		setConfirmation(false)
		setFocusARendre(true)
	}, [])

	return (
		<li
			data-testid="ligne-contact-card"
			data-contact={rattache.contactId}
			className="flex flex-col gap-2 border-b border-border py-1 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-2 min-h-[var(--size-target)]">
				<span className="font-medium">{rattache.nom}</span>
				{rattache.organisation === null ? null : (
					<Link
						to={cheminOrganisation(rattache.organisation.id)}
						data-testid="lien-organisation-rattachement"
						className="inline-flex items-center min-h-[var(--size-target)] text-sm text-brand hover:underline"
					>
						{rattache.organisation.name}
					</Link>
				)}
				{/*
				  LE RÔLE EST UN MOT, JAMAIS UNE TEINTE (§1), et il n'est PAS traduit : c'est une
				  valeur métier libre que la base n'énumère pas (§2.3), au même titre qu'un libellé
				  de track. Un rattachement SANS rôle ne rend RIEN à cette place — ni tiret, ni
				  « non renseigné » (§5.9).
				*/}
				{rattache.role === null ? null : (
					<span
						data-testid="role-rattachement"
						className="rounded-full bg-hover px-2 py-[2px] text-sm text-text-2"
					>
						{rattache.role}
					</span>
				)}
				<span className="grow" />
				{confirmation ? null : (
					<Button
						ref={commande}
						taille="compacte"
						onClick={() => setConfirmation(true)}
						data-testid="detacher-contact"
					>
						<Unlink aria-hidden="true" size={14} strokeWidth={2} />
						{t('cardContacts.detach.action')}
					</Button>
				)}
			</div>
			{confirmation ? (
				<ConfirmationDetachement
					nom={rattache.nom}
					enCours={enVol}
					onConfirmer={() => void confirmer()}
					onAnnuler={annuler}
				/>
			) : null}
		</li>
	)
}

/**
 * La confirmation, DANS LE FLUX du document et jamais en modale (§5.13, §5.21).
 *
 * Elle NOMME le contact (§6) : le détachement retire la ligne et le rôle saisi avec elle, sans
 * reprise possible. Son bouton d'action est destructif — la teinte de danger annonce le geste
 * qu'on est sur le point de commettre, exactement comme au §5.3.
 */
function ConfirmationDetachement({
	nom,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly nom: string
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const premier = useRef<HTMLButtonElement>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	return (
		<div
			data-testid="confirmation-detachement"
			className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
		>
			<p className="font-medium">{t('cardContacts.detach.confirm.title', { nom })}</p>
			<p className="text-sm text-text-2">{t('cardContacts.detach.confirm.body')}</p>
			<div className="flex gap-2">
				<Button
					ref={premier}
					variante="destructif"
					disabled={enCours}
					onClick={onConfirmer}
					data-testid="confirmer-detachement"
				>
					{enCours ? t('cardContacts.detach.pending') : t('cardContacts.detach.confirm.action')}
				</Button>
				<Button variante="secondaire" onClick={onAnnuler}>
					{t('cardContacts.detach.cancel')}
				</Button>
			</div>
		</div>
	)
}

/**
 * Le geste de rattachement : une commande, puis son formulaire DANS LE FLUX (§5.13).
 *
 * TROIS VIDES DISTINCTS, et aucun ne se confond avec un autre (§5.21) : « aucun contact rattaché »
 * garde son formulaire, « tous déjà rattachés » n'affiche aucun sélecteur vide, et « le workspace
 * n'a aucun contact » n'offre aucune action — aucun écran du produit ne crée de contact, et un
 * bouton y serait un chemin vers nulle part (§12.8).
 */
function FormulaireRattachement({
	rattachables,
	carnetVide,
	idCard,
	idWorkspace,
	client,
	onRelire,
}: {
	readonly rattachables: readonly ContactDuCarnet[]
	readonly carnetVide: boolean
	readonly idCard: string
	readonly idWorkspace: string
	readonly client: ClientCrm
	readonly onRelire: () => void
}) {
	const [ouvert, setOuvert] = useState(false)
	const [idContact, setIdContact] = useState('')
	const [role, setRole] = useState('')
	const [enVol, setEnVol] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const commande = useRef<HTMLButtonElement>(null)
	const premierChamp = useRef<HTMLSelectElement>(null)
	const [focusARendre, setFocusARendre] = useState(false)

	// Le focus ENTRE dans le premier contrôle à l'ouverture (§5.13). Sans cela, ouvrir le
	// formulaire au clavier laisse le focus sur une commande qui vient de disparaître.
	useEffect(() => {
		if (!ouvert) return
		premierChamp.current?.focus()
	}, [ouvert])

	useEffect(() => {
		if (ouvert || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [focusARendre, ouvert])

	const fermer = useCallback(() => {
		setOuvert(false)
		setIdContact('')
		setRole('')
		setMessage(null)
		setFocusARendre(true)
	}, [])

	const envoyer = useCallback(async () => {
		if (idContact === '') return
		setEnVol(true)
		setMessage(null)
		const resultat = await rattacherContact(client, {
			idWorkspace,
			idCard,
			idContact,
			role,
		})
		setEnVol(false)
		if (resultat.statut === 'appliquee') {
			// Le formulaire se referme, le focus revient à la commande, et la liste est RELUE —
			// cas g du §12.7.
			fermer()
			onRelire()
			return
		}
		// UN REFUS N'EFFACE PAS LA SAISIE (§5.7 ter) : le contact choisi et le rôle tapé restent à
		// l'écran avec leur explication. Rejeter une saisie sans le dire est la valeur par défaut
		// trompeuse que `CLAUDE.md` §18 interdit.
		setMessage(t(MESSAGES_REFUS[resultat.refus.nature]))
	}, [client, fermer, idCard, idContact, idWorkspace, onRelire, role])

	// Cas l du §12.7 : le workspace n'a AUCUN contact. Le bloc le nomme et s'arrête là — la
	// création d'un contact n'est livrée par aucun écran, et sa surface n'est spécifiée nulle part.
	if (carnetVide) {
		return (
			<p data-testid="carnet-vide" className="text-sm text-text-3">
				{t('cardContacts.attach.noContact')}
			</p>
		)
	}

	// Cas k : tous les contacts sont déjà rattachés. Aucun sélecteur vide n'est rendu — un contrôle
	// sans option serait une commande morte (§5.10).
	if (rattachables.length === 0) {
		return (
			<p data-testid="tous-rattaches" className="text-sm text-text-3">
				{t('cardContacts.attach.allAttached')}
			</p>
		)
	}

	if (!ouvert) {
		return (
			<div>
				<Button ref={commande} onClick={() => setOuvert(true)} data-testid="ouvrir-rattachement">
					<Link2 aria-hidden="true" size={16} strokeWidth={2} />
					{t('cardContacts.attach.action')}
				</Button>
			</div>
		)
	}

	return (
		<div
			data-testid="formulaire-rattachement"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
		>
			<div className="flex flex-col gap-1">
				<label htmlFor="rattachement-contact" className="text-sm text-text-2">
					{t('cardContacts.attach.contact')}
				</label>
				<select
					id="rattachement-contact"
					ref={premierChamp}
					value={idContact}
					onChange={(evenement) => setIdContact(evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-contact"
				>
					<option value="">{t('cardContacts.attach.contactPlaceholder')}</option>
					{rattachables.map((contact) => (
						<option key={contact.id} value={contact.id}>
							{/*
							  L'ORGANISATION DISTINGUE DEUX HOMONYMES. La composition vit désormais
							  dans `contacts.ts` (§13.3) : le sélecteur du formulaire l'emploie
							  aussi, et une règle d'affichage écrite deux fois divergerait.
							*/}
							{libelleContactAvecOrganisation(contact)}
						</option>
					))}
				</select>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor="rattachement-role" className="text-sm text-text-2">
					{t('cardContacts.attach.role')}
				</label>
				<input
					id="rattachement-role"
					type="text"
					value={role}
					onChange={(evenement) => setRole(evenement.target.value)}
					className={CLASSES_CONTROLE}
					data-testid="champ-role"
					aria-describedby="rattachement-role-aide"
				/>
				<p id="rattachement-role-aide" className="text-sm text-text-3">
					{t('cardContacts.attach.roleHelp')}
				</p>
			</div>
			{message === null ? null : (
				<p
					role="alert"
					data-testid="refus-rattachement"
					className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
				>
					{message}
				</p>
			)}
			<div className="flex gap-2">
				{/*
				  LA COMMANDE N'EST JAMAIS ÉTEINTE PAR UN RÔLE (§12.4). Elle l'est tant qu'aucun
				  contact n'est CHOISI, ce qui est autre chose : il n'y a alors rien à envoyer, et
				  l'état désactivé reste lisible et s'explique par le sélecteur juste au-dessus (§8).
				*/}
				<Button
					variante="primaire"
					disabled={enVol || idContact === ''}
					onClick={() => void envoyer()}
					data-testid="confirmer-rattachement"
				>
					{enVol ? t('cardContacts.attach.pending') : t('cardContacts.attach.submit')}
				</Button>
				<Button variante="secondaire" onClick={fermer}>
					{t('cardContacts.attach.cancel')}
				</Button>
			</div>
		</div>
	)
}
