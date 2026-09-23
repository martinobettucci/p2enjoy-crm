// @spec CRM-009 (docs/BACKLOG.md) — écran de connexion
// @spec CRM-091 (docs/BACKLOG.md) — action « Se connecter avec LeLabs »
// @spec CRM-092 (docs/BACKLOG.md) — une seule action, refus et attentes rendus sur deux surfaces
// @spec docs/SPEC-session-sso.md §4 (parcours), §9.1 (carte), §9.2 (refus et attentes)
// @spec docs/SPEC-auth.md §9.1 (navigation), §10.3 (aller), §10.5 (transaction d'onglet)
// @spec docs/DESIGN_SYSTEM.md §5.8 (états), §5.10 (commande morte interdite), §5.12 (connexion), §7, §8, §9
// @spec docs/manual.md chapitre 1 (connexion)
//
// Le composant ne connaît aucun secret et ne traduit aucun droit. Il mène l'aller vers LeLabs, puis
// rend ce que l'échangeur a décidé : un REFUS dit qu'une tentative a échoué, une ATTENTE qu'un geste
// d'autrui manque. Plus de mot de passe : le SSO est la seule source d'identité (§1).

import { CircleDashed, KeyRound, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Navigate, useLocation } from 'react-router'
import { Button } from '../components/ui/Button'
import { SkeletonListe } from '../components/ui/Skeleton'
import { t } from '../i18n'
import { cheminRetour } from '../lib/auth'
import {
	configurationSso,
	estAttente,
	lireDecouverte,
	natureDe,
	preparerRedirection,
	type ConfigurationSso,
	type NatureAttente,
	type NatureEchecSso,
} from '../lib/sso'
import { clientCrm, creerStockageSession } from '../lib/supabase'
import { useAuthentification } from './Authentification'

type CleTraduction = Parameters<typeof t>[0]

const CLE_REFUS: Readonly<Record<Exclude<NatureEchecSso, NatureAttente>, CleTraduction>> = {
	sso_annule: 'auth.sso.error.cancelled',
	sso_echec: 'auth.sso.error.failed',
	reseau: 'auth.error.network',
	session_expiree: 'auth.session.expired',
	configuration: 'auth.error.configuration',
}

const CLE_ATTENTE: Readonly<Record<NatureAttente, CleTraduction>> = {
	adresse_non_verifiee: 'auth.wait.unverifiedAddress',
	attente_verification: 'auth.wait.verification',
	attente_espace: 'auth.wait.workspace',
}

const ID_ETAT = 'etat-connexion'

type EtatRouteConnexion = { readonly retour?: unknown; readonly erreurSso?: unknown; readonly adresse?: unknown } | null

type Issue = { readonly nature: NatureEchecSso; readonly adresse: string | null }

/** Seule une nature du dictionnaire fermé est rendue ; une attente sans adresse ne l'est pas. */
function issueDepuis(etat: EtatRouteConnexion): Issue | null {
	const nature = etat?.erreurSso
	if (typeof nature !== 'string') return null
	const adresse = typeof etat?.adresse === 'string' && etat.adresse !== '' ? etat.adresse : null
	if (Object.hasOwn(CLE_REFUS, nature)) return { nature: nature as NatureEchecSso, adresse: null }
	if (Object.hasOwn(CLE_ATTENTE, nature) && adresse !== null) return { nature: nature as NatureEchecSso, adresse }
	return null
}

/** La navigation hors de l'application ; injectable pour les preuves, jsdom ne la connaissant pas. */
function quitterVers(url: string) {
	window.location.assign(url)
}

