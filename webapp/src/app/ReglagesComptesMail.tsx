// @spec CRM-088 (docs/BACKLOG.md) — écran de configuration des comptes entrants IMAP
// @spec docs/SPEC-mail-subsystem.md §21.2 (l'adresse), §21.3 (ce qu'il lit), §21.4 (le
//       formulaire), §21.5 (le mot de passe), §21.7 (les refus traduits), §21.8 (les états),
//       §21.9 (ce qu'il ne fait pas)
// @spec docs/DESIGN_SYSTEM.md §5.34 (cette surface), §5.8 (états systématiques), §5.18 (la liste
//       plate dont elle hérite), §5.23 (formulaire replié, dans le flux), §5.7 (champs)
//
// UN ÉCRAN QUI LIT ET QUI ÉCRIT, mais qui n'ouvre AUCUNE politique : la lecture est celle de
// `CRM-052` sous la RLS de `0022`, et l'écriture passe par `upsert_mail_inbound_account`, seul
// chemin d'écriture de la table. Aucun droit n'est calculé ici (§5.34) : l'écran envoie, et
// traduit le refus.

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
	compteDe,
	enregistrerCompteEntrant,
	estEtatCompteConnu,
	estModeSecuriteConnu,
	lireComptesEntrants,
	MODES_SECURITE,
	saisieDepuisCompte,
	type CompteEntrant,
	type EtatCompteEntrant,
	type IssueEnregistrement,
	type ModeSecurite,
	type SaisieCompteEntrant,
} from '../lib/mail-comptes'
import { lireWorkspaces } from '../lib/workspaces'
import { clientCrm, type ClientCrm } from '../lib/supabase'
import { useAuthentification } from './Authentification'

/** Les quatre états de `mail_inbound_accounts_statut`, chacun avec son mot et son ton (§5.34). */
const ETATS: Readonly<Record<EtatCompteEntrant, { readonly cle: CleTraduction; readonly ton: TonBadge }>> = {
	pending: { cle: 'admin.mailAccounts.status.pending', ton: 'neutre' },
	ok: { cle: 'admin.mailAccounts.status.ok', ton: 'success' },
	error: { cle: 'admin.mailAccounts.status.error', ton: 'danger' },
	disabled: { cle: 'admin.mailAccounts.status.disabled', ton: 'neutre' },
}

/** Les trois modes de sécurité, en toutes lettres — jamais une teinte (§1, §5.34). */
const SECURITES: Readonly<Record<ModeSecurite, CleTraduction>> = {
	ssl: 'admin.mailAccounts.security.ssl',
	starttls: 'admin.mailAccounts.security.starttls',
	none: 'admin.mailAccounts.security.none',
}

/** Le dictionnaire fermé des issues du §21.7 — aucune phrase du serveur n'atteint l'écran. */
const REFUS: Readonly<Record<Exclude<IssueEnregistrement, 'enregistre'>, CleTraduction>> = {
	refus: 'admin.mailAccounts.refusal.forbidden',
	'session-expiree': 'admin.mailAccounts.refusal.session',
	'mot-de-passe-requis': 'admin.mailAccounts.refusal.passwordRequired',
	'libelle-invalide': 'admin.mailAccounts.refusal.label',
	'hote-invalide': 'admin.mailAccounts.refusal.host',
	'port-invalide': 'admin.mailAccounts.refusal.port',
	'securite-invalide': 'admin.mailAccounts.refusal.security',
	'identifiant-invalide': 'admin.mailAccounts.refusal.username',
	'proprietaire-non-membre': 'admin.mailAccounts.refusal.owner',
	reseau: 'admin.mailAccounts.refusal.network',
	inconnu: 'admin.mailAccounts.refusal.unknown',
}

/**
 * La valeur du sélecteur de boîte visée.
 *
 * `systeme` désigne `owner_id IS NULL`, que la fonction reçoit en omettant `p_owner_id` (§21.4).
 * Toute autre valeur est un identifiant de profil.
 */
const VALEUR_SYSTEME = 'systeme'

type Cible = {
	readonly valeur: string
	readonly libelle: string
	readonly idProprietaire: string | null
}

