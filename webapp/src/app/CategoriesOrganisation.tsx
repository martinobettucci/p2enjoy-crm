// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — le lien vers les réglages mène dans l'espace courant (§15.3) ; docs/SPEC-espace-courant.md
// @spec CRM-153 (docs/BACKLOG.md) — tranche T3 : la ligne « Catégories » de la fiche d'une organisation, ses pilules, et la
//       commande « Catégories » qui ouvre dans le flux le panneau de cases — une case par catégorie active, puis les
//       archivées encore posées, qui se décochent seulement ; chaque case écrit au clic, reste active pendant l'appel,
//       revient si la base refuse
// @spec docs/SPEC-organisations.md §9.1 (pose et retrait par qui peut modifier l'organisation ; une archivée ne se pose
//       plus), §9.3 (la fiche) ; docs/DESIGN_SYSTEM.md §5.107 (la pilule de catégorie, la ligne, la commande `Tags`, le
//       panneau du §5.73), §5.73, §5.59 (la capacité d'éditer l'espace), §5.13 (focus et `Échap`), §5.7 bis (case de 24 px)
// @spec CLAUDE.md §10 — le panneau ne décide aucun droit : la capacité d'éditer, rendue par la base, éteint les cases ; le
//       déclencheur et la RLS de `organization_category_links` restent seuls juges, et leur refus est traduit

import { Tags, TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
// `CRM-161` T2.a (docs/SPEC-espace-courant.md §15.3) : les liens et la navigation de cet écran d'un espace mènent dans
// l'espace courant.
import { LienEspace as Link } from './LienEspace'
import { Button } from '../components/ui/Button'
import { MotifLectureSeule } from '../components/ui/MotifLectureSeule'
import { PastilleEtiquette } from '../components/ui/PastilleEtiquette'
import { t, type CleTraduction } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { motifVisible, proprietesCommande, type Capacite } from '../lib/capacites'
import { lireCategoriesOrganisations, type CategorieOrganisation } from '../lib/categories-organisations'
import { lireCategoriesDeLOrganisation, poserCategorie, type NatureRefusPose } from '../lib/commentaires-organisation'
import type { ClientCrm } from '../lib/supabase'
import { CHEMIN_ADMIN_CATEGORIES_ORGANISATIONS } from './chemins'

const CLES_REFUS: Readonly<Record<NatureRefusPose, CleTraduction>> = {
	archivee: 'organization.categories.refus.archivee',
	'deja-posee': 'organization.categories.refus.panne',
	forbidden: 'organization.categories.refus.forbidden',
	'sans-effet': 'organization.categories.refus.forbidden',
	network: 'organization.categories.refus.panne',
	unknown: 'organization.categories.refus.panne',
}

const compare = (a: CategorieOrganisation, b: CategorieOrganisation): number =>
	Number(a.archivee) - Number(b.archivee) || a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })

/** Le nom accessible d'une pilule : celui d'une archivée le dit (§5.107). */
export const nomAccessibleCategorie = (categorie: CategorieOrganisation): string | undefined =>
	categorie.archivee ? t('orgCategories.pill.archived', { nom: categorie.nom }) : undefined

/**
 * La ligne « Catégories » de la liste de définitions, après « Tracks » (§5.107) : les pilules, ou « Aucune catégorie » ;
 * sous elles, la commande et son panneau. Elle lit elle-même ; son échec s'écrit dans la ligne seule.
 */
