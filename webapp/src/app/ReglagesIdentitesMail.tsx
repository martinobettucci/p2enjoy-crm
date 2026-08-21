// @spec CRM-089 (docs/BACKLOG.md) — écran de configuration des identités sortantes SMTP
// @spec docs/SPEC-mail-subsystem.md §22.2 (l'adresse), §22.3 (ce qu'il lit), §22.4 (la clé est un
//       TRIPLET), §22.5 (le formulaire), §22.6 (le mot de passe), §22.8 (les refus traduits),
//       §22.9 (les états), §22.10 (ce qu'il ne fait pas)
// @spec docs/DESIGN_SYSTEM.md §5.35 (cette surface, en écarts du §5.34), §5.8 (états
//       systématiques), §5.18 (la liste plate), §5.23 (formulaire replié, dans le flux)
//
// UN ÉCRAN QUI LIT ET QUI ÉCRIT, mais qui n'ouvre AUCUNE politique : la lecture est celle de
// `CRM-053` sous la RLS de `0023`, et l'écriture passe par `upsert_mail_outbound_identity`, seul
// chemin d'écriture de la table. Aucun droit n'est calculé ici : l'écran envoie, et traduit le
// refus.

import { useCallback, useEffect, useRef, useState } from 'react'
import { PencilLine, Plus } from 'lucide-react'
import { Badge, type TonBadge } from '../components/ui/Badge'
import { EtatErreur, EtatVide } from '../components/ui/States'
import { LiveRegion } from '../components/ui/LiveRegion'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import type { CleTraduction } from '../i18n'
import { enChargement, enErreur, pret, type EtatAsync } from '../lib/async'
import {
	enregistrerIdentiteSortante,
	estEtatIdentiteConnu,
	estModeSecuriteSortanteConnu,
	expediteurLisible,
	identiteDe,
	lireIdentitesSortantes,
	MODES_SECURITE_SORTANTE,
	saisieDepuisIdentite,
	type EtatIdentiteSortante,
	type IdentiteSortante,
	type IssueEnregistrementIdentite,
	type ModeSecuriteSortante,
	type SaisieIdentiteSortante,
} from '../lib/mail-identites'
import { lireWorkspaces } from '../lib/workspaces'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/** Les quatre états de `mail_outbound_identities_statut`, chacun avec son mot et son ton (§5.35). */
const ETATS: Readonly<
	Record<EtatIdentiteSortante, { readonly cle: CleTraduction; readonly ton: TonBadge }>
> = {
	pending: { cle: 'admin.mailIdentities.status.pending', ton: 'neutre' },
	ok: { cle: 'admin.mailIdentities.status.ok', ton: 'success' },
	error: { cle: 'admin.mailIdentities.status.error', ton: 'danger' },
	disabled: { cle: 'admin.mailIdentities.status.disabled', ton: 'neutre' },
}

/** Les trois modes de sécurité, en toutes lettres — jamais une teinte (§1, §5.34). */
const SECURITES: Readonly<Record<ModeSecuriteSortante, CleTraduction>> = {
	ssl: 'admin.mailIdentities.security.ssl',
	starttls: 'admin.mailIdentities.security.starttls',
	none: 'admin.mailIdentities.security.none',
}

/** Le dictionnaire fermé des issues du §22.8 — aucune phrase du serveur n'atteint l'écran. */
const REFUS: Readonly<
	Record<Exclude<IssueEnregistrementIdentite, 'enregistre'>, CleTraduction>
> = {
	refus: 'admin.mailIdentities.refusal.forbidden',
	'session-expiree': 'admin.mailIdentities.refusal.session',
	'mot-de-passe-requis': 'admin.mailIdentities.refusal.passwordRequired',
	'libelle-invalide': 'admin.mailIdentities.refusal.label',
	'hote-invalide': 'admin.mailIdentities.refusal.host',
	'port-invalide': 'admin.mailIdentities.refusal.port',
	'securite-invalide': 'admin.mailIdentities.refusal.security',
	'identifiant-invalide': 'admin.mailIdentities.refusal.username',
	'adresse-invalide': 'admin.mailIdentities.refusal.fromAddress',
	'proprietaire-non-membre': 'admin.mailIdentities.refusal.owner',
	reseau: 'admin.mailIdentities.refusal.network',
	inconnu: 'admin.mailIdentities.refusal.unknown',
}