/**
 * Les boîtes que le formulaire peut viser : celles que l'appelant VOIT, plus celles qu'il peut
 * créer.
 *
 * Une boîte visible est nommée par son `label`, qui est une **donnée** et non une traduction
 * (`docs/DESIGN_SYSTEM.md` §10) ; une boîte qui n'existe pas encore est nommée par une clé, faute
 * de donnée à afficher. L'écran ne calcule aucun droit en construisant cette liste : la boîte
 * système y figure pour tout le monde, et c'est la base qui refuse (§21.4).
 */
export function ciblesPossibles(
	comptes: readonly CompteEntrant[],
	idSession: string | null,
): readonly Cible[] {
	const cibles: Cible[] = comptes.map((compte) => ({
		valeur: compte.owner_id ?? VALEUR_SYSTEME,
		libelle: compte.label,
		idProprietaire: compte.owner_id,
	}))
	if (!comptes.some((compte) => compte.owner_id === null)) {
		cibles.push({
			valeur: VALEUR_SYSTEME,
			libelle: t('admin.mailAccounts.target.system'),
			idProprietaire: null,
		})
	}
	if (idSession !== null && !comptes.some((compte) => compte.owner_id === idSession)) {
		cibles.push({
			valeur: idSession,
			libelle: t('admin.mailAccounts.target.mine'),
			idProprietaire: idSession,
		})
	}
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

export type ProprietesReglagesComptesMail = {
	readonly client?: ClientCrm | null
	/**
	 * Identifiant de session, injectable pour les preuves.
	 *
	 * Hors preuve, il vient du contexte d'authentification — la même source que `FormulaireEnvoi`.
	 * Un appelant anonyme n'atteint pas cet écran, mais la valeur `null` reste traitée : elle retire
	 * simplement l'option « Ma boîte personnelle », faute de savoir qui la posséderait.
	 */
	readonly idUtilisateur?: string | null
}

export function ReglagesComptesMail({
	client = clientCrm,
	idUtilisateur,
}: ProprietesReglagesComptesMail = {}) {
	const authentification = useAuthentification()
	const idSession =
		idUtilisateur ??
		(authentification.etat.statut === 'authentifie' ? authentification.etat.utilisateur.id : null)

	const [idWorkspace, setIdWorkspace] = useState<string | null>(null)
	const [etat, setEtat] = useState<EtatAsync<readonly CompteEntrant[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const [saisie, setSaisie] = useState<SaisieCompteEntrant | null>(null)
	const [refus, setRefus] = useState<CleTraduction | null>(null)
	const [enCours, setEnCours] = useState(false)
	const [annonce, setAnnonce] = useState('')
	// Une réponse arrivée après le démontage, ou périmée par un rechargement, ne doit pas écraser un
	// état plus récent — même garde que les cinq autres surfaces de réglages.
	const courant = useRef(0)
	/** La commande qui a ouvert le formulaire, pour lui rendre le focus (§5.13). */
	const origineFocus = useRef<HTMLButtonElement | null>(null)
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
			const lus = await lireComptesEntrants(client)
			if (rang !== courant.current) return
			setEtat(lus.statut === 'pret' ? pret(lus.donnees) : lus)
		})()
	}, [client, tentative])

	useEffect(() => {
		if (saisie !== null || !focusARendre.current) return
		focusARendre.current = false
		origineFocus.current?.focus()
	}, [saisie])

	const recharger = useCallback(() => setTentative((precedente) => precedente + 1), [])

	const comptes = etat.statut === 'pret' ? etat.donnees : []

	const ouvrir = useCallback(
		(idProprietaire: string | null, depuis: HTMLButtonElement | null) => {
			if (idWorkspace === null) return
			origineFocus.current = depuis
			setRefus(null)
			setSaisie(saisieDepuisCompte(idWorkspace, idProprietaire, compteDe(comptes, idProprietaire)))
		},
		[comptes, idWorkspace],
	)

	const fermer = useCallback(() => {
		focusARendre.current = true
		setRefus(null)
		setSaisie(null)
	}, [])

	const viser = useCallback(
		(valeur: string) => {
			if (idWorkspace === null) return
			const idProprietaire = valeur === VALEUR_SYSTEME ? null : valeur
			setRefus(null)
			setSaisie(saisieDepuisCompte(idWorkspace, idProprietaire, compteDe(comptes, idProprietaire)))
		},
		[comptes, idWorkspace],
	)

	const enregistrer = useCallback(async () => {
		if (client === null || saisie === null || enCours) return
		setEnCours(true)
		setRefus(null)
		const resultat = await enregistrerCompteEntrant(client, saisie)
		setEnCours(false)
		if (resultat.issue !== 'enregistre') {
			// Un refus n'efface pas la saisie et laisse le formulaire ouvert (§5.7 ter, §21.7).
			setRefus(REFUS[resultat.issue])
			return
		}
		setSaisie(null)
		focusARendre.current = true
		setAnnonce(t('admin.mailAccounts.saved'))
		// La liste est RELUE, jamais complétée localement (§5.21, §21.8) : la base a pu remettre
		// l'état à `pending` et effacer le dernier incident, ce que la saisie ne sait pas.
		recharger()
	}, [client, enCours, recharger, saisie])

	if (client === null) {
		return (
			<EtatVide
				titre={t('admin.mailAccounts.noWorkspace.title')}
				corps={t('admin.mailAccounts.noWorkspace.body')}
			/>
		)
	}

	if (etat.statut === 'chargement') {
		return <SkeletonListe lignes={4} libelle={t('state.loading.aria')} />
	}

	if (etat.statut === 'erreur') {
		return (
			<EtatErreur
				titre={t('admin.mailAccounts.error.title')}
				corps={t('admin.mailAccounts.error.body')}
				libelleReprise={t('admin.mailAccounts.error.retry')}
				onReprise={recharger}
			/>
		)
	}

	const cibles = ciblesPossibles(comptes, idSession)

	return (
		// LA BORNE EST À `104ch`, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE (`CLAUDE.md`
		// §16). Écrite d'abord à `72ch` — la largeur d'une colonne de prose —, la ligne d'une boîte
		// personnelle se repliait DÈS 1440 px et sa commande passait seule à la ligne suivante,
		// alors que celle de la boîte système tenait : deux lignes voisines n'avaient plus la même
		// hauteur sans qu'aucune donnée ne le justifie. Une ligne porte ici six éléments, dont
		// trois données techniques ; sa borne est celle de son contenu, pas celle d'un paragraphe.
		<section aria-label={t('admin.mailAccounts.aria')} className="flex flex-col gap-4 max-w-[104ch]">
			<LiveRegion libelle={t('admin.mailAccounts.live.aria')} message={annonce} />

			{comptes.length === 0 ? (
				// L'état vide PORTE le geste — §5.13, §21.8 : c'est lui qui le comble, et c'est
				// l'écart assumé avec l'écran d'état (§5.14), qui n'agit pas.
				<EtatVide
					titre={t('admin.mailAccounts.empty.title')}
					corps={t('admin.mailAccounts.empty.body')}
					action={
						saisie === null ? (
							<button
								type="button"
								data-testid="ouvrir-configuration"
								onClick={(evenement) => ouvrir(idSession, evenement.currentTarget)}
								className={CLASSES_BOUTON_PRIMAIRE}
							>
								<Plus aria-hidden="true" className="size-4" />
								{t('admin.mailAccounts.open')}
							</button>
						) : undefined
					}
				/>
			) : (
				<ul
					data-testid="liste-comptes-mail"
					className="flex flex-col rounded-lg border border-border bg-surface"
				>
					{comptes.map((compte) => (
						<LigneCompte
							key={compte.id}
							compte={compte}
							enCours={enCours}
							onConfigurer={(depuis) => ouvrir(compte.owner_id, depuis)}
						/>
					))}
				</ul>
			)}

			{saisie === null ? (
				comptes.length > 0 && (
					<div>
						<button
							type="button"
							data-testid="ouvrir-configuration"
							onClick={(evenement) => ouvrir(idSession, evenement.currentTarget)}
							className={CLASSES_BOUTON_PRIMAIRE}
						>
							<Plus aria-hidden="true" className="size-4" />
							{t('admin.mailAccounts.open')}
						</button>
					</div>
				)
			) : (
				<FormulaireCompte
					saisie={saisie}
					cibles={cibles}
					creation={compteDe(comptes, saisie.idProprietaire) === undefined}
					enCours={enCours}
					refus={refus}
					onCible={viser}
					onChangement={setSaisie}
					onAnnuler={fermer}
					onValider={() => void enregistrer()}
				/>
			)}
		</section>
	)
}

