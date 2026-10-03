// @spec CRM-097 (docs/BACKLOG.md) — tranche T2.c : le panneau de suggestion de l'assistant IA
// @spec docs/SPEC-ia.md §2 (rien n'est créé avant « Accepter »), §12.5 (demander, générer, relire, corriger, faire
//       revoir, accepter, abandonner ; une génération d'un autre se relit sans scrutation), §12.6 (reprise sans
//       consigne, issue `sans_suite`), §12.7 (les refus traduits) ; docs/JOURNAL.md décision 618
// @spec docs/DESIGN_SYSTEM.md §5.52 (tout le panneau : principe écrit, demande et rappel des données, état de
//       l'assistant qui n'éteint rien, opération longue, défauts en accent, barre de gestes et ordre d'engagement,
//       confirmation d'abandon dans le flux, refus près de la cause, historique replié, focus, annonces),
//       §5.8 (états), §6 (opération longue), §8 (accessibilité), §10 (aucun texte en dur)
// @spec CRM-097 tranche T3.c — docs/SPEC-ia.md §13.6 (le panneau dans la colonne du workflow, titré par la portée ;
//       le différentiel ; les affaires des étapes retirées ; accepter, puis l'annonce du point de retour), §13.4
//       (« workflow modifie », « workflow archive ») ; docs/DESIGN_SYSTEM.md §5.53 ; décision 620
//
// AUCUN DROIT N'EST CALCULÉ ICI (CLAUDE.md §10) : chaque commande est rendue, la base et la fonction `ia`
// refusent, et le panneau traduit. Les seules commandes désactivées le sont par l'état de la saisie — rien de
// modifié, une consigne blanche — ou pendant un geste en vol, jamais selon un rôle.

import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import { ApercuPropositionIa } from './ApercuPropositionIa'
import { DifferentielIa, RemappagesIa, type Nommage } from './ModificationIa'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n/fr'
import { enChargement, type EtatAsync } from '../lib/async'
import { lireCatalogueActif } from '../lib/administration-workflows'
import {
	abandonnerSuggestion,
	accepterSuggestion,
	enregistrerCorrection,
	formaterHorodatage,
	generationEnVol,
	genererSuggestion,
	lireEtatAssistant,
	lireNumeroVersion,
	lireSuggestion,
	lireWorkflowVivant,
	revoirSuggestion,
	type AccesAssistant,
	type PorteeModification,
	type WorkflowVivant,
	type DefautIa,
	type EchecGeneration,
	type EtatAssistant,
	type IssueFlux,
	type RaisonIndisponible,
	type RefusAcceptation,
	type RefusCorrection,
	type RefusGeneration,
	type ResultatGeneration,
	type RevisionIa,
	type SuggestionLue,
} from '../lib/assistant-ia'
import { definirRemappage, memesPropositions, noeudPropose, type PropositionIa } from '../lib/brouillon-ia'
import { differentiel, etapesRetireesOccupees } from '../lib/differentiel-ia'
import type { ClientCrm } from '../lib/supabase'

// ---------------------------------------------------------------------------------------------
// Les textes — composés par clé, jamais par concaténation (§10)
// ---------------------------------------------------------------------------------------------

// Chaque clé est écrite EN TOUTES LETTRES, jamais composée : une clé composée échappe au contrôle des clés mortes
// (`i18n.test.ts`) et à la recherche — la convention de `LIBELLES_TYPE` dans l'éditeur.
const CLES_DEFAUT: Readonly<Record<string, CleTraduction>> = {
	nom_absent: 'ia.defaut.nom_absent',
	cle_invalide: 'ia.defaut.cle_invalide',
	noeud_en_double: 'ia.defaut.noeud_en_double',
	noeud_deja_au_catalogue: 'ia.defaut.noeud_deja_au_catalogue',
	noeud_archive: 'ia.defaut.noeud_archive',
	libelle_absent: 'ia.defaut.libelle_absent',
	nature_invalide: 'ia.defaut.nature_invalide',
	probabilite_invalide: 'ia.defaut.probabilite_invalide',
	noeud_inutilise: 'ia.defaut.noeud_inutilise',
	aucune_etape: 'ia.defaut.aucune_etape',
	etape_en_double: 'ia.defaut.etape_en_double',
	noeud_inconnu: 'ia.defaut.noeud_inconnu',
	etape_initiale: 'ia.defaut.etape_initiale',
	transition_etape_absente: 'ia.defaut.transition_etape_absente',
	transition_boucle: 'ia.defaut.transition_boucle',
	transition_en_double: 'ia.defaut.transition_en_double',
	transition_sans_libelle: 'ia.defaut.transition_sans_libelle',
	champ_en_double: 'ia.defaut.champ_en_double',
	type_inconnu: 'ia.defaut.type_inconnu',
	choix_requis: 'ia.defaut.choix_requis',
	choix_invalide: 'ia.defaut.choix_invalide',
	devise_requise: 'ia.defaut.devise_requise',
	regle_champ_absent: 'ia.defaut.regle_champ_absent',
	regle_etape_absente: 'ia.defaut.regle_etape_absente',
	regle_en_double: 'ia.defaut.regle_en_double',
	visibilite_invalide: 'ia.defaut.visibilite_invalide',
	exigence_transition_absente: 'ia.defaut.exigence_transition_absente',
	exigence_champ_absent: 'ia.defaut.exigence_champ_absent',
	exigence_en_double: 'ia.defaut.exigence_en_double',
	// `CRM-097` T3 — les cinq codes d'une modification (docs/SPEC-ia.md §13.3).
	type_non_modifiable: 'ia.defaut.type_non_modifiable',
	remappage_requis: 'ia.defaut.remappage_requis',
	remappage_origine_inconnue: 'ia.defaut.remappage_origine_inconnue',
	remappage_cible_absente: 'ia.defaut.remappage_cible_absente',
	remappage_en_double: 'ia.defaut.remappage_en_double',
}

