// @spec CRM-101 (docs/BACKLOG.md) — tranche T3 : la liste des espaces et leur création
// @spec docs/SPEC-plateforme.md §6.2 (fonctions), §7.2 (onglet « Espaces ») ; docs/DESIGN_SYSTEM.md §5.56 (tableau,
//       « Nouvel espace », formulaire dans le flux, succès qui ouvre la fiche), §5.9, §5.13, §5.50, §5.8
//
// Aucune garde de saisie ne double la base : l'identifiant court n'est vérifié qu'en base, et son refus est traduit
// (§5.3 ter). « Créer » n'est éteint que par un champ requis blanc, jamais par un droit (§5.50).

import { Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import { enChargement, type EtatAsync } from '../lib/async'
import { creerEspace, lireEspaces, type EspacePlateforme, type RefusPlateforme } from '../lib/plateforme'
import type { ClientCrm } from '../lib/supabase'
import { cheminFicheEspace } from './chemins'
import { texteRefus } from './presentation-plateforme'

const CLASSES_ENTETE = 'bg-bg text-sm text-text-2 font-medium h-[var(--size-target)] px-3 text-left'
const CLASSES_CELLULE = 'h-[var(--size-target)] px-3 truncate max-w-[32ch]'
const CLASSES_NOMBRE = 'h-[var(--size-target)] px-3 text-right tabular-nums'
const CLASSES_CHAMP =
	'min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand'

/** L'état que la fiche transmet en quittant un espace supprimé, pour le dire ici (§5.56). */
export type EtatNavigationEspaces = { readonly espaceSupprime?: string }

export function PlateformeEspaces({ client }: { readonly client: ClientCrm }) {
	const [etat, setEtat] = useState<EtatAsync<readonly EspacePlateforme[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [formulaireOuvert, setFormulaireOuvert] = useState(false)
	const commande = useRef<HTMLButtonElement>(null)
	const rendreFocus = useRef(false)
	const location = useLocation()
	const supprime = (location.state as EtatNavigationEspaces | null)?.espaceSupprime

	useEffect(() => {
		let vivant = true
		setEtat((precedent) => (precedent.statut === 'pret' ? precedent : enChargement()))
		void lireEspaces(client).then((resultat) => {
			if (vivant) setEtat(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, tentative])

	// Le retour du focus est différé d'un tour de rendu : la commande est démontée pendant que le formulaire est
	// ouvert, et sa référence vaut `null` au moment de la fermeture (§5.25). Aucune temporisation.
	useEffect(() => {
		if (!formulaireOuvert && rendreFocus.current) {
			rendreFocus.current = false
			commande.current?.focus()
		}
	}, [formulaireOuvert])

	const fermer = useCallback(() => {
		rendreFocus.current = true
		setFormulaireOuvert(false)
	}, [])

	if (etat.statut === 'chargement') return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('platform.espaces.erreur.title')}
				corps={t('platform.espaces.erreur.body')}
				libelleReprise={t('state.error.retry')}
				onReprise={() => setTentative((n) => n + 1)}
			/>
		)
	}

	const commandeCreation = formulaireOuvert ? null : (
		<Button ref={commande} variante="primaire" onClick={() => setFormulaireOuvert(true)} data-testid="nouvel-espace">
			<Plus aria-hidden="true" size={18} />
			{t('platform.espaces.nouveau')}
		</Button>
	)

	return (
		<section aria-labelledby="titre-espaces" className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id="titre-espaces" className="text-h2">
					{t('platform.espaces.titre')}
				</h2>
				{etat.donnees.length > 0 && commandeCreation}
			</div>
			{supprime !== undefined && (
				<p role="status" data-testid="espace-supprime" className="rounded-sm bg-success-soft text-success-on-soft px-3 py-2 text-sm">
					{t('platform.espaces.supprime', { nom: supprime })}
				</p>
			)}
			{formulaireOuvert && <FormulaireCreation client={client} onFermer={fermer} />}
			{etat.donnees.length === 0 ? (
				<EtatVide titre={t('platform.espaces.vide.title')} corps={t('platform.espaces.vide.body')} action={commandeCreation ?? undefined} />
			) : (
				<div className="overflow-x-auto indique-debordement-x">
					<table data-testid="tableau-espaces" className="w-full border-collapse">
						<caption className="sr-only">{t('platform.espaces.titre')}</caption>
						<thead>
							<tr className="border-b border-border">
								<th scope="col" className={CLASSES_ENTETE}>
									{t('platform.espaces.colonne.nom')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('platform.espaces.colonne.slug')}
								</th>
								<th scope="col" className={CLASSES_ENTETE}>
									{t('platform.espaces.colonne.domaine')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('platform.espaces.colonne.membres')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('platform.espaces.colonne.administrateurs')}
								</th>
								<th scope="col" className={`${CLASSES_ENTETE} text-right`}>
									{t('platform.espaces.colonne.attentes')}
								</th>
							</tr>
						</thead>
						<tbody>
							{etat.donnees.map((espace) => (
								<tr key={espace.id} data-testid="ligne-espace" data-slug={espace.slug} className="border-b border-border hover:bg-hover">
									<td className={CLASSES_CELLULE} title={espace.nom}>
										<Link to={cheminFicheEspace(espace.slug)} className="text-brand font-medium hover:underline">
											{espace.nom}
										</Link>
									</td>
									<td className={CLASSES_CELLULE}>
										<code>{espace.slug}</code>
									</td>
									<td className={CLASSES_CELLULE}>{espace.domaineEntrant === null ? null : <code>{espace.domaineEntrant}</code>}</td>
									<td className={CLASSES_NOMBRE}>{espace.membres}</td>
									<td className={`${CLASSES_NOMBRE} whitespace-nowrap`}>
										<span className="inline-flex items-center gap-2">
											{espace.administrateurs === 0 && <Badge ton="accent">{t('platform.espaces.sansAdministrateur')}</Badge>}
											<span>{espace.administrateurs}</span>
										</span>
									</td>
									<td className={CLASSES_NOMBRE}>{espace.attentes}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	)
}

function FormulaireCreation({ client, onFermer }: { readonly client: ClientCrm; readonly onFermer: () => void }) {
	const [nom, setNom] = useState('')
	const [slug, setSlug] = useState('')
	const [domaine, setDomaine] = useState('')
	const [envoi, setEnvoi] = useState(false)
	const [refus, setRefus] = useState<RefusPlateforme | null>(null)
	const premierChamp = useRef<HTMLInputElement>(null)
	const navigate = useNavigate()

	useEffect(() => {
		premierChamp.current?.focus()
	}, [])

	const soumettre = async (evenement: FormEvent) => {
		evenement.preventDefault()
		setEnvoi(true)
		setRefus(null)
		const issue = await creerEspace(client, nom, slug.trim(), domaine)
		setEnvoi(false)
		if (issue.statut === 'refus') {
			setRefus(issue.refus)
			return
		}
		// Un succès ouvre la fiche du nouvel espace, qui porte la suite : son premier administrateur (§5.56).
		void navigate(cheminFicheEspace(slug.trim()))
	}

	const requisManquant = nom.trim() === '' || slug.trim() === ''

	return (
		<form
			onSubmit={(evenement) => void soumettre(evenement)}
			onKeyDown={(evenement) => {
				if (evenement.key === 'Escape') onFermer()
			}}
			aria-labelledby="titre-creation-espace"
			data-testid="formulaire-espace"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<h3 id="titre-creation-espace" className="text-h3">
				{t('platform.espaces.creation.titre')}
			</h3>
			<div className="flex flex-col gap-1">
				<label htmlFor="espace-nom" className="text-sm text-text-2">
					{t('platform.espaces.champ.nom')}
				</label>
				<input ref={premierChamp} id="espace-nom" value={nom} onChange={(e) => setNom(e.target.value)} className={CLASSES_CHAMP} />
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor="espace-slug" className="text-sm text-text-2">
					{t('platform.espaces.champ.slug')}
				</label>
				<input
					id="espace-slug"
					value={slug}
					onChange={(e) => setSlug(e.target.value)}
					aria-describedby="aide-espace-slug"
					className={`${CLASSES_CHAMP} font-mono`}
				/>
				<p id="aide-espace-slug" className="text-sm text-text-3">
					{t('platform.espaces.champ.slug.aide')}
				</p>
			</div>
			<div className="flex flex-col gap-1">
				<label htmlFor="espace-domaine" className="text-sm text-text-2">
					{t('platform.espaces.champ.domaine')}
				</label>
				<input
					id="espace-domaine"
					value={domaine}
					onChange={(e) => setDomaine(e.target.value)}
					aria-describedby="aide-espace-domaine"
					className={`${CLASSES_CHAMP} font-mono`}
				/>
				<p id="aide-espace-domaine" className="text-sm text-text-3">
					{t('platform.espaces.champ.domaine.aide')}
				</p>
			</div>
			{refus !== null && (
				<p role="alert" data-testid="refus-espace" className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm">
					{texteRefus(refus)}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={envoi || requisManquant}>
					{envoi ? t('platform.envoi') : t('platform.espaces.creer')}
				</Button>
				<Button onClick={onFermer}>{t('platform.annuler')}</Button>
			</div>
		</form>
	)
}
