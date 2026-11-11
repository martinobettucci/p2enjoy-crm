// @spec CRM-136 (docs/BACKLOG.md) — tranche T2 : le relais rend `folder_names` pour une boîte entrante, rien de plus pour une
//       identité sortante (docs/SPEC-mail-subsystem.md §25.3)
// @spec CRM-127 (docs/BACKLOG.md) — tranche T3 : la fonction edge `mail-connection-test`
// @spec docs/SPEC-mail-subsystem.md §23.4 (forme, session, droit décidé par la base avec le jeton de l'appelant, relais
//       vers `mail-sync`, codes rendus, journal sans jeton ni hôte), §23.3 (les refus de la base) ;
//       docs/SPEC-edge-functions.md §2 bis (aucune fonction ne rend `204`) ; docs/JOURNAL.md décision 816
//
// Gestionnaire pur : la base, le service et le journal sont injectés. La base décide du droit AVANT tout appel au
// service ; le service fait le test et écrit lui-même le verdict en base ; la fonction ne fait que relayer, et rend le
// verdict tel que le service l'a écrit.

export const CIBLES = ['inbound', 'outbound'] as const
export type Cible = (typeof CIBLES)[number]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ce que la base répond à `authorize_mail_connection_test` (§23.3), ramené à un mot. */
export type Autorisation = 'ok' | 'not_authenticated' | 'invalid_target' | 'not_found' | 'disabled' | 'too_soon' | 'indisponible'

/** Ce que `mail-sync` répond à la route de test (§13.5, §14.4), ramené à un cas. */
export type Relais =
	| {
			readonly cas: 'verdict'
			readonly status: string
			readonly error: string | null
			readonly checked_at: string
			/** `CRM-136` (§25.3) : les dossiers sélectionnables d'une boîte entrante, quand le service les rend. */
			readonly folder_names?: readonly string[]
	  }
	| { readonly cas: 'not_found' }
	| { readonly cas: 'secret_missing' }
	| { readonly cas: 'indisponible' }

export type DependancesTest = {
	/** Avec le jeton de l'appelant : la base décide. */
	readonly autoriser: (jeton: string, cible: Cible, id: string) => Promise<Autorisation>
	/** Avec le jeton interne du service, que l'appelant ne voit jamais. */
	readonly relayer: (cible: Cible, id: string) => Promise<Relais>
	readonly journal: (ligne: Record<string, unknown>) => void
	readonly maintenant?: () => number
}

const json = (statut: number, corps: unknown) =>
	new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })

function jetonDe(requete: Request): string | null {
	const jeton = /^Bearer\s+(.+)$/i.exec(requete.headers.get('authorization') ?? '')?.[1]?.trim()
	return jeton ? jeton : null
}

async function lireDemande(requete: Request): Promise<{ cible: Cible; id: string } | null> {
	let corps: unknown
	try {
		corps = await requete.json()
	} catch {
		return null
	}
	if (typeof corps !== 'object' || corps === null) return null
	const { target, id } = corps as Record<string, unknown>
	if (typeof target !== 'string' || !(CIBLES as readonly string[]).includes(target)) return null
	if (typeof id !== 'string' || !UUID.test(id)) return null
	return { cible: target as Cible, id }
}

/** Les refus de la base, et le code HTTP que chacun rend (§23.4, point 3). */
const REFUS: Readonly<Record<Exclude<Autorisation, 'ok'>, [number, string]>> = {
	not_authenticated: [401, 'unauthorized'],
	invalid_target: [400, 'invalid_request'],
	not_found: [404, 'not_found'],
	disabled: [409, 'disabled'],
	too_soon: [429, 'too_soon'],
	indisponible: [502, 'service_unavailable'],
}

export async function traiterTestConnexion(requete: Request, dependances: DependancesTest): Promise<Response> {
	const maintenant = dependances.maintenant ?? Date.now
	const debut = maintenant()
	let cible: Cible | null = null
	const rendre = (statut: number, corps: unknown) => {
		dependances.journal({ fonction: 'mail-connection-test', target: cible, statut, duree_ms: maintenant() - debut })
		return json(statut, corps)
	}

	if (requete.method !== 'POST') return rendre(405, { error: 'method_not_allowed' })
	const jeton = jetonDe(requete)
	if (jeton === null) return rendre(401, { error: 'unauthorized' })
	const demande = await lireDemande(requete)
	if (demande === null) return rendre(400, { error: 'invalid_request' })
	cible = demande.cible

	const autorisation = await dependances.autoriser(jeton, demande.cible, demande.id)
	if (autorisation !== 'ok') {
		const [statut, erreur] = REFUS[autorisation]
		return rendre(statut, { error: erreur })
	}

	const relais = await dependances.relayer(demande.cible, demande.id)
	switch (relais.cas) {
		case 'verdict':
			// `CRM-136` (§25.3) : les dossiers d'une boîte ENTRANTE sont relayés, sous le même droit ; la réponse d'une
			// identité sortante est inchangée.
			return rendre(200, {
				status: relais.status,
				error: relais.error,
				checked_at: relais.checked_at,
				...(demande.cible === 'inbound' && relais.folder_names !== undefined ? { folder_names: relais.folder_names } : {}),
			})
		case 'not_found':
			return rendre(404, { error: 'not_found' })
		case 'secret_missing':
			return rendre(409, { error: 'secret_missing' })
		case 'indisponible':
			return rendre(502, { error: 'service_unavailable' })
	}
}