/** La phrase d'un défaut : sa clé de traduction et les valeurs que la base a écrites (docs/SPEC-ia.md §12.1). */
export function phraseDefaut(defaut: DefautIa): string {
	const valeurs = Object.fromEntries(Object.entries(defaut.valeurs ?? {}).map(([cle, valeur]) => [cle, String(valeur)]))
	const cle = Object.hasOwn(CLES_DEFAUT, defaut.code) ? CLES_DEFAUT[defaut.code] : undefined
	return cle === undefined ? t('ia.defaut.inconnu', { code: defaut.code }) : t(cle, valeurs)
}

type Compte = { readonly zero: CleTraduction; readonly un: CleTraduction; readonly plusieurs: CleTraduction }
const PRETE: Compte = { zero: 'ia.annonce.prete.zero', un: 'ia.annonce.prete.un', plusieurs: 'ia.annonce.prete.plusieurs' }
const CORRECTION: Compte = {
	zero: 'ia.annonce.correction.zero',
	un: 'ia.annonce.correction.un',
	plusieurs: 'ia.annonce.correction.plusieurs',
}
const DEFAUTS_REVISION: Compte = {
	zero: 'ia.historique.defauts.zero',
	un: 'ia.historique.defauts.un',
	plusieurs: 'ia.historique.defauts.plusieurs',
}

/** Un compte accordé par clé : `zero`, `un` ou `plusieurs` (§10). */
function compte(cles: Compte, nombre: number): string {
	if (nombre === 0) return t(cles.zero)
	if (nombre === 1) return t(cles.un)
	return t(cles.plusieurs, { nombre: String(nombre) })
}

const ECHECS: Readonly<Record<EchecGeneration, CleTraduction>> = {
	delai_depasse: 'ia.echec.delai_depasse',
	serveur_injoignable: 'ia.echec.serveur_injoignable',
	cle_refusee: 'ia.echec.cle_refusee',
	reponse_invalide: 'ia.echec.reponse_invalide',
}
export const RAISONS: Readonly<Record<RaisonIndisponible, CleTraduction>> = {
	cle_absente: 'ia.etat.raison.cle_absente',
	serveur_injoignable: 'ia.etat.raison.serveur_injoignable',
	cle_refusee: 'ia.etat.raison.cle_refusee',
	modele_absent: 'ia.etat.raison.modele_absent',
}
const REFUS_GENERATION: Readonly<Record<Exclude<RefusGeneration, 'indisponible'>, CleTraduction>> = {
	workflow_introuvable: 'ia.refus.workflow_introuvable',
	demande_invalide: 'ia.refus.demande_invalide',
	consigne_invalide: 'ia.refus.consigne_invalide',
	session: 'ia.refus.session',
	refuse: 'ia.refus.refuse',
	introuvable: 'ia.refus.introuvable',
	figee: 'ia.refus.figee',
	en_cours: 'ia.refus.en_cours',
	reseau: 'ia.refus.reseau',
	inconnu: 'ia.refus.inconnu',
}
const REFUS_CORRECTION: Readonly<Record<RefusCorrection, CleTraduction>> = {
	refuse: 'ia.refus.refuse',
	introuvable: 'ia.refus.introuvable',
	figee: 'ia.refus.figee',
	en_cours: 'ia.refus.en_cours',
	mal_formee: 'ia.refus.mal_formee',
	panne: 'ia.refus.panne',
}
const REFUS_ACCEPTATION: Readonly<Record<Exclude<RefusAcceptation, 'non_conforme'>, CleTraduction>> = {
	workflow_modifie: 'ia.refus.workflow_modifie',
	workflow_archive: 'ia.refus.workflow_archive',
	session: 'ia.refus.session',
	introuvable: 'ia.refus.introuvable',
	figee: 'ia.refus.figee',
	en_cours: 'ia.refus.en_cours',
	aucune_revision: 'ia.refus.aucune_revision',
	panne: 'ia.refus.panne',
}

export function texteEchec(echec: EchecGeneration): string {
	return t(ECHECS[echec])
}

