// @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration : l'écran, sixième tranche
// @spec docs/SPEC-corbeille.md §4.1 (l'adresse), §4.2 (les trois lectures), §4.3 (l'auteur inconnu),
//       §4.4 (l'énumération d'une entrée parente), §4.5 (les trois issues de la restauration),
//       §4.6 (les quatre états), §4.7 (ce que l'écran ne fait pas)
// @spec docs/DESIGN_SYSTEM.md §5.16 (cette surface), §5.9 (tableau), §5.8 (états systématiques)
// @spec CLAUDE.md §10 (la garde est backend, jamais une aide d'interface), §23 (aucune phrase
//       construite par concaténation)
//
// L'ÉCRAN N'ANTICIPE AUCUN REFUS. Il affiche la même commande sur toutes les lignes, envoie, puis
// traduit ce qu'il reçoit : la garde de `0038` vit dans la base, et une commande éteinte d'avance
// ferait passer une règle du produit pour une décision d'interface — sans compter qu'elle se
// tromperait dès qu'un autre utilisateur aurait restauré le parent entre le chargement et le clic.

import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	compterEnfantsInaccessibles,
	composerEnumeration,
	lireCorbeille,
	restaurer,
	type EntreeCorbeille,
	type NatureRefusRestauration,
	type TypeObjetCorbeille,
} from '../lib/corbeille'
import { texteLigneEnumeration, type EtatEnumeration } from './presentation-corbeille'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/** Le type est un MOT, jamais une icône seule (`docs/DESIGN_SYSTEM.md` §5.16). */
const CLES_TYPE: Readonly<Record<TypeObjetCorbeille, CleTraduction>> = {
	track: 'admin.trash.type.track',
	channel: 'admin.trash.type.channel',
	card: 'admin.trash.type.card',
}

/**
 * Un texte par geste attendu (§4.5).
 *
 * `sans-effet` n'est pas dans ce tableau : ce n'est pas un refus reçu, c'est une écriture qui n'a
 * touché aucune ligne, et elle porte sa propre clé.
 */
const CLES_REFUS: Readonly<Record<NatureRefusRestauration, CleTraduction>> = {
	'parent-en-corbeille': 'admin.trash.refus.parent',
	forbidden: 'admin.trash.refus.forbidden',
	network: 'admin.trash.refus.network',
	unknown: 'admin.trash.refus.unknown',
}

/**
 * Date/heure locale courte, au même format que la dernière relève de l'état de la messagerie
 * (`EtatMessagerie.tsx`) : deux dates du même produit ne se lisent pas dans deux formats.
 */