export function EcranConnexion({
	sso = configurationSso,
	apiConfiguree = clientCrm !== null,
	rediriger = quitterVers,
}: {
	readonly sso?: ConfigurationSso | null
	readonly apiConfiguree?: boolean
	readonly rediriger?: (url: string) => void
}) {
	const { etat } = useAuthentification()
	const location = useLocation()
	const etatRoute = location.state as EtatRouteConnexion
	const [enCours, setEnCours] = useState(false)
	const [issue, setIssue] = useState<Issue | null>(() => issueDepuis(etatRoute))

	if (etat.statut === 'authentifie') return <Navigate to={cheminRetour(etatRoute?.retour)} replace />

	const configuration = apiConfiguree ? sso : null
	// Sans configuration, aucune action n'est offerte et l'emplacement d'erreur le dit (§9.1) : la
	// commande morte reste interdite (docs/DESIGN_SYSTEM.md §5.10).
	const affichee: Issue | null = configuration === null ? { nature: 'configuration', adresse: null } : issue

	// Le navigateur quitte la page : la transaction doit être écrite AVANT, dans le stockage
	// d'onglet (docs/SPEC-auth.md §10.5). Seul un échec avant la redirection revient ici.
	const demarrer = async () => {
		if (configuration === null || enCours) return
		setEnCours(true)
		setIssue(null)
		try {
			const decouverte = await lireDecouverte(configuration)
			const url = await preparerRedirection({
				configuration,
				decouverte,
				origine: window.location.origin,
				retour: cheminRetour(etatRoute?.retour),
				stockage: creerStockageSession(),
			})
			rediriger(url)
		} catch (echec) {
			setIssue({ nature: natureDe(echec), adresse: null })
			setEnCours(false)
		}
	}

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

				{affichee === null ? null : <EtatConnexion issue={affichee} />}

				{configuration === null ? null : (
					<Button
						variante="primaire"
						type="button"
						disabled={enCours}
						aria-describedby={affichee === null ? undefined : ID_ETAT}
						onClick={() => void demarrer()}
						className="w-full"
					>
						<KeyRound aria-hidden="true" size={18} />
						<span>{enCours ? t('auth.sso.submitting') : t('auth.sso.submit')}</span>
					</Button>
				)}
			</section>
		</main>
	)
}

/**
 * Un refus (surface danger, `role="alert"`) ou une attente (surface accent, `role="status"`, titre
 * court) : docs/SPEC-session-sso.md §9.2, docs/DESIGN_SYSTEM.md §5.12. Aucune couleur nouvelle.
 */
function EtatConnexion({ issue }: { readonly issue: Issue }) {
	if (estAttente(issue.nature) && issue.adresse !== null) {
		return (
			<div id={ID_ETAT} role="status" className="flex items-start gap-2 rounded-sm bg-accent-soft text-accent-on-soft p-3">
				<CircleDashed aria-hidden="true" size={20} className="shrink-0" />
				<div className="flex flex-col gap-1 min-w-0">
					<p className="font-medium">{t('auth.wait.title')}</p>
					<p className="break-words">{t(CLE_ATTENTE[issue.nature], { adresse: issue.adresse })}</p>
				</div>
			</div>
		)
	}
	const cle = estAttente(issue.nature) ? CLE_REFUS.sso_echec : CLE_REFUS[issue.nature]
	return (
		<p id={ID_ETAT} role="alert" className="flex items-start gap-2 rounded-sm bg-danger-soft text-danger-on-soft p-3">
			<TriangleAlert aria-hidden="true" size={20} className="shrink-0" />
			<span>{t(cle)}</span>
		</p>
	)
}

/**
 * Forme exacte de la carte pendant la restauration de la session, et pendant l'échange du retour
 * SSO, qui en change seulement le libellé annoncé.
 */
export function ChargementAuthentification({
	cleLibelle = 'auth.loading',
}: {
	readonly cleLibelle?: CleTraduction
}) {
	return (
		<main className="min-h-dvh bg-bg px-4 py-6 flex items-start md:items-center justify-center">
			<section className="w-full max-w-[448px] bg-surface border border-border rounded-lg shadow-card p-6">
				<SkeletonListe lignes={4} libelle={t(cleLibelle)} />
			</section>
		</main>
	)
}
