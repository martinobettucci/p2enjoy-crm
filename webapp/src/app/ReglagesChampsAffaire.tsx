// @spec CRM-112 (docs/BACKLOG.md) — tranche T3.a : Réglages ▸ « Champs de l'affaire » — lire, déclarer, modifier,
//       réordonner, archiver et restaurer les champs communs de l'espace
// @spec docs/SPEC-champs-communs.md §3.2 (ni la clé ni le type ne se modifient), §4 (lecture par les membres, écriture par
//       l'administrateur), §6 (`common_field_in_use` nomme les transitions), §7 (l'écran réemploie les éléments de
//       l'éditeur de formulaire des workflows) ; docs/DESIGN_SYSTEM.md §5.86 (l'écran), §5.15 (la ligne, le formulaire,
//       la confirmation), §5.29 bis (« Afficher les archivés » ; un refus nomme le geste qui le lève), §5.59 (capacité
//       d'administrer), §5.8 (états)
// @spec CLAUDE.md §10 — l'écran ne décide aucun droit : refusée par la base, la capacité d'administrer éteint ses
//       commandes avec leur motif ; la RLS de `card_common_fields` reste seule juge de chaque écriture

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { FournisseurRefus, useRefus } from '../components/ui/RefusCommandes'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t, type CleTraduction } from '../i18n'
import type { NatureErreur } from '../lib/async'
import { calculerDeplacement, type Sens } from '../lib/administration-arborescence'
import { composerOptions, type ChampDeclarable } from '../lib/administration-workflows'
import { motifVisible, proprietesCommande } from '../lib/capacites'
import {
	archiverChampCommun,
	declarerChampCommun,
	deplacerChampCommun,
	lireChampsCommunsEspace,
	modifierChampCommun,
	type IssueChampCommun,
	type NatureRefusChampCommun,
	type RefusChampCommun,
} from '../lib/champs-communs'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { CHEMIN_ADMIN_WORKFLOWS } from './chemins'
import { useContexteEspace } from './ContexteEspace'
import { ConfirmationRetrait, FormulaireChamp, LigneChamp, type SaisieChamp } from './ElementsChampAdmin'

const ID_MOTIF = 'motif-champs-affaire'

const CLES_REFUS: Readonly<Record<Exclude<NatureRefusChampCommun, 'employe'>, CleTraduction>> = {
	'cle-prise': 'admin.commonFields.refus.cle',
	forme: 'admin.commonFields.refus.forme',
	forbidden: 'admin.commonFields.refus.forbidden',
	'sans-effet': 'admin.commonFields.refus.sansEffet',
	network: 'admin.commonFields.refus.panne',
	unknown: 'admin.commonFields.refus.panne',
}

/** Le texte d'un refus ; celui d'un champ employé nomme les transitions que la base écrit (§5.86). */
export function texteRefusChampCommun(refus: RefusChampCommun): string {
	if (refus.nature === 'employe') return t('admin.commonFields.refus.employe', { transitions: refus.detail ?? '' })
	return t(CLES_REFUS[refus.nature])
}

type Lecture =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'erreur'; readonly nature: NatureErreur }
	| { readonly statut: 'pret'; readonly champs: readonly ChampDeclarable[] }

type Ouverture =
	| { readonly type: 'aucune' }
	| { readonly type: 'creation' }
	| { readonly type: 'edition'; readonly idChamp: string }
	| { readonly type: 'archivage'; readonly idChamp: string }

const AUCUNE: Ouverture = { type: 'aucune' }

export type ProprietesReglagesChampsAffaire = { readonly client?: ClientCrm | null }

