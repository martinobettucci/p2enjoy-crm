// @spec CRM-071 (docs/BACKLOG.md) — tranche T5 : l'import CSV du carnet — la commande « Importer un fichier » et son panneau
//       en trois étapes (fichier, colonnes, vérification), puis le rapport
// @spec docs/DESIGN_SYSTEM.md §5.77 (`FileUp`, la capacité d'éditer l'espace et son motif, trois étapes titrées dans un panneau
//       du flux, comptes par clé, lignes écartées en tableau, rapport téléchargeable, gestes désactivés pendant le vol),
//       §5.59 ; docs/SPEC-vues-import-export.md §6.1, §6.2, §6.2 bis
// @spec CRM-071 (docs/BACKLOG.md) — tranche T6 : le même panneau pour les affaires d'un channel, et sa commande dans la vue
//       liste, qui suit la capacité d'écrire le channel (docs/DESIGN_SYSTEM.md §5.78 ; docs/SPEC-vues-import-export.md
//       §6.3, §6.3 bis)
//
// Le fichier est lu dans le navigateur ; la base juge chaque ligne, deux fois : en simulation, puis confirmée. L'écran ne
// décide ni d'un doublon ni d'un droit : il compose les lignes et dit ce que la base a rendu.

import { FileSpreadsheet, FileUp, TriangleAlert } from 'lucide-react'
import { forwardRef, useEffect, useId, useRef, useState } from 'react'
import { Button } from '../components/ui/Button'
import { t, type CleTraduction } from '../i18n'
import { useRefus } from '../components/ui/RefusCommandes'
import { proprietesCommande } from '../lib/capacites'
import { dateDuJour, telecharger } from '../lib/export-csv'
import {
	CHAMPS_PAR_OBJET,
	LIGNES_MAX,
	POIDS_MAX,
	champNommant,
	compter,
	correspondanceInitiale,
	correspondanceUtile,
	decoderFichier,
	importerAffaires,
	importerContacts,
	lignesPourImport,
	lireCsv,
	motifDe,
	rapportCsv,
	type Champ,
	type Comptes,
	type IssueImport,
	type IssueLigne,
	type LigneImport,
	type NatureRefusImport,
	type ObjetImport,
} from '../lib/import-csv'
import type { ClientCrm } from '../lib/supabase'
import { useContexteEspace } from './ContexteEspace'

const CLASSES_CHAMP = 'min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base'
const CLASSES_ALERTE = 'flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm text-danger-on-soft'

const CLES_REFUS: Readonly<Record<NatureRefusImport, CleTraduction>> = {
	'trop-grand': 'import.refus.tropGrand',
	introuvable: 'import.refus.introuvable',
	ferme: 'import.refus.ferme',
	network: 'import.refus.panne',
	unknown: 'import.refus.panne',
}

/** Ce que l'import vise : l'espace du carnet (T5), ou le channel de la vue liste (T6). */
export type CibleImport =
	| { readonly objet: 'contacts'; readonly idWorkspace: string }
	| { readonly objet: 'affaires'; readonly idChannel: string }

type TextesObjet = {
	readonly aria: CleTraduction
	readonly aide: CleTraduction
	readonly nom: CleTraduction
	readonly introuvable: CleTraduction
}

/** Les textes qui diffèrent d'un objet à l'autre, chacun par une clé écrite en entier (§10). */
const TEXTES: Readonly<Record<ObjetImport, TextesObjet>> = {
	contacts: {
		aria: 'import.aria',
		aide: 'import.colonnes.aide',
		nom: 'import.ecartees.nom',
		introuvable: 'import.refus.introuvable',
	},
	affaires: {
		aria: 'import.aria.affaires',
		aide: 'import.colonnes.aide.affaires',
		nom: 'import.ecartees.titre',
		introuvable: 'import.refus.introuvable.channel',
	},
}

function appeler(client: ClientCrm, cible: CibleImport, lignes: readonly LigneImport[], simuler: boolean): Promise<IssueImport> {
	return cible.objet === 'contacts'
		? importerContacts(client, cible.idWorkspace, lignes, simuler)
		: importerAffaires(client, cible.idChannel, lignes, simuler)
}

