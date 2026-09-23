// @spec CRM-009 (docs/BACKLOG.md) — écran de connexion et refus générique
// @spec CRM-091 (docs/BACKLOG.md) — action « Se connecter avec LeLabs » et refus du SSO
// @spec docs/SPEC-auth.md §9.1 (navigation), §9.3 (états et erreurs), §10.3 (parcours), §10.4
// @spec docs/DESIGN_SYSTEM.md §5.7 (champs), §5.8 (états), §5.12 (connexion), §7, §8, §9
// @spec docs/manual.md chapitre 1 (connexion)
//
// Le composant ne connaît aucun secret de service et ne traduit aucun droit. Il remet l'adresse
// et le mot de passe à GoTrue par le provider, puis rend seulement la classe d'erreur assainie.

import { KeyRound, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { cheminRetour, type NatureEchecConnexion } from '../lib/auth'
import {
	configurationSso,
	lireDecouverte,
	natureDe,
	preparerRedirection,
	type ConfigurationSso,
	type NatureEchecSso,
} from '../lib/sso'
import { creerStockageSession } from '../lib/supabase'
import { useAuthentification } from './Authentification'

const CLASSES_CHAMP = [
	'w-full min-h-[var(--size-target)] rounded-sm border border-border bg-surface px-3',
	'text-base text-text placeholder:text-text-3',
	'focus:border-brand disabled:bg-hover disabled:text-text-2 disabled:cursor-not-allowed',
].join(' ')

const CLE_ERREUR: Readonly<Record<NatureEchecConnexion, Parameters<typeof t>[0]>> = {
	identifiants: 'auth.error.credentials',
	reseau: 'auth.error.network',
	configuration: 'auth.error.configuration',
}

const CLE_ERREUR_SSO: Readonly<Record<NatureEchecSso, Parameters<typeof t>[0]>> = {
	sso_annule: 'auth.sso.error.cancelled',
	sso_sans_compte: 'auth.sso.error.noAccount',
	reseau: 'auth.error.network',
	sso_echec: 'auth.sso.error.failed',
}

type SoumissionFormulaire = FormEvent<HTMLFormElement>

type EtatRouteConnexion = { readonly retour?: unknown; readonly erreurSso?: unknown } | null

/** Seule une nature du dictionnaire fermé est rendue ; toute autre valeur d'état est ignorée. */
function erreurSsoDepuis(etat: EtatRouteConnexion): NatureEchecSso | null {
	const valeur = etat?.erreurSso
	return typeof valeur === 'string' && Object.hasOwn(CLE_ERREUR_SSO, valeur) ? (valeur as NatureEchecSso) : null
}

/** La navigation hors de l'application ; injectable pour les preuves, jsdom ne la connaissant pas. */
function quitterVers(url: string) {
	window.location.assign(url)
}

export function EcranConnexion({
	sso = configurationSso,
	rediriger = quitterVers,
}: {
	readonly sso?: ConfigurationSso | null
	readonly rediriger?: (url: string) => void
}) {
	const { etat, connecter } = useAuthentification()
	const location = useLocation()
	const navigate = useNavigate()
	const emailRef = useRef<HTMLInputElement>(null)
	const connexionLancee = useRef(false)
	const [email, setEmail] = useState('')
	const [motDePasse, setMotDePasse] = useState('')
	const [enCours, setEnCours] = useState(false)
	const [erreur, setErreur] = useState<NatureEchecConnexion | null>(null)
	const [ssoEnCours, setSsoEnCours] = useState(false)
	const [erreurSso, setErreurSso] = useState<NatureEchecSso | null>(() =>
		erreurSsoDepuis(location.state as EtatRouteConnexion),
	)

	useEffect(() => {
		if (erreur === 'identifiants' && !enCours) emailRef.current?.focus()
	}, [enCours, erreur])

	if (etat.statut === 'authentifie' && !connexionLancee.current) return <Navigate to="/" replace />

	const soumettre = async (evenement: SoumissionFormulaire) => {
		evenement.preventDefault()
		if (enCours) return
		connexionLancee.current = true
		setEnCours(true)
		setErreur(null)
		setErreurSso(null)
		const resultat = await connecter(email, motDePasse)
		setEnCours(false)
		if (!resultat.ok) {
			connexionLancee.current = false
			setErreur(resultat.nature)
			return
		}
		const etatRoute = location.state as EtatRouteConnexion
		navigate(cheminRetour(etatRoute?.retour), { replace: true })
	}

	// Le navigateur quitte la page : la transaction doit être écrite AVANT, dans le stockage
	// d'onglet (docs/SPEC-auth.md §10.5). Seul un échec avant la redirection revient ici.
	const demarrerSso = async () => {
		if (sso === null || ssoEnCours || enCours) return
		setSsoEnCours(true)
		setErreur(null)
		setErreurSso(null)
		try {
			const decouverte = await lireDecouverte(sso)
			const url = await preparerRedirection({
				configuration: sso,
				decouverte,
				origine: window.location.origin,
				retour: cheminRetour((location.state as EtatRouteConnexion)?.retour),
				stockage: creerStockageSession(),
			})
			rediriger(url)
		} catch (echec) {
			setErreurSso(natureDe(echec))
			setSsoEnCours(false)
		}
	}

	const idErreur = erreur === null ? undefined : 'erreur-connexion'

	return (
		<main className="min-h-dvh bg-bg px-4 py-6 flex items-start md:items-center justify-center">
			<section
				aria-labelledby="titre-connexion"
				className="w-full max-w-[448px] bg-surface border border-border rounded-lg shadow-card p-6 flex flex-col gap-6"
			>
				<header className="flex flex-col gap-2">
					<p className="text-sm font-medium text-brand">{t('app.name')}</p>
					<h1 id="titre-connexion" className="text-h1">
						{t('auth.route.title')}
					</h1>
					<p className="text-text-2">{t('auth.intro')}</p>
				</header>

				<form onSubmit={(evenement) => void soumettre(evenement)} className="flex flex-col gap-4">
					<div className="flex flex-col gap-2">
						<label htmlFor="email-connexion" className="text-sm text-text-2">
							{t('auth.email.label')}
						</label>
						<input
							ref={emailRef}
							id="email-connexion"
							type="email"
							name="email"
							autoComplete="email"
							autoFocus
							required
							disabled={enCours}
							aria-describedby={idErreur}
							value={email}
							onChange={(evenement) => setEmail(evenement.target.value)}
							placeholder={t('auth.email.placeholder')}
							className={CLASSES_CHAMP}
						/>
					</div>

					<div className="flex flex-col gap-2">
						<label htmlFor="mot-de-passe-connexion" className="text-sm text-text-2">
							{t('auth.password.label')}
						</label>
						<input
							id="mot-de-passe-connexion"
							type="password"
							name="password"
							autoComplete="current-password"
							required
							disabled={enCours}
							aria-describedby={idErreur}
							value={motDePasse}
							onChange={(evenement) => setMotDePasse(evenement.target.value)}
							className={CLASSES_CHAMP}
						/>
					</div>

					{erreur === null ? null : (
						<p
							id="erreur-connexion"
							role="alert"
							className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3"
						>
							<TriangleAlert aria-hidden="true" size={20} className="shrink-0" />
							<span>{t(CLE_ERREUR[erreur])}</span>
						</p>
					)}

					<Button variante="primaire" type="submit" disabled={enCours || ssoEnCours} className="w-full">
						{enCours ? t('auth.submitting') : t('auth.submit')}
					</Button>
				</form>

				{sso === null ? null : (
					<div className="flex flex-col gap-4">
						<p className="flex items-center gap-3 text-sm text-text-3" aria-hidden="true">
							<span className="h-px grow bg-border" />
							<span>{t('auth.sso.separator')}</span>
							<span className="h-px grow bg-border" />
						</p>
						{erreurSso === null ? null : (
							<p
								id="erreur-connexion-sso"
								role="alert"
								className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3"
							>
								<TriangleAlert aria-hidden="true" size={20} className="shrink-0" />
								<span>{t(CLE_ERREUR_SSO[erreurSso])}</span>
							</p>
						)}
						<Button
							variante="secondaire"
							type="button"
							disabled={ssoEnCours || enCours}
							aria-describedby={erreurSso === null ? undefined : 'erreur-connexion-sso'}
							onClick={() => void demarrerSso()}
							className="w-full"
						>
							<KeyRound aria-hidden="true" size={18} />
							<span>{ssoEnCours ? t('auth.sso.submitting') : t('auth.sso.submit')}</span>
						</Button>
					</div>
				)}
			</section>
		</main>
	)
}

/**
 * Forme exacte de la carte pendant la restauration de `sessionStorage`, et pendant l'échange du
 * retour SSO (`CRM-091`), qui en change seulement le libellé annoncé.
 */
export function ChargementAuthentification({
	cleLibelle = 'auth.loading',
}: {
	readonly cleLibelle?: Parameters<typeof t>[0]
}) {
	return (
		<main className="min-h-dvh bg-bg px-4 py-6 flex items-start md:items-center justify-center">
			<section className="w-full max-w-[448px] bg-surface border border-border rounded-lg shadow-card p-6">
				<SkeletonListe lignes={4} libelle={t(cleLibelle)} />
			</section>
		</main>
	)
}
