// @spec CRM-091 (docs/BACKLOG.md) — route publique de retour du SSO : échange, session, redirection
// @spec docs/SPEC-auth.md §10.3 (points 5 à 9), §10.4 (refus), §10.5 (transaction à usage unique)
// @spec docs/DESIGN_SYSTEM.md §5.8 (état de chargement sans spinner), §5.12 (carte de connexion)
// @spec docs/manual.md chapitre 1 (connexion)
//
// Cet écran n'affiche qu'un état de chargement : il consomme la transaction, juge le retour,
// échange le code, remet l'`id_token` à GoTrue, puis REMPLACE son adresse — le `code` ne reste
// jamais dans l'historique. Un échec ramène à `/connexion`, où le refus est rendu (§10.4).

import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { cheminRetour } from '../lib/auth'
import {
	configurationSso,
	consommerTransaction,
	echangerCode,
	jugerRetour,
	natureDe,
	type ConfigurationSso,
	type NatureEchecSso,
	type StockageTransaction,
} from '../lib/sso'
import { creerStockageSession } from '../lib/supabase'
import type { t } from '../i18n'
import { useAuthentification } from './Authentification'
import { ChargementAuthentification } from './EcranConnexion'

/** Libellé annoncé pendant l'échange (docs/DESIGN_SYSTEM.md §5.12, connexion unique). */
const CLE_ECHANGE: Parameters<typeof t>[0] = 'auth.sso.returning'

export function RetourSso({
	sso = configurationSso,
	stockage,
}: {
	readonly sso?: ConfigurationSso | null
	readonly stockage?: StockageTransaction
}) {
	const { connecterSso } = useAuthentification()
	const location = useLocation()
	const navigate = useNavigate()
	// StrictMode rejoue l'effet en développement ; la transaction ne sert qu'UNE fois. Le drapeau
	// survit au double montage simulé, et le second passage ne fait rien.
	const lance = useRef(false)

	useEffect(() => {
		if (lance.current) return
		lance.current = true
		const recherche = location.search
		const echouer = (nature: NatureEchecSso) =>
			navigate('/connexion', { replace: true, state: { erreurSso: nature } })

		void (async () => {
			const transaction = consommerTransaction(stockage ?? creerStockageSession())
			const issue = jugerRetour(recherche, transaction)
			if (!issue.ok) return echouer(issue.nature)
			if (transaction === null || sso === null) return echouer('sso_echec')
			try {
				const idToken = await echangerCode(sso, transaction, issue.code)
				const resultat = await connecterSso(idToken, transaction.nonce)
				if (!resultat.ok) return echouer(resultat.nature)
				navigate(cheminRetour(transaction.retour), { replace: true })
			} catch (echec) {
				echouer(natureDe(echec))
			}
		})()
	}, [connecterSso, location.search, navigate, sso, stockage])

	return <ChargementAuthentification cleLibelle={CLE_ECHANGE} />
}