export function LigneCategories({
	client,
	idOrganisation,
	idWorkspace,
	edition,
	idMotif,
}: {
	readonly client: ClientCrm
	readonly idOrganisation: string
	readonly idWorkspace: string | null
	/** La capacité d'éditer l'espace (§5.59) : poser et retirer une catégorie sont des écritures de l'organisation. */
	readonly edition: Capacite
	/** Le motif de la fiche, cité par les commandes refusées. */
	readonly idMotif: string
}) {
	const [posees, setPosees] = useState<EtatAsync<readonly CategorieOrganisation[]>>(enChargement)
	const [ouvert, setOuvert] = useState(false)
	const [focusARendre, setFocusARendre] = useState(false)
	const commande = useRef<HTMLButtonElement | null>(null)
	const idPanneau = useId()

	useEffect(() => {
		let actuel = true
		setPosees(enChargement())
		void lireCategoriesDeLOrganisation(client, idOrganisation).then((lu) => {
			if (actuel) setPosees(lu)
		})
		return () => {
			actuel = false
		}
	}, [client, idOrganisation])

	// La commande reste montée pendant que le panneau est ouvert (§5.43) : le focus lui revient sans différé.
	useEffect(() => {
		if (ouvert || !focusARendre) return
		commande.current?.focus()
		setFocusARendre(false)
	}, [ouvert, focusARendre])

	return (
		<div className="flex flex-col gap-1 md:col-span-2" data-testid="categories-organisation">
			<dt className="text-sm text-text-2">{t('organization.field.categories')}</dt>
			<dd className="flex flex-col gap-2">
				<div className="min-h-[var(--size-target)] flex flex-wrap items-center gap-2" data-testid="pilules-categories-organisation">
					{posees.statut === 'chargement' ? (
						''
					) : posees.statut === 'erreur' ? (
						<span role="alert" className="text-sm text-danger">
							{t('organization.categories.error')}
						</span>
					) : posees.donnees.length === 0 ? (
						<span className="text-sm text-text-2">{t('organization.categories.none')}</span>
					) : (
						posees.donnees.map((categorie) => {
							const nom = nomAccessibleCategorie(categorie)
							return <PastilleEtiquette key={categorie.id} etiquette={categorie} {...(nom === undefined ? {} : { nomAccessible: nom })} />
						})
					)}
				</div>
				<div>
					<Button
						{...proprietesCommande(edition, idMotif)}
						ref={commande}
						taille="compacte"
						variante="secondaire"
						aria-expanded={ouvert}
						{...(ouvert ? { 'aria-controls': idPanneau } : {})}
						data-testid="commande-categories-organisation"
						onClick={() => setOuvert((precedent) => !precedent)}
					>
						<Tags aria-hidden="true" size={16} strokeWidth={2} />
						{t('organization.categories.open')}
					</Button>
				</div>
				{ouvert && posees.statut === 'pret' ? (
					<PanneauCategories
						id={idPanneau}
						client={client}
						idOrganisation={idOrganisation}
						idWorkspace={idWorkspace}
						edition={edition}
						posees={posees.donnees}
						onChange={(suivantes) => setPosees({ statut: 'pret', donnees: suivantes })}
						onFermer={() => {
							setOuvert(false)
							setFocusARendre(true)
						}}
					/>
				) : null}
			</dd>
		</div>
	)
}

/**
 * Le panneau de cases du §5.73, dans le flux sous la commande. Une case par catégorie active du catalogue, puis les
 * archivées encore posées, qui se décochent seulement. Refusée par la capacité d'éditer, chaque case est éteinte et cite
 * le motif de la fiche, posé en tête du panneau aussi (§5.107).
 */