/**
 * Les deux valeurs de DÉCLARATION du sélecteur — §22.5.
 *
 * Toute autre valeur est l'identifiant d'une identité existante, et non celui d'un profil : la clé
 * est un triplet, si bien qu'`owner_id` ne désigne plus une ligne unique (§22.4).
 */
const VALEUR_NOUVELLE_PERSONNELLE = 'nouvelle-personnelle'
const VALEUR_NOUVELLE_SERVICE = 'nouvelle-service'

type Cible = {
	readonly valeur: string
	readonly libelle: string
}

/**
 * Les identités que le formulaire peut viser : celles que l'appelant VOIT, plus les deux
 * déclarations qu'il peut tenter.
 *
 * Une identité existante y est nommée par son `label` suivi de son `from_address` — deux
 * **données** (§10) —, parce que le seul libellé ne distingue plus deux identités d'une même
 * personne (§5.35). Les deux entrées de déclaration portent une clé, faute de donnée à afficher.
 *
 * L'écran ne calcule AUCUN droit ici : l'entrée de service y figure pour tout le monde, et c'est la
 * base qui refuse — mesuré, `403 forbidden` pour la lectrice (§22.7).
 */
export function ciblesIdentites(
	identites: readonly IdentiteSortante[],
	idSession: string | null,
): readonly Cible[] {
	const cibles: Cible[] = identites.map((identite) => ({
		valeur: identite.id,
		libelle: `${identite.label} — ${identite.from_address}`,
	}))
	if (idSession !== null) {
		cibles.push({
			valeur: VALEUR_NOUVELLE_PERSONNELLE,
			libelle: t('admin.mailIdentities.target.newMine'),
		})
	}
	cibles.push({
		valeur: VALEUR_NOUVELLE_SERVICE,
		libelle: t('admin.mailIdentities.target.newSystem'),
	})
	return cibles
}

const CLASSES_BOUTON_PRIMAIRE = [
	'inline-flex items-center gap-2 shrink-0',
	'min-h-[var(--size-target)] px-4 rounded-sm',
	'bg-brand text-white text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_BOUTON_SECONDAIRE = [
	'inline-flex items-center gap-2',
	'min-h-[var(--size-target)] px-3 rounded-sm',
	'border border-border bg-surface text-ink text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:bg-hover disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_BOUTON_DISCRET = [
	'inline-flex items-center gap-2 shrink-0',
	'min-h-[var(--size-target)] px-2 rounded-sm',
	'text-text-2 text-sm font-medium',
	'transition-colors duration-[var(--transition-duration-fast)]',
	'hover:bg-hover disabled:opacity-60 disabled:cursor-not-allowed',
].join(' ')

const CLASSES_CHAMP = [
	'min-h-[var(--size-target)] px-3 rounded-sm',
	'border border-border bg-surface text-ink',
].join(' ')

export type ProprietesReglagesIdentitesMail = {
	readonly client?: ClientCrm | null
	/**
	 * Identifiant de session, injectable pour les preuves.
	 *
	 * Hors preuve, il vient du contexte d'authentification. Un appelant anonyme n'atteint pas cet
	 * écran, mais la valeur `null` reste traitée : elle retire l'entrée « nouvelle identité
	 * personnelle », faute de savoir qui la posséderait.
	 */
	readonly idUtilisateur?: string | null
}

