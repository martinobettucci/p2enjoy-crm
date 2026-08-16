// @spec CRM-030 (docs/BACKLOG.md) — administration du catalogue de nœuds : l'écran
// @spec docs/SPEC-workflow-engine.md §2 bis.1 (ce que l'écran est), §2 bis.2 (l'adresse),
//       §2 bis.3 (la lecture unique), §2 bis.4 (les quatre gestes), §2 bis.5 (les refus mesurés),
//       §2 bis.6 (validation de forme), §2 bis.7 (états, accessibilité)
// @spec docs/SPEC-workflow-engine.md §2 ter.2 (le calcul, réutilisé et non réécrit), §2 ter.3 (la
//       liste sur laquelle il porte, archivés compris), §2 ter.5 (les refus du déplacement)
// @spec docs/DESIGN_SYSTEM.md §5.18 (cette surface), §5.13 (formulaires dans le flux, focus),
//       §5.8 (états systématiques), §5.6 et §12.5 (pilules), §9 (icônes)
// @spec CLAUDE.md §10 (la garde est backend), §23 (aucune phrase construite par concaténation)
//
// L'ÉCRAN N'ANTICIPE AUCUN REFUS. « Archiver » est offerte sur toutes les lignes actives, quelle
// que soit leur occupation : l'écran ne mesure pas les affaires posées sur un nœud (§2 bis.3), la
// base les mesure, et une commande éteinte d'avance ferait passer une règle du produit pour une
// décision d'interface. Elle se tromperait de surcroît dès qu'une affaire aurait bougé entre le
// chargement et le clic.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Plus } from 'lucide-react'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	calculerDeplacement,
	proposerSlug,
	slugConforme,
	type Deplacement,
	type Sens,
} from '../lib/administration-arborescence'
import {
	archiverNoeud,
	COULEURS_NOEUD,
	creerNoeud,
	deplacerNoeud,
	lireCatalogueAdministrable,
	lireSaisieNumerique,
	modifierNoeud,
	probabiliteConforme,
	seuilRelanceConforme,
	TYPES_NOEUD,
	type CouleurNoeud,
	type NatureRefusCatalogue,
	type NoeudCatalogue,
	type RefusCatalogue,
	type TypeNoeud,
} from '../lib/administration-catalogue'
import { classesPilule } from './presentation-tracks'
import { lireWorkspaces } from '../lib/workspaces'
import { clientCrm, type ClientCrm } from '../lib/supabase'

/** Le type est un MOT, jamais une teinte (`docs/DESIGN_SYSTEM.md` §5.18). */
const CLES_TYPE: Readonly<Record<TypeNoeud, CleTraduction>> = {
	open: 'admin.catalog.kind.open',
	won: 'admin.catalog.kind.won',
	lost: 'admin.catalog.kind.lost',
}

const CLES_COULEUR: Readonly<Record<CouleurNoeud, CleTraduction>> = {
	brand: 'admin.catalog.color.brand',
	success: 'admin.catalog.color.success',
	accent: 'admin.catalog.color.accent',
	danger: 'admin.catalog.color.danger',
	neutral: 'admin.catalog.color.neutral',
}

/**
 * Un texte par refus attendu (§2 bis.5).
 *
 * `noeud-occupe` n'est PAS dans ce tableau : c'est le seul refus dont le texte porte un nombre, et
 * il a deux clés — avec compte et sans compte — choisies par `texteRefus`.
 */
const CLES_REFUS: Readonly<Record<Exclude<NatureRefusCatalogue, 'noeud-occupe'>, CleTraduction>> = {
	forbidden: 'admin.catalog.refus.forbidden',
	'cle-prise': 'admin.catalog.refus.keyTaken',
	'forme-refusee': 'admin.catalog.refus.shape',
	'reference-absente': 'admin.catalog.refus.missing',
	network: 'admin.catalog.refus.network',
	unknown: 'admin.catalog.refus.unknown',
}