export function ReglagesChampsAffaire({ client = clientCrm }: ProprietesReglagesChampsAffaire = {}) {
	const { idWorkspace, capacites } = useContexteEspace()
	const droit = proprietesCommande(capacites.administration, ID_MOTIF)
	const [lecture, setLecture] = useState<Lecture>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [archives, setArchives] = useState(false)
	const [ouverture, setOuverture] = useState<Ouverture>(AUCUNE)
	const [refus, setRefus] = useState<RefusChampCommun | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	const rang = useRef(0)
	// Le focus revient à la commande qui a ouvert le bloc (§5.13), différé d'un rendu : elle a pu être démontée (§5.25).
	// Elle se retrouve par sa ligne et son nom accessible ; une ligne disparue — un champ archivé, archivés masqués — le
	// rend à « Nouveau champ » : le focus ne reste jamais sur un élément qui disparaît.
	const retourFocus = useRef<{ readonly ligne: string; readonly noms: readonly string[] } | 'nouveau' | null>(null)

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		const r = ++rang.current
		void lireChampsCommunsEspace(client, idWorkspace).then((lu) => {
			if (r !== rang.current) return
			// Une relecture garde la liste à l'écran : le squelette est réservé au premier chargement (§5.29 tranche 2 c).
			if (lu.statut === 'erreur') setLecture({ statut: 'erreur', nature: lu.erreur.nature })
			else if (lu.statut === 'pret') setLecture({ statut: 'pret', champs: lu.donnees })
		})
	}, [client, idWorkspace, tentative])

	useEffect(() => {
		const cible = retourFocus.current
		if (ouverture.type !== 'aucune' || cible === null) return
		const commande =
			cible === 'nouveau'
				? null
				: cible.noms
						.map((nom) =>
							[...document.querySelectorAll<HTMLButtonElement>(`[data-retour-focus-ligne="${cible.ligne}"] button`)].find(
								(bouton) => bouton.getAttribute('aria-label') === nom,
							),
						)
						.find((bouton) => bouton !== undefined)
		;(commande ?? document.querySelector<HTMLElement>('[data-retour-focus="nouveau"]'))?.focus()
		retourFocus.current = null
	}, [ouverture, lecture])

	const fermer = useCallback(() => {
		setRefus(null)
		setOuverture(AUCUNE)
	}, [])

	/** Exécute une écriture : au succès, ferme le bloc, annonce et relit ; au refus, le garde ouvert avec son motif. */
	const executer = useCallback(
		async (appel: () => Promise<IssueChampCommun>, succes: string, garderOuvert = false) => {
			setEnCours(true)
			setRefus(null)
			const issue = await appel()
			setEnCours(false)
			if (issue.statut === 'refus') {
				setRefus(issue.refus)
				if (!garderOuvert) setAnnonce(texteRefusChampCommun(issue.refus))
				return
			}
			setAnnonce(succes)
			setOuverture(AUCUNE)
			setTentative((n) => n + 1)
		},
		[],
	)

	if (client === null || idWorkspace === null) {
		return <EtatVide titre={t('time.noworkspace.title')} corps={t('admin.commonFields.noworkspace')} />
	}

	const champs = lecture.statut === 'pret' ? lecture.champs : []
	const visibles = champs.filter((c) => archives || c.archived_at === null)

	const ouvrir = (suivante: Ouverture, retour: { readonly ligne: string; readonly noms: readonly string[] } | 'nouveau') => {
		retourFocus.current = retour
		setRefus(null)
		setOuverture(suivante)
	}

	const deplacer = (idChamp: string, sens: Sens) => {
		// L'ordre se calcule sur la liste AFFICHÉE : ce que l'administrateur voit monter ou descendre.
		const calcul = calculerDeplacement(visibles, idChamp, sens)
		if (calcul.statut !== 'calcule') {
			setAnnonce(t('admin.move.impossible'))
			return
		}
		void executer(() => deplacerChampCommun(client, idChamp, calcul.position), t('admin.commonFields.moved'))
	}

	const enregistrer = (champ: ChampDeclarable | null, saisie: SaisieChamp) => {
		const libelle = saisie.libelle.trim()
		const aide = saisie.aide.trim() === '' ? null : saisie.aide.trim()
		const options = composerOptions(saisie.type, saisie.choix, saisie.devise)
		void executer(
			() =>
				champ === null
					? declarerChampCommun(client, idWorkspace, { cle: saisie.cle.trim(), libelle, type: saisie.type, aide, options })
					: modifierChampCommun(client, champ.id, { libelle, aide, options }),
			t('admin.commonFields.saved', { nom: libelle }),
			true,
		)
	}

	const texteRefus = refus === null ? null : texteRefusChampCommun(refus)

	return (
		<FournisseurRefus valeur={droit}>
			<div className="flex max-w-[104ch] min-w-0 flex-col gap-4" data-testid="reglages-champs-affaire">
				<h2 className="text-h3">{t('admin.commonFields.title')}</h2>
				<p className="max-w-[72ch] text-sm text-text-2">{t('admin.commonFields.intro')}</p>
				{motifVisible(capacites.administration) ? (
					<MotifLectureSeule id={ID_MOTIF}>{t('rights.readonly.administration')}</MotifLectureSeule>
				) : null}
				<div className="flex flex-wrap items-center gap-3">
					{ouverture.type === 'creation' ? null : <CommandeNouveau onOuvrir={() => ouvrir({ type: 'creation' }, 'nouveau')} />}
					<label className="inline-flex min-h-[var(--size-target)] items-center gap-2 text-sm">
						<input
							type="checkbox"
							className="size-6 accent-[var(--color-brand)]"
							data-testid="champs-communs-archives"
							checked={archives}
							onChange={(evenement) => setArchives(evenement.target.checked)}
						/>
						{t('admin.commonFields.showArchived')}
					</label>
				</div>
				<LiveRegion libelle={t('live.admin.aria')} message={annonce} />

				{ouverture.type === 'creation' ? (
					<FormulaireChamp champ={null} refus={texteRefus} enCours={enCours} onValider={(saisie) => enregistrer(null, saisie)} onAnnuler={fermer} />
				) : null}

				{lecture.statut === 'chargement' ? (
					<SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
				) : lecture.statut === 'erreur' ? (
					<EtatErreur
						titre={t('admin.commonFields.error.title')}
						corps={t(lecture.nature === 'network' ? 'state.error.network' : 'state.error.unknown')}
						libelleReprise={t('state.error.retry')}
						onReprise={() => setTentative((n) => n + 1)}
					/>
				) : visibles.length === 0 ? (
					ouverture.type === 'creation' ? null : (
						<EtatVide titre={t('admin.commonFields.empty.title')} corps={t('admin.commonFields.empty.body')} />
					)
				) : (
					<ul className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3" data-testid="liste-champs-communs">
						{visibles.map((champ) => (
							<li key={champ.id} className="flex flex-col gap-2" data-champ={champ.key}>
								<div data-retour-focus-ligne={champ.id}>
									<LigneChamp
										champ={champ}
										liste={visibles}
										enCours={enCours}
										onDeplacer={(sens) => deplacer(champ.id, sens)}
										onOuvrirEdition={() =>
											ouvrir(
												{ type: 'edition', idChamp: champ.id },
												{ ligne: champ.id, noms: [t('admin.workflows.fields.action.edit', { nom: champ.label })] },
											)
										}
										onOuvrirArchivage={() =>
											ouvrir(
												{ type: 'archivage', idChamp: champ.id },
												// Annulé, le focus revient à « Archiver » ; archivé, à « Restaurer », qui l'a remplacé.
												{
													ligne: champ.id,
													noms: [
														t('admin.workflows.fields.action.archive', { nom: champ.label }),
														t('admin.workflows.fields.action.restore', { nom: champ.label }),
													],
												},
											)
										}
										onRestaurer={() =>
											void executer(
												() => archiverChampCommun(client, champ.id, null),
												t('admin.commonFields.restored', { nom: champ.label }),
											)
										}
									/>
								</div>
								{ouverture.type === 'edition' && ouverture.idChamp === champ.id ? (
									<FormulaireChamp
										champ={champ}
										refus={texteRefus}
										enCours={enCours}
										onValider={(saisie) => enregistrer(champ, saisie)}
										onAnnuler={fermer}
									/>
								) : null}
								{ouverture.type === 'archivage' && ouverture.idChamp === champ.id ? (
									<ConfirmationRetrait
										marqueur="confirmation-archivage-champ-commun"
										titre={t('admin.commonFields.archive.confirm', { nom: champ.label })}
										corps={t('admin.commonFields.archive.confirm.body')}
										libelleAction={t('admin.workflows.fields.archive.confirm.action')}
										refus={texteRefus}
										enCours={enCours}
										onConfirmer={() =>
											void executer(
												// L'instant vient du client : PostgREST écrit ce qu'on lui envoie, et c'est celui que
												// l'écran affichera.
												() => archiverChampCommun(client, champ.id, new Date().toISOString()),
												t('admin.commonFields.archived', { nom: champ.label }),
												true,
											)
										}
										onAnnuler={fermer}
										suiteRefus={
											refus?.nature === 'employe' ? (
												<Link to={CHEMIN_ADMIN_WORKFLOWS} className="text-sm font-medium text-brand underline">
													{t('admin.commonFields.refus.employe.lien')}
												</Link>
											) : null
										}
									/>
								) : null}
							</li>
						))}
					</ul>
				)}
			</div>
		</FournisseurRefus>
	)
}

/** « Nouveau champ » : primaire, éteinte avec le motif quand la base refuse l'administration (§5.59). */
function CommandeNouveau({ onOuvrir }: { readonly onOuvrir: () => void }) {
	const droit = useRefus()
	return (
		<Button {...droit} variante="primaire" data-retour-focus="nouveau" data-testid="nouveau-champ-commun" onClick={onOuvrir}>
			<Plus aria-hidden="true" size={16} strokeWidth={2} />
			{t('admin.commonFields.new')}
		</Button>
	)
}