export function texteRefusGeneration(refus: RefusGeneration, raison?: RaisonIndisponible): string {
	if (refus === 'indisponible') {
		return raison === undefined ? t('ia.refus.indisponible.sans_raison') : t('ia.refus.indisponible', { raison: t(RAISONS[raison]) })
	}
	return t(REFUS_GENERATION[refus])
}

export function texteRefusCorrection(refus: RefusCorrection): string {
	return t(REFUS_CORRECTION[refus])
}

export function texteRefusAcceptation(refus: RefusAcceptation, defauts?: number): string {
	if (refus === 'non_conforme') {
		if (defauts === undefined) return t('ia.refus.non_conforme')
		return defauts === 1 ? t('ia.refus.non_conforme.un') : t('ia.refus.non_conforme.plusieurs', { nombre: String(defauts) })
	}
	return t(REFUS_ACCEPTATION[refus])
}

/** Ce que dit la fin d'un flux : une issue, ou son absence — la connexion coupée. */
function annonceIssue(issue: IssueFlux | null): { readonly annonce: string; readonly refus: string | null } {
	if (issue === null) return { annonce: t('ia.issue.coupee'), refus: t('ia.issue.coupee') }
	if (issue.issue === 'revision') return { annonce: compte(PRETE, issue.defauts), refus: null }
	if (issue.issue === 'sans_suite') return { annonce: t('ia.issue.sans_suite'), refus: t('ia.issue.sans_suite') }
	return { annonce: texteEchec(issue.echec), refus: texteEchec(issue.echec) }
}

// ---------------------------------------------------------------------------------------------
// Petites formes
// ---------------------------------------------------------------------------------------------

function AlerteIa({ message, testId }: { readonly message: string; readonly testId: string }) {
	return (
		<p role="alert" data-testid={testId} className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger-on-soft">
			<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="mt-[2px] shrink-0" />
			<span>{message}</span>
		</p>
	)
}

/**
 * L'opération longue (§5.52, §6) : la phrase dans une région polie, le temps écoulé HORS d'elle — annoncé chaque
 * seconde, il couvrirait tout —, et une barre indéterminée qui ne glisse qu'en `motion-safe`.
 */