/**
 * Le texte d'un refus.
 *
 * UN COMPTE ABSENT NE DEVIENT PAS ZÉRO (§2 bis.5) : la phrase sans compte dit la même règle sans
 * affirmer un nombre que la base n'a pas donné. Les deux formes sont deux clés distinctes, jamais
 * une phrase construite par concaténation (`CLAUDE.md` §23).
 */
export function texteRefus(refus: RefusCatalogue): string {
	if (refus.nature !== 'noeud-occupe') return t(CLES_REFUS[refus.nature])
	if (refus.affairesActives === null) return t('admin.catalog.refus.occupied.unknown')
	return refus.affairesActives === 1
		? t('admin.catalog.refus.occupied.one', { compte: String(refus.affairesActives) })
		: t('admin.catalog.refus.occupied.many', { compte: String(refus.affairesActives) })
}

/** Ce qui est ouvert dans le flux du document. Un seul à la fois (`docs/DESIGN_SYSTEM.md` §5.13). */
type Ouverture =
	| { readonly quoi: 'aucune' }
	| { readonly quoi: 'creation' }
	| { readonly quoi: 'modification'; readonly id: string }
	| { readonly quoi: 'archivage'; readonly id: string }

const AUCUNE: Ouverture = { quoi: 'aucune' }

/** La saisie d'un formulaire, création comme modification : les mêmes champs, moins la clé. */
type Saisie = {
	readonly cle: string
	readonly libelle: string
	readonly type: TypeNoeud
	readonly couleur: CouleurNoeud
	readonly probabilite: string
	readonly seuilRelance: string
}

const SAISIE_VIDE: Saisie = {
	cle: '',
	libelle: '',
	type: 'open',
	couleur: 'neutral',
	probabilite: '',
	seuilRelance: '',
}

/**
 * La saisie d'un nœud existant.
 *
 * Un `null` en base redevient une chaîne VIDE, jamais `'0'` : sans quoi rouvrir le formulaire d'un
 * nœud qui ne se prononce pas et l'enregistrer sans y toucher écrirait `0`, c'est-à-dire changerait
 * la donnée sans que personne ne l'ait demandé (§2.5).
 */
function saisieDepuis(noeud: NoeudCatalogue): Saisie {
	return {
		cle: noeud.key,
		libelle: noeud.label,
		type: (TYPES_NOEUD as readonly string[]).includes(noeud.kind)
			? (noeud.kind as TypeNoeud)
			: 'open',
		couleur: (COULEURS_NOEUD as readonly string[]).includes(noeud.color)
			? (noeud.color as CouleurNoeud)
			: 'neutral',
		probabilite: noeud.default_probability === null ? '' : String(Number(noeud.default_probability)),
		seuilRelance:
			noeud.default_stale_after_days === null ? '' : String(noeud.default_stale_after_days),
	}
}

export type ProprietesAdministrationCatalogue = {
	readonly client?: ClientCrm | null
}