export function ReglagesIdentitesMail({
	client = clientCrm,
	idUtilisateur,
}: ProprietesReglagesIdentitesMail = {}) {
	const authentification = useAuthentification()
	const idSession =
		idUtilisateur ??
		(authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null)

	const [idWorkspace, setIdWorkspace] = useState<string | null>(null)
	const [etat, setEtat] = useState<EtatAsync<readonly IdentiteSortante[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [saisie, setSaisie] = useState<SaisieIdentiteSortante | null>(null)
	/** L'identité visée par le sélecteur : son identifiant, ou l'une des deux valeurs neuves. */
	const [cible, setCible] = useState<string>(VALEUR_NOUVELLE_PERSONNELLE)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	// Une réponse arrivée après le démontage, ou périmée par un rechargement, ne doit pas écraser un
	// état plus récent — même garde que les six autres surfaces de réglages.
	const courant = useRef(0)
	/**
	 * La commande qui a ouvert le formulaire, pour lui rendre le focus (§5.13).
	 *
	 * DEUX COMMANDES PEUVENT L'OUVRIR, ET UNE SEULE SURVIT À L'OUVERTURE. Celle d'une ligne reste
	 * montée — la liste ne disparaît pas —, si bien que son nœud est encore là à la fermeture. Celle
	 * du bas, elle, s'EXCLUT du formulaire (§5.23) : son nœud est DÉTRUIT à l'ouverture, et lui
	 * garder une référence rendrait le focus à un élément détaché du document, c'est-à-dire nulle
	 * part. Le remède n'est pas une temporisation : la commande du bas porte sa PROPRE référence,
	 * que React réassigne au nœud neuf quand elle remonte, et l'origine ne retient que LAQUELLE des
	 * deux a ouvert.
	 */
	const origineFocus = useRef<HTMLButtonElement | null>(null)
	const origineEstCommandeDuBas = useRef(false)
	/** La commande du bas — ou celle de l'état vide, qui occupe la même place et le même rôle. */
	const commandeDuBas = useRef<HTMLButtonElement | null>(null)
	/** Le retour du focus est DIFFÉRÉ d'un tour de rendu : la commande est démontée (§5.25). */
	const focusARendre = useRef(false)

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
			const lues = await lireIdentitesSortantes(client)
			if (rang !== courant.current) return
			setEtat(lues.statut === 'pret' ? pret(lues.donnees) : lues)
		})()
	}, [client, tentative])

	useEffect(() => {
		if (saisie !== null || !focusARendre.current) return
		focusARendre.current = false
		// Le nœud est relu MAINTENANT, après le rendu qui a remonté la commande du bas — jamais
		// celui qui a été capturé à l'ouverture, et que le démontage a détaché.
		const cible = origineEstCommandeDuBas.current ? commandeDuBas.current : origineFocus.current
		cible?.focus()
	}, [saisie])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const identites = etat.statut === 'pret' ? etat.donnees : []

	/**
	 * Ouvre le formulaire sur une cible — un identifiant d'identité, ou l'une des deux déclarations.
	 *
	 * Le propriétaire visé se déduit de la cible : celui de l'identité choisie, l'appelant pour une
	 * déclaration personnelle, `null` pour l'identité de service.
	 */
	const ouvrir = useCallback(
		(valeurCible: string, depuis: HTMLButtonElement | null, estCommandeDuBas = false) => {
			if (idWorkspace === null) return
			if (depuis !== null) {
				origineFocus.current = depuis
				origineEstCommandeDuBas.current = estCommandeDuBas
			}
			setRefus(null)
			setCible(valeurCible)
			const existante = identiteDe(identites, valeurCible)
			if (existante !== undefined) {
				setSaisie(saisieDepuisIdentite(idWorkspace, existante.owner_id, existante))
				return
			}
			const idProprietaire = valeurCible === VALEUR_NOUVELLE_SERVICE ? null : idSession
			setSaisie(saisieDepuisIdentite(idWorkspace, idProprietaire, undefined))
		},
		[identites, idSession, idWorkspace],
	)

	const fermer = useCallback(() => {
		focusARendre.current = true
		setRefus(null)
		setSaisie(null)
	}, [])

	const enregistrer = useCallback(async () => {
		if (client === null || saisie === null || enCours) return
		setEnCours(true)
		setRefus(null)
		const resultat = await enregistrerIdentiteSortante(client, saisie)
		setEnCours(false)
		if (resultat.issue !== 'enregistre') {
			// Un refus n'efface pas la saisie et laisse le formulaire ouvert (§5.7 ter, §22.8).
			setRefus(REFUS[resultat.issue])
			return
		}
		setSaisie(null)
		focusARendre.current = true
		setAnnonce(t('admin.mailIdentities.saved'))
		// LA LISTE EST RELUE, jamais complétée localement (§5.21, §22.9), et c'est cette relecture
		// qui rend visibles les deux effets que la saisie ne connaît pas : le déplacement de
		// l'identité par défaut, tenu par le trigger, et la SECONDE identité qu'une adresse
		// d'expédition modifiée vient de déclarer (§22.4).
		recharger()
	}, [client, enCours, recharger, saisie])

	if (client === null) {
		return (
			<EtatVide
				titre={t('admin.mailIdentities.noWorkspace.title')}
				corps={t('admin.mailIdentities.noWorkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={3} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.mailIdentities.error.title')}
				corps={t('admin.mailIdentities.error.body')}
				libelleReprise={t('admin.mailIdentities.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	const cibles = ciblesIdentites(identites, idSession)
	/** Une déclaration : le mot de passe est alors EXIGÉ, et l'adresse ne porte pas son avertissement. */
	const declaration = identiteDe(identites, cible) === undefined
	/** Le geste d'ouverture par défaut : une déclaration personnelle, ou celle de service à défaut. */
	const cibleNeuve = idSession === null ? VALEUR_NOUVELLE_SERVICE : VALEUR_NOUVELLE_PERSONNELLE

	return (
		// La borne est celle du §5.34, pour la même raison : une ligne porte ici sept éléments, dont
		// trois données techniques. La borne d'un paragraphe de prose y replierait les lignes.
		<section
			aria-label={t('admin.mailIdentities.aria')}
			className="flex flex-col gap-4 max-w-[104ch]"
		>
			<LiveRegion libelle={t('admin.mailIdentities.live.aria')} message={annonce} />

			{identites.length === 0 ? (
				// L'état vide PORTE le geste — §5.13, §22.9.
				<EtatVide
					titre={t('admin.mailIdentities.empty.title')}
					corps={t('admin.mailIdentities.empty.body')}
					action={
						saisie === null ? (
							<button
								type="button"
								ref={commandeDuBas}
								data-testid="ouvrir-identite"
								onClick={(evenement) => ouvrir(cibleNeuve, evenement.currentTarget, true)}
								className={CLASSES_BOUTON_PRIMAIRE}
							>
								<Plus aria-hidden="true" className="size-4" />
								{t('admin.mailIdentities.open')}
							</button>
						) : undefined
					}
				/>
			) : (
				<ul
					data-testid="liste-identites-mail"
					className="flex flex-col rounded-lg border border-border bg-surface"
				>
					{identites.map((identite) => (
						<LigneIdentite
							key={identite.id}
							identite={identite}
							enCours={enCours}
							onConfigurer={(depuis) => ouvrir(identite.id, depuis)}
						/>
					))}
				</ul>
			)}

			{saisie === null ? (
				identites.length > 0 && (
					<div>
						<button
							type="button"
							ref={commandeDuBas}
							data-testid="ouvrir-identite"
							onClick={(evenement) => ouvrir(cibleNeuve, evenement.currentTarget, true)}
							className={CLASSES_BOUTON_PRIMAIRE}
						>
							<Plus aria-hidden="true" className="size-4" />
							{t('admin.mailIdentities.open')}
						</button>
					</div>
				)
			) : (
				<FormulaireIdentite
					saisie={saisie}
					cibles={cibles}
					valeurCible={cible}
					declaration={declaration}
					enCours={enCours}
					refus={refus}
					onCible={(valeur) => ouvrir(valeur, null)}
					onChangement={setSaisie}
					onAnnuler={fermer}
					onValider={() => void enregistrer()}
				/>
			)}
		</section>
	)
}

/**
 * Une ligne de la liste plate du §5.35.
 *
 * L'ADRESSE D'EXPÉDITION EST EN TÊTE, avant le libellé, et c'est l'écart avec le §5.34 : c'est la
 * seule donnée que le destinataire verra, et c'est elle qui distingue deux identités d'une même
 * personne, le libellé pouvant être identique.
 */
function LigneIdentite({
	identite,
	enCours,
	onConfigurer,
}: {
	readonly identite: IdentiteSortante
	readonly enCours: boolean
	readonly onConfigurer: (depuis: HTMLButtonElement | null) => void
}) {
	const expediteur = expediteurLisible(identite)
	return (
		<li
			data-testid="ligne-identite-mail"
			data-identite={identite.id}
			className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-hover"
		>
			{/* `Nom <adresse>` — la forme dans laquelle un destinataire lira l'expéditeur (§5.35). Un
			    nom absent ne produit ni tiret ni valeur inventée (§5.9). */}
			<span
				data-testid="expediteur-identite"
				className="font-medium truncate max-w-[34ch]"
				title={expediteur}
			>
				{expediteur}
			</span>
			{/* L'identité par défaut porte sa pilule ; les autres n'en portent AUCUNE — une pilule
			    « Secondaire » dirait ce que son absence dit déjà (§5.35). */}
			{identite.is_default && (
				<Badge ton="success">{t('admin.mailIdentities.default')}</Badge>
			)}
			<span className="text-sm text-text-2 truncate max-w-[22ch]" title={identite.label}>
				{identite.label}
			</span>
			<code data-testid="connexion-identite" className="text-sm text-text-2 tabular-nums">
				{identite.smtp_host}:{identite.smtp_port}
			</code>
			<span className="text-sm text-text-2">
				{estModeSecuriteSortanteConnu(identite.smtp_security)
					? t(SECURITES[identite.smtp_security])
					: identite.smtp_security}
			</span>
			{/* Un cinquième état serait un défaut de la contrainte : la pilule est alors ABSENTE,
			    jamais remplie du code brut (§5.35, règle du §5.14). Elle ferme la ligne, le CONSTAT
			    du service après le CHOIX de l'utilisateur. */}
			{estEtatIdentiteConnu(identite.status) && (
				<Badge ton={ETATS[identite.status].ton}>{t(ETATS[identite.status].cle)}</Badge>
			)}
			<span className="grow" />
			<button
				type="button"
				data-testid="configurer-identite"
				disabled={enCours}
				onClick={(evenement) => onConfigurer(evenement.currentTarget)}
				aria-label={t('admin.mailIdentities.configure.aria', { identite: expediteur })}
				className={CLASSES_BOUTON_DISCRET}
			>
				<PencilLine aria-hidden="true" className="size-4" />
				{t('admin.mailIdentities.configure')}
			</button>
		</li>
	)
}

/**
 * Le formulaire, déclaration et modification confondues — c'est la forme de la fonction, qui est un
 * `upsert` sur le TRIPLET `(workspace_id, owner_id, from_address)` (§22.4).
 *
 * UNE SEULE COMMANDE D'ENREGISTREMENT, pour le motif du §5.34 : la fonction réécrit la ligne
 * entière, si bien qu'un champ qui s'enregistrerait seul renverrait quand même tous les autres.
 */
function FormulaireIdentite({
	saisie,
	cibles,
	valeurCible,
	declaration,
	enCours,
	refus,
	onCible,
	onChangement,
	onAnnuler,
	onValider,
}: {
	readonly saisie: SaisieIdentiteSortante
	readonly cibles: readonly Cible[]
	readonly valeurCible: string
	/** L'identité visée n'existe pas encore : le mot de passe est alors EXIGÉ, et le dire change. */
	readonly declaration: boolean
	readonly enCours: boolean
	readonly refus: CleTraduction | null
	readonly onCible: (valeur: string) => void
	readonly onChangement: (saisie: SaisieIdentiteSortante) => void
	readonly onAnnuler: () => void
	readonly onValider: () => void
}) {
	const premier = useRef<HTMLSelectElement | null>(null)
	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	return (
		<form
			data-testid="formulaire-identite-mail"
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				onValider()
			}}
		>
			<h3 className="text-h3">{t('admin.mailIdentities.form.title')}</h3>

			<div className="flex flex-wrap gap-3">
				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.target')}
					<select
						ref={premier}
						data-testid="champ-identite-visee"
						value={valeurCible}
						onChange={(evenement) => onCible(evenement.target.value)}
						className={CLASSES_CHAMP}
					>
						{cibles.map((cible) => (
							<option key={cible.valeur} value={cible.valeur}>
								{cible.libelle}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.fromAddress')}
					{/* AUCUN `type="email"` NI `pattern` : c'est la contrainte
					    `mail_outbound_identities_from_address` qui tranche, et son refus est traduit
					    (§5.3 ter, §22.5). */}
					<input
						data-testid="champ-adresse-expedition"
						value={saisie.adresseExpedition}
						onChange={(evenement) =>
							onChangement({ ...saisie, adresseExpedition: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
					{/* L'AVERTISSEMENT NE PARAÎT QUE SUR UNE IDENTITÉ EXISTANTE, et il dit un
					    comportement MESURÉ de la base : l'adresse fait partie de la clé, si bien que
					    la changer DÉCLARE une seconde identité au lieu de renommer celle-ci (§22.4).
					    Ce n'est pas une garde de saisie — rien n'est désactivé, le champ reste
					    modifiable, et la liste relue montre les deux lignes. */}
					{!declaration && (
						<span className="text-sm text-text-3 max-w-[44ch]">
							{t('admin.mailIdentities.field.fromAddress.help')}
						</span>
					)}
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.fromName')}
					{/* TOUJOURS ENVOYÉ, Y COMPRIS VIDE, à l'inverse du mot de passe : `coalesce`
					    rendrait un nom omis INEFFAÇABLE, tandis qu'une chaîne vide l'écrase — les deux
					    sens mesurés (§22.5). */}
					<input
						data-testid="champ-nom-expediteur"
						value={saisie.nomExpediteur}
						onChange={(evenement) =>
							onChangement({ ...saisie, nomExpediteur: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.label')}
					<input
						data-testid="champ-libelle-identite"
						value={saisie.libelle}
						onChange={(evenement) => onChangement({ ...saisie, libelle: evenement.target.value })}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.host')}
					<input
						data-testid="champ-hote-smtp"
						value={saisie.hote}
						onChange={(evenement) => onChangement({ ...saisie, hote: evenement.target.value })}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.port')}
					{/* `type="number"` parce que c'est un nombre, JAMAIS pour borner la saisie (§5.3
					    ter, §22.5). */}
					<input
						type="number"
						data-testid="champ-port-smtp"
						value={saisie.port}
						onChange={(evenement) => onChangement({ ...saisie, port: evenement.target.value })}
						className={[CLASSES_CHAMP, 'tabular-nums w-[12ch]'].join(' ')}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.security')}
					<select
						data-testid="champ-securite-smtp"
						value={saisie.securite}
						onChange={(evenement) => onChangement({ ...saisie, securite: evenement.target.value })}
						className={CLASSES_CHAMP}
					>
						{MODES_SECURITE_SORTANTE.map((mode) => (
							<option key={mode} value={mode}>
								{t(SECURITES[mode])}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.username')}
					<input
						data-testid="champ-identifiant-smtp"
						value={saisie.identifiant}
						onChange={(evenement) =>
							onChangement({ ...saisie, identifiant: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailIdentities.field.password')}
					{/* AUCUNE VALEUR DE SUBSTITUTION : le champ est vide, et son texte d'aide dit ce
					    qu'un champ vide fait (§5.34, §22.6). */}
					<input
						type="password"
						data-testid="champ-mot-de-passe-smtp"
						autoComplete="new-password"
						value={saisie.motDePasse}
						onChange={(evenement) =>
							onChangement({ ...saisie, motDePasse: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
					{/* DEUX TEXTES D'AIDE, comme au §5.34 : « conservé » serait FAUX sur une
					    déclaration, où la base refuse par `password_required` (§22.6). */}
					<span className="text-sm text-text-3 max-w-[40ch]">
						{declaration
							? t('admin.mailIdentities.field.password.help.new')
							: t('admin.mailIdentities.field.password.help')}
					</span>
				</label>
			</div>

			{/* LA CASE EST COCHÉE SUR UNE DÉCLARATION, parce que c'est le défaut de la fonction —
			    `coalesce(p_is_default, true)`. Montrer autre chose ferait mentir le formulaire sur ce
			    que l'enregistrement va faire (§5.35). Aucune confirmation ne précède le déplacement :
			    la base rabat l'ancienne sans état intermédiaire, et le geste se refait. */}
			<label className="flex items-center gap-2 text-sm text-ink min-h-[var(--size-target)]">
				<input
					type="checkbox"
					data-testid="champ-par-defaut"
					checked={saisie.parDefaut}
					onChange={(evenement) =>
						onChangement({ ...saisie, parDefaut: evenement.target.checked })
					}
					className="size-4"
				/>
				{t('admin.mailIdentities.field.default')}
			</label>

			{refus !== null && (
				<p
					role="alert"
					data-testid="refus-identite-mail"
					className="rounded-sm bg-danger-soft text-danger-on-soft px-3 py-2 text-sm"
				>
					{t(refus)}
				</p>
			)}

			<div className="flex items-center gap-2">
				{/* JAMAIS DÉSACTIVÉ PAR L'ÉTAT DES CHAMPS (§5.34) : c'est la base qui refuse une saisie
				    incomplète, et l'écran traduit son refus. Il l'est pendant le vol. */}
				<button
					type="submit"
					data-testid="valider-identite-mail"
					disabled={enCours}
					className={CLASSES_BOUTON_PRIMAIRE}
				>
					{enCours ? t('admin.mailIdentities.saving') : t('admin.mailIdentities.save')}
				</button>
				<button
					type="button"
					data-testid="annuler-identite-mail"
					onClick={onAnnuler}
					className={CLASSES_BOUTON_SECONDAIRE}
				>
					{t('admin.mailIdentities.cancel')}
				</button>
			</div>
		</form>
	)
}