function Attente({ nature, debut, maintenant }: { readonly nature: 'creation' | 'revue'; readonly debut: number; readonly maintenant: () => number }) {
	const [secondes, setSecondes] = useState(() => Math.max(0, Math.floor((maintenant() - debut) / 1000)))
	useEffect(() => {
		const minuterie = setInterval(() => setSecondes(Math.max(0, Math.floor((maintenant() - debut) / 1000))), 1000)
		return () => clearInterval(minuterie)
	}, [debut, maintenant])
	return (
		<div className="flex flex-col gap-2" data-testid="ia-attente">
			<p role="status" className="text-sm">
				{nature === 'creation' ? t('ia.generation.creation') : t('ia.generation.revue')}
			</p>
			<p className="text-sm text-text-2">
				<code>{t('ia.generation.ecoule', { secondes: String(secondes) })}</code>
			</p>
			<div aria-hidden="true" className="relative h-[4px] overflow-hidden rounded-full bg-hover">
				<div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-brand motion-safe:animate-[glissement-attente_1.5s_ease-in-out_infinite]" />
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------------------------
// Le panneau
// ---------------------------------------------------------------------------------------------

/** La portée nomme une modification (`CRM-097` T3) ; sans elle, l'ouverture est celle d'une création. */
export type OuverturePanneauIa =
	| { readonly type: 'demande'; readonly portee?: PorteeModification }
	| { readonly type: 'suggestion'; readonly id: string; readonly portee?: PorteeModification }

const TITRES_MODIFICATION: Readonly<Record<PorteeModification, CleTraduction>> = {
	etapes: 'ia.modification.titre.etapes',
	transitions: 'ia.modification.titre.transitions',
	champs: 'ia.modification.titre.champs',
}

export type ProprietesPanneauIa = {
	readonly client: ClientCrm
	readonly acces: AccesAssistant | null
	readonly idWorkspace: string | null
	readonly ouverture: OuverturePanneauIa
	/** Le workflow que le panneau fait évoluer, quand il vit dans sa colonne (§5.53) ; absent pour une création. */
	readonly workflow?: { readonly id: string; readonly nom: string }
	/** La première ligne du flux est arrivée : la suggestion existe, la liste peut la montrer. */
	readonly onSuggestionCreee: (id: string) => void
	/** La première génération est finie, quelle que soit son issue : la suggestion s'ouvre. */
	readonly onSuggestionPrete: (id: string, annonce: string) => void
	/** `version` : le numéro du point de retour d'une modification, s'il a pu être lu ; `null` pour une création. */
	readonly onAcceptee: (idWorkflow: string, nom: string, version: number | null) => void
	readonly onAbandonnee: () => void
	readonly onFermer: () => void
	readonly annoncer: (message: string) => void
	/** L'horloge, injectée pour les preuves. */
	readonly maintenant?: () => number
}

const horloge = () => Date.now()

export function PanneauSuggestionIa(proprietes: ProprietesPanneauIa) {
	const { ouverture, workflow } = proprietes
	const idTitre = useId()
	const titre = useRef<HTMLHeadingElement | null>(null)
	const portee = ouverture.portee
	const texteTitre =
		portee !== undefined && workflow !== undefined
			? t(TITRES_MODIFICATION[portee], { workflow: workflow.nom })
			: ouverture.type === 'demande'
				? t('ia.demande.titre')
				: t('ia.panneau.titre')
	return (
		<section
			aria-labelledby={idTitre}
			data-testid="ia-panneau"
			className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
		>
			<div className="flex flex-col gap-2">
				<h2 id={idTitre} ref={titre} tabIndex={-1} className="flex items-center gap-2">
					<Sparkles aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 text-brand" />
					<span>{texteTitre}</span>
				</h2>
				<p className="self-start rounded-full bg-hover px-2 text-xs text-text-2">
					{workflow === undefined ? t('ia.panneau.principe') : t('ia.modification.principe')}
				</p>
			</div>
			{ouverture.type === 'demande' ? (
				<VueDemande {...proprietes} />
			) : (
				<VueSuggestion key={ouverture.id} {...proprietes} id={ouverture.id} titre={titre} />
			)}
		</section>
	)
}

// ---------------------------------------------------------------------------------------------
// Demander
// ---------------------------------------------------------------------------------------------

function VueDemande({
	acces,
	idWorkspace,
	ouverture,
	workflow,
	onSuggestionCreee,
	onSuggestionPrete,
	onFermer,
	maintenant = horloge,
}: ProprietesPanneauIa) {
	// Une demande ouverte depuis un bloc du workflow fait évoluer ce workflow (docs/SPEC-ia.md §13.5).
	const cible =
		ouverture.type === 'demande' && ouverture.portee !== undefined && workflow !== undefined
			? { portee: ouverture.portee, idWorkflow: workflow.id }
			: null
	const prefixe = useId()
	const champ = useRef<HTMLTextAreaElement | null>(null)
	const [demande, setDemande] = useState('')
	const [etat, setEtat] = useState<EtatAssistant | null | 'lecture'>('lecture')
	const [refus, setRefus] = useState<string | null>(null)
	const [debut, setDebut] = useState<number | null>(null)

	useEffect(() => {
		champ.current?.focus()
	}, [])

	// L'état de l'assistant est lu à l'ouverture ; il ne retient rien (§5.52).
	useEffect(() => {
		if (acces === null) {
			setEtat(null)
			return
		}
		let vivant = true
		void lireEtatAssistant(acces).then((lu) => {
			if (vivant) setEtat(lu)
		})
		return () => {
			vivant = false
		}
	}, [acces])

	const generer = async () => {
		if (acces === null || idWorkspace === null) {
			setRefus(t('ia.refus.inconnu'))
			return
		}
		setRefus(null)
		setDebut(maintenant())
		const resultat: ResultatGeneration = await genererSuggestion(acces, idWorkspace, demande, onSuggestionCreee, cible)
		setDebut(null)
		if (resultat.statut === 'refus') {
			setRefus(texteRefusGeneration(resultat.refus, resultat.raison))
			return
		}
		onSuggestionPrete(resultat.suggestionId, annonceIssue(resultat.issue).annonce)
	}

	if (debut !== null) return <Attente nature="creation" debut={debut} maintenant={maintenant} />

	return (
		<form
			className="flex flex-col gap-3"
			aria-label={t('ia.demande.titre')}
			onSubmit={(e) => {
				e.preventDefault()
				if (demande.trim() === '') return
				void generer()
			}}
		>
			{etat !== 'lecture' && (etat === null || !etat.disponible) ? (
				<p role="status" data-testid="ia-etat" className="flex items-start gap-2 rounded-sm bg-accent-soft px-3 py-2 text-sm text-accent-on-soft">
					<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="mt-[2px] shrink-0" />
					<span>
						{etat === null
							? t('ia.etat.illisible')
							: t('ia.etat.indisponible', { raison: t(RAISONS[etat.raison ?? 'serveur_injoignable']) })}
					</span>
				</p>
			) : null}
			<div className="flex flex-col gap-1">
				<label htmlFor={`${prefixe}-demande`} className="text-sm text-text-2">
					{cible === null ? t('ia.demande.champ') : t('ia.modification.champ')}
				</label>
				<textarea
					id={`${prefixe}-demande`}
					ref={champ}
					rows={6}
					maxLength={4000}
					value={demande}
					aria-describedby={`${prefixe}-aide ${prefixe}-donnees`}
					onChange={(e) => setDemande(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Escape') onFermer()
					}}
					className="rounded-sm border border-border bg-surface px-3 py-2"
				/>
				<span id={`${prefixe}-aide`} className="text-sm text-text-3">
					{cible === null ? t('ia.demande.aide') : t('ia.modification.aide')}
				</span>
				<span id={`${prefixe}-donnees`} className="text-sm text-text-3">
					{t('ia.demande.donnees')}
				</span>
			</div>
			{refus === null ? null : <AlerteIa message={refus} testId="ia-refus-demande" />}
			<div className="flex flex-wrap gap-2">
				<Button type="submit" variante="primaire" disabled={demande.trim() === ''}>
					<Sparkles aria-hidden="true" size={16} strokeWidth={2} />
					{t('ia.demande.generer')}
				</Button>
				<Button variante="discret" onClick={onFermer}>
					{t('admin.action.cancel')}
				</Button>
			</div>
		</form>
	)
}

// ---------------------------------------------------------------------------------------------
// Relire, corriger, faire revoir, accepter, abandonner
// ---------------------------------------------------------------------------------------------

type Lieu = 'barre' | 'consigne' | 'generation'
type Geste = 'enregistrer' | 'accepter' | 'abandonner'

function VueSuggestion({
	client,
	acces,
	id,
	titre,
	onAcceptee,
	onAbandonnee,
	annoncer,
	maintenant = horloge,
}: ProprietesPanneauIa & { readonly id: string; readonly titre: RefObject<HTMLHeadingElement | null> }) {
	const prefixe = useId()
	const [lue, setLue] = useState<EtatAsync<SuggestionLue | null>>(enChargement)
	const [catalogue, setCatalogue] = useState<ReadonlyMap<string, string>>(new Map())
	const [tentative, setTentative] = useState(0)
	const [brouillon, setBrouillon] = useState<{ readonly revision: string; readonly proposition: PropositionIa } | null>(null)
	const [consigne, setConsigne] = useState('')
	const [geste, setGeste] = useState<Geste | null>(null)
	const [generation, setGeneration] = useState<{ readonly debut: number; readonly nature: 'creation' | 'revue' } | null>(null)
	const [refus, setRefus] = useState<{ readonly lieu: Lieu; readonly message: string } | null>(null)
	const [confirmation, setConfirmation] = useState(false)
	const [focaliserTitre, setFocaliserTitre] = useState(true)
	const commandeAbandon = useRef<HTMLButtonElement | null>(null)
	// La commande d'abandon est DÉSACTIVÉE pendant sa confirmation (§5.52) : un élément désactivé ne prend pas le
	// focus, qui lui est donc rendu au rendu suivant, une fois réactivée — défaut trouvé par la preuve unitaire.
	const [rendreFocusAbandon, setRendreFocusAbandon] = useState(false)
	useEffect(() => {
		if (!rendreFocusAbandon || confirmation) return
		commandeAbandon.current?.focus()
		setRendreFocusAbandon(false)
	}, [rendreFocusAbandon, confirmation])

	const relire = useCallback(() => setTentative((n) => n + 1), [])

	useEffect(() => {
		let vivant = true
		void Promise.all([lireSuggestion(client, id), lireCatalogueActif(client)]).then(([suggestion, noeuds]) => {
			if (!vivant) return
			setLue(suggestion)
			if (noeuds.statut === 'pret') setCatalogue(new Map(noeuds.donnees.map((n) => [n.key, n.label])))
		})
		return () => {
			vivant = false
		}
	}, [client, id, tentative])

	const derniere: RevisionIa | null = lue.statut === 'pret' && lue.donnees !== null ? (lue.donnees.revisions[0] ?? null) : null

	// Une MODIFICATION (docs/SPEC-ia.md §13.6) : le workflow vivant et son occupation, relus avec la suggestion. Une
	// relecture garde l'état lu le temps qu'elle aboutisse — le différentiel ne clignote pas à chaque geste (§5.29).
	const idWorkflowVise = lue.statut === 'pret' && lue.donnees !== null ? lue.donnees.suggestion.workflow_id : null
	const [vivant, setVivant] = useState<EtatAsync<WorkflowVivant | null>>(enChargement)
	useEffect(() => {
		if (idWorkflowVise === null) return
		let actif = true
		void lireWorkflowVivant(client, idWorkflowVise).then((lu) => {
			if (actif) setVivant(lu)
		})
		return () => {
			actif = false
		}
	}, [client, idWorkflowVise, tentative])

	// Le brouillon repart de la dernière révision dès qu'elle change — jamais d'une autre.
	useEffect(() => {
		if (derniere === null) return
		setBrouillon((courant) => (courant?.revision === derniere.id ? courant : { revision: derniere.id, proposition: derniere.proposition }))
	}, [derniere])

	// Ouvrir une suggestion, ou recevoir une révision, place le focus sur le titre du panneau (§5.52).
	useEffect(() => {
		if (!focaliserTitre || lue.statut === 'chargement') return
		titre.current?.focus()
		setFocaliserTitre(false)
	}, [focaliserTitre, lue, titre])

	if (lue.statut === 'chargement') return <SkeletonListe lignes={4} libelle={t('ia.panneau.chargement')} />
	if (lue.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('ia.panneau.erreur.titre')}
				corps={t('ia.panneau.erreur.corps')}
				libelleReprise={t('ia.action.relire')}
				onReprise={relire}
			/>
		)
	}
	if (lue.donnees === null) return <EtatVide titre={t('ia.panneau.introuvable.titre')} corps={t('ia.panneau.introuvable.corps')} />

	const { suggestion, revisions } = lue.donnees
	const proposition = brouillon !== null && derniere !== null && brouillon.revision === derniere.id ? brouillon.proposition : derniere?.proposition ?? null
	const modifie = derniere !== null && proposition !== null && !memesPropositions(proposition, derniere.proposition)
	const occupe = geste !== null || generation !== null
	const defauts = derniere?.defauts ?? []
	const bloquee = !modifie && defauts.length > 0

	const enregistrer = async (): Promise<RevisionIa | null> => {
		if (proposition === null) return null
		setGeste('enregistrer')
		setRefus(null)
		const resultat = await enregistrerCorrection(client, id, proposition)
		setGeste(null)
		if (!resultat.ok) {
			setRefus({ lieu: 'barre', message: texteRefusCorrection(resultat.refus) })
			return null
		}
		annoncer(compte(CORRECTION, resultat.revision.defauts.length))
		relire()
		return resultat.revision
	}

	const generer = async (nature: 'creation' | 'revue', texte: string | null) => {
		if (acces === null) {
			setRefus({ lieu: nature === 'revue' ? 'consigne' : 'generation', message: t('ia.refus.inconnu') })
			return
		}
		if (modifie && (await enregistrer()) === null) return
		setRefus(null)
		setGeneration({ debut: maintenant(), nature })
		const resultat = await revoirSuggestion(acces, id, texte)
		setGeneration(null)
		const lieu: Lieu = nature === 'revue' ? 'consigne' : 'generation'
		if (resultat.statut === 'refus') {
			setRefus({ lieu, message: texteRefusGeneration(resultat.refus, resultat.raison) })
		} else {
			const { annonce, refus: echec } = annonceIssue(resultat.issue)
			annoncer(annonce)
			if (echec !== null) setRefus({ lieu, message: echec })
			else setConsigne('')
		}
		setFocaliserTitre(true)
		relire()
	}

	const accepter = async () => {
		if (proposition === null) return
		let nombre = defauts.length
		if (modifie) {
			const ecrite = await enregistrer()
			if (ecrite === null) return
			nombre = ecrite.defauts.length
			if (nombre > 0) {
				setRefus({ lieu: 'barre', message: texteRefusAcceptation('non_conforme', nombre) })
				return
			}
		}
		setGeste('accepter')
		setRefus(null)
		const resultat = await accepterSuggestion(client, id)
		if (!resultat.ok) {
			setGeste(null)
			setRefus({ lieu: 'barre', message: texteRefusAcceptation(resultat.refus, resultat.defauts) })
			relire()
			return
		}
		// Une modification a publié — ou désigné — son point de retour : l'annonce le nomme (§5.53).
		let version: number | null = null
		if (suggestion.workflow_id !== null) {
			const relue = await lireSuggestion(client, id)
			const idVersion = relue.statut === 'pret' ? (relue.donnees?.suggestion.version_retour_id ?? null) : null
			version = idVersion === null ? null : await lireNumeroVersion(client, idVersion)
		}
		setGeste(null)
		onAcceptee(resultat.idWorkflow, proposition.workflow.nom.trim(), version)
	}

	const abandonner = async () => {
		setGeste('abandonner')
		setRefus(null)
		const resultat = await abandonnerSuggestion(client, id)
		setGeste(null)
		if (resultat.ok) {
			annoncer(t('ia.annonce.abandonnee'))
			onAbandonnee()
			return
		}
		setConfirmation(false)
		setRendreFocusAbandon(true)
		setRefus({ lieu: 'barre', message: resultat.refus === 'figee' ? t('ia.refus.figee') : resultat.refus === 'sans_effet' ? t('ia.refus.sans_effet') : t('ia.refus.panne') })
		relire()
	}

	const refusDe = (lieu: Lieu): ReactNode => (refus?.lieu === lieu ? <AlerteIa message={refus.message} testId={`ia-refus-${lieu}`} /> : null)
	const modification = suggestion.workflow_id !== null
	const vivante = modification && vivant.statut === 'pret' && vivant.donnees !== null ? vivant.donnees : null
	const noms: Nommage = {
		etape: (cle) => (proposition === null ? undefined : noeudPropose(proposition, cle)?.libelle) || catalogue.get(cle) || cle,
		champ: (cle) =>
			proposition?.champs.find((c) => c.cle === cle)?.libelle || vivante?.composition.champs.find((c) => c.cle === cle)?.libelle || cle,
	}
	const enVolAilleurs = generation === null && suggestion.statut === 'en_revue' && generationEnVol(suggestion, maintenant())
	const depuis = suggestion.generation_depuis === null ? null : formaterHorodatage(suggestion.generation_depuis, 'heure')

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<p className="text-sm font-medium text-text-2">{t('ia.panneau.demande')}</p>
				<blockquote data-testid="ia-demande" className="whitespace-pre-wrap border-l-[3px] border-border pl-3 text-text-2">
					{suggestion.demande}
				</blockquote>
			</div>

			{suggestion.statut !== 'en_revue' ? (
				<p role="status" className="rounded-sm bg-hover px-3 py-2 text-sm text-text-2">
					{suggestion.statut === 'acceptee' ? t('ia.panneau.acceptee') : t('ia.panneau.abandonnee')}
				</p>
			) : null}

			{generation !== null ? <Attente nature={generation.nature} debut={generation.debut} maintenant={maintenant} /> : null}

			{enVolAilleurs ? (
				<div className="flex flex-wrap items-center gap-2">
					<p role="status" className="text-sm">
						{t('ia.generation.en_vol', { heure: depuis ?? '' })}
					</p>
					<Button variante="secondaire" taille="compacte" onClick={relire}>
						{t('ia.action.relire')}
					</Button>
				</div>
			) : null}

			{/* Aucune révision : la première génération a échoué ou n'a rien rendu ; elle se reprend sans consigne. */}
			{derniere === null && generation === null && !enVolAilleurs && suggestion.statut === 'en_revue' ? (
				<div className="flex flex-col gap-2">
					{suggestion.derniere_erreur === null ? (
						<p className="text-sm text-text-2">{t('ia.panneau.sans_revision')}</p>
					) : (
						<p role="status" className="text-sm">
							<span className="font-medium">{t('ia.echec.titre')}</span> — {texteEchec(suggestion.derniere_erreur)}
						</p>
					)}
					{refusDe('generation')}
					<div>
						<Button variante="primaire" onClick={() => void generer('creation', null)}>
							{t('ia.action.reessayer')}
						</Button>
					</div>
				</div>
			) : null}

			{derniere !== null && proposition !== null && generation === null ? (
				<>
					{defauts.length > 0 ? (
						<section
							aria-labelledby={`${prefixe}-defauts`}
							data-testid="ia-defauts"
							className="flex flex-col gap-2 rounded-sm bg-accent-soft px-3 py-2 text-sm text-accent-on-soft"
						>
							<h3 id={`${prefixe}-defauts`} className="flex items-center gap-2 text-sm font-medium text-accent-on-soft">
								<TriangleAlert aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
								{defauts.length === 1 ? t('ia.defauts.titre.un') : t('ia.defauts.titre.plusieurs', { nombre: String(defauts.length) })}
							</h3>
							<ul className="flex list-disc flex-col gap-1 pl-6">
								{defauts.map((defaut, i) => (
									<li key={`${defaut.code}#${i}`}>{phraseDefaut(defaut)}</li>
								))}
							</ul>
						</section>
					) : null}

					{modification ? (
						vivant.statut === 'chargement' ? (
							<SkeletonListe lignes={3} libelle={t('ia.vivant.chargement')} />
						) : vivant.statut === 'erreur' ? (
							<div className="flex flex-wrap items-center gap-2">
								<p role="status" className="text-sm">
									{t('ia.vivant.erreur')}
								</p>
								<Button variante="secondaire" taille="compacte" onClick={relire}>
									{t('ia.action.relire')}
								</Button>
							</div>
						) : vivante === null ? (
							<p role="status" className="text-sm">
								{t('ia.vivant.introuvable')}
							</p>
						) : (
							<>
								<DifferentielIa changements={differentiel(vivante.composition, proposition)} noms={noms} />
								<RemappagesIa
									lignes={etapesRetireesOccupees(vivante.composition, proposition, vivante.occupation)}
									destinations={proposition.etapes.map((e) => e.noeud)}
									noms={noms}
									desactive={occupe || suggestion.statut !== 'en_revue'}
									onChoisir={(de, vers) => setBrouillon({ revision: derniere.id, proposition: definirRemappage(proposition, de, vers) })}
								/>
							</>
						)
					) : null}

					<ApercuPropositionIa
						proposition={proposition}
						catalogue={catalogue}
						desactive={occupe || suggestion.statut !== 'en_revue'}
						vivante={vivante?.composition ?? null}
						onChange={(nouvelle, annonce) => {
							setBrouillon({ revision: derniere.id, proposition: nouvelle })
							if (annonce !== undefined) annoncer(annonce)
						}}
					/>

					{modifie ? (
						<p data-testid="ia-modifie" className="text-sm text-text-3">
							{t('ia.apercu.modifie')}
						</p>
					) : null}

					{suggestion.statut === 'en_revue' ? (
						<>
							<div className="flex flex-col gap-2">
								<label htmlFor={`${prefixe}-consigne`} className="text-sm text-text-2">
									{t('ia.consigne.champ')}
								</label>
								<textarea
									id={`${prefixe}-consigne`}
									rows={3}
									maxLength={4000}
									value={consigne}
									disabled={occupe}
									aria-describedby={`${prefixe}-consigne-aide`}
									onChange={(e) => setConsigne(e.target.value)}
									className="rounded-sm border border-border bg-surface px-3 py-2"
								/>
								<span id={`${prefixe}-consigne-aide`} className="text-sm text-text-3">
									{t('ia.consigne.aide')}
								</span>
								{suggestion.derniere_erreur !== null && refus?.lieu !== 'consigne' ? (
									<p role="status" className="text-sm">
										<span className="font-medium">{t('ia.echec.titre')}</span> — {texteEchec(suggestion.derniere_erreur)}
									</p>
								) : null}
								{refusDe('consigne')}
								<div>
									<Button variante="secondaire" disabled={occupe || consigne.trim() === ''} onClick={() => void generer('revue', consigne)}>
										<Sparkles aria-hidden="true" size={16} strokeWidth={2} />
										{t('ia.action.revoir')}
									</Button>
								</div>
							</div>

							<div className="flex flex-col gap-2 border-t border-border pt-4">
								<div className="flex flex-wrap gap-2">
									<Button
										variante="primaire"
										disabled={occupe || bloquee}
										aria-describedby={bloquee ? `${prefixe}-bloquee` : undefined}
										onClick={() => void accepter()}
									>
										{geste === 'accepter'
											? t('ia.action.accepter.encours')
											: modification
												? t('ia.action.accepter.modification')
												: t('ia.action.accepter')}
									</Button>
									<Button variante="secondaire" disabled={occupe || !modifie} onClick={() => void enregistrer()}>
										{geste === 'enregistrer' ? t('ia.action.enregistrer.encours') : t('ia.action.enregistrer')}
									</Button>
									<Button
										variante="discret"
										disabled={occupe || !modifie}
										onClick={() => {
											setBrouillon({ revision: derniere.id, proposition: derniere.proposition })
											annoncer(t('ia.annonce.retablie'))
										}}
									>
										{t('ia.action.retablir')}
									</Button>
									<Button ref={commandeAbandon} variante="discret" disabled={occupe || confirmation} onClick={() => setConfirmation(true)}>
										{t('ia.action.abandonner')}
									</Button>
								</div>
								{bloquee ? (
									<p id={`${prefixe}-bloquee`} className="text-sm text-text-3">
										{t('ia.accepter.bloque')}
									</p>
								) : null}
								{refusDe('barre')}
								{confirmation ? (
									<ConfirmationAbandon
										demande={suggestion.demande}
										enCours={geste === 'abandonner'}
										onConfirmer={() => void abandonner()}
										onAnnuler={() => {
											setConfirmation(false)
											setRendreFocusAbandon(true)
										}}
									/>
								) : null}
							</div>
						</>
					) : null}

					<Historique revisions={revisions} />
				</>
			) : null}
		</div>
	)
}