function PanneauCategories({
	id,
	client,
	idOrganisation,
	idWorkspace,
	edition,
	posees,
	onChange,
	onFermer,
}: {
	readonly id: string
	readonly client: ClientCrm
	readonly idOrganisation: string
	readonly idWorkspace: string | null
	readonly edition: Capacite
	readonly posees: readonly CategorieOrganisation[]
	readonly onChange: (posees: readonly CategorieOrganisation[]) => void
	readonly onFermer: () => void
}) {
	const idLegende = useId()
	const [catalogue, setCatalogue] = useState<EtatAsync<readonly CategorieOrganisation[]>>(enChargement)
	const [enVol, setEnVol] = useState<string | null>(null)
	const [refus, setRefus] = useState<{ readonly id: string; readonly nature: NatureRefusPose } | null>(null)
	const premiere = useRef<HTMLInputElement | null>(null)
	const fermer = useRef<HTMLButtonElement | null>(null)
	// UNE ARCHIVÉE DÉCOCHÉE QUITTE LE PANNEAU, et sa case avec le focus : il revient à la première case, à défaut à
	// « Fermer » — laissé sur le document, `Échap` ne refermait plus le panneau (trouvé par la preuve E2E au clavier).
	const [focusPerdu, setFocusPerdu] = useState(false)
	useEffect(() => {
		if (!focusPerdu) return
		;(premiere.current ?? fermer.current)?.focus()
		setFocusPerdu(false)
	}, [focusPerdu])
	// Le motif de l'édition est posé EN TÊTE DU PANNEAU, et chaque case le cite (§5.107) ; la commande, elle, cite celui
	// de la fiche.
	const idMotifPanneau = `${idLegende}-motif`
	const droit = proprietesCommande(edition, idMotifPanneau)

	useEffect(() => {
		if (idWorkspace === null) {
			setCatalogue({ statut: 'pret', donnees: [] })
			return
		}
		let actif = true
		void lireCategoriesOrganisations(client, idWorkspace).then((lu) => {
			if (actif) setCatalogue(lu)
		})
		return () => {
			actif = false
		}
	}, [client, idWorkspace])

	// Le focus entre dans la première case, une fois le catalogue lu ; sans case, à « Fermer » (§5.13, §5.73).
	useEffect(() => {
		if (catalogue.statut === 'chargement') return
		;(premiere.current ?? fermer.current)?.focus()
	}, [catalogue.statut])

	const idsPosees = new Set(posees.map((c) => c.id))
	const proposees =
		catalogue.statut === 'pret'
			? [
					...catalogue.donnees.filter((c) => !c.archivee),
					...posees.filter((c) => c.archivee && !catalogue.donnees.some((d) => d.id === c.id && !d.archivee)),
				]
			: []

	const basculer = async (categorie: CategorieOrganisation, pose: boolean) => {
		// Une écriture à la fois : la case n'est jamais désactivée pendant l'envoi (elle perdrait le focus, §5.103), un clic
		// pendant le vol est ignoré, et la case contrôlée garde l'état que la base a retenu.
		if (enVol !== null) return
		setRefus(null)
		setEnVol(categorie.id)
		const issue = await poserCategorie(client, idOrganisation, categorie.id, pose)
		setEnVol(null)
		if (issue.statut === 'refus') {
			setRefus({ id: categorie.id, nature: issue.nature })
			return
		}
		onChange((pose ? [...posees, categorie] : posees.filter((c) => c.id !== categorie.id)).slice().sort(compare))
		if (!pose && categorie.archivee) setFocusPerdu(true)
	}

	return (
		<fieldset
			id={id}
			data-testid="panneau-categories-organisation"
			aria-labelledby={idLegende}
			className="flex flex-col gap-2 rounded-lg border border-border p-3 max-w-[60ch]"
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.preventDefault()
				evenement.stopPropagation()
				onFermer()
			}}
		>
			<legend id={idLegende} className="text-sm text-text-2">
				{t('organization.categories.legend')}
			</legend>
			{motifVisible(edition) ? (
				<MotifLectureSeule id={idMotifPanneau}>{t('rights.readonly.edition')}</MotifLectureSeule>
			) : null}
			{catalogue.statut === 'chargement' ? (
				<p className="text-sm text-text-3">{t('organization.categories.loading')}</p>
			) : catalogue.statut === 'erreur' ? (
				<p role="alert" className="text-sm text-text-2">
					{t('organization.categories.catalogError')}
				</p>
			) : proposees.length === 0 ? (
				// Un catalogue vide nomme l'écran qui le comble (§5.51) ; le lien est rendu à tous, l'écran se lit par tout membre.
				<p className="flex flex-wrap items-center gap-2 text-sm text-text-2" data-testid="categories-catalogue-vide">
					{t('organization.categories.empty')}
					<Link to={CHEMIN_ADMIN_CATEGORIES_ORGANISATIONS} className="text-brand underline">
						{t('organization.categories.empty.link')}
					</Link>
				</p>
			) : (
				<ul className="flex flex-col gap-1">
					{proposees.map((categorie, rang) => {
						const cochee = idsPosees.has(categorie.id)
						const idCase = `${idLegende}-${categorie.id}`
						const idRefus = `${idCase}-refus`
						const refusee = refus?.id === categorie.id
						const nom = nomAccessibleCategorie(categorie)
						return (
							<li key={categorie.id} className="flex flex-col gap-1">
								<label htmlFor={idCase} className="flex min-h-[var(--size-target)] items-center gap-3">
									<input
										id={idCase}
										ref={rang === 0 ? premiere : undefined}
										type="checkbox"
										data-testid="case-categorie-organisation"
										checked={cochee}
										aria-busy={enVol === categorie.id}
										// Une archivée encore posée se décoche seulement : elle ne se pose plus (§9.1).
										disabled={droit.disabled === true || (categorie.archivee && !cochee)}
										{...(refusee
											? { 'aria-describedby': idRefus }
											: droit['aria-describedby'] === undefined
												? {}
												: { 'aria-describedby': droit['aria-describedby'] })}
										onChange={(evenement) => void basculer(categorie, evenement.currentTarget.checked)}
										className="size-6 shrink-0 accent-[var(--color-brand)]"
									/>
									<PastilleEtiquette etiquette={categorie} {...(nom === undefined ? {} : { nomAccessible: nom })} />
								</label>
								{refusee ? (
									<p id={idRefus} role="alert" className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm text-danger-on-soft">
										<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="mt-1 shrink-0" />
										{t(CLES_REFUS[refus.nature])}
									</p>
								) : null}
							</li>
						)
					})}
				</ul>
			)}
			<div>
				<Button ref={fermer} variante="secondaire" taille="compacte" data-testid="categories-organisation-fermer" onClick={onFermer}>
					{t('organization.categories.close')}
				</Button>
			</div>
		</fieldset>
	)
}
