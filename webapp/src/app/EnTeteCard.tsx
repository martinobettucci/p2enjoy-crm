// @spec CRM-040 (docs/BACKLOG.md) — les champs d'en-tête de la fiche d'affaire, et leur écriture
// @spec docs/SPEC-cards.md §15.2 (où l'en-tête vit), §15.4 (les six données), §15.5 (l'action de
//       copie et ce qu'elle promet), §15.6 (accessibilité), §15.7 (les trois états de donnée),
//       §15 bis.1 (ce que le geste est), §15 bis.3 (le moment de l'écriture),
//       §15 bis.5 (ce que le produit n'invente pas), §15 bis.6 (le responsable),
//       §15 bis.7 (les issues), §15 bis.9 (interface, accessibilité et états)
// @spec docs/DESIGN_SYSTEM.md §5.3 (les champs d'entête et l'adresse en monospace),
//       §5.3 bis (les neuf règles visuelles), §5.3 ter (la bascule lecture / édition),
//       §5.7 (champs de formulaire), §5.7 ter (champ qui s'enregistre pour lui-même),
//       §2 (données techniques), §5.5 (boutons), §8 (accessibilité), §9 (icônes Lucide)
//
// L'en-tête ne lit RIEN par lui-même EN LECTURE : la card lui est passée, telle que `lireCard` l'a
// déjà chargée avec ses deux relations (docs/SPEC-cards.md §15.3). Une requête de plus pour une
// donnée de la même ligne serait un aller-retour gratuit.
//
// EN ÉDITION, il émet une lecture et une seule : celle des membres du workspace, pour la liste du
// responsable — et seulement à l'OUVERTURE de l'édition (§15 bis.6). L'en-tête est d'abord une
// lecture ; charger la liste des membres pour un geste que la plupart des visites ne font pas
// serait une requête gratuite sur l'écran le plus ouvert du produit.

import { Archive, Copy, PencilLine } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import {
	composerAdresseCard,
	ecrireChampEntete,
	estArchivee,
	formaterEcheance,
	formaterMontant,
	lireMembresAffectables,
	normaliserSaisieEntete,
	type ChampEntete,
	type IssueEcritureEntete,
	type LigneEnteteEcrite,
	type MembreAffectable,
} from '../lib/entete-card'
import type { CardOuverte } from '../lib/formulaire'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { t, type CleTraduction } from '../i18n'

/** Durée de la confirmation « Copié », en millisecondes (§15.5, point 3). */
const DUREE_CONFIRMATION = 2000

/**
 * Les trois issues du geste de copie.
 *
 * `refus` n'est pas une erreur d'application : `navigator.clipboard` n'existe pas dans tout
 * contexte, et la permission peut être refusée. Un bouton qui ne ferait rien en silence serait la
 * « simulation de succès » que `CLAUDE.md` §18 interdit (§15.5).
 */
type IssueCopie = 'inactif' | 'copie' | 'refus'

/** Clés nommées hors du JSX, comme `CLE_TITRE_CARD` : le contrôle de clés mortes les cherche ainsi. */
const CLE_COPIER: CleTraduction = 'card.header.email.copy'
const CLE_COPIE: CleTraduction = 'card.header.email.copied'