/** La confirmation d'abandon, dans le flux : elle nomme la demande et dit la conséquence (§5.52, §5.27). */
function ConfirmationAbandon({
	demande,
	enCours,
	onConfirmer,
	onAnnuler,
}: {
	readonly demande: string
	readonly enCours: boolean
	readonly onConfirmer: () => void
	readonly onAnnuler: () => void
}) {
	const premier = useRef<HTMLButtonElement | null>(null)
	useEffect(() => {
		premier.current?.focus()
	}, [])
	const extrait = demande.length > 80 ? `${demande.slice(0, 80).trimEnd()}…` : demande
	return (
		<div
			role="group"
			aria-label={t('ia.action.abandonner')}
			data-testid="ia-confirmation-abandon"
			className="flex flex-col gap-2 rounded-sm border border-border p-3"
			onKeyDown={(e) => {
				if (e.key === 'Escape') onAnnuler()
			}}
		>
			<p className="font-medium">{t('ia.abandon.question', { demande: extrait })}</p>
			<p className="text-sm text-text-2">{t('ia.abandon.corps')}</p>
			<div className="flex flex-wrap gap-2">
				<Button ref={premier} variante="destructif" disabled={enCours} onClick={onConfirmer}>
					{t('ia.abandon.confirmer')}
				</Button>
				<Button variante="discret" disabled={enCours} onClick={onAnnuler}>
					{t('ia.abandon.garder')}
				</Button>
			</div>
		</div>
	)
}