/**
 * Une ligne de la liste plate du §5.34.
 *
 * La connexion et l'identifiant sont des **données techniques** (§2) : monospace, chiffres
 * tabulaires. Le mode de sécurité est un mot, jamais une teinte.
 */
function LigneCompte({
	compte,
	enCours,
	onConfigurer,
}: {
	readonly compte: CompteEntrant
	readonly enCours: boolean
	readonly onConfigurer: (depuis: HTMLButtonElement | null) => void
}) {
	return (
		<li
			data-testid="ligne-compte-configuration"
			data-compte={compte.id}
			className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border last:border-b-0 hover:bg-hover"
		>
			<span className="font-medium truncate max-w-[32ch]" title={compte.label}>
				{compte.label}
			</span>
			<code data-testid="connexion-compte" className="text-sm text-text-2 tabular-nums">
				{compte.imap_host}:{compte.imap_port}
			</code>
			<span className="text-sm text-text-2">
				{estModeSecuriteConnu(compte.imap_security)
					? t(SECURITES[compte.imap_security])
					: compte.imap_security}
			</span>
			<code className="text-sm text-text-2 truncate max-w-[28ch]" title={compte.imap_username}>
				{compte.imap_username}
			</code>
			{/* Un cinquième état serait un défaut de la contrainte : la pilule est alors ABSENTE,
			    jamais remplie du code brut (§5.34, règle du §5.14). */}
			{estEtatCompteConnu(compte.status) && (
				<Badge ton={ETATS[compte.status].ton}>{t(ETATS[compte.status].cle)}</Badge>
			)}
			<span className="grow" />
			<button
				type="button"
				data-testid="configurer-compte"
				disabled={enCours}
				onClick={(evenement) => onConfigurer(evenement.currentTarget)}
				aria-label={t('admin.mailAccounts.configure.aria', { boite: compte.label })}
				className={CLASSES_BOUTON_DISCRET}
			>
				<PencilLine aria-hidden="true" className="size-4" />
				{t('admin.mailAccounts.configure')}
			</button>
		</li>
	)
}

