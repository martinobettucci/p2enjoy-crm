// @spec CRM-011 (docs/BACKLOG.md) — état de session partagé par la webapp
// @spec docs/SPEC-auth.md §9.1 (restauration avant les lectures), §9.2 (session), §9.4
// @spec docs/SPEC-webapp.md §6.2 (restauration avant les lectures métier)
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
import { classerEchecConnexion, type NatureEchecConnexion } from '../lib/auth'
import { clientCrm, type ClientCrm } from '../lib/supabase'

export type EtatAuthentification =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'anonyme' }
	| { readonly statut: 'authentifie'; readonly utilisateur: User }

export type ResultatAuthentification =
	| { readonly ok: true }
	| { readonly ok: false; readonly nature: NatureEchecConnexion }

type PromesseAuthentification = Promise<ResultatAuthentification>

export type ContexteAuthentification = {
	readonly etat: EtatAuthentification
	connecter(email: string, motDePasse: string): PromesseAuthentification
	deconnecter(): PromesseAuthentification
}

const contexteAnonyme: ContexteAuthentification = {
	etat: { statut: 'anonyme' },
	connecter: async () => ({ ok: false, nature: 'configuration' }),
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

	const deconnecter = useCallback(async function deconnecter(): Promise<ResultatAuthentification> {
		if (client === null) return { ok: true }
		const { error } = await client.auth.signOut()
		if (error !== null) return { ok: false, nature: classerEchecConnexion(error) }
		setEtat({ statut: 'anonyme' })
		return { ok: true }
	}, [client])

	const valeur = useMemo(() => ({ etat, connecter, deconnecter }), [connecter, deconnecter, etat])
	return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

export function useAuthentification(): ContexteAuthentification {
	return useContext(Contexte)
}
