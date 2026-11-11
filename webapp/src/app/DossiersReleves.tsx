// @spec CRM-136 (docs/BACKLOG.md) — tranche T3 : le panneau « Dossiers relevés » d'une boîte — la liste réelle des dossiers lue
//       par le test de connexion, une case par dossier, les dossiers relevés que la boîte n'a plus, l'échec du test et sa
//       reprise, l'enregistrement par la fonction d'écriture habituelle et ses refus, le focus (docs/SPEC-mail-subsystem.md
//       §25.3, §25.5 ; docs/DESIGN_SYSTEM.md §5.99 ; décisions 884, 885 et 914)
//
// AUCUN DROIT N'EST APPLIQUÉ ICI. Lire les dossiers est un test de connexion, que la base autorise sous le droit d'écrire la
// boîte (§23.3) ; les enregistrer passe par `upsert_mail_inbound_account`, qui refuse de toute façon. La commande qui ouvre
// le panneau suit la capacité de la ligne (§5.59), comme « Configurer ».

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import {
	casesDossiers,
	enregistrerDossiers,
	type CompteEntrant,
	type IssueEnregistrement,
} from '../lib/mail-comptes'
import type { ClientCrm } from '../lib/supabase'
import { testerConnexion, type AccesTest, type IssueTest } from '../lib/test-connexion-mail'
import { phraseIssue } from './TestConnexionMail'

/** Le retrait d'un niveau de la hiérarchie : 0, 24 puis 48 px, l'échelle fermée du §3. */
const RETRAITS = ['pl-0', 'pl-6', 'pl-12'] as const

type Lecture = { readonly etat: 'lecture' } | { readonly etat: 'pret'; readonly noms: readonly string[] } | { readonly etat: 'echec'; readonly issue: IssueTest }