/**
 * Le formulaire, création et modification confondues — c'est la forme de la fonction, qui est un
 * `upsert` sur le couple `(workspace_id, owner_id)` (§21.4).
 *
 * UNE SEULE COMMANDE D'ENREGISTREMENT, et l'écart avec le §5.7 ter est motivé au §5.34 : la
 * fonction réécrit la ligne entière, si bien qu'un champ qui s'enregistrerait seul renverrait
 * quand même les cinq autres.
 */
function FormulaireCompte({
	saisie,
	cibles,
	creation,
	enCours,
	refus,
	onCible,
	onChangement,
	onAnnuler,
	onValider,
}: {
	readonly saisie: SaisieCompteEntrant
	readonly cibles: readonly Cible[]
	/** La boîte visée n'existe pas encore : le mot de passe est alors EXIGÉ, et le dire change. */
	readonly creation: boolean
	readonly enCours: boolean
	readonly refus: CleTraduction | null
	readonly onCible: (valeur: string) => void
	readonly onChangement: (saisie: SaisieCompteEntrant) => void
	readonly onAnnuler: () => void
	readonly onValider: () => void
}) {
	const premier = useRef<HTMLSelectElement | null>(null)
	// Ouvrir un formulaire déplace le focus dans son premier champ (§5.13).
	useEffect(() => {
		premier.current?.focus()
	}, [])

	const valeurCible = saisie.idProprietaire ?? VALEUR_SYSTEME

	return (
		<form
			data-testid="formulaire-compte-mail"
			className="flex flex-col gap-3 rounded-lg border border-border bg-bg p-3"
			onSubmit={(evenement) => {
				evenement.preventDefault()
				onValider()
			}}
		>
			<h3 className="text-h3">{t('admin.mailAccounts.form.title')}</h3>

			<div className="flex flex-wrap gap-3">
				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailAccounts.field.target')}
					<select
						ref={premier}
						data-testid="champ-boite"
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
					{t('admin.mailAccounts.field.label')}
					<input
						data-testid="champ-libelle-compte"
						value={saisie.libelle}
						onChange={(evenement) => onChangement({ ...saisie, libelle: evenement.target.value })}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailAccounts.field.host')}
					<input
						data-testid="champ-hote"
						value={saisie.hote}
						onChange={(evenement) => onChangement({ ...saisie, hote: evenement.target.value })}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailAccounts.field.port')}
					{/* `type="number"` parce que c'est un nombre, JAMAIS pour borner la saisie : aucune
					    garde de saisie ne double une contrainte de la base (§5.3 ter, §21.4). */}
					<input
						type="number"
						data-testid="champ-port"
						value={saisie.port}
						onChange={(evenement) => onChangement({ ...saisie, port: evenement.target.value })}
						className={[CLASSES_CHAMP, 'tabular-nums w-[12ch]'].join(' ')}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailAccounts.field.security')}
					<select
						data-testid="champ-securite"
						value={saisie.securite}
						onChange={(evenement) => onChangement({ ...saisie, securite: evenement.target.value })}
						className={CLASSES_CHAMP}
					>
						{MODES_SECURITE.map((mode) => (
							<option key={mode} value={mode}>
								{t(SECURITES[mode])}
							</option>
						))}
					</select>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailAccounts.field.username')}
					<input
						data-testid="champ-identifiant"
						value={saisie.identifiant}
						onChange={(evenement) =>
							onChangement({ ...saisie, identifiant: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
				</label>

				<label className="flex flex-col gap-1 text-sm text-text-2">
					{t('admin.mailAccounts.field.password')}
					{/* AUCUNE VALEUR DE SUBSTITUTION : le champ est vide, et son texte d'aide dit ce
					    qu'un champ vide fait (§5.34, §21.5). */}
					<input
						type="password"
						data-testid="champ-mot-de-passe"
						autoComplete="new-password"
						value={saisie.motDePasse}
						onChange={(evenement) =>
							onChangement({ ...saisie, motDePasse: evenement.target.value })
						}
						className={CLASSES_CHAMP}
					/>
					{/* DEUX TEXTES D'AIDE, ET C'EST UN DÉFAUT TROUVÉ EN REGARDANT UNE CAPTURE
					    (`CLAUDE.md` §16). « Laissé vide, le mot de passe enregistré est conservé »
					    est FAUX sur une création : il n'y a rien d'enregistré, et la base refuse par
					    `password_required` (§21.5). Une phrase qui promet une conservation
					    inexistante est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.
					    Ce n'est PAS une garde de saisie : le champ reste envoyable vide, et c'est
					    toujours la base qui tranche. */}
					<span className="text-sm text-text-3 max-w-[40ch]">
						{creation
							? t('admin.mailAccounts.field.password.help.new')
							: t('admin.mailAccounts.field.password.help')}
					</span>
				</label>
			</div>

			{refus !== null && (
				<p
					role="alert"
					data-testid="refus-compte-mail"
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
					data-testid="valider-compte-mail"
					disabled={enCours}
					className={CLASSES_BOUTON_PRIMAIRE}
				>
					{enCours ? t('admin.mailAccounts.saving') : t('admin.mailAccounts.save')}
				</button>
				<button
					type="button"
					data-testid="annuler-compte-mail"
					onClick={onAnnuler}
					className={CLASSES_BOUTON_SECONDAIRE}
				>
					{t('admin.mailAccounts.cancel')}
				</button>
			</div>
		</form>
	)
}