function formaterRetrait(horodatage: string): string {
	const date = new Date(horodatage)
	if (Number.isNaN(date.getTime())) return horodatage
	return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

/** Clé d'identification d'une entrée : le type ET l'identifiant, deux tables pouvant les partager. */
const cleEntree = (entree: EntreeCorbeille): string => `${entree.type}:${entree.id}`

// Le type des trois états et le choix de la clé singulier/pluriel vivent désormais dans
// `presentation-corbeille.ts` : la confirmation du geste de mise à la corbeille (§4 bis.3) affiche
// exactement la même énumération, et deux copies auraient divergé sur le même fait.

/** L'issue de la dernière restauration tentée sur une ligne. */
type EtatRestauration =
	| { readonly statut: 'en-cours' }
	| { readonly statut: 'echec'; readonly texte: string }

export type ProprietesCorbeille = {
	readonly client?: ClientCrm | null
}

export function Corbeille({ client = clientCrm }: ProprietesCorbeille = {}) {
	const [etat, setEtat] = useState<EtatAsync<readonly EntreeCorbeille[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [enumerations, setEnumerations] = useState<Readonly<Record<string, EtatEnumeration>>>({})
	const [restaurations, setRestaurations] = useState<Readonly<Record<string, EtatRestauration>>>({})
	const [succes, setSucces] = useState<string | null>(null)
	// Une réponse arrivée après le démontage, ou périmée par un rechargement, ne doit pas écraser un
	// état plus récent — même garde que `AdministrationArborescence` et `EtatMessagerie`.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		setEnumerations({})
		setRestaurations({})
		void (async () => {
			const lecture = await lireCorbeille(client)
			if (rang !== courant.current) return
			// Le cas est traité par `statut === 'erreur'` puis `statut !== 'pret'`, jamais par la
			// seule négation : `lireCorbeille` ne rend jamais `chargement`, mais `EtatAsync` le porte
			// structurellement, et seule cette double garde le nomme.
			if (lecture.statut === 'erreur') {
				setEtat(enErreur(lecture.erreur))
				return
			}
			if (lecture.statut !== 'pret') return
			setEtat(pret(lecture.donnees))

			// LES ÉNUMÉRATIONS SONT DEMANDÉES APRÈS LA LISTE, ET EN PARALLÈLE. Une énumération en
			// échec n'invalide pas la liste (§4.4) : l'entrée reste affichée, et seule sa colonne
			// dit qu'elle n'a pas pu être lue. Une affaire n'en demande aucune — elle n'a pas
			// d'enfant au sens du §3.5.
			const parents = lecture.donnees.filter((entree) => entree.type !== 'card')
			if (parents.length === 0) return
			setEnumerations(
				Object.fromEntries(
					parents.map((entree) => [cleEntree(entree), { statut: 'chargement' } as EtatEnumeration]),
				),
			)
			await Promise.all(
				parents.map(async (entree) => {
					const compte = await compterEnfantsInaccessibles(client, {
						type: entree.type === 'track' ? 'track' : 'channel',
						id: entree.id,
					})
					if (rang !== courant.current) return
					setEnumerations((precedentes) => ({
						...precedentes,
						[cleEntree(entree)]:
							compte.statut === 'pret'
								? { statut: 'pret', lignes: composerEnumeration(compte.donnees) }
								: { statut: 'echec' },
					}))
				}),
			)
		})()
	}, [client, tentative])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const lancerRestauration = useCallback(
		async (entree: EntreeCorbeille) => {
			if (client === null) return
			const cle = cleEntree(entree)
			setSucces(null)
			setRestaurations((precedentes) => ({ ...precedentes, [cle]: { statut: 'en-cours' } }))
			const resultat = await restaurer(client, entree.type, entree.id)
			if (resultat.statut === 'appliquee') {
				setSucces(t('admin.trash.restored', { nom: entree.nom }))
				// LA LISTE EST RELUE, JAMAIS CORRIGÉE EN MÉMOIRE (§4.6) : c'est la base qui décide de
				// ce que contient la corbeille, et une liste recomposée localement finirait par en
				// diverger — restaurer un track rend aussi ses enfants joignables, ce que seule une
				// relecture constate.
				recharger()
				return
			}
			const texte =
				resultat.statut === 'sans-effet'
					? t('admin.trash.refus.sansEffet')
					: t(CLES_REFUS[resultat.refus.nature])
			setRestaurations((precedentes) => ({ ...precedentes, [cle]: { statut: 'echec', texte } }))
		},
		[client, recharger],
	)

	if (client === null) {
		return (
			<EtatVide titre={t('admin.trash.noWorkspace.title')} corps={t('admin.trash.noWorkspace.body')} />
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.trash.error.title')}
				corps={t('admin.trash.error.body')}
				libelleReprise={t('admin.trash.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	const entrees = etat.donnees

	// L'ÉTAT VIDE EST LE CAS NORMAL, et il n'offre AUCUNE action (§4.6, §5.16) : il n'y a rien à
	// faire d'une corbeille vide, et un bouton y serait un chemin vers nulle part. C'est l'écart
	// assumé avec le §5.8, qui prévoit « message et action ».
	if (entrees.length === 0) {
		return <EtatVide titre={t('admin.trash.empty.title')} corps={t('admin.trash.empty.body')} />
	}

	return (
		<section aria-label={t('admin.trash.aria')} className="flex flex-col gap-4">
			{succes !== null && (
				<p
					role="status"
					data-testid="corbeille-succes"
					className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm"
				>
					{succes}
				</p>
			)}

			<div className="overflow-x-auto indique-debordement-x">
				<table data-testid="tableau-corbeille" className="w-full border-collapse text-left">
					<caption className="sr-only">{t('admin.trash.table.aria')}</caption>
					<thead>
						<tr className="border-b border-border">
							<th scope="col" className={CLASSES_ENTETE}>
								{t('admin.trash.table.type')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('admin.trash.table.name')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('admin.trash.table.by')}
							</th>
							<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
								{t('admin.trash.table.at')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('admin.trash.table.holds')}
							</th>
							<th scope="col" className={CLASSES_ENTETE}>
								{t('admin.trash.table.action')}
							</th>
						</tr>
					</thead>
					<tbody>
						{entrees.map((entree) => {
							const cle = cleEntree(entree)
							const restauration = restaurations[cle]
							return (
								<LigneCorbeille
									key={cle}
									entree={entree}
									enumeration={enumerations[cle]}
									restauration={restauration}
									onRestaurer={() => void lancerRestauration(entree)}
								/>
							)
						})}
					</tbody>
				</table>
			</div>
		</section>
	)
}

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'

/**
 * Une entrée, et le refus qu'elle a éventuellement reçu.
 *
 * LE REFUS S'AFFICHE DANS LA LIGNE CONCERNÉE, et non en tête d'écran (`docs/DESIGN_SYSTEM.md`
 * §5.16, même ancrage que le §5.13) : un refus se lit près de ce qui l'a causé. Il occupe une
 * seconde ligne de tableau plutôt qu'une cellule, faute de quoi il tiendrait sur une seule ligne
 * tronquée par l'ellipse du §5.9 — c'est-à-dire illisible.
 */
function LigneCorbeille({
	entree,
	enumeration,
	restauration,
	onRestaurer,
}: {
	readonly entree: EntreeCorbeille
	readonly enumeration: EtatEnumeration | undefined
	readonly restauration: EtatRestauration | undefined
	readonly onRestaurer: () => void
}) {
	const enCours = restauration?.statut === 'en-cours'
	return (
		<>
			<tr
				data-testid="ligne-corbeille"
				data-type={entree.type}
				data-objet={entree.id}
				className="border-b border-border hover:bg-hover"
			>
				<td className={CLASSES_CELLULE}>{t(CLES_TYPE[entree.type])}</td>
				<td className={CLASSES_CELLULE} title={entree.nom}>
					{entree.nom}
				</td>
				{/* L'auteur non enregistré est un FAIT à nommer, jamais une cellule vide (§4.3). */}
				<td className={CLASSES_CELLULE}>
					{entree.retirePar ?? (
						<span className="text-text-2">{t('admin.trash.author.unknown')}</span>
					)}
				</td>
				<td className="h-[var(--size-target)] px-3 text-right whitespace-nowrap">
					<code className="text-text-2 tabular-nums">{formaterRetrait(entree.retireLe)}</code>
				</td>
				<td className={CLASSES_CELLULE} data-testid="cellule-enumeration">
					<CelluleEnumeration entree={entree} enumeration={enumeration} />
				</td>
				<td className="h-[var(--size-target)] px-3">
					<button
						type="button"
						data-testid="bouton-restaurer"
						onClick={onRestaurer}
						disabled={enCours}
						aria-label={t('admin.trash.restore.aria', { nom: entree.nom })}
						className={[
							'inline-flex items-center gap-2',
							'min-h-[var(--size-target)] px-3 rounded-sm',
							'border border-border bg-surface text-ink text-sm font-medium',
							'transition-colors duration-[var(--transition-duration-fast)]',
							'hover:bg-hover disabled:opacity-60 disabled:cursor-not-allowed',
						].join(' ')}
					>
						<RotateCcw aria-hidden="true" className="size-4" />
						{enCours ? t('admin.trash.restore.running') : t('admin.trash.restore')}
					</button>
				</td>
			</tr>
			{restauration?.statut === 'echec' && (
				<tr className="border-b border-border">
					<td colSpan={6} className="px-3 pb-2">
						<p
							role="alert"
							data-testid="refus-restauration"
							className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
						>
							{restauration.texte}
						</p>
					</td>
				</tr>
			)}
		</>
	)
}

/**
 * La colonne « Retient avec lui », dans ses états distincts.
 *
 * Une AFFAIRE laisse la cellule **vide** : elle n'a pas d'enfant au sens du §3.5, et le §5.9 réserve
 * précisément la cellule vide à une donnée qui n'existe pas pour la ligne. C'est le seul endroit de
 * cet écran où le vide est le bon rendu.
 */
function CelluleEnumeration({
	entree,
	enumeration,
}: {
	readonly entree: EntreeCorbeille
	readonly enumeration: EtatEnumeration | undefined
}) {
	if (entree.type === 'card') return null
	if (enumeration === undefined || enumeration.statut === 'chargement') {
		return <span className="text-text-3">{t('admin.trash.holds.loading')}</span>
	}
	if (enumeration.statut === 'echec') {
		return <span className="text-text-3">{t('admin.trash.holds.failed')}</span>
	}
	// Une énumération entièrement vide ne rend AUCUNE ligne (§3.5) : l'écran dit alors sa propre
	// phrase, plutôt que d'afficher « 0 channel » que personne n'a besoin de lire.
	if (enumeration.lignes.length === 0) {
		return <span className="text-text-3">{t('admin.trash.holds.none')}</span>
	}
	return (
		<ul className="flex flex-col">
			{enumeration.lignes.map((ligne) => (
				<li key={ligne.type} className="text-sm">
					{texteLigneEnumeration(ligne)}
				</li>
			))}
		</ul>
	)
}
