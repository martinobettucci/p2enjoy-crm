// @spec CRM-009 (docs/BACKLOG.md) — état de session partagé par la webapp
// @spec CRM-022 (docs/BACKLOG.md) — profil courant lu une fois après restauration de session
// @spec CRM-091 (docs/BACKLOG.md) — session ouverte par l'échange d'un id_token vérifié par GoTrue
// @spec docs/SPEC-auth.md §10.1 (GoTrue seul juge), §10.6 (règle d'accès appliquée côté serveur)
// @spec docs/SPEC-auth.md §9.1 (restauration avant les lectures), §9.2 (session), §9.4
// @spec docs/SPEC-webapp.md §6.2 (restauration avant les lectures métier)
// @spec docs/SPEC-identite.md §7 (identité d'en-tête, une lecture autonome)
//
// Le provider est l'unique endroit qui écoute GoTrue. Les composants consomment un état de
// session ; ils ne relisent jamais directement le stockage et ne fabriquent aucun droit métier.

import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react'
import type { User } from '@supabase/supabase-js'
import { enChargement, pret, type EtatAsync } from '../lib/async'
import { classerEchecConnexion, type NatureEchecConnexion } from '../lib/auth'
import { lireProfilCourant, type ProfilAffiche } from '../lib/identites'
import { classerEchecGoTrue, type NatureEchecSso } from '../lib/sso'
import { clientCrm, type ClientCrm } from '../lib/supabase'

export type EtatAuthentification =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'anonyme' }
	| { readonly statut: 'authentifie'; readonly utilisateur: User }

export type ResultatAuthentification =
	| { readonly ok: true }
	| { readonly ok: false; readonly nature: NatureEchecConnexion }

type PromesseAuthentification = Promise<ResultatAuthentification>

export type ResultatAuthentificationSso =
	| { readonly ok: true }
	| { readonly ok: false; readonly nature: NatureEchecSso }

export type ContexteAuthentification = {
	readonly etat: EtatAuthentification
	readonly profilCourant: EtatAsync<ProfilAffiche | null>
	connecter(email: string, motDePasse: string): PromesseAuthentification
	/** Remet à GoTrue l'`id_token` du SSO et le nonce BRUT ; GoTrue décide seul (§10.6). */
	connecterSso(idToken: string, nonce: string): Promise<ResultatAuthentificationSso>
	deconnecter(): PromesseAuthentification
}

const contexteAnonyme: ContexteAuthentification = {
	etat: { statut: 'anonyme' },
	profilCourant: pret(null),
	connecter: async () => ({ ok: false, nature: 'configuration' }),
	connecterSso: async () => ({ ok: false, nature: 'sso_echec' }),
	deconnecter: async () => ({ ok: true }),
}

const Contexte = createContext<ContexteAuthentification>(contexteAnonyme)

export function FournisseurAuthentification({
	children,
	client = clientCrm,
}: {
	readonly children: ReactNode
	readonly client?: ClientCrm | null
}) {
	const [etat, setEtat] = useState<EtatAuthentification>(
		client === null ? { statut: 'anonyme' } : { statut: 'chargement' },
	)
	const [profilCourant, setProfilCourant] = useState<EtatAsync<ProfilAffiche | null>>(
		client === null ? pret(null) : enChargement,
	)

	useEffect(() => {
		if (client === null) {
			setEtat({ statut: 'anonyme' })
			return
		}

		let monte = true
		const { data } = client.auth.onAuthStateChange((_evenement, session) => {
			if (!monte) return
			setEtat(session === null ? { statut: 'anonyme' } : { statut: 'authentifie', utilisateur: session.user })
		})

		void client.auth.getSession().then(({ data: session, error }) => {
			if (!monte) return
			setEtat(
				error !== null || session.session === null
					? { statut: 'anonyme' }
					: { statut: 'authentifie', utilisateur: session.session.user },
			)
		})

		return () => {
			monte = false
			data.subscription.unsubscribe()
		}
	}, [client])

	const idUtilisateur = etat.statut === 'authentifie' ? etat.utilisateur.id : null

	// Le provider survit aux changements de route : dépendre de l'identifiant primitif garantit
	// une seule lecture par session, même si GoTrue émet deux objets `User` équivalents pendant la
	// restauration. Les identités des lignes métier restent embarquées dans leurs requêtes.
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

	const connecter = useCallback(
		async function connecter(email: string, motDePasse: string): Promise<ResultatAuthentification> {
			if (client === null) return { ok: false, nature: 'configuration' }
			const { data, error } = await client.auth.signInWithPassword({
				email: email.trim(),
				password: motDePasse,
			})
			if (error !== null) return { ok: false, nature: classerEchecConnexion(error) }
			setEtat({ statut: 'authentifie', utilisateur: data.user })
			return { ok: true }
		},
		[client],
	)

	// Le fournisseur `keycloak` de GoTrue vérifie la signature contre les clés publiées, l'émetteur,
	// l'audience et le nonce (M7, M8), puis applique `DISABLE_SIGNUP` : aucun compte ou une adresse
	// non vérifiée rendent `signup_disabled` (M3, M5). Rien n'est décidé ici.
	const connecterSso = useCallback(
		async function connecterSso(idToken: string, nonce: string): Promise<ResultatAuthentificationSso> {
			if (client === null) return { ok: false, nature: 'sso_echec' }
			const { data, error } = await client.auth.signInWithIdToken({ provider: 'keycloak', token: idToken, nonce })
			if (error !== null) return { ok: false, nature: classerEchecGoTrue(error) }
			setEtat({ statut: 'authentifie', utilisateur: data.user })
			return { ok: true }
		},
		[client],
	)

	const deconnecter = useCallback(async function deconnecter(): Promise<ResultatAuthentification> {
		if (client === null) return { ok: true }
		const { error } = await client.auth.signOut()
		if (error !== null) return { ok: false, nature: classerEchecConnexion(error) }
		setEtat({ statut: 'anonyme' })
		return { ok: true }
	}, [client])

	const valeur = useMemo(
		() => ({ etat, profilCourant, connecter, connecterSso, deconnecter }),
		[connecter, connecterSso, deconnecter, etat, profilCourant],
	)
	return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

export function useAuthentification(): ContexteAuthentification {
	return useContext(Contexte)
}
