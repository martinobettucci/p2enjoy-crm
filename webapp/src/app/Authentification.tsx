// @spec CRM-009 (docs/BACKLOG.md) — état de session partagé par la webapp
// @spec CRM-022 (docs/BACKLOG.md) — profil courant lu une fois après restauration de session
// @spec CRM-092 (docs/BACKLOG.md) — session ouverte, prolongée et fermée par l'échangeur de session
// @spec docs/SPEC-session-sso.md §4 (parcours), §5.1 (gestes), §8.3 (jeton en mémoire), §8.4
//       (restauration, rafraîchissement 60 s avant l'échéance, fin de session, K18), §8.5 (déconnexion)
// @spec docs/SPEC-auth.md §9.1 (restauration avant les lectures) ; docs/SPEC-webapp.md §6.2
// @spec docs/SPEC-identite.md §7 (identité d'en-tête, une lecture autonome)
// @spec docs/JOURNAL.md décision 586 (client serveur)
// @spec CLAUDE.md §10 (le serveur décide), §11 (aucun jeton écrit sur l'appareil)
//
// Le provider est l'unique endroit qui parle à l'échangeur. Les composants consomment un état de
// session ; ils ne voient jamais le jeton et ne fabriquent aucun droit métier. Le jeton interne vit
// dans le porteur en mémoire que lit le client Supabase ; la poignée vit dans un cookie `httpOnly`
// qu'aucun script ne lit. Rien d'autre n'est gardé.

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from 'react'
import { enChargement, pret, type EtatAsync } from '../lib/async'
import { lireProfilCourant, type ProfilAffiche } from '../lib/identites'
import { creerEchangeur, type Echangeur, type IdentiteSession, type SessionInterne } from '../lib/session'
import type { NatureEchecSso } from '../lib/sso'
import { cleAnonymeCrm, clientCrm, porteurJeton, type ClientCrm, type PorteurJeton } from '../lib/supabase'

/** L'identité de la session : `id` est le `sub` LeLabs, `email` l'adresse rendue par l'échangeur. */
export type UtilisateurSession = IdentiteSession

export type EtatAuthentification =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'anonyme' }
	| { readonly statut: 'authentifie'; readonly utilisateur: UtilisateurSession }

/** Un échec nommé par le dictionnaire du §9.2 ; l'adresse n'accompagne que les trois attentes. */
export type EchecSession = { readonly nature: NatureEchecSso; readonly adresse?: string }

export type ResultatOuverture = { readonly ok: true } | ({ readonly ok: false } & EchecSession)

export type ResultatDeconnexion = { readonly ok: true } | { readonly ok: false; readonly nature: 'reseau' }

export type ContexteAuthentification = {
	readonly etat: EtatAuthentification
	readonly profilCourant: EtatAsync<ProfilAffiche | null>
	/** Pourquoi la dernière session a pris fin sans geste de la personne ; `null` sinon (§8.4). */
	readonly fin: EchecSession | null
	/** L'écran de connexion a rendu `fin` : il ne sera plus rendu. */
	acquitterFin(): void
	/** Remet à l'échangeur le code et le vérificateur du retour LeLabs ; l'échangeur décide seul. */
	ouvrirSession(code: string, verificateur: string, redirectUri: string): Promise<ResultatOuverture>
	deconnecter(): Promise<ResultatDeconnexion>
}

/**
 * Le rafraîchissement part 60 s avant l'échéance du jeton interne (§8.4). L'échéance est comptée à
 * partir de la RÉCEPTION du jeton, sur sa durée de vie : l'horloge du poste peut différer de celle du
 * serveur, et seule la durée est commune aux deux.
 */
export const AVANCE_RAFRAICHISSEMENT_MS = 60_000
/** Une panne réseau pendant la session est réessayée à ce rythme, jusqu'à l'échéance (§8.4). */
export const DELAI_NOUVEL_ESSAI_MS = 10_000
/**
 * Plancher entre deux prolongations. LeLabs rend des jetons de 300 s (K3) ; un jeton rendu à moins
 * de 60 s de son échéance ne doit pas pour autant faire boucler la page sur l'échangeur.
 */
export const INTERVALLE_MIN_PROLONGATION_MS = 5_000

