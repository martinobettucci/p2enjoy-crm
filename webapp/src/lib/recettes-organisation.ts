// @spec CRM-146 (docs/BACKLOG.md) — tranche T2 : ce que la liste et la fiche des organisations lisent du prévisionnel et du
//       réel, et la part réalisée qu'elles en tirent
// @spec docs/SPEC-recettes.md §12.2 (les grandeurs, la part réalisée sans objet sur un prévu nul ou négatif, au-delà de
//       100 %, 0 % sur un réel inconnu), §12.3 (`public.organization_revenue_totals`, sous la RLS de l'appelant), §12.4 (la
//       liste), §12.5 (les mentions de la fiche) ; docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/SPEC-types.md
//       (une réponse non conforme est écartée, jamais devinée) ; CLAUDE.md §10 — ce module ne décide aucun droit
//
// Ce module ne rend rien : il lit et calcule. La base rend des SOMMES ; la part réalisée est calculée ici, jamais en base
// (§12.2), et ses règles se vérifient sans navigateur.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Le prévu et le réel d'une organisation dans une devise (§12.2). Le réel est NUL quand aucun n'est connu. */
export type TotalDevise = {
	readonly devise: string
	readonly prevu: number
	readonly reel: number | null
	readonly affaires: number
	readonly affairesPartagees: number
	readonly lignes: number
	readonly lignesSansReel: number
}

/** Les totaux par organisation, chacune avec ses devises dans l'ordre alphabétique des codes. */
export type TotauxParOrganisation = ReadonlyMap<string, readonly TotalDevise[]>

const nombreOuNul = (v: unknown): number | null => {
	if (v === null || v === undefined) return null
	const n = typeof v === 'number' ? v : Number(v)
	return Number.isFinite(n) ? n : null
}

/**
 * Convertit les lignes brutes de la fonction. Une ligne sans organisation, sans devise ou sans prévu est ÉCARTÉE et
 * comptée : c'est une réponse non conforme, qu'on ne devine pas. Les devises d'une organisation sont triées par code.
 */
export function lireLignesTotaux(brutes: readonly Record<string, unknown>[]): {
	readonly parOrganisation: TotauxParOrganisation
	readonly ecartees: number
} {
	const parOrganisation = new Map<string, TotalDevise[]>()
	let ecartees = 0
	for (const brute of brutes) {
		const organisation = brute['organization_id']
		const devise = brute['currency']
		const prevu = nombreOuNul(brute['estimated_total'])
		if (typeof organisation !== 'string' || typeof devise !== 'string' || devise === '' || prevu === null) {
			ecartees += 1
			continue
		}
		const total: TotalDevise = {
			devise,
			prevu,
			reel: nombreOuNul(brute['actual_total']),
			affaires: nombreOuNul(brute['cards']) ?? 0,
			affairesPartagees: nombreOuNul(brute['shared_cards']) ?? 0,
			lignes: nombreOuNul(brute['revenue_lines']) ?? 0,
			lignesSansReel: nombreOuNul(brute['lines_without_actual']) ?? 0,
		}
		const devises = parOrganisation.get(organisation)
		if (devises === undefined) parOrganisation.set(organisation, [total])
		else devises.push(total)
	}
	for (const devises of parOrganisation.values()) devises.sort((a, b) => (a.devise < b.devise ? -1 : a.devise > b.devise ? 1 : 0))
	return { parOrganisation, ecartees }
}

/**
 * Le prévu et le réel sous le jeton de l'appelant : toutes ses organisations (la liste, §12.4), ou une seule (la fiche,
 * §12.5). Une organisation sans recette n'a AUCUNE entrée — ni zéro, ni barre vide (décision 900).
 */
export async function lireTotauxOrganisations(
	client: ClientCrm,
	idOrganisation: string | null = null,
): Promise<EtatAsync<TotauxParOrganisation>> {
	try {
		const reponse = await client.rpc(
			'organization_revenue_totals',
			idOrganisation === null ? {} : { p_organization_id: idOrganisation },
		)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(lireLignesTotaux((reponse.data ?? []) as unknown as readonly Record<string, unknown>[]).parOrganisation)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * La part réalisée, `réel ÷ prévu` (§12.2). SANS OBJET — `null` — quand le prévu est nul ou négatif : un rapport à un tel
 * dénominateur ne dit rien de lisible. Un réel inconnu vaut 0. Elle peut dépasser 1 : ce n'est ni bon ni mauvais.
 */
export function partRealisee(prevu: number, reel: number | null): number | null {
	if (!(prevu > 0)) return null
	return (reel ?? 0) / prevu
}

/** La largeur dessinée de la barre, en pour cent : la part bornée à [0, 100] — un dépassement remplit la barre. */
export function largeurBarre(part: number): number {
	return Math.min(100, Math.max(0, part * 100))
}

/** La part en pourcentage entier, telle que la fiche l'écrit (« 78 % ») ; non bornée. */
export function pourcentageEntier(part: number): number {
	return Math.round(part * 100)
}

/**
 * Ce que disent les mentions sous le tableau de la fiche (§12.5). Une affaire n'a qu'une devise : ses comptes
 * s'additionnent donc à travers les devises sans jamais compter deux fois la même affaire. Les lignes sans réel sont
 * des LIGNES, pas de l'argent : elles traversent les devises.
 */
export function mentionsOrganisation(totaux: readonly TotalDevise[]): {
	readonly affaires: number
	readonly affairesPartagees: number
	readonly lignesSansReel: number
} {
	return totaux.reduce(
		(somme, total) => ({
			affaires: somme.affaires + total.affaires,
			affairesPartagees: somme.affairesPartagees + total.affairesPartagees,
			lignesSansReel: somme.lignesSansReel + total.lignesSansReel,
		}),
		{ affaires: 0, affairesPartagees: 0, lignesSansReel: 0 },
	)
}