/** L'historique, replié, la révision la plus récente en haut (§5.52, §5.43). Lecture seule. */
function Historique({ revisions }: { readonly revisions: readonly RevisionIa[] }) {
	return (
		<details data-testid="ia-historique" className="rounded-sm border border-border">
			<summary className="flex min-h-[var(--size-target)] cursor-pointer items-center px-3 text-sm font-medium">
				{revisions.length === 1 ? t('ia.historique.titre.un') : t('ia.historique.titre.plusieurs', { nombre: String(revisions.length) })}
			</summary>
			<ol className="flex flex-col divide-y divide-border border-t border-border">
				{revisions.map((revision) => (
					<li key={revision.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium">{t('ia.historique.revision', { numero: String(revision.numero) })}</span>
							<code>{formaterHorodatage(revision.created_at) ?? ''}</code>
							<span className="rounded-full bg-hover px-2 text-xs text-text-2">
								{revision.origine === 'ia' ? t('ia.historique.origine.ia') : t('ia.historique.origine.correction')}
							</span>
							<span className="text-text-2">{compte(DEFAUTS_REVISION, revision.defauts.length)}</span>
						</div>
						{revision.consigne === null ? null : <p className="whitespace-pre-wrap text-text-2">{revision.consigne}</p>}
					</li>
				))}
			</ol>
		</details>
	)
}
