// @spec CRM-071 (docs/BACKLOG.md) — tranche T2 : les vues sauvegardées de la vue liste — le sélecteur « Vue », ses commandes
//       et le panneau d'enregistrement et de modification
// @spec docs/SPEC-vues-import-export.md §2.3 (qui écrit : la base tranche), §3 (la vue choisie portée par l'adresse, des
//       filtres qui s'en écartent dits, décision 777) ; docs/DESIGN_SYSTEM.md §5.75, §5.59 (la capacité d'administrer
//       l'espace, le motif porté par la commande), §5.50 (le panneau dans le flux), §5.22 (le `select` et sa dérogation)
//
// L'ÉTAT VIT DANS UN CROCHET, LE RENDU DANS DEUX COMPOSANTS : la vue liste reçoit le sélecteur dans sa barre et le panneau
// sous elle, comme « Nouvelle affaire » (`NouvelleAffaire.tsx`). Aucun droit n'est calculé ici : une vue privée rendue
// est celle de la personne (la base ne rend que les siennes), et une vue de l'espace suit la capacité d'administrer que
// la base rend sur la ligne de l'espace.

import { BookmarkCheck, BookmarkPlus, PencilLine, Trash2, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { Button } from '../components/ui/Button'
import { LiveRegion } from '../components/ui/LiveRegion'
import { t, type CleTraduction } from '../i18n'
import type { EtatAsync } from '../lib/async'
import { proprietesCommande } from '../lib/capacites'
import type { ParametresListe } from '../lib/liste-cards'
import type { ClientCrm } from '../lib/supabase'
import {
	enregistrerVue,
	filtresDepuisParametres,
	filtresEcartes,
	lireVues,
	mettreAJourVue,
	modifierVue,
	parametresDepuisVue,
	supprimerVue,
	type NatureRefusVue,
	type VueSauvegardee,
} from '../lib/vues-sauvegardees'
import { useContexteEspace } from './ContexteEspace'

const CLES_REFUS: Readonly<Record<NatureRefusVue, CleTraduction>> = {
	'nom-pris': 'vues.refus.nomPris',
	forme: 'vues.refus.forme',
	depublication: 'vues.refus.depublication',
	forbidden: 'vues.refus.forbidden',
	'sans-effet': 'vues.refus.sansEffet',
	network: 'vues.refus.panne',
	unknown: 'vues.refus.panne',
}

const CLASSES_CHAMP = 'min-h-[var(--size-target)] px-3 rounded-sm border border-border bg-surface text-base'

type Panneau = null | 'enregistrer' | 'modifier'

export type VuesDuChannel = {
	/** Nul sans configuration du déploiement : rien n'est lu, et rien n'est rendu. */
	readonly client: ClientCrm | null
	readonly idChannel: string
	readonly etat: EtatAsync<readonly VueSauvegardee[]>
	readonly relire: () => void
	readonly panneau: Panneau
	readonly ouvrir: (panneau: Exclude<Panneau, null>) => void
	readonly fermer: () => void
	readonly annonce: string
	readonly annoncer: (texte: string) => void
	readonly refus: NatureRefusVue | null
	readonly setRefus: (refus: NatureRefusVue | null) => void
	readonly refEnregistrer: RefObject<HTMLButtonElement | null>
	readonly refModifier: RefObject<HTMLButtonElement | null>
	readonly refSelecteur: RefObject<HTMLSelectElement | null>
	readonly rendreFocus: (cible: 'enregistrer' | 'modifier' | 'selecteur') => void
}

/** L'état des vues d'un channel : leur lecture, le panneau ouvert, l'annonce, le refus d'une commande et le focus à rendre. */
export function useVuesSauvegardees(client: ClientCrm | null, idChannel: string): VuesDuChannel {
	const [etat, setEtat] = useState<EtatAsync<readonly VueSauvegardee[]>>({ statut: 'chargement' })
	const [tentative, setTentative] = useState(0)
	const [panneau, setPanneau] = useState<Panneau>(null)
	const [annonce, setAnnonce] = useState('')
	const [refus, setRefus] = useState<NatureRefusVue | null>(null)
	const [focusARendre, setFocusARendre] = useState<'enregistrer' | 'modifier' | 'selecteur' | null>(null)
	const refEnregistrer = useRef<HTMLButtonElement | null>(null)
	const refModifier = useRef<HTMLButtonElement | null>(null)
	const refSelecteur = useRef<HTMLSelectElement | null>(null)
	const premiereLecture = useRef(true)

	useEffect(() => {
		if (client === null) return
		let actif = true
		// UN RECHARGEMENT N'EFFACE PAS LA LISTE QU'IL RELIT (§5.29 tranche 2 c) : seul le premier passe par le chargement.
		if (premiereLecture.current) setEtat({ statut: 'chargement' })
		void lireVues(client, idChannel).then((lu) => {
			if (!actif) return
			premiereLecture.current = false
			setEtat(lu)
		})
		return () => {
			actif = false
		}
	}, [client, idChannel, tentative])

	// LE FOCUS EST RENDU UN RENDU PLUS TARD (§5.25) : la commande visée est démontée pendant le panneau, ou vient de paraître.
	useEffect(() => {
		if (focusARendre === null) return
		setFocusARendre(null)
		const cible =
			focusARendre === 'enregistrer'
				? refEnregistrer.current
				: focusARendre === 'modifier'
					? (refModifier.current ?? refSelecteur.current ?? refEnregistrer.current)
					: (refSelecteur.current ?? refEnregistrer.current)
		cible?.focus()
	}, [focusARendre])

	const relire = useCallback(() => setTentative((n) => n + 1), [])
	const ouvrir = useCallback((quoi: Exclude<Panneau, null>) => {
		setRefus(null)
		setAnnonce('')
		setPanneau(quoi)
	}, [])
	const fermer = useCallback(() => {
		const origine = panneau
		setPanneau(null)
		setFocusARendre(origine === 'modifier' ? 'modifier' : 'enregistrer')
	}, [panneau])

	return {
		client,
		idChannel,
		etat,
		relire,
		panneau,
		ouvrir,
		fermer,
		annonce,
		annoncer: setAnnonce,
		refus,
		setRefus,
		refEnregistrer,
		refModifier,
		refSelecteur,
		rendreFocus: setFocusARendre,
	}
}

/** La vue choisie, si l'adresse en porte une que la liste contient ; sinon aucune — l'écran ne nomme pas ce qu'il ne montre pas. */
export function vueChoisie(vues: readonly VueSauvegardee[], parametres: ParametresListe): VueSauvegardee | undefined {
	return parametres.vue === null || parametres.vue === undefined ? undefined : vues.find((v) => v.id === parametres.vue)
}

/**
 * Le sélecteur « Vue » et ses commandes, dans la barre de la vue liste (§5.75). Sans aucune vue, le sélecteur n'est pas
 * rendu (§5.36) ; « Enregistrer la vue » l'est toujours, sauf pendant que son panneau est ouvert (§5.50).
 */
export function CommandesVues({
	vues: etatVues,
	parametres,
	onParametres,
}: {
	readonly vues: VuesDuChannel
	readonly parametres: ParametresListe
	readonly onParametres: (parametres: ParametresListe) => void
}) {
	const { capacites } = useContexteEspace()
	const idSelecteur = useId()
	const idEcart = useId()
	const idMotif = useId()
	const { etat, panneau } = etatVues
	const vues = etat.statut === 'pret' ? etat.donnees : []
	const choisie = vueChoisie(vues, parametres)
	const ecart = choisie !== undefined && filtresEcartes(parametres, choisie)
	const miennes = vues.filter((v) => v.visibilite === 'privee')
	const espace = vues.filter((v) => v.visibilite === 'espace')
	// UNE VUE DE L'ESPACE SUIT LA CAPACITÉ D'ADMINISTRER (§5.59) ; une vue privée rendue est celle de la personne.
	const capacite = choisie?.visibilite === 'espace' ? capacites.administration : 'permise'
	const droit = proprietesCommande(capacite, idMotif)
	const refusee = capacite === 'refusee'
	const [enVol, setEnVol] = useState(false)

	const choisir = (id: string) => {
		etatVues.setRefus(null)
		const vue = vues.find((v) => v.id === id)
		// « Aucune vue » retire seulement la marque : les filtres courants restent (§5.75).
		onParametres(vue === undefined ? { ...parametres, vue: null } : parametresDepuisVue(vue))
	}

	const client = etatVues.client
	if (client === null) return null

	const mettreAJour = async () => {
		if (choisie === undefined || enVol) return
		etatVues.setRefus(null)
		setEnVol(true)
		const issue = await mettreAJourVue(client, choisie.id, filtresDepuisParametres(parametres))
		setEnVol(false)
		if (issue.statut === 'refus') {
			etatVues.setRefus(issue.nature)
			return
		}
		etatVues.annoncer(t('vues.annonce.miseAJour', { nom: choisie.nom }))
		etatVues.relire()
		// « Mettre à jour » disparaît avec l'écart : le focus va au sélecteur (§5.13).
		etatVues.rendreFocus('selecteur')
	}

	const supprimer = async () => {
		if (choisie === undefined || enVol) return
		etatVues.setRefus(null)
		setEnVol(true)
		const issue = await supprimerVue(client, choisie.id)
		setEnVol(false)
		if (issue.statut === 'refus') {
			etatVues.setRefus(issue.nature)
			return
		}
		etatVues.annoncer(t('vues.annonce.supprimee', { nom: choisie.nom }))
		onParametres({ ...parametres, vue: null })
		etatVues.relire()
		etatVues.rendreFocus('selecteur')
	}

	return (
		<div data-testid="commandes-vues" className="flex flex-col gap-1 min-w-0 w-full md:w-auto">
			<div className="flex flex-wrap items-end gap-2 min-w-0">
				{etat.statut === 'erreur' ? (
					<div className="flex flex-wrap items-center gap-2" data-testid="vues-erreur">
						<p className="text-sm text-text-2">{t('vues.erreur')}</p>
						<Button variante="discret" taille="compacte" onClick={etatVues.relire}>
							{t('vues.reessayer')}
						</Button>
					</div>
				) : etat.statut === 'chargement' || vues.length > 0 ? (
					<div className="flex flex-col gap-1 min-w-0 w-full md:w-auto">
						<label htmlFor={idSelecteur} className="text-sm text-text-2">
							{t('vues.selecteur')}
						</label>
						<select
							id={idSelecteur}
							ref={etatVues.refSelecteur}
							data-testid="selecteur-vue"
							// LA DÉROGATION BORNÉE DU §5.22 : pendant la lecture, il n'y a rien à choisir.
							disabled={etat.statut === 'chargement'}
							aria-busy={etat.statut === 'chargement'}
							value={choisie?.id ?? ''}
							{...(ecart ? { 'aria-describedby': idEcart } : {})}
							onChange={(evenement) => choisir(evenement.target.value)}
							className={`${CLASSES_CHAMP} w-full md:w-auto md:max-w-[32ch]`}
						>
							{etat.statut === 'chargement' ? (
								<option value="">{t('vues.chargement')}</option>
							) : (
								<>
									<option value="">{t('vues.aucune')}</option>
									{miennes.length === 0 ? null : (
										<optgroup label={t('vues.groupe.miennes')}>
											{miennes.map((v) => (
												<option key={v.id} value={v.id}>
													{v.nom}
												</option>
											))}
										</optgroup>
									)}
									{espace.length === 0 ? null : (
										<optgroup label={t('vues.groupe.espace')}>
											{espace.map((v) => (
												<option key={v.id} value={v.id}>
													{v.nom}
												</option>
											))}
										</optgroup>
									)}
								</>
							)}
						</select>
					</div>
				) : null}

				{panneau === 'enregistrer' ? null : (
					<Button
						ref={etatVues.refEnregistrer}
						variante="discret"
						taille="compacte"
						data-testid="vue-enregistrer"
						aria-expanded={false}
						onClick={() => etatVues.ouvrir('enregistrer')}
					>
						<BookmarkPlus aria-hidden="true" size={16} strokeWidth={2} />
						{t('vues.enregistrer')}
					</Button>
				)}

				{choisie === undefined ? null : (
					<>
						{!ecart ? null : (
							<Button
								{...proprietesCommande(capacite, idMotif, enVol)}
								variante="discret"
								taille="compacte"
								data-testid="vue-mettre-a-jour"
								aria-label={t('vues.mettreAJour.aria', { nom: choisie.nom })}
								{...(refusee ? { title: t('vues.motif.espace') } : {})}
								onClick={() => void mettreAJour()}
							>
								<BookmarkCheck aria-hidden="true" size={16} strokeWidth={2} />
								{t('vues.mettreAJour')}
							</Button>
						)}
						{panneau === 'modifier' ? null : (
							<Button
								{...droit}
								ref={etatVues.refModifier}
								variante="discret"
								taille="compacte"
								data-testid="vue-modifier"
								aria-expanded={false}
								aria-label={t('vues.modifier.aria', { nom: choisie.nom })}
								{...(refusee ? { title: t('vues.motif.espace') } : {})}
								onClick={() => etatVues.ouvrir('modifier')}
							>
								<PencilLine aria-hidden="true" size={16} strokeWidth={2} />
								{t('vues.modifier')}
							</Button>
						)}
						<Button
							{...proprietesCommande(capacite, idMotif, enVol)}
							variante="discret"
							taille="compacte"
							data-testid="vue-supprimer"
							aria-label={t('vues.supprimer.aria', { nom: choisie.nom })}
							{...(refusee ? { title: t('vues.motif.espace') } : {})}
							onClick={() => void supprimer()}
						>
							<Trash2 aria-hidden="true" size={16} strokeWidth={2} />
							{t('vues.supprimer')}
						</Button>
						{refusee ? (
							<span id={idMotif} className="sr-only">
								{t('vues.motif.espace')}
							</span>
						) : null}
					</>
				)}
			</div>
			{ecart ? (
				<p id={idEcart} data-testid="vue-ecart" className="text-sm text-text-2">
					{t('vues.ecart')}
				</p>
			) : null}
			{etatVues.refus === null || panneau !== null ? null : (
				<p role="alert" data-testid="vue-refus" className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm text-danger-on-soft">
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
					{t(CLES_REFUS[etatVues.refus])}
				</p>
			)}
			<LiveRegion libelle={t('vues.live')} message={etatVues.annonce} />
		</div>
	)
}

/** Le panneau « Enregistrer la vue » ou « Modifier », sous la barre, dans le flux (§5.75, §5.50). */
export function PanneauVue({
	vues: etatVues,
	parametres,
	onParametres,
}: {
	readonly vues: VuesDuChannel
	readonly parametres: ParametresListe
	readonly onParametres: (parametres: ParametresListe) => void
}) {
	const { capacites } = useContexteEspace()
	const idNom = useId()
	const idRefus = useId()
	const idAide = useId()
	const { panneau, etat } = etatVues
	const choisie = etat.statut === 'pret' ? vueChoisie(etat.donnees, parametres) : undefined
	const modification = panneau === 'modifier' && choisie !== undefined
	const [nom, setNom] = useState(modification ? choisie.nom : '')
	const [publier, setPublier] = useState(false)
	const [enCours, setEnCours] = useState(false)
	const champ = useRef<HTMLInputElement | null>(null)

	useEffect(() => {
		champ.current?.focus()
	}, [])

	// LA CASE DE PUBLICATION : à l'enregistrement, et sur une vue PRIVÉE à la modification — une vue publiée ne redevient
	// pas privée, sa case ne se rend donc pas (§5.15). Refusée par la capacité d'administrer, elle est désactivée, lisible,
	// et sa phrase devient le motif (§5.59).
	const offrirPublication = !modification || choisie.visibilite === 'privee'
	const publicationRefusee = capacites.administration === 'refusee'
	const blanc = nom.trim() === ''

	const fermer = () => {
		if (enCours) return
		etatVues.fermer()
	}

	const client = etatVues.client

	const envoyer = async () => {
		if (blanc || enCours || client === null) return
		etatVues.setRefus(null)
		setEnCours(true)
		const issue = modification
			? await modifierVue(client, choisie.id, { nom, publier })
			: await enregistrerVue(client, etatVues.idChannel, { nom, publier, filtres: filtresDepuisParametres(parametres) })
		setEnCours(false)
		if (issue.statut === 'refus') {
			etatVues.setRefus(issue.nature)
			// LE FOCUS REVIENT AU CHAMP À CORRIGER (§5.71) : « Enregistrer », éteint pendant l'envoi, l'a perdu.
			champ.current?.focus()
			return
		}
		etatVues.annoncer(t(modification ? 'vues.annonce.modifiee' : 'vues.annonce.enregistree', { nom: nom.trim() }))
		// LE SUCCÈS CHOISIT LA VUE ENREGISTRÉE : l'adresse prend son `vue` (§5.75).
		if (!modification) onParametres({ ...parametres, vue: issue.id })
		etatVues.relire()
		etatVues.fermer()
	}

	if (client === null || panneau === null || (panneau === 'modifier' && choisie === undefined)) return null

	return (
		<form
			data-testid="panneau-vue"
			aria-label={modification ? t('vues.panneau.modifier', { nom: choisie.nom }) : t('vues.panneau.enregistrer')}
			className="flex flex-col gap-3 bg-surface border border-border rounded-lg p-4"
			noValidate
			onSubmit={(evenement) => {
				evenement.preventDefault()
				void envoyer()
			}}
			onKeyDown={(evenement) => {
				if (evenement.key !== 'Escape') return
				evenement.preventDefault()
				evenement.stopPropagation()
				fermer()
			}}
		>
			<div className="flex flex-col gap-1 max-w-[72ch]">
				<label htmlFor={idNom} className="text-sm text-text-2">
					{t('vues.champ.nom')}
				</label>
				<input
					id={idNom}
					ref={champ}
					data-testid="champ-nom-vue"
					type="text"
					autoComplete="off"
					value={nom}
					onChange={(evenement) => setNom(evenement.target.value)}
					{...(etatVues.refus === null ? {} : { 'aria-describedby': idRefus })}
					className={CLASSES_CHAMP}
				/>
			</div>
			{!offrirPublication ? null : (
				<div className="flex flex-col gap-1">
					<label className="flex min-h-[var(--size-target)] items-center gap-3">
						<input
							type="checkbox"
							data-testid="case-publier-vue"
							checked={publier}
							disabled={publicationRefusee}
							aria-describedby={idAide}
							onChange={(evenement) => setPublier(evenement.target.checked)}
							className="size-6 shrink-0 accent-brand"
						/>
						<span>{t('vues.publier')}</span>
					</label>
					<p id={idAide} className="text-sm text-text-2 pl-[36px]">
						{t(publicationRefusee ? 'vues.publier.refusee' : 'vues.publier.aide')}
					</p>
				</div>
			)}
			{etatVues.refus === null ? null : (
				<p id={idRefus} role="alert" data-testid="panneau-vue-refus" className="flex items-start gap-2 rounded-sm bg-danger-soft p-2 text-sm text-danger-on-soft">
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
					{t(CLES_REFUS[etatVues.refus])}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" data-testid="panneau-vue-valider" disabled={blanc || enCours}>
					{t(enCours ? 'vues.enCours' : 'vues.valider')}
				</Button>
				<Button type="button" variante="secondaire" onClick={fermer}>
					{t('vues.annuler')}
				</Button>
			</div>
		</form>
	)
}