/** Le libellé de chaque champ, par une clé écrite en entier (§10 : aucune clé construite). */
const CLES_CHAMP: Readonly<Record<Champ, CleTraduction>> = {
	ignorer: 'import.champ.ignorer',
	full_name: 'import.champ.full_name',
	email: 'import.champ.email',
	phone: 'import.champ.phone',
	role_title: 'import.champ.role_title',
	organization_name: 'import.champ.organization_name',
	organization_domain: 'import.champ.organization_domain',
	organization_website: 'import.champ.organization_website',
	title: 'import.champ.title',
	step: 'import.champ.step',
	owner: 'import.champ.owner',
	amount: 'import.champ.amount',
	currency: 'import.champ.currency',
	probability: 'import.champ.probability',
	next_action: 'import.champ.next_action',
	next_action_at: 'import.champ.next_action_at',
	contact_email: 'import.champ.contact_email',
}

/** L'accord par clé (§10) : zéro, un, plusieurs. */
function accord(n: number, zero: CleTraduction, un: CleTraduction, plusieurs: CleTraduction): string {
	return n === 0 ? t(zero) : n === 1 ? t(un) : t(plusieurs, { n: String(n) })
}

function phraseVerification(c: Comptes): string {
	return t('import.comptes.phrase', {
		crees: accord(c.crees, 'import.comptes.crees.0', 'import.comptes.crees.1', 'import.comptes.crees.n'),
		ignores: accord(c.ignores, 'import.comptes.ignores.0', 'import.comptes.ignores.1', 'import.comptes.ignores.n'),
		refuses: accord(c.refuses, 'import.comptes.refuses.0', 'import.comptes.refuses.1', 'import.comptes.refuses.n'),
	})
}

function phraseRapport(c: Comptes, objet: ObjetImport): string {
	if (objet === 'affaires') {
		// Une affaire ne crée pas d'organisation : le rapport n'en parle pas (§5.78).
		return t('import.rapport.phrase.affaires', {
			crees: accord(c.crees, 'import.rapport.crees.0', 'import.rapport.crees.1', 'import.rapport.crees.n'),
			ignores: accord(c.ignores, 'import.comptes.ignores.0', 'import.comptes.ignores.1', 'import.comptes.ignores.n'),
			refuses: accord(c.refuses, 'import.comptes.refuses.0', 'import.comptes.refuses.1', 'import.comptes.refuses.n'),
		})
	}
	return t('import.rapport.phrase', {
		crees: accord(c.crees, 'import.rapport.crees.0', 'import.rapport.crees.1', 'import.rapport.crees.n'),
		organisations: accord(c.organisations, 'import.rapport.organisations.0', 'import.rapport.organisations.1', 'import.rapport.organisations.n'),
		ignores: accord(c.ignores, 'import.comptes.ignores.0', 'import.comptes.ignores.1', 'import.comptes.ignores.n'),
		refuses: accord(c.refuses, 'import.comptes.refuses.0', 'import.comptes.refuses.1', 'import.comptes.refuses.n'),
	})
}

/** « Importer un fichier » — elle suit la capacité d'éditer l'espace, et cite le motif du carnet (§5.77, §5.59). */
export const CommandeImport = forwardRef<HTMLButtonElement, { readonly idMotif: string; readonly onOuvrir: () => void }>(
	function CommandeImport({ idMotif, onOuvrir }, ref) {
		const { capacites } = useContexteEspace()
		return (
			<Button
				{...proprietesCommande(capacites.edition, idMotif)}
				ref={ref}
				variante="discret"
				taille="compacte"
				data-testid="importer-contacts"
				aria-expanded={false}
				onClick={onOuvrir}
				className="self-start"
			>
				<FileUp aria-hidden="true" size={16} strokeWidth={2} />
				{t('import.commande')}
			</Button>
		)
	},
)

/**
 * « Importer un fichier » de la vue liste — elle suit la capacité d'écrire le channel, comme « Nouvelle affaire », et cite
 * le motif de la vue par le contexte de refus (§5.78, §5.59).
 */