export function AdministrationCatalogue({
	client = clientCrm,
}: ProprietesAdministrationCatalogue = {}) {
	const [idWorkspace, setIdWorkspace] = useState<string | null>(null)
	const [etat, setEtat] = useState<EtatAsync<readonly NoeudCatalogue[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [ouverture, setOuverture] = useState<Ouverture>(AUCUNE)
	const [saisie, setSaisie] = useState<Saisie>(SAISIE_VIDE)
	const [refus, setRefus] = useState<string | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	// Une réponse arrivée après le démontage, ou périmée par un rechargement, ne doit pas écraser un
	// état plus récent — même garde que les quatre autres surfaces d'administration.
	const courant = useRef(0)
	/** La commande qui a ouvert le formulaire, pour lui rendre le focus (`§5.13`). */
	const origineFocus = useRef<HTMLButtonElement | null>(null)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setEtat(enChargement())
		void (async () => {
			const espaces = await lireWorkspaces(client)
			if (rang !== courant.current) return
			if (espaces.statut === 'erreur') {
				setEtat(enErreur(espaces.erreur))
				return
			}
			if (espaces.statut !== 'pret') return
			setIdWorkspace(espaces.donnees[0]?.id ?? null)
			const lus = await lireCatalogueAdministrable(client)
			if (rang !== courant.current) return
			setEtat(lus.statut === 'pret' ? pret(lus.donnees) : lus)
		})()
	}, [client, tentative])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const fermer = useCallback(() => {
		setOuverture(AUCUNE)
		setRefus(null)
		// Le focus revient à la commande qui a ouvert le bloc : sans lui, activer « Annuler » au
		// clavier laisse le focus sur un bouton qui vient de disparaître (§5.13).
		origineFocus.current?.focus()
	}, [])

	const ouvrir = useCallback((prochaine: Ouverture, depuis: HTMLButtonElement | null) => {
		origineFocus.current = depuis
		setRefus(null)
		setOuverture(prochaine)
	}, [])

	/** Une écriture, son résultat, et la seule chose que l'écran en fait. */
	const appliquer = useCallback(
		async (
			ecriture: () => Promise<
				| { readonly statut: 'applique' }
				| { readonly statut: 'sans-effet' }
				| { readonly statut: 'refus'; readonly refus: RefusCatalogue }
			>,
			cleSucces: CleTraduction,
			nom: string,
		) => {
			setEnCours(true)
			setRefus(null)
			const resultat = await ecriture()
			setEnCours(false)
			if (resultat.statut === 'applique') {
				setAnnonce(t(cleSucces, { nom }))
				setOuverture(AUCUNE)
				// LA LISTE EST RELUE, JAMAIS CORRIGÉE EN MÉMOIRE : la position d'un nœud créé est
				// attribuée par un trigger (§2.4), et une liste recomposée localement l'ignorerait.
				recharger()
				return
			}
			setRefus(
				resultat.statut === 'sans-effet'
					? t('admin.catalog.refus.sansEffet')
					: texteRefus(resultat.refus),
			)
		},
		[recharger],
	)

	/**
	 * Monter ou descendre un nœud — §2 ter.
	 *
	 * LA LISTE PASSÉE EST CELLE QUI EST AFFICHÉE, archivés compris (§2 ter.3) : c'est la seule qui
	 * corresponde à ce que l'administrateur voit. Calculer sur la seule sous-liste active ferait
	 * franchir une ligne archivée d'un seul clic, ou produirait une position égale à la sienne.
	 *
	 * LE CALCUL PRÉCÈDE L'ÉCRITURE, et un calcul impossible n'écrit RIEN : l'écran nomme
	 * l'impossibilité au lieu d'envoyer une valeur sans effet, ce que `CLAUDE.md` §18 proscrit sous
	 * le nom de « valeur par défaut trompeuse ». Le cas double la désactivation de la commande, qui
	 * repose sur le même calcul — il n'est donc pas atteignable à la souris, mais il le reste par
	 * tout autre chemin, et c'est pour cela qu'il est traité.
	 */
	const deplacer = useCallback(
		(liste: readonly NoeudCatalogue[], noeud: NoeudCatalogue, sens: Sens) => {
			if (client === null) return
			const calcul = calculerDeplacement(liste, noeud.id, sens)
			if (calcul.statut !== 'calcule') {
				setOuverture(AUCUNE)
				setRefus(t('admin.move.impossible'))
				return
			}
			void appliquer(
				() => deplacerNoeud(client, noeud.id, calcul.position),
				'admin.catalog.moved',
				noeud.label,
			)
		},
		[appliquer, client],
	)

	if (client === null) {
		return (
			<EtatVide
				titre={t('admin.catalog.noWorkspace.title')}
				corps={t('admin.catalog.noWorkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={5} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.catalog.error.title')}
				corps={t('admin.catalog.error.body')}
				libelleReprise={t('admin.catalog.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	const noeuds = etat.donnees

	return (
		<section aria-label={t('admin.catalog.aria')} className="flex flex-col gap-4">
			<p role="status" className="sr-only">
				{annonce}
			</p>

			<div className="flex items-center justify-between gap-4">
				<p className="text-sm text-text-2 max-w-[70ch]">{t('admin.catalog.intro')}</p>
				<button
					type="button"
					data-testid="ouvrir-creation-noeud"
					onClick={(evenement) => {
						setSaisie(SAISIE_VIDE)
						ouvrir({ quoi: 'creation' }, evenement.currentTarget)
					}}
					className={CLASSES_BOUTON_PRIMAIRE}
				>
					<Plus aria-hidden="true" className="size-4" />
					{t('admin.catalog.create')}
				</button>
			</div>

			{/*
			 * Un refus qui n'appartient à AUCUN bloc — celui d'un déplacement impossible (§2 ter.5),
			 * ou d'un déplacement resté sans effet — est affiché ici.
			 *
			 * Le patron vient de `AdministrationArborescence`, où il a été ajouté APRÈS un défaut
			 * réel : `setRefus` était appelé pour un déplacement refusé, mais l'alerte n'était rendue
			 * que dans les formulaires. Le refus était calculé, correct, et invisible — l'erreur
			 * masquée de `CLAUDE.md` §18. Il est repris ici plutôt que redécouvert.
			 */}
			{refus !== null && ouverture.quoi === 'aucune' && (
				<p
					role="alert"
					data-testid="refus-catalogue"
					className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
				>
					{refus}
				</p>
			)}

			{ouverture.quoi === 'creation' && (
				<FormulaireNoeud
					titre={t('admin.catalog.form.createTitle')}
					saisie={saisie}
					avecCle
					enCours={enCours}
					refus={refus}
					onChangement={setSaisie}
					onAnnuler={fermer}
					onValider={() => {
						if (idWorkspace === null) return
						void appliquer(
							() =>
								creerNoeud(client, {
									idWorkspace,
									cle: saisie.cle,
									libelle: saisie.libelle,
									type: saisie.type,
									couleur: saisie.couleur,
									probabilite: lireSaisieNumerique(saisie.probabilite),
									seuilRelance: lireSaisieNumerique(saisie.seuilRelance),
								}),
							'admin.catalog.created',
							saisie.libelle,
						)
					}}
				/>
			)}

			{/* L'état vide offre l'action, contrairement à celui de la corbeille : un catalogue vide
			    est un manque, et le §5.8 demande « message et action ». */}
			{noeuds.length === 0 ? (
				<EtatVide titre={t('admin.catalog.empty.title')} corps={t('admin.catalog.empty.body')} />
			) : (
				<ul data-testid="liste-catalogue" className="rounded-lg border border-border bg-surface">
					{noeuds.map((noeud) => (
						<LigneNoeud
							key={noeud.id}
							noeud={noeud}
							liste={noeuds}
							ouverture={ouverture}
							saisie={saisie}
							enCours={enCours}
							refus={refus}
							onDeplacer={(sens) => deplacer(noeuds, noeud, sens)}
							onOuvrirModification={(depuis) => {
								setSaisie(saisieDepuis(noeud))
								ouvrir({ quoi: 'modification', id: noeud.id }, depuis)
							}}
							onOuvrirArchivage={(depuis) => ouvrir({ quoi: 'archivage', id: noeud.id }, depuis)}
							onDesarchiver={() => {
								void appliquer(
									() => archiverNoeud(client, noeud.id, false),
									'admin.catalog.unarchived',
									noeud.label,
								)
							}}
							onChangement={setSaisie}
							onAnnuler={fermer}
							onValiderModification={() => {
								void appliquer(
									() =>
										modifierNoeud(client, noeud.id, {
											libelle: saisie.libelle,
											type: saisie.type,
											couleur: saisie.couleur,
											probabilite: lireSaisieNumerique(saisie.probabilite),
											seuilRelance: lireSaisieNumerique(saisie.seuilRelance),
										}),
									'admin.catalog.updated',
									saisie.libelle,
								)
							}}
							onConfirmerArchivage={() => {
								void appliquer(
									() => archiverNoeud(client, noeud.id, true),
									'admin.catalog.archived.done',
									noeud.label,
								)
							}}
						/>
					))}
				</ul>
			)}
		</section>
	)
}

const CLASSES_BOUTON_PRIMAIRE = [
	'inline-flex items-center gap-2 shrink-0',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_BOUTON_DISCRET = [
	'inline-flex items-center gap-2',
	'min-h-[var(--size-target)] px-2 rounded-sm',
	'text-text-2 text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:bg-hover disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_BOUTON_SECONDAIRE = [
	'inline-flex items-center gap-2',
	'min-h-[var(--size-target)] px-3 rounded-sm',
	'border border-border bg-surface text-ink text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:bg-hover disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_BOUTON_DESTRUCTIF = [
	'inline-flex items-center gap-2',
	'min-h-[var(--size-target)] px-3 rounded-sm',
	'bg-danger text-white text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_CHAMP = [
	'min-h-[var(--size-target)] px-3 rounded-sm',
	'border border-border bg-surface text-ink',
].join(' ')

/**
 * Une ligne du catalogue, et le bloc qu'elle ouvre éventuellement sous elle.
 *
 * Le formulaire et la confirmation vivent DANS LE FLUX, sous la ligne concernée — aucune modale
 * (§5.13). Le refus s'affiche dans le bloc concerné, jamais en tête d'écran.
 */
function LigneNoeud({
	noeud,
	liste,
	ouverture,
	saisie,
	enCours,
	refus,
	onDeplacer,
	onOuvrirModification,
	onOuvrirArchivage,
	onDesarchiver,
	onChangement,
	onAnnuler,
	onValiderModification,
	onConfirmerArchivage,
}: {
	readonly noeud: NoeudCatalogue
	/** La liste AFFICHÉE, archivés compris : c'est sur elle que le déplacement se calcule (§2 ter.3). */
	readonly liste: readonly NoeudCatalogue[]
	readonly ouverture: Ouverture
	readonly saisie: Saisie
	readonly enCours: boolean
	readonly refus: string | null
	readonly onDeplacer: (sens: Sens) => void
	readonly onOuvrirModification: (depuis: HTMLButtonElement) => void
	readonly onOuvrirArchivage: (depuis: HTMLButtonElement) => void
	readonly onDesarchiver: () => void
	readonly onChangement: (saisie: Saisie) => void
	readonly onAnnuler: () => void
	readonly onValiderModification: () => void
	readonly onConfirmerArchivage: () => void
}) {
	const archive = noeud.archived_at !== null
	const enModification = ouverture.quoi === 'modification' && ouverture.id === noeud.id
	const enArchivage = ouverture.quoi === 'archivage' && ouverture.id === noeud.id

	return (
		<li data-testid="ligne-noeud" data-noeud={noeud.key} className="border-b border-border last:border-b-0">
			<div className="flex flex-wrap items-center gap-3 px-3 min-h-[var(--size-target)] py-2 hover:bg-hover">
				<span
					data-testid="pilule-noeud"
					className={`inline-flex items-center rounded-full px-3 min-h-[var(--size-target)] text-sm font-medium ${classesPilule(noeud.color)}`}
				>
					{noeud.label}
				</span>
				<code className="rounded-sm bg-hover px-2 py-1 text-sm text-text-2">{noeud.key}</code>
				<span data-testid="type-noeud" className="text-sm text-text-2">
					{t(CLES_TYPE[(noeud.kind as TypeNoeud) ?? 'open'] ?? 'admin.catalog.kind.open')}
				</span>
				{/* Un attribut facultatif non renseigné reste VIDE (§5.9, §5.18) : ni tiret, ni zéro. */}
				<span className="text-sm text-text-2 tabular-nums font-mono">
					{noeud.default_probability === null ? (
						''
					) : (
						<span data-testid="probabilite-noeud">
							{t('admin.catalog.probability.value', {
								valeur: String(Number(noeud.default_probability)),
							})}
						</span>
					)}
				</span>
				<span className="text-sm text-text-2 tabular-nums font-mono">
					{noeud.default_stale_after_days === null ? (
						''
					) : (
						<span data-testid="seuil-noeud">
							{t('admin.catalog.stale.value', { valeur: String(noeud.default_stale_after_days) })}
						</span>
					)}
				</span>
				{archive && (
					<span
						data-testid="pilule-archive"
						className="inline-flex items-center gap-1 rounded-full bg-accent-soft text-accent-on-soft px-3 py-1 text-sm"
					>
						<Archive aria-hidden="true" className="size-4" />
						{t('admin.catalog.archived')}
					</span>
				)}

				<span className="ml-auto flex items-center gap-1">
					{/* Les commandes d'ordre viennent EN TÊTE du groupe, avant « Modifier » — la
					    disposition du §5.13, reprise telle quelle au §5.18. Comme « Modifier », elles
					    disparaissent sur une ligne archivée (§2 ter.3) ; la ligne archivée reste en
					    revanche comptée comme voisine par le calcul, puisqu'elle occupe une place. */}
					{!archive && (
						<CommandesOrdre
							noeud={noeud}
							liste={liste}
							enCours={enCours}
							onDeplacer={onDeplacer}
						/>
					)}
					{/* Modifier disparaît sur un nœud archivé : le geste n'a aucun effet observable sur
					    un nœud masqué des sélecteurs, exactement comme au §5.13 pour un objet archivé. */}
					{!archive && (
						<button
							type="button"
							data-testid="modifier-noeud"
							onClick={(evenement) => onOuvrirModification(evenement.currentTarget)}
							aria-label={t('admin.catalog.edit.aria', { nom: noeud.label })}
							className={CLASSES_BOUTON_DISCRET}
						>
							<Pencil aria-hidden="true" className="size-4" />
							{t('admin.catalog.edit')}
						</button>
					)}
					{archive ? (
						<button
							type="button"
							data-testid="desarchiver-noeud"
							onClick={onDesarchiver}
							disabled={enCours}
							aria-label={t('admin.catalog.unarchive.aria', { nom: noeud.label })}
							className={CLASSES_BOUTON_DISCRET}
						>
							<ArchiveRestore aria-hidden="true" className="size-4" />
							{t('admin.catalog.unarchive')}
						</button>
					) : (
						<button
							type="button"
							data-testid="archiver-noeud"
							onClick={(evenement) => onOuvrirArchivage(evenement.currentTarget)}
							aria-label={t('admin.catalog.archive.aria', { nom: noeud.label })}
							className={CLASSES_BOUTON_DISCRET}
						>
							<Archive aria-hidden="true" className="size-4" />
							{t('admin.catalog.archive')}
						</button>
					)}
				</span>
			</div>

			{enModification && (
				<div className="px-3 pb-3">
					<FormulaireNoeud
						titre={t('admin.catalog.form.editTitle')}
						saisie={saisie}
						avecCle={false}
						enCours={enCours}
						refus={refus}
						onChangement={onChangement}
						onAnnuler={onAnnuler}
						onValider={onValiderModification}
					/>
				</div>
			)}

			{enArchivage && (
				<div className="px-3 pb-3 flex flex-col gap-2" data-testid="confirmation-archivage">
					<p className="text-sm">{t('admin.catalog.archive.confirm', { nom: noeud.label })}</p>
					{refus !== null && (
						<p
							role="alert"
							data-testid="refus-catalogue"
							className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
						>
							{refus}
						</p>
					)}
					<div className="flex items-center gap-2">
						<button
							type="button"
							data-testid="confirmer-archivage"
							onClick={onConfirmerArchivage}
							disabled={enCours}
							className={CLASSES_BOUTON_DESTRUCTIF}
						>
							{t('admin.catalog.archive.confirmAction')}
						</button>
						<button
							type="button"
							data-testid="annuler-archivage"
							onClick={onAnnuler}
							className={CLASSES_BOUTON_SECONDAIRE}
						>
							{t('admin.catalog.cancel')}
						</button>
					</div>
				</div>
			)}
		</li>
	)
}

/**
 * Les deux commandes d'ordre d'une ligne — §2 ter, `docs/DESIGN_SYSTEM.md` §5.18.
 *
 * ELLES SONT DÉSACTIVÉES AUX EXTRÉMITÉS, JAMAIS MASQUÉES (§8) : une commande qui disparaît en tête
 * de liste fait sauter le groupe d'actions d'une ligne à l'autre, et l'œil perd la colonne.
 *
 * ICÔNE SEULE, nom accessible par `aria-label` : c'est la disposition du §5.13, et à 390 px deux
 * libellés de plus feraient déborder la barre d'actions d'une ligne qui en porte déjà trois.
 */
function CommandesOrdre({
	noeud,
	liste,
	enCours,
	onDeplacer,
}: {
	readonly noeud: NoeudCatalogue
	readonly liste: readonly NoeudCatalogue[]
	readonly enCours: boolean
	readonly onDeplacer: (sens: Sens) => void
}) {
	const monter = calculerDeplacement(liste, noeud.id, 'monter')
	const descendre = calculerDeplacement(liste, noeud.id, 'descendre')

	/**
	 * Pourquoi la commande est indisponible — §8 : « les états désactivés restent lisibles et
	 * expliquent pourquoi l'action est indisponible ».
	 *
	 * LES DEUX CAUSES APPELLENT DEUX PHRASES DIFFÉRENTES, et les confondre serait un message faux :
	 * une ligne dont les voisines portent la même position n'est PAS « déjà en tête de liste ». Le
	 * défaut a été trouvé par la preuve sur l'arborescence, pas à la lecture ; il n'est pas refait ici.
	 */
	const explication = (deplacement: Deplacement, extremite: CleTraduction): string | undefined => {
		if (deplacement.statut === 'calcule') return undefined
		return deplacement.cause === 'extremite' ? t(extremite) : t('admin.move.impossible')
	}

	return (
		<>
			<button
				type="button"
				data-testid="monter-noeud"
				disabled={monter.statut !== 'calcule' || enCours}
				onClick={() => onDeplacer('monter')}
				aria-label={t('admin.catalog.moveUp.aria', { nom: noeud.label })}
				title={explication(monter, 'admin.move.disabled.top')}
				className={CLASSES_BOUTON_DISCRET}
			>
				<ArrowUp aria-hidden="true" className="size-4" />
			</button>
			<button
				type="button"
				data-testid="descendre-noeud"
				disabled={descendre.statut !== 'calcule' || enCours}
				onClick={() => onDeplacer('descendre')}
				aria-label={t('admin.catalog.moveDown.aria', { nom: noeud.label })}
				title={explication(descendre, 'admin.move.disabled.bottom')}
				className={CLASSES_BOUTON_DISCRET}
			>
				<ArrowDown aria-hidden="true" className="size-4" />
			</button>
		</>
	)
}

/**
 * Le formulaire, création et modification confondues.
 *
 * `avecCle` porte la seule différence : à la création la clé est un champ, proposé depuis le libellé
 * par `proposerSlug` et modifiable ; sur un nœud existant elle est une PHRASE, jamais un champ
 * désactivé (§5.18, §5.15). Un champ grisé poserait la question « pourquoi ? » sans y répondre.
 */
function FormulaireNoeud({
	titre,
	saisie,
	avecCle,
	enCours,
	refus,
	onChangement,
	onAnnuler,
	onValider,
}: {
	readonly titre: string
	readonly saisie: Saisie
	readonly avecCle: boolean
	readonly enCours: boolean
	readonly refus: string | null
	readonly onChangement: (saisie: Saisie) => void
	readonly onAnnuler: () => void
	readonly onValider: () => void
}) {
	const premier = useRef<HTMLInputElement | null>(null)
	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const probabilite = lireSaisieNumerique(saisie.probabilite)
	const seuil = lireSaisieNumerique(saisie.seuilRelance)
	const libelleValide = saisie.libelle.trim() !== ''
	const cleValide = !avecCle || slugConforme(saisie.cle.trim())
	const valide =
		libelleValide && cleValide && probabiliteConforme(probabilite) && seuilRelanceConforme(seuil)

	return (
		<form
			data-testid="formulaire-noeud"
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				if (valide && !enCours) onValider()
			}}
		>
			<h3 className="text-h3">{titre}</h3>

			<div className="flex flex-wrap gap-3">
				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.catalog.field.label')}
					<input
						ref={premier}
						data-testid="champ-libelle"
						value={saisie.libelle}
						onChange={(evenement) => {
							const libelle = evenement.target.value
							// La clé est PROPOSÉE depuis le libellé tant qu'elle n'a pas été touchée à la
							// main — commodité du §2 bis.6, jamais une garantie. Elle ne l'est qu'à la
							// création : sur un nœud existant, la clé ne bouge pas.
							onChangement(
								avecCle && (saisie.cle === '' || saisie.cle === proposerSlug(saisie.libelle))
									? { ...saisie, libelle, cle: proposerSlug(libelle) }
									: { ...saisie, libelle },
							)
						}}
						className={CLASSES_CHAMP}
					/>
				</label>

				{avecCle ? (
					<label className="flex flex-col gap-1 text-sm text-text-2">
						{t('admin.catalog.field.key')}
						<input
							data-testid="champ-cle"
							value={saisie.cle}
							onChange={(evenement) => onChangement({ ...saisie, cle: evenement.target.value })}
							className={CLASSES_CHAMP}
						/>
					</label>
				) : (
					<p className="text-sm text-text-2 max-w-[40ch]" data-testid="phrase-cle">
						{t('admin.catalog.field.keyFixed', { cle: saisie.cle })}
					</p>
				)}

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.catalog.field.kind')}
					<select
						data-testid="champ-type"
						value={saisie.type}
						onChange={(evenement) =>
							onChangement({ ...saisie, type: evenement.target.value as TypeNoeud })
						}
						className={CLASSES_CHAMP}
					>
						{TYPES_NOEUD.map((type) => (
							<option key={type} value={type}>
								{t(CLES_TYPE[type])}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.catalog.field.color')}
					<select
						data-testid="champ-couleur"
						value={saisie.couleur}
						onChange={(evenement) =>
							onChangement({ ...saisie, couleur: evenement.target.value as CouleurNoeud })
						}
						className={CLASSES_CHAMP}
					>
						{COULEURS_NOEUD.map((couleur) => (
							<option key={couleur} value={couleur}>
								{t(CLES_COULEUR[couleur])}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.catalog.field.probability')}
					<input
						data-testid="champ-probabilite"
						inputMode="decimal"
						value={saisie.probabilite}
						onChange={(evenement) =>
							onChangement({ ...saisie, probabilite: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.catalog.field.stale')}
					<input
						data-testid="champ-seuil"
						inputMode="numeric"
						value={saisie.seuilRelance}
						onChange={(evenement) =>
							onChangement({ ...saisie, seuilRelance: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
				</label>
			</div>

			<p className="text-sm text-text-3">{t('admin.catalog.field.optional')}</p>

			{refus !== null && (
				<p
					role="alert"
					data-testid="refus-catalogue"
					className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
				>
					{refus}
				</p>
			)}

			<div className="flex items-center gap-2">
				<button
					type="submit"
					data-testid="valider-noeud"
					disabled={!valide || enCours}
					className={CLASSES_BOUTON_PRIMAIRE}
				>
					{t('admin.catalog.save')}
				</button>
				<button
					type="button"
					data-testid="annuler-noeud"
					onClick={onAnnuler}
					className={CLASSES_BOUTON_SECONDAIRE}
				>
					{t('admin.catalog.cancel')}
				</button>
			</div>
		</form>
	)
}