export function PanneauDossiersReleves({
	client,
	accesTest,
	idWorkspace,
	compte,
	refus,
	onFermer,
	onEnregistre,
}: {
	readonly client: ClientCrm
	readonly accesTest: AccesTest | null
	readonly idWorkspace: string
	readonly compte: CompteEntrant
	/** Le dictionnaire fermé des refus de l'écran (§21.7), complété par `aucun-dossier`. */
	readonly refus: Readonly<Record<Exclude<IssueEnregistrement, 'enregistre'>, CleTraduction>>
	readonly onFermer: () => void
	readonly onEnregistre: () => void
}) {
	const [lecture, setLecture] = useState<Lecture>({ etat: 'lecture' })
	const [essai, setEssai] = useState(0)
	const [coches, setCoches] = useState<ReadonlySet<string>>(() => new Set(compte.watch_folders ?? []))
	const [enCours, setEnCours] = useState(false)
	const [refusEcriture, setRefusEcriture] = useState<CleTraduction | null>(null)
	const premiere = useRef<HTMLInputElement | null>(null)
	const idLegende = useId()

	useEffect(() => {
		let vivant = true
		setLecture({ etat: 'lecture' })
		void testerConnexion(accesTest, 'inbound', compte.id).then((issue) => {
			if (!vivant) return
			if (issue.type === 'reussi' && issue.dossiers !== undefined) setLecture({ etat: 'pret', noms: issue.dossiers })
			else if (issue.type === 'reussi') setLecture({ etat: 'echec', issue: { type: 'refuse', motif: 'service' } })
			else setLecture({ etat: 'echec', issue })
		})
		return () => {
			vivant = false
		}
	}, [accesTest, compte.id, essai])

	// LE FOCUS ENTRE SUR LA PREMIÈRE CASE au retour de la lecture (§5.99, §5.13).
	useEffect(() => {
		if (lecture.etat === 'pret') premiere.current?.focus()
	}, [lecture.etat])

	const basculer = useCallback((nom: string) => {
		setCoches((precedentes) => {
			const suivantes = new Set(precedentes)
			if (suivantes.has(nom)) suivantes.delete(nom)
			else suivantes.add(nom)
			return suivantes
		})
	}, [])

	const enregistrer = useCallback(async () => {
		if (lecture.etat !== 'pret' || enCours) return
		setEnCours(true)
		setRefusEcriture(null)
		// L'ORDRE AFFICHÉ, celui des cases (§25.5) ; une liste vide part telle quelle, et c'est la base qui refuse.
		const ordre = casesDossiers(lecture.noms, compte.watch_folders).map((dossier) => dossier.nom)
		const resultat = await enregistrerDossiers(
			client,
			idWorkspace,
			compte,
			ordre.filter((nom) => coches.has(nom)),
		)
		setEnCours(false)
		if (resultat.issue !== 'enregistre') {
			setRefusEcriture(refus[resultat.issue])
			return
		}
		onEnregistre()
	}, [client, coches, compte, enCours, idWorkspace, lecture, onEnregistre, refus])

	const cases = lecture.etat === 'pret' ? casesDossiers(lecture.noms, compte.watch_folders) : []

	return (
		<fieldset
			data-testid="panneau-dossiers-releves"
			aria-labelledby={idLegende}
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape' && !enCours) {
					evenement.stopPropagation()
					onFermer()
				}
			}}
		>
			<legend id={idLegende} className="text-h3 font-bold text-ink px-1">
				{t('admin.mailAccounts.folders.legend', { boite: compte.label })}
			</legend>

			{lecture.etat === 'lecture' ? (
				<p role="status" data-testid="dossiers-lecture" className="text-sm text-text-2">
					{t('admin.mailAccounts.folders.reading')}
				</p>
			) : null}

			{lecture.etat === 'echec' ? (
				<div className="flex flex-col gap-2 items-start">
					<p role="status" data-testid="dossiers-echec" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
						{phraseIssue(lecture.issue)}
					</p>
					<Button taille="compacte" data-testid="dossiers-reessayer" onClick={() => setEssai((n) => n + 1)}>
						{t('admin.mailAccounts.folders.retry')}
					</Button>
				</div>
			) : null}

			{lecture.etat === 'pret' ? (
				<ul data-testid="dossiers-cases" className="flex flex-col">
					{cases.map((dossier, rang) => (
						<li key={dossier.nom} className={RETRAITS[dossier.niveau] ?? 'pl-12'}>
							<label className="flex items-center gap-3 min-h-[var(--size-target)] text-sm text-ink cursor-pointer">
								<input
									ref={rang === 0 ? premiere : undefined}
									type="checkbox"
									data-testid="case-dossier"
									data-dossier={dossier.nom}
									checked={coches.has(dossier.nom)}
									onChange={() => basculer(dossier.nom)}
									aria-label={dossier.absent ? t('admin.mailAccounts.folders.absent.aria', { dossier: dossier.nom }) : dossier.nom}
									className="size-6 shrink-0 accent-brand"
								/>
								<span className="break-all">{dossier.libelle}</span>
								{dossier.absent ? (
									<span data-testid="dossier-absent" className="text-sm text-text-3">
										{t('admin.mailAccounts.folders.absent')}
									</span>
								) : null}
							</label>
						</li>
					))}
				</ul>
			) : null}

			{refusEcriture !== null ? (
				<p role="alert" data-testid="refus-dossiers" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{t(refusEcriture)}
				</p>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					variante="primaire"
					data-testid="enregistrer-dossiers"
					disabled={lecture.etat !== 'pret' || enCours}
					aria-busy={enCours ? 'true' : undefined}
					onClick={() => void enregistrer()}
				>
					{enCours ? t('admin.mailAccounts.saving') : t('admin.mailAccounts.save')}
				</Button>
				<Button data-testid="annuler-dossiers" disabled={enCours} onClick={onFermer}>
					{t('admin.mailAccounts.cancel')}
				</Button>
			</div>
		</fieldset>
	)
}
