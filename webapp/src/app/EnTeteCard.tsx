// @spec CRM-040 (docs/BACKLOG.md) — les champs d'en-tête de la fiche d'affaire
// @spec docs/SPEC-cards.md §15.2 (où l'en-tête vit), §15.4 (les six données), §15.5 (l'action de
//       copie et ce qu'elle promet), §15.6 (accessibilité), §15.7 (les trois états de donnée)
// @spec docs/DESIGN_SYSTEM.md §5.3 (les champs d'entête et l'adresse en monospace),
//       §5.3 bis (les neuf règles visuelles), §2 (données techniques), §5.5 (boutons),
//       §5.7 (graduation du texte d'aide), §8 (accessibilité), §9 (icônes Lucide)
//
// L'en-tête ne lit RIEN par lui-même : la card lui est passée, telle que `lireCard` l'a déjà
// chargée avec ses deux relations (docs/SPEC-cards.md §15.3). Une requête de plus pour une donnée
// de la même ligne serait un aller-retour gratuit.

import { Archive, Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Avatar } from '../components/ui/Avatar'
import { Button } from '../components/ui/Button'
import { composerAdresseCard, estArchivee, formaterEcheance, formaterMontant } from '../lib/entete-card'
import type { CardOuverte } from '../lib/formulaire'
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
	card,
	copier = copierDansLePressePapier,
}: {
	readonly card: CardOuverte
	/** Injectable pour les preuves ; en production, l'API du navigateur. */
	readonly copier?: (texte: string) => Promise<boolean>
}) {
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
			</div>

			{/* COUPLE TERME / VALEUR (§15.6) : « Montant » lu seul, puis un nombre lu seul, ne dit pas
			    que l'un qualifie l'autre. */}
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

			<BlocAdresse adresse={adresse} copier={copier} />
		</section>
	)
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
