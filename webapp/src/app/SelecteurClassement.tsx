// @spec CRM-137 (docs/BACKLOG.md) — classer un mail : le sélecteur d'affaire cherchable et la case « Expéditeur connu »
// @spec docs/DESIGN_SYSTEM.md §5.94 (la forme : la combobox de la palette, la case, la liste, le choix retenu, les vides,
//       les annonces), §5.46 (le patron de la combobox), §5.7 bis (la case) ; docs/SPEC-mail-subsystem.md §26.3 (le
//       comportement : case cochée à chaque ouverture, 200 ms de repos, réponse périmée ignorée, présélection unique,
//       choix qui survit au filtre) ; docs/JOURNAL.md décision 893 ; CLAUDE.md §11 (aucun état mémorisé)
//
// LE FOCUS NE QUITTE PAS LE CHAMP (§5.46) : les flèches déplacent l'option active par `aria-activedescendant`, `Entrée`
// choisit l'option active sans envoyer, et c'est « Classer », hors de ce composant, qui envoie.

import { Check, Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import {
	lireCandidates,
	preselection,
	type Candidate,
	type DemandeCandidates,
	type ResultatCandidates,
} from '../lib/candidats-classement'

/** Le repos de la frappe avant une lecture : celui de la palette (docs/SPEC-recherche.md §13.3). */
export const REPOS_FRAPPE_MS = 200

type Lecteur = (demande: DemandeCandidates) => Promise<ResultatCandidates>

type Etat =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur' }
	| {
			readonly statut: 'pret'
			readonly demande: DemandeCandidates
			readonly candidates: readonly Candidate[]
			readonly tronquee: boolean
	  }

function compte(n: number): string {
	if (n === 0) return t('inbox.classify.count.zero')
	if (n === 1) return t('inbox.classify.count.one')
	return t('inbox.classify.count.other', { n: String(n) })
}

export function SelecteurClassement({
	messageId,
	expediteur,
	choix,
	onChoisir,
	onEchap,
	champ,
	lire,
}: {
	readonly messageId: string
	/** L'adresse de l'expéditeur, telle que le message la porte. */
	readonly expediteur: string
	readonly choix: Candidate | null
	readonly onChoisir: (candidate: Candidate) => void
	/** `Échap` depuis le champ : le formulaire se referme, comme « Annuler » (§5.94). */
	readonly onEchap: () => void
	/** Le champ prend le focus à l'ouverture du formulaire (§5.13) : l'appelant tient la référence. */
	readonly champ: React.RefObject<HTMLInputElement | null>
	/** Le lecteur, injectable pour les preuves sans navigateur ; par défaut, la base. */
	readonly lire: Lecteur
}) {
	// La case repart cochée à chaque montage : son état n'est gardé nulle part (`CLAUDE.md` §11).
	const [connues, setConnues] = useState(true)
	const [terme, setTerme] = useState('')
	const [termeApplique, setTermeApplique] = useState('')
	const [essai, setEssai] = useState(0)
	const [etat, setEtat] = useState<Etat>({ statut: 'chargement' })
	const [enVol, setEnVol] = useState(false)
	const [actif, setActif] = useState(-1)
	const [annonce, setAnnonce] = useState('')
	const numero = useRef(0)
	const idListe = useId()
	const idAide = useId()
	const idCase = useId()
	const idChamp = useId()
	// La présélection ne vaut qu'une fois, et jamais par-dessus un choix : `onChoisir` change à chaque rendu de l'appelant.
	const choixCourant = useRef(choix)
	choixCourant.current = choix
	const choisirCourant = useRef(onChoisir)
	choisirCourant.current = onChoisir

	// Le repos de la frappe : seul le terme attend, la case relit aussitôt.
	useEffect(() => {
		const minuterie = setTimeout(() => setTermeApplique(terme), REPOS_FRAPPE_MS)
		return () => clearTimeout(minuterie)
	}, [terme])

	useEffect(() => {
		const moi = ++numero.current
		const demande: DemandeCandidates = { messageId, connues, terme: termeApplique }
		setEnVol(true)
		void lire(demande).then((resultat) => {
			// Une réponse arrivée après une plus récente est ignorée (§26.3).
			if (moi !== numero.current) return
			setEnVol(false)
			setActif(-1)
			if (!resultat.ok) {
				setEtat({ statut: 'erreur' })
				return
			}
			setEtat({ statut: 'pret', demande, candidates: resultat.candidates, tronquee: resultat.tronquee })
			setAnnonce(compte(resultat.candidates.length))
			const unique = preselection(demande, resultat.candidates)
			if (unique !== null && choixCourant.current === null) choisirCourant.current(unique)
		})
	}, [lire, messageId, connues, termeApplique, essai])

	const candidates = etat.statut === 'pret' ? etat.candidates : []
	const optionActive = actif >= 0 ? candidates[actif] : undefined

	const elargir = () => {
		setConnues(false)
		champ.current?.focus()
	}

	let contenu: React.ReactNode
	if (etat.statut === 'chargement') {
		contenu = <SkeletonListe lignes={3} libelle={t('inbox.classify.loading')} />
	} else if (etat.statut === 'erreur') {
		contenu = (
			<div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger" data-testid="classement-erreur">
				<p>{t('inbox.classify.error')}</p>
				<Button taille="compacte" onClick={() => setEssai((n) => n + 1)}>
					{t('inbox.classify.retry')}
				</Button>
			</div>
		)
	} else if (candidates.length === 0) {
		const termeLu = etat.demande.terme.trim()
		const texte =
			termeLu !== ''
				? t('inbox.classify.empty.term', { terme: termeLu })
				: etat.demande.connues
					? t('inbox.classify.empty.known', { adresse: expediteur })
					: t('inbox.classify.empty.all')
		contenu = (
			<div className="flex flex-col items-start gap-2" data-testid="classement-vide">
				<p className="text-sm text-text-2">{texte}</p>
				{etat.demande.connues ? (
					<Button taille="compacte" onClick={elargir} data-testid="classement-elargir">
						{termeLu !== '' ? t('inbox.classify.widen.term') : t('inbox.classify.widen')}
					</Button>
				) : null}
			</div>
		)
	} else {
		contenu = (
			<ul
				id={idListe}
				role="listbox"
				aria-label={t('inbox.classify.search')}
				aria-busy={enVol}
				data-testid="classement-liste"
				className="max-h-[20rem] overflow-y-auto rounded-sm border border-border bg-surface"
			>
				{candidates.map((candidate, i) => {
					const choisie = choix?.id === candidate.id
					return (
						<li
							key={candidate.id}
							id={`${idListe}-${i}`}
							role="option"
							aria-selected={choisie}
							data-testid="classement-option"
							data-actif={i === actif ? 'oui' : 'non'}
							// La souris choisit sans voler le focus au champ (§5.46).
							onMouseDown={(e) => {
								e.preventDefault()
								onChoisir(candidate)
							}}
							className={[
								'flex min-h-[var(--size-target)] cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-b-0',
								i === actif ? 'border-l-[3px] border-l-brand bg-brand-soft' : 'hover:bg-hover',
							].join(' ')}
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="font-medium break-words text-ink">{candidate.titre}</span>
								{candidate.chemin !== '' ? (
									<span className="text-sm text-text-2 break-words">{candidate.chemin}</span>
								) : null}
							</span>
							{!etat.demande.connues && candidate.connue ? (
								<span role="img" aria-label={t('inbox.classify.pill.known.aria')} className="shrink-0">
									<span aria-hidden="true">
										<Badge>{t('inbox.classify.pill.known')}</Badge>
									</span>
								</span>
							) : null}
							{choisie ? <Check aria-hidden="true" size={16} className="shrink-0 text-brand" /> : null}
						</li>
					)
				})}
			</ul>
		)
	}

	return (
		<div className="flex flex-col gap-2" data-testid="classement-selecteur">
			<div className="flex flex-col">
				<label
					htmlFor={idCase}
					className="inline-flex min-h-[var(--size-target)] cursor-pointer items-center gap-2 text-sm text-text-2"
				>
					<input
						id={idCase}
						type="checkbox"
						checked={connues}
						aria-describedby={idAide}
						data-testid="classement-connu"
						onChange={(e) => setConnues(e.target.checked)}
						className="size-6 shrink-0 accent-brand"
					/>
					{t('inbox.classify.known')}
				</label>
				<p id={idAide} className="text-sm text-text-2 break-words">
					{t('inbox.classify.known.help.before')}
					<code>{expediteur}</code>
				</p>
			</div>
			<label htmlFor={idChamp} className="text-sm text-text-2">
				{t('inbox.classify.search')}
			</label>
			<div className="relative">
				<Search
					aria-hidden="true"
					size={16}
					className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-3"
				/>
				<input
					id={idChamp}
					ref={champ}
					type="search"
					role="combobox"
					aria-expanded={candidates.length > 0}
					aria-controls={idListe}
					aria-autocomplete="list"
					{...(optionActive !== undefined ? { 'aria-activedescendant': `${idListe}-${actif}` } : {})}
					value={terme}
					data-testid="classement-champ"
					onChange={(e) => setTerme(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'ArrowDown' && candidates.length > 0) {
							e.preventDefault()
							setActif((n) => Math.min(n + 1, candidates.length - 1))
						} else if (e.key === 'ArrowUp' && candidates.length > 0) {
							e.preventDefault()
							setActif((n) => Math.max(n - 1, 0))
						} else if (e.key === 'Enter') {
							// `Entrée` choisit l'option active, et n'envoie jamais le formulaire (§5.94).
							e.preventDefault()
							if (optionActive !== undefined) onChoisir(optionActive)
						} else if (e.key === 'Escape') {
							e.preventDefault()
							onEchap()
						}
					}}
					className="min-h-[var(--size-target)] w-full rounded-sm border border-border bg-surface pl-[36px] pr-3 focus-visible:outline-2 focus-visible:outline-brand"
				/>
			</div>
			{contenu}
			{etat.statut === 'pret' && etat.tronquee ? (
				<p className="text-sm text-text-3" data-testid="classement-tronquee">
					{t('inbox.classify.truncated')}
				</p>
			) : null}
			<p role="status" className="text-sm text-ink break-words" data-testid="classement-choix">
				{choix === null
					? null
					: choix.chemin === ''
						? t('inbox.classify.chosen', { titre: choix.titre })
						: t('inbox.classify.chosen.path', { titre: choix.titre, chemin: choix.chemin })}
			</p>
			<p className="sr-only" aria-live="polite">
				{annonce}
			</p>
		</div>
	)
}

/** Le lecteur par défaut : la base, par le client de l'application. */
export function lecteurBase(client: Parameters<typeof lireCandidates>[0]): Lecteur {
	return (demande) => lireCandidates(client, demande)
}
