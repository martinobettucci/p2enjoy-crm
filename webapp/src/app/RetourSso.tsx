// @spec CRM-091 (docs/BACKLOG.md) — route publique de retour du SSO : jugement, redirection
// @spec CRM-092 (docs/BACKLOG.md) — le code et le vérificateur sont remis à l'échangeur de session
// @spec docs/SPEC-session-sso.md §4 (points 3 à 6), §5.2 (ouvrir), §9.2 (refus et attentes)
// @spec docs/SPEC-auth.md §10.3 (points 5 et 6), §10.5 (transaction à usage unique)
// @spec docs/DESIGN_SYSTEM.md §5.8 (état de chargement sans spinner), §5.12 (carte de connexion)
// @spec docs/manual.md chapitre 1 (connexion)
//
// Cet écran n'affiche qu'un état de chargement : il consomme la transaction, juge le retour, remet
// le code et le vérificateur à l'échangeur — qui les échange avec son secret —, puis REMPLACE son
// adresse : le `code` ne reste jamais dans l'historique. Un échec ramène à `/connexion`, où le
// refus ou l'attente est rendu (§9.2).

import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { cheminRetour } from '../lib/auth'
import { consommerTransaction, jugerRetour, type NatureEchecSso, type StockageTransaction } from '../lib/sso'
import { creerStockageSession } from '../lib/supabase'
import type { t } from '../i18n'
import { useAuthentification } from './Authentification'
import { ChargementAuthentification } from './EcranConnexion'

/** Libellé annoncé pendant l'échange (docs/DESIGN_SYSTEM.md §5.12, connexion unique). */
const CLE_ECHANGE: Parameters<typeof t>[0] = 'auth.sso.returning'

export function RetourSso({ stockage }: { readonly stockage?: StockageTransaction }) {
	const { ouvrirSession } = useAuthentification()
	const location = useLocation()
	const navigate = useNavigate()
	// StrictMode rejoue l'effet en développement ; la transaction ne sert qu'UNE fois. Le drapeau
	// survit au double montage simulé, et le second passage ne fait rien.
	const lance = useRef(false)

	useEffect(() => {
		if (lance.current) return
		lance.current = true
		const recherche = location.search
		const echouer = (nature: NatureEchecSso, adresse?: string) =>
			navigate('/connexion', { replace: true, state: adresse === undefined ? { erreurSso: nature } : { erreurSso: nature, adresse } })

		void (async () => {
			const transaction = consommerTransaction(stockage ?? creerStockageSession())
			const issue = jugerRetour(recherche, transaction)
			if (!issue.ok || transaction === null) return echouer(issue.ok ? 'sso_echec' : issue.nature)
			const resultat = await ouvrirSession(issue.code, transaction.verificateur, transaction.redirectUri)
			if (!resultat.ok) return echouer(resultat.nature, resultat.adresse)
			navigate(cheminRetour(transaction.retour), { replace: true })
		})()
	}, [location.search, navigate, ouvrirSession, stockage])

	return <ChargementAuthentification cleLibelle={CLE_ECHANGE} />
}