const contexteAnonyme: ContexteAuthentification = {
	etat: { statut: 'anonyme' },
	profilCourant: pret(null),
	fin: null,
	acquitterFin: () => undefined,
	ouvrirSession: async () => ({ ok: false, nature: 'configuration' }),
	deconnecter: async () => ({ ok: true }),
}

const Contexte = createContext<ContexteAuthentification>(contexteAnonyme)

let echangeurDuDeploiement: Echangeur | null | undefined

/** L'échangeur de ce déploiement, créé au premier montage du fournisseur et non à l'import du module. */
function echangeurCrm(): Echangeur | null {
	if (echangeurDuDeploiement === undefined) {
		echangeurDuDeploiement = cleAnonymeCrm === null ? null : creerEchangeur({ cleAnonyme: cleAnonymeCrm })
	}
	return echangeurDuDeploiement
}

export function FournisseurAuthentification({
	children,
	client = clientCrm,
	porteur = porteurJeton,
	echangeur = echangeurCrm(),
	maintenant = Date.now,
}: {
	readonly children: ReactNode
	readonly client?: ClientCrm | null
	readonly porteur?: PorteurJeton
	readonly echangeur?: Echangeur | null
	readonly maintenant?: () => number
}) {
	const configure = client !== null && echangeur !== null
	const [etat, setEtat] = useState<EtatAuthentification>(configure ? { statut: 'chargement' } : { statut: 'anonyme' })
	const [profilCourant, setProfilCourant] = useState<EtatAsync<ProfilAffiche | null>>(configure ? enChargement : pret(null))
	const [fin, setFin] = useState<EchecSession | null>(null)
	const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null)
	const monte = useRef(true)
	// Le rafraîchissement et la fermeture se servent de la même fonction : un seul geste à la fois,
	// et une session fermée entre-temps n'est jamais ressuscitée par un rafraîchissement en vol.
	const generation = useRef(0)
	// La restauration du chargement ne s'applique que si rien n'a été décidé entre-temps : une
	// ouverture menée pendant qu'elle est en vol l'emporte sur elle.
	const decisionPrise = useRef(false)

	const annulerMinuterie = useCallback(() => {
		if (minuterie.current !== null) clearTimeout(minuterie.current)
		minuterie.current = null
	}, [])

	/**
	 * Pose le jeton sur le porteur ET l'attend sur Realtime avant de déclarer la session (K18) : un
	 * abonnement lancé avant rejoindrait le canal en anonyme. `setAuth()` sans argument relit le
	 * porteur par le rappel `accessToken`, qui reste l'unique source des battements suivants.
	 */
	const poserJeton = useCallback(
		async (jeton: string | null) => {
			porteur.poser(jeton)
			if (client !== null) await client.realtime.setAuth()
		},
		[client, porteur],
	)

	const terminer = useCallback(
		async (echec: EchecSession | null) => {
			decisionPrise.current = true
			generation.current += 1
			annulerMinuterie()
			await poserJeton(null)
			if (!monte.current) return
			setEtat({ statut: 'anonyme' })
			setFin(echec)
		},
		[annulerMinuterie, poserJeton],
	)

	// Déclaration circulaire : l'installation d'une session programme son rafraîchissement, qui
	// réinstalle la session suivante. La référence brise le cycle sans recréer les rappels.
	const programmer = useRef<(session: SessionInterne) => void>(() => undefined)

	const installer = useCallback(
		async (session: SessionInterne) => {
			decisionPrise.current = true
			await poserJeton(session.jeton)
			if (!monte.current) return
			setFin(null)
			setEtat((precedent) =>
				precedent.statut === 'authentifie' &&
				precedent.utilisateur.id === session.identite.id &&
				precedent.utilisateur.email === session.identite.email &&
				precedent.utilisateur.nom === session.identite.nom
					? precedent
					: { statut: 'authentifie', utilisateur: session.identite },
			)
			programmer.current(session)
		},
		[poserJeton],
	)

	useEffect(() => {
		programmer.current = (session: SessionInterne) => {
			annulerMinuterie()
			if (echangeur === null) return
			const generationSession = generation.current
			const echeanceMs = maintenant() + session.dureeS * 1000
			const essayer = async () => {
				minuterie.current = null
				const issue = await echangeur.prolonger()
				if (generationSession !== generation.current || !monte.current) return
				if (issue.ok) return installer(issue.session)
				if (issue.nature === 'reseau') {
					// Réessayée jusqu'à l'échéance du jeton, puis la session prend fin avec le message réseau.
					const reste = echeanceMs - maintenant()
					if (reste <= 0) return terminer({ nature: 'reseau' })
					minuterie.current = setTimeout(() => void essayer(), Math.min(DELAI_NOUVEL_ESSAI_MS, reste))
					return
				}
				// Une poignée qui ne désigne plus rien pendant la session : elle a été fermée ailleurs.
				const nature = issue.nature === 'session_absente' ? 'session_expiree' : issue.nature
				return terminer(issue.adresse === undefined ? { nature } : { nature, adresse: issue.adresse })
			}
			const delai = Math.max(INTERVALLE_MIN_PROLONGATION_MS, echeanceMs - AVANCE_RAFRAICHISSEMENT_MS - maintenant())
			minuterie.current = setTimeout(() => void essayer(), delai)
		}
	}, [annulerMinuterie, echangeur, installer, maintenant, terminer])

	// Restauration au chargement, avant tout montage métier (§8.4) : un cookie valide rend la session
	// sans aucun geste de la personne ; `session_absente` rend l'état anonyme, sans message.
	useEffect(() => {
		monte.current = true
		if (!configure || echangeur === null) {
			setEtat({ statut: 'anonyme' })
			return
		}
		const generationInitiale = generation.current
		void echangeur.prolonger().then(async (issue) => {
			if (!monte.current || generationInitiale !== generation.current || decisionPrise.current) return
			if (issue.ok) return installer(issue.session)
			if (issue.nature === 'session_absente') return terminer(null)
			return terminer(issue.adresse === undefined ? { nature: issue.nature } : { nature: issue.nature, adresse: issue.adresse })
		})
		return () => {
			monte.current = false
			generation.current += 1
			annulerMinuterie()
		}
	}, [annulerMinuterie, configure, echangeur, installer, terminer])

	const idUtilisateur = etat.statut === 'authentifie' ? etat.utilisateur.id : null

	// Le provider survit aux changements de route : dépendre de l'identifiant primitif garantit
	// une seule lecture par session, même si chaque prolongation rend un objet d'identité neuf.
	useEffect(() => {
		if (client === null || idUtilisateur === null) {
			setProfilCourant(pret(null))
			return
		}
		let vivant = true
		setProfilCourant(enChargement)
		void lireProfilCourant(client, idUtilisateur).then((resultat) => {
			if (vivant) setProfilCourant(resultat)
		})
		return () => {
			vivant = false
		}
	}, [client, idUtilisateur])

	const ouvrirSession = useCallback(
		async function ouvrirSession(code: string, verificateur: string, redirectUri: string): Promise<ResultatOuverture> {
			if (!configure || echangeur === null) return { ok: false, nature: 'configuration' }
			generation.current += 1
			annulerMinuterie()
			const issue = await echangeur.ouvrir(code, verificateur, redirectUri)
			if (!issue.ok) {
				// Aucune session ne s'ouvre : l'échec est rendu par l'appelant, et `session_absente` ne
				// peut pas naître d'une ouverture — il reste un échec de connexion.
				const nature = issue.nature === 'session_absente' ? 'sso_echec' : issue.nature
				return issue.adresse === undefined ? { ok: false, nature } : { ok: false, nature, adresse: issue.adresse }
			}
			await installer(issue.session)
			return { ok: true }
		},
		[annulerMinuterie, configure, echangeur, installer],
	)

	// « Se déconnecter » ferme la session serveur et oublie le jeton ; rien n'est révoqué chez LeLabs
	// (§8.5). Une fermeture en échec est dite, et la session reste ouverte : rien n'est simulé.
	const deconnecter = useCallback(
		async function deconnecter(): Promise<ResultatDeconnexion> {
			if (echangeur === null) return { ok: true }
			const issue = await echangeur.fermer()
			if (!issue.ok) return issue
			await terminer(null)
			return { ok: true }
		},
		[echangeur, terminer],
	)

	const acquitterFin = useCallback(() => setFin(null), [])

	const valeur = useMemo(
		() => ({ etat, profilCourant, fin, acquitterFin, ouvrirSession, deconnecter }),
		[acquitterFin, deconnecter, etat, fin, ouvrirSession, profilCourant],
	)
	return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

export function useAuthentification(): ContexteAuthentification {
	return useContext(Contexte)
}