export const CommandeImportAffaires = forwardRef<HTMLButtonElement, { readonly onOuvrir: () => void }>(
	function CommandeImportAffaires({ onOuvrir }, ref) {
		const droit = useRefus()
		return (
			<Button
				{...droit}
				ref={ref}
				variante="discret"
				taille="compacte"
				data-testid="importer-affaires"
				aria-expanded={false}
				onClick={onOuvrir}
			>
				<FileUp aria-hidden="true" size={16} strokeWidth={2} />
				{t('import.commande')}
			</Button>
		)
	},
)

type Fichier = { readonly nom: string; readonly enTetes: readonly string[]; readonly donnees: readonly (readonly string[])[] }

export function PanneauImport({
	client,
	cible,
	onFermer,
}: {
	readonly client: ClientCrm
	readonly cible: CibleImport
	/** `relire` : un import a écrit des lignes, le carnet ou la liste doit être relu. */
	readonly onFermer: (relire: boolean) => void
}) {
	const objet = cible.objet
	const textes = TEXTES[objet]
	const idFichier = useId()
	const idAideFichier = useId()
	const idErreurFichier = useId()
	const [fichier, setFichier] = useState<Fichier | null>(null)
	const [lecture, setLecture] = useState(false)
	const [erreurFichier, setErreurFichier] = useState<CleTraduction | null>(null)
	const [correspondance, setCorrespondance] = useState<Champ[]>([])
	const [simulation, setSimulation] = useState<readonly IssueLigne[] | null>(null)
	const [resultat, setResultat] = useState<readonly IssueLigne[] | null>(null)
	const [enVol, setEnVol] = useState<null | 'verification' | 'import'>(null)
	const [refus, setRefus] = useState<NatureRefusImport | null>(null)
	const champFichier = useRef<HTMLInputElement | null>(null)
	const premierChamp = useRef<HTMLSelectElement | null>(null)
	const confirmer = useRef<HTMLButtonElement | null>(null)
	const terminer = useRef<HTMLButtonElement | null>(null)

	useEffect(() => {
		champFichier.current?.focus()
	}, [])

	const fermer = () => {
		if (enVol !== null) return
		onFermer(resultat !== null)
	}

	const lire = async (choisi: File | undefined) => {
		setErreurFichier(null)
		setFichier(null)
		setSimulation(null)
		setRefus(null)
		if (choisi === undefined) return
		if (choisi.size > POIDS_MAX) {
			setErreurFichier('import.fichier.lourd')
			return
		}
		setLecture(true)
		try {
			const rangees = lireCsv(decoderFichier(await choisi.arrayBuffer()))
			const [enTetes, ...donnees] = rangees
			if (enTetes === undefined || donnees.length === 0) {
				setErreurFichier('import.fichier.vide')
			} else if (donnees.length > LIGNES_MAX) {
				setErreurFichier('import.fichier.long')
			} else {
				setFichier({ nom: choisi.name, enTetes, donnees })
				setCorrespondance(correspondanceInitiale(enTetes, objet))
			}
		} catch {
			setErreurFichier('import.fichier.illisible')
		} finally {
			setLecture(false)
		}
	}

	// LE FOCUS SUIT L'ÉTAPE : la première colonne à associer, puis la confirmation, puis « Terminer » (§5.77, §5.13).
	useEffect(() => {
		if (fichier !== null) premierChamp.current?.focus()
	}, [fichier])
	useEffect(() => {
		if (simulation !== null && resultat === null) confirmer.current?.focus()
	}, [simulation, resultat])
	useEffect(() => {
		if (resultat !== null) terminer.current?.focus()
	}, [resultat])

	const juger = async (simuler: boolean) => {
		if (fichier === null || enVol !== null) return
		setRefus(null)
		setEnVol(simuler ? 'verification' : 'import')
		const issue = await appeler(client, cible, lignesPourImport(fichier.donnees, correspondance), simuler)
		setEnVol(null)
		if (issue.statut === 'refus') {
			setRefus(issue.nature)
			return
		}
		if (simuler) setSimulation(issue.issues)
		else setResultat(issue.issues)
	}

	const choisirChamp = (index: number, champ: Champ) => {
		setSimulation(null)
		setCorrespondance((avant) => avant.map((c, i) => (i === index ? champ : c)))
	}

	const indexNom = correspondance.indexOf(champNommant(objet))
	const utile = correspondanceUtile(correspondance, objet)
	const comptesSimulation = simulation === null ? null : compter(simulation)
	const comptesResultat = resultat === null ? null : compter(resultat)
	const ecartees = (simulation ?? []).filter((i) => i.outcome !== 'created')

	return (
		<section
			data-testid="panneau-import"
			aria-label={t(textes.aria)}
			className="flex flex-col gap-4 bg-surface border border-border rounded-lg p-4"
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.preventDefault()
				evenement.stopPropagation()
				fermer()
			}}
		>
			<div className="flex flex-col gap-2">
				<h3 className="font-medium text-ink">{t('import.etape.fichier')}</h3>
				<label htmlFor={idFichier} className="text-sm text-text-2">
					{t('import.fichier')}
				</label>
				<input
					id={idFichier}
					ref={champFichier}
					data-testid="champ-fichier-import"
					type="file"
					accept=".csv,text/csv"
					disabled={enVol !== null || resultat !== null}
					aria-describedby={erreurFichier === null ? idAideFichier : `${idAideFichier} ${idErreurFichier}`}
					onChange={(evenement) => void lire(evenement.target.files?.[0])}
					className="text-sm"
				/>
				<p id={idAideFichier} className="text-sm text-text-2">
					{t(lecture ? 'import.fichier.lecture' : 'import.fichier.aide')}
				</p>
				{erreurFichier === null ? null : (
					<p id={idErreurFichier} role="alert" data-testid="import-erreur-fichier" className={CLASSES_ALERTE}>
						<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
						{t(erreurFichier)}
					</p>
				)}
				{fichier === null ? null : (
					<p className="text-sm text-text-2">{t('import.fichier.lu', { lignes: String(fichier.donnees.length), nom: fichier.nom })}</p>
				)}
			</div>

			{fichier === null ? null : (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-ink">{t('import.etape.colonnes')}</h3>
					<div className="overflow-x-auto indique-debordement-x">
						<table data-testid="tableau-colonnes-import" className="w-full border-collapse text-left">
							<caption className="sr-only">{t('import.colonnes.aria')}</caption>
							<thead>
								<tr className="border-b border-border">
									<th scope="col" className="px-3 h-[var(--size-target)] text-sm font-normal text-text-2">
										{t('import.colonnes.entete')}
									</th>
									<th scope="col" className="px-3 h-[var(--size-target)] text-sm font-normal text-text-2">
										{t('import.colonnes.exemple')}
									</th>
									<th scope="col" className="px-3 h-[var(--size-target)] text-sm font-normal text-text-2">
										{t('import.colonnes.champ')}
									</th>
								</tr>
							</thead>
							<tbody>
								{fichier.enTetes.map((enTete, index) => (
									<tr key={`${index}-${enTete}`} className="border-b border-border">
										<th scope="row" className="px-3 h-[var(--size-target)] text-left font-normal max-w-[24ch] truncate" title={enTete}>
											{enTete}
										</th>
										<td className="px-3 text-sm text-text-2 max-w-[32ch] truncate" title={fichier.donnees[0]?.[index] ?? ''}>
											{fichier.donnees[0]?.[index] ?? ''}
										</td>
										<td className="px-3 py-1">
											<select
												ref={index === 0 ? premierChamp : undefined}
												data-testid="champ-colonne-import"
												aria-label={t('import.colonnes.champ.aria', { colonne: enTete })}
												value={correspondance[index] ?? 'ignorer'}
												disabled={enVol !== null || resultat !== null}
												onChange={(evenement) => choisirChamp(index, evenement.target.value as Champ)}
												className={CLASSES_CHAMP}
											>
												{CHAMPS_PAR_OBJET[objet].map((champ) => (
													<option key={champ} value={champ}>
														{t(CLES_CHAMP[champ])}
													</option>
												))}
											</select>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{utile ? null : <p className="text-sm text-text-2">{t(textes.aide)}</p>}
					{resultat !== null ? null : (
						<Button
							variante="primaire"
							data-testid="import-verifier"
							className="self-start"
							disabled={!utile || enVol !== null}
							onClick={() => void juger(true)}
						>
							{t(enVol === 'verification' ? 'import.verification.enCours' : 'import.verifier')}
						</Button>
					)}
				</div>
			)}

			{refus === null ? null : (
				<p role="alert" data-testid="import-refus" className={CLASSES_ALERTE}>
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
					{t(refus === 'introuvable' ? textes.introuvable : CLES_REFUS[refus])}
				</p>
			)}

			{comptesSimulation === null || fichier === null || resultat !== null ? null : (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-ink">{t('import.etape.verification')}</h3>
					<p data-testid="import-comptes">{phraseVerification(comptesSimulation)}</p>
					{ecartees.length === 0 ? null : (
						<div className="overflow-x-auto indique-debordement-x">
							<table data-testid="tableau-ecartees-import" className="w-full border-collapse text-left">
								<caption className="sr-only">{t('import.ecartees.aria')}</caption>
								<thead>
									<tr className="border-b border-border">
										<th scope="col" className="px-3 h-[var(--size-target)] text-sm font-normal text-text-2 text-right">
											{t('import.ecartees.ligne')}
										</th>
										<th scope="col" className="px-3 h-[var(--size-target)] text-sm font-normal text-text-2">
											{t(textes.nom)}
										</th>
										<th scope="col" className="px-3 h-[var(--size-target)] text-sm font-normal text-text-2">
											{t('import.ecartees.motif')}
										</th>
									</tr>
								</thead>
								<tbody>
									{ecartees.map((issue) => {
										const motif = motifDe(issue.code, objet)
										return (
											<tr key={issue.line} data-testid="ligne-ecartee-import" className="border-b border-border">
												<td className="px-3 h-[var(--size-target)] text-right tabular-nums">
													<code>{issue.line}</code>
												</td>
												<td className="px-3 max-w-[32ch] truncate">
													{indexNom < 0 ? '' : (fichier.donnees[issue.line - 1]?.[indexNom] ?? '')}
												</td>
												<td className="px-3 text-sm">{motif === null ? '' : t(motif)}</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							ref={confirmer}
							variante="primaire"
							data-testid="import-confirmer"
							disabled={comptesSimulation.crees === 0 || enVol !== null}
							onClick={() => void juger(false)}
						>
							{enVol === 'import'
								? t('import.import.enCours')
								: accord(comptesSimulation.crees, 'import.confirmer.0', 'import.confirmer.1', 'import.confirmer.n')}
						</Button>
						<Button variante="secondaire" disabled={enVol !== null} onClick={fermer}>
							{t('import.annuler')}
						</Button>
					</div>
				</div>
			)}

			{comptesResultat === null || fichier === null || resultat === null ? null : (
				<div className="flex flex-col gap-2">
					<h3 className="font-medium text-ink">{t('import.rapport.titre')}</h3>
					<p role="status" data-testid="import-rapport">
						{phraseRapport(comptesResultat, objet)}
					</p>
					<div className="flex flex-wrap gap-2">
						{comptesResultat.ignores + comptesResultat.refuses === 0 ? null : (
							<Button
								variante="secondaire"
								data-testid="import-telecharger-rapport"
								onClick={() =>
									telecharger(`rapport-import-${dateDuJour()}.csv`, rapportCsv(fichier.enTetes, fichier.donnees, resultat, objet))
								}
							>
								<FileSpreadsheet aria-hidden="true" size={16} strokeWidth={2} />
								{t('import.rapport.telecharger')}
							</Button>
						)}
						<Button ref={terminer} variante="primaire" data-testid="import-terminer" onClick={() => onFermer(true)}>
							{t('import.rapport.terminer')}
						</Button>
					</div>
				</div>
			)}

			{simulation !== null || resultat !== null ? null : (
				<Button variante="secondaire" className="self-start" disabled={enVol !== null} onClick={fermer}>
					{t('import.annuler')}
				</Button>
			)}
		</section>
	)
}