export function EnTeteCard({
	card: cardChargee,
	copier = copierDansLePressePapier,
	client = clientCrm,
}: {
	readonly card: CardOuverte
	/** Injectable pour les preuves ; en production, l'API du navigateur. */
	readonly copier?: (texte: string) => Promise<boolean>
	/** Injectable pour les preuves ; en production, le client réel du module `supabase`. */
	readonly client?: ClientCrm | null
}) {
	// La card vit ici pendant la visite : une écriture confirmée la met à jour EN PLACE, à partir de
	// la ligne que le serveur a RENDUE — jamais de la saisie (§15 bis.7). Elle est resynchronisée dès
	// que la fiche recharge : c'est alors la base qui a raison, pas l'écran.
	const [card, setCard] = useState(cardChargee)
	useEffect(() => setCard(cardChargee), [cardChargee])

	const [edition, setEdition] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	/**
	 * Le focus est rendu APRÈS le rendu, et c'est le défaut que le §5.10 a mesuré par la preuve
	 * clavier : la commande est démontée tant que l'édition est ouverte, si bien qu'appeler `focus()`
	 * depuis le gestionnaire de fermeture viserait une référence nulle et laisserait le focus sur le
	 * corps du document. L'intention est posée ici, honorée par l'effet quand la commande est remontée.
	 */
	const [focusARendre, setFocusARendre] = useState(false)
	useEffect(() => {
		if (edition || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [edition, focusARendre])

	const appliquer = useCallback((ligne: LigneEnteteEcrite, membres: readonly MembreAffectable[]) => {
		setCard((precedente) => ({
			...precedente,
			title: ligne.title,
			amount: ligne.amount,
			currency: ligne.currency,
			next_action: ligne.next_action,
			next_action_at: ligne.next_action_at,
			// LE NOM DU RESPONSABLE VIENT DE LA LISTE DÉJÀ CHARGÉE, jamais d'une relecture (§15 bis.6) :
			// la représentation rendue par l'écriture ne porte pas la relation embarquée, et relire la
			// card entière pour un nom en main serait un aller-retour gratuit. Un identifiant que la
			// liste ne connaît pas détache le responsable plutôt que d'afficher un nom inventé.
			profiles: profilDe(ligne.owner_id, membres, precedente.profiles ?? null),
		}))
	}, [])

	const adresse = composerAdresseCard(card)
	const montant = formaterMontant(card)
	const echeance = formaterEcheance(card.next_action_at)

	return (
		<section
			data-testid="entete-card"
			aria-labelledby="entete-card-titre"
			className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
		>
			<div className="flex flex-wrap items-center gap-2">
				<h2 id="entete-card-titre" className="text-h2 min-w-0 break-words">
					{card.title}
				</h2>
				{/* UNE AFFAIRE ARCHIVÉE EST NOMMÉE, jamais seulement teintée (§5.3 bis, §1) : sans cette
				    mention, la fiche d'une affaire close serait indistinguable d'une affaire en cours. */}
				{estArchivee(card) && (
					<span
						data-testid="entete-card-archivee"
						className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-on-soft px-3 py-1 text-sm"
					>
						<Archive aria-hidden="true" className="size-4" />
						{t('card.header.archived')}
					</span>
				)}
				{/* LA COMMANDE N'EST JAMAIS ÉTEINTE D'AVANCE, quel que soit le rôle (§5.3 ter) : la règle
				    vit dans `cards_maj`, et une commande grisée ferait passer une décision de la base
				    pour une décision d'écran (`CLAUDE.md` §10). Un lecteur seul l'ouvre, écrit, et lit
				    « rien n'a été enregistré » — le refus est MONTRÉ, il n'est pas anticipé. */}
				{client === null || edition ? null : (
					<Button
						ref={commande}
						taille="compacte"
						variante="secondaire"
						className="ms-auto"
						aria-expanded={false}
						aria-label={t('card.header.edit.open.aria')}
						data-testid="entete-card-modifier"
						onClick={() => setEdition(true)}
					>
						<PencilLine aria-hidden="true" size={16} strokeWidth={2} />
						{t(CLE_MODIFIER)}
					</Button>
				)}
			</div>

			{edition && client !== null ? (
				<EditionEntete
					card={card}
					client={client}
					onAppliquer={appliquer}
					onTerminer={() => {
						setEdition(false)
						// Le focus revient à la commande qui a ouvert l'édition : sans ce retour, terminer
						// au clavier laisserait l'utilisateur sur un bouton qui vient de disparaître (§5.13).
						setFocusARendre(true)
					}}
				/>
			) : (
				/* COUPLE TERME / VALEUR (§15.6) : « Montant » lu seul, puis un nombre lu seul, ne dit pas
				   que l'un qualifie l'autre. */
				<dl className="flex flex-col gap-2 text-sm">
					<LigneResponsable card={card} />
					{/* UNE DONNÉE ABSENTE FAIT DISPARAÎTRE SA LIGNE, jamais un tiret (§5.3 bis) : une affaire
					    sans montant chiffré est le cas ordinaire d'un début de qualification. */}
					{montant !== null && (
						<div data-testid="entete-card-montant" className="flex flex-wrap items-baseline gap-2">
							<dt className="text-text-2">{t('card.header.amount')}</dt>
							<dd className="flex items-baseline gap-1">
								<code>{montant.montant}</code>
								{/* LE CODE DEVISE DANS SON PROPRE ÉLÉMENT, jamais accolé au nombre par un nœud de
								    texte nu — défaut « Discussion1 » mesuré au §5.11 du design system. */}
								<span className="text-text-2">{montant.devise}</span>
							</dd>
						</div>
					)}
					{card.next_action !== null && (
						<div
							data-testid="entete-card-prochaine-action"
							className="flex flex-wrap items-baseline gap-2"
						>
							<dt className="text-text-2">{t('card.header.nextaction')}</dt>
							<dd className="flex flex-wrap items-baseline gap-2 min-w-0">
								<span className="break-words">{card.next_action}</span>
								{/* L'ÉCHÉANCE SEULE EST OMISE, la prochaine action reste (§15.4) : une action sans
								    date est une action, une date sans action ne serait rien. */}
								{echeance !== null && <code data-testid="entete-card-echeance">{echeance}</code>}
							</dd>
						</div>
					)}
				</dl>
			)}

			<BlocAdresse adresse={adresse} copier={copier} />
		</section>
	)
}

/**
 * Le profil correspondant à l'identifiant que le serveur vient de confirmer.
 *
 * `null` lorsque l'affaire n'a plus de responsable, et `null` AUSSI lorsque la liste ne connaît pas
 * l'identifiant : afficher l'ancien nom sur un nouvel identifiant serait un mensonge d'écran. Le
 * profil précédent n'est conservé que s'il EST celui que le serveur a rendu — c'est le cas d'une
 * écriture qui ne touche pas au responsable, où la liste n'a pas même été chargée.
 */
function profilDe(
	idResponsable: string | null,
	membres: readonly MembreAffectable[],
	precedent: CardOuverte['profiles'],
): CardOuverte['profiles'] {
	if (idResponsable === null) return null
	if (precedent !== null && precedent.id === idResponsable) return precedent
	const membre = membres.find((candidat) => candidat.id === idResponsable)
	if (membre === undefined) return null
	// `avatar_url` n'est pas dans la liste : elle n'y est pas demandée, et l'avatar se replie sur les
	// initiales — c'est le contrat du §7 de `docs/SPEC-identite.md`, pas une donnée manquante.
	return { id: membre.id, full_name: membre.nom, avatar_url: null }
}

/**
 * Le responsable — la seule donnée dont l'absence est une PHRASE et non une omission (§5.3 bis).
 *
 * N'avoir personne à qui s'adresser est un fait de l'affaire ; l'avatar est décoratif, le nom étant
 * écrit juste à côté (§15.6, docs/SPEC-identite.md §7).
 */
function LigneResponsable({ card }: { readonly card: CardOuverte }) {
	// `?? null` ET NON `card.profiles` : la relation peut être ABSENTE de la réponse, et non
	// seulement nulle. Trouvé par la campagne de fin de session — les preuves d'interface qui
	// substituent le réseau (docs/DESIGN_SYSTEM.md §12.5) servent une card sans ses relations, et
	// `profil.full_name` levait alors `Cannot read properties of undefined`, faisant tomber la page
	// entière. Le type ne garantit jamais une valeur (docs/SPEC-types.md) : une clé absente se
	// traite comme une absence de responsable, ce que le §15.7 nomme déjà.
	const profil = card.profiles ?? null
	return (
		<div data-testid="entete-card-responsable" className="flex flex-wrap items-center gap-2">
			<dt className="text-text-2">{t('card.header.owner')}</dt>
			{profil === null ? (
				<dd className="text-text-3">{t('card.header.owner.none')}</dd>
			) : (
				<dd className="flex items-center gap-2 min-w-0">
					<Avatar profil={profil} taille={32} decoratif />
					<span className="break-words">{profil.full_name}</span>
				</dd>
			)}
		</div>
	)
}

/**
 * L'adresse email de l'affaire, son explication d'usage et sa commande de copie.
 *
 * L'EXPLICATION EST UN TEXTE, pas seulement un `title` (§15.5, point 2) : une infobulle native
 * n'apparaît ni au clavier, ni au toucher. Le `title` est conservé en plus, pour la souris.
 *
 * AUCUNE COMMANDE SANS ADRESSE À COPIER (§15.3) : une adresse amputée de son domaine serait fausse,
 * et une commande sans objet est une commande morte.
 */
function BlocAdresse({
	adresse,
	copier,
}: {
	readonly adresse: string | null
	readonly copier: (texte: string) => Promise<boolean>
}) {
	const [issue, setIssue] = useState<IssueCopie>('inactif')
	// Le minuteur est annulé au démontage : écrire l'état d'un composant démonté est un avertissement
	// de console, et la console doit rester vierge (docs/CloudWorker.md §3).
	const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null)
	useEffect(
		() => () => {
			if (minuteur.current !== null) clearTimeout(minuteur.current)
		},
		[],
	)

	const lancer = useCallback(async () => {
		if (adresse === null) return
		const reussi = await copier(adresse)
		setIssue(reussi ? 'copie' : 'refus')
		if (minuteur.current !== null) clearTimeout(minuteur.current)
		// Le refus RESTE affiché : il demande une manœuvre de remplacement — sélectionner l'adresse —,
		// que deux secondes ne suffiraient pas à lire. Seule la confirmation s'efface.
		if (reussi) {
			minuteur.current = setTimeout(() => setIssue('inactif'), DUREE_CONFIRMATION)
		}
	}, [adresse, copier])

	if (adresse === null) {
		return (
			<p data-testid="entete-card-adresse-absente" className="text-sm text-text-3">
				{t('card.header.email.unavailable')}
			</p>
		)
	}

	return (
		<div className="flex flex-col gap-1 border-t border-border pt-3">
			<div className="flex flex-wrap items-center gap-2">
				<code data-testid="entete-card-adresse" title={t('card.header.email.hint')}>
					{adresse}
				</code>
				{/* LA CONFIRMATION REMPLACE LE LIBELLÉ, elle ne s'y ajoute pas (§5.7 ter, §15.5) ; la
				    largeur minimale empêche la ligne de se décaler au changement de mot. */}
				<Button
					taille="compacte"
					variante="secondaire"
					onClick={() => void lancer()}
					aria-label={t('card.header.email.copy.aria')}
					data-testid="entete-card-copier"
					className="min-w-[10rem]"
				>
					<Copy aria-hidden="true" size={16} strokeWidth={2} />
					{issue === 'copie' ? t(CLE_COPIE) : t(CLE_COPIER)}
				</Button>
			</div>
			<p className="text-sm text-text-3">{t('card.header.email.hint')}</p>
			{/* L'ISSUE EST ANNONCÉE (§8) : la région existe toujours, sans quoi son apparition ne serait
			    pas annoncée par un lecteur d'écran. */}
			<p role="status" data-testid="entete-card-copie-etat" className="text-sm text-danger-on-soft">
				{issue === 'refus' ? t('card.header.email.failed') : ''}
			</p>
		</div>
	)
}

/**
 * La copie réelle, isolée pour que le composant reste éprouvable sans navigateur.
 *
 * Elle rend `false` plutôt que de lever : l'absence de `navigator.clipboard` dans un contexte non
 * sécurisé n'est pas une anomalie du produit, c'est un état que l'écran doit dire (§15.5).
 */
async function copierDansLePressePapier(texte: string): Promise<boolean> {
	try {
		if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false
		await navigator.clipboard.writeText(texte)
		return true
	} catch {
		// Le refus n'est pas masqué : il devient l'issue « refus », que l'écran écrit en toutes
		// lettres avec sa manœuvre de remplacement. Ce n'est pas un `catch` vide (`CLAUDE.md` §18).
		return false
	}
}

// ---------------------------------------------------------------------------------------------
// L'ÉDITION des six champs — docs/SPEC-cards.md §15 bis, docs/DESIGN_SYSTEM.md §5.3 ter
// ---------------------------------------------------------------------------------------------

/** Les six libellés, nommés hors du JSX : le contrôle de clés mortes cherche les clés ainsi. */
const CLE_MODIFIER: CleTraduction = 'card.header.edit.open'
const CLE_TERMINER: CleTraduction = 'card.header.edit.close'
const CLE_SANS_RESPONSABLE: CleTraduction = 'card.header.edit.owner.none'
const CLE_MEMBRES_EN_COURS: CleTraduction = 'card.header.edit.owner.loading'
const CLE_MEMBRES_ECHEC: CleTraduction = 'card.header.edit.owner.failed'
const CLE_ENVOI: CleTraduction = 'card.header.edit.saving'
const CLE_ENREGISTRE: CleTraduction = 'card.header.edit.saved'

/**
 * Les six messages d'issue non enregistrée, indexés par l'issue classée hors du JSX (§15 bis.7).
 *
 * DICTIONNAIRE FERMÉ, jamais le message du serveur : règle déjà tenue par les refus de `CRM-075`,
 * `CRM-077` et de la saisie de valeur. Un texte d'API n'est pas un texte pour un humain, et le rendre
 * tel quel exposerait le détail de la pile à l'utilisateur (`CLAUDE.md` §20).
 */
const MESSAGES_ISSUE: Readonly<Record<Exclude<IssueEcritureEntete, 'enregistree'>, CleTraduction>> = {
	'sans-effet': 'card.header.edit.refus.noeffect',
	invalide: 'card.header.edit.refus.invalid',
	introuvable: 'card.header.edit.refus.notfound',
	refus: 'card.header.edit.refus.forbidden',
	reseau: 'card.header.edit.refus.network',
	inconnu: 'card.header.edit.refus.unknown',
}

/** Classes communes aux contrôles : 40 px de haut, bordure, focus `brand` (§5.7). */
const CLASSES_CONTROLE = [
	'w-full min-h-[var(--size-target)] px-3 py-2',
	'rounded-sm border border-border bg-surface text-base text-text',
].join(' ')

const CLASSES_ETAT_ENVOI = 'text-sm text-text-3'
const CLASSES_ETAT_CONFIRME = 'text-sm text-success'

/** Les quatre états d'un champ, repris sans changement du §4 bis.6 du composeur. */
type EtatChampEntete =
	| { readonly phase: 'inactif' }
	| { readonly phase: 'envoi' }
	| { readonly phase: 'enregistre' }
	| { readonly phase: 'refus'; readonly issue: Exclude<IssueEcritureEntete, 'enregistree'> }

const CHAMP_INACTIF: EtatChampEntete = { phase: 'inactif' }

/**
 * Le bloc d'édition : les six contrôles, chacun s'enregistrant pour lui-même.
 *
 * LES SIX SONT TOUS RENDUS, VIDES COMPRIS, et c'est le motif même de la bascule (§5.3 ter) : une
 * donnée absente n'a pas de ligne en lecture, et sans ce mode il n'existerait aucun endroit où
 * saisir le montant d'une affaire qui n'en a pas. C'est la quatrième destination du §4 ter.4 du
 * composeur, transposée.
 */
function EditionEntete({
	card,
	client,
	onAppliquer,
	onTerminer,
}: {
	readonly card: CardOuverte
	readonly client: ClientCrm
	readonly onAppliquer: (ligne: LigneEnteteEcrite, membres: readonly MembreAffectable[]) => void
	readonly onTerminer: () => void
}) {
	const [etats, setEtats] = useState<Readonly<Record<string, EtatChampEntete>>>({})
	const [membres, setMembres] = useState<readonly MembreAffectable[] | null>(null)
	const [membresEnEchec, setMembresEnEchec] = useState(false)
	const premier = useRef<HTMLInputElement>(null)

	// LE FOCUS ENTRE DANS LE PREMIER CONTRÔLE (§5.13) : ouvrir un formulaire sans y déplacer le focus
	// laisse l'utilisateur au clavier en tête de page, devant un bloc qu'il ne sait pas atteint.
	useEffect(() => {
		premier.current?.focus()
	}, [])

	// LA LISTE DES MEMBRES N'EST LUE QU'ICI, à l'ouverture de l'édition (§15 bis.6) : la charger au
	// chargement de la fiche serait une requête gratuite sur l'écran le plus ouvert du produit.
	useEffect(() => {
		let vivant = true
		void (async () => {
			const resultat = await lireMembresAffectables(client, card.workspace_id)
			if (!vivant) return
			if (resultat.statut === 'pret') {
				setMembres(resultat.donnees)
				return
			}
			// L'échec est DIT, jamais une liste vide en silence : un sélecteur sans option se lirait
			// comme un workspace sans membre (§5.3 ter).
			setMembresEnEchec(true)
		})()
		return () => {
			vivant = false
		}
	}, [client, card.workspace_id])

	const enregistrer = useCallback(
		async (champ: ChampEntete, saisie: string) => {
			const valeur = normaliserSaisieEntete(champ, saisie)
			setEtats((precedents) => ({ ...precedents, [champ]: { phase: 'envoi' } }))
			const resultat = await ecrireChampEntete(client, card.id, champ, valeur)
			if (resultat.issue === 'enregistree') {
				onAppliquer(resultat.ligne, membres ?? [])
				setEtats((precedents) => ({ ...precedents, [champ]: { phase: 'enregistre' } }))
				return
			}
			setEtats((precedents) => ({ ...precedents, [champ]: { phase: 'refus', issue: resultat.issue } }))
		},
		[client, card.id, membres, onAppliquer],
	)

	return (
		<div data-testid="entete-card-edition" className="flex flex-col gap-3">
			<ChampTexte
				ref={premier}
				champ="title"
				libelle={t('card.header.edit.title')}
				valeur={card.title}
				etat={etats.title ?? CHAMP_INACTIF}
				onEnregistrer={enregistrer}
			/>

			<ChampResponsable
				valeur={card.profiles?.id ?? null}
				membres={membres}
				enEchec={membresEnEchec}
				etat={etats.owner_id ?? CHAMP_INACTIF}
				onEnregistrer={enregistrer}
			/>

			{/* MONTANT ET DEVISE SONT DEUX CONTRÔLES ET DEUX ÉCRITURES (§5.3 ter) : leurs refus sont
			    distincts — `23514` pour la devise mal formée, rien pour un montant négatif, MESURÉ
			    accepté —, et un lot ferait échouer l'un à cause de l'autre (§15 bis.2). */}
			<div className="flex flex-wrap gap-3">
				<div className="flex-1 min-w-[12rem]">
					<ChampTexte
						champ="amount"
						type="number"
						libelle={t('card.header.amount')}
						valeur={card.amount === null ? '' : String(card.amount)}
						etat={etats.amount ?? CHAMP_INACTIF}
						onEnregistrer={enregistrer}
					/>
				</div>
				<div className="w-[8rem]">
					{/* AUCUNE LISTE FERMÉE DE DEVISES : la base ne contraint que la FORME du code, jamais
					    sa liste réelle (§15 bis.4). En fermer une à l'écran interdirait une devise que la
					    base accepte. La casse est mise en majuscules par la normalisation, ce qui épargne
					    un refus incompréhensible sans décider à la place de la base. */}
					<ChampTexte
						champ="currency"
						libelle={t('card.header.edit.currency')}
						valeur={card.currency}
						longueurMax={3}
						etat={etats.currency ?? CHAMP_INACTIF}
						onEnregistrer={enregistrer}
					/>
				</div>
			</div>

			<ChampTexte
				champ="next_action"
				libelle={t('card.header.nextaction')}
				valeur={card.next_action ?? ''}
				etat={etats.next_action ?? CHAMP_INACTIF}
				onEnregistrer={enregistrer}
			/>

			<ChampTexte
				champ="next_action_at"
				type="datetime-local"
				libelle={t('card.header.edit.deadline')}
				valeur={pourControleDateHeure(card.next_action_at)}
				etat={etats.next_action_at ?? CHAMP_INACTIF}
				onEnregistrer={enregistrer}
			/>

			<div>
				{/* « TERMINER » N'ENVOIE RIEN (§5.3 ter) : chaque champ a déjà écrit sa valeur, et
				    « Enregistrer » promettrait une écriture qui a eu lieu. */}
				<Button variante="secondaire" data-testid="entete-card-terminer" onClick={onTerminer}>
					{t(CLE_TERMINER)}
				</Button>
			</div>
		</div>
	)
}

/**
 * La valeur qu'un `input type="datetime-local"` accepte, dérivée d'un horodatage de la base.
 *
 * Le contrôle n'admet que `AAAA-MM-JJTHH:MM`, en heure LOCALE et sans fuseau, là où la base rend un
 * `timestamptz` en UTC. La conversion se fait donc par les composantes locales de `Date` — un
 * `slice` de la chaîne ISO afficherait l'heure UTC et décalerait toute échéance de l'écart de fuseau.
 * Une valeur illisible rend la chaîne vide : le contrôle refuserait de toute façon de l'afficher, et
 * « Invalid Date » n'est pas une échéance.
 */
export function pourControleDateHeure(valeur: string | null): string {
	if (valeur === null) return ''
	const date = new Date(valeur)
	if (Number.isNaN(date.getTime())) return ''
	const deux = (nombre: number) => String(nombre).padStart(2, '0')
	return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(date.getMinutes())}`
}

/**
 * Un contrôle de saisie qui s'enregistre pour lui-même (§5.7 ter).
 *
 * LA SAISIE VIT ICI, PAS DANS LA CARD. Un refus laisse la saisie à l'écran avec son explication
 * (§15 bis.9) : la rejeter effacerait un travail sans le dire, ce que `CLAUDE.md` §18 interdit. La
 * valeur CONNUE DE LA BASE, elle, ne bouge que sur confirmation du serveur.
 *
 * L'ÉCRITURE PART DE LA PERTE DU FOCUS, jamais de la frappe (§15 bis.3) : écrire à chaque caractère
 * produirait une requête par touche. Et rien n'est émis si la valeur n'a pas changé — reprendre le
 * focus sans rien modifier ne doit produire aucune requête.
 *
 * AUCUNE GARDE DE SAISIE NE DOUBLE UNE CONTRAINTE DE LA BASE (§5.3 ter) : pas de `required` sur le
 * titre, pas de `min` sur le montant. Un titre vide et un montant négatif sont ENVOYÉS, et c'est la
 * base qui tranche — un montant négatif est d'ailleurs MESURÉ accepté.
 */
const ChampTexte = forwardRef<
	HTMLInputElement,
	{
		readonly champ: ChampEntete
		readonly libelle: string
		readonly valeur: string
		readonly etat: EtatChampEntete
		readonly type?: 'text' | 'number' | 'datetime-local'
		readonly longueurMax?: number
		readonly onEnregistrer: (champ: ChampEntete, saisie: string) => Promise<void>
	}
>(function ChampTexte({ champ, libelle, valeur, etat, type = 'text', longueurMax, onEnregistrer }, ref) {
	const [saisie, setSaisie] = useState(valeur)
	// La valeur confirmée par le serveur reprend la main : sans cette resynchronisation, le contrôle
	// garderait la casse d'origine d'une devise que la normalisation a mise en majuscules.
	useEffect(() => setSaisie(valeur), [valeur])

	const idControle = `entete-${champ}`
	const idEtat = `${idControle}-etat`
	const idRefus = `${idControle}-refus`
	const enRefus = etat.phase === 'refus'
	const confirme = etat.phase === 'enregistre'
	const annonce = etat.phase === 'envoi' || confirme
	const decrit = [annonce ? idEtat : '', enRefus ? idRefus : ''].filter((entree) => entree !== '')

	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={idControle} className="text-sm text-text-2">
				{libelle}
			</label>
			<input
				ref={ref}
				id={idControle}
				type={type}
				value={saisie}
				data-testid={idControle}
				className={CLASSES_CONTROLE}
				{...(longueurMax === undefined ? {} : { maxLength: longueurMax })}
				{...(enRefus ? { 'aria-invalid': true } : {})}
				{...(decrit.length === 0 ? {} : { 'aria-describedby': decrit.join(' ') })}
				onChange={(evenement) => setSaisie(evenement.target.value)}
				onBlur={() => {
					if (saisie === valeur) return
					void onEnregistrer(champ, saisie)
				}}
			/>
			<MentionEtat etat={etat} idEtat={idEtat} idRefus={idRefus} />
		</div>
	)
})

/**
 * La liste des responsables — le seul contrôle qui écrit au CHANGEMENT et non à la perte du focus
 * (§15 bis.3) : sa valeur est complète dès qu'elle est choisie.
 *
 * « Aucun responsable » est une OPTION, et c'est ainsi qu'une affaire se détache de son responsable
 * — la seule des six données dont le vidage passe par un choix explicite plutôt que par un champ
 * laissé vide.
 */
function ChampResponsable({
	valeur,
	membres,
	enEchec,
	etat,
	onEnregistrer,
}: {
	readonly valeur: string | null
	readonly membres: readonly MembreAffectable[] | null
	readonly enEchec: boolean
	readonly etat: EtatChampEntete
	readonly onEnregistrer: (champ: ChampEntete, saisie: string) => Promise<void>
}) {
	const idControle = 'entete-owner_id'
	const idEtat = `${idControle}-etat`
	const idRefus = `${idControle}-refus`
	const enRefus = etat.phase === 'refus'
	const confirme = etat.phase === 'enregistre'
	const annonce = etat.phase === 'envoi' || confirme
	const decrit = [annonce ? idEtat : '', enRefus ? idRefus : ''].filter((entree) => entree !== '')

	return (
		<div className="flex flex-col gap-1">
			<label htmlFor={idControle} className="text-sm text-text-2">
				{t('card.header.owner')}
			</label>
			<select
				id={idControle}
				value={valeur ?? ''}
				data-testid={idControle}
				className={CLASSES_CONTROLE}
				{...(enRefus ? { 'aria-invalid': true } : {})}
				{...(decrit.length === 0 ? {} : { 'aria-describedby': decrit.join(' ') })}
				onChange={(evenement) => void onEnregistrer('owner_id', evenement.target.value)}
			>
				<option value="">{t(CLE_SANS_RESPONSABLE)}</option>
				{(membres ?? []).map((membre) => (
					<option key={membre.id} value={membre.id}>
						{membre.nom}
					</option>
				))}
			</select>
			{/* LA LISTE EN COURS DE LECTURE ET SON ÉCHEC SONT DITS, jamais une liste vide en silence : un
			    sélecteur sans option se lirait comme un workspace sans membre (§5.3 ter). L'affaire garde
			    pendant ce temps son responsable, dont l'option est celle que la card porte déjà. */}
			{membres === null && !enEchec ? (
				<p className="text-sm text-text-3">{t(CLE_MEMBRES_EN_COURS)}</p>
			) : null}
			{enEchec ? (
				<p role="alert" data-testid="entete-membres-echec" className="text-sm text-danger-on-soft">
					{t(CLE_MEMBRES_ECHEC)}
				</p>
			) : null}
			<MentionEtat etat={etat} idEtat={idEtat} idRefus={idRefus} />
		</div>
	)
}

/**
 * Les trois mentions d'état d'un champ, jamais deux à la fois (§5.7 ter).
 *
 * La confirmation REMPLACE l'envoi, elle ne s'y ajoute pas : deux mentions superposées feraient
 * croire à deux écritures. Le refus est une alerte, annoncée et liée au contrôle par
 * `aria-describedby` (§15 bis.9).
 */
function MentionEtat({
	etat,
	idEtat,
	idRefus,
}: {
	readonly etat: EtatChampEntete
	readonly idEtat: string
	readonly idRefus: string
}) {
	if (etat.phase === 'refus') {
		return (
			<p
				id={idRefus}
				role="alert"
				data-testid={idRefus}
				className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft"
			>
				{t(MESSAGES_ISSUE[etat.issue])}
			</p>
		)
	}
	if (etat.phase === 'envoi' || etat.phase === 'enregistre') {
		const confirme = etat.phase === 'enregistre'
		return (
			<p
				id={idEtat}
				role="status"
				data-testid={idEtat}
				className={confirme ? CLASSES_ETAT_CONFIRME : CLASSES_ETAT_ENVOI}
			>
				{confirme ? t(CLE_ENREGISTRE) : t(CLE_ENVOI)}
			</p>
		)
	}
	return null
}
