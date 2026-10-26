// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3 : les gestes désignent le rattachement d'une affaire, et les preuves hors
//       interface doivent donc le connaître
// @spec docs/SPEC-rattachements.md §5 (les signatures par rattachement), §14 ; docs/SPEC-test-harness.md §4.3 (projet `api`)
//
// Pendant la bascule, une affaire n'a qu'un rattachement : les scénarios continuent de nommer l'AFFAIRE, ce qui les garde
// lisibles, et ce module donne le rattachement que le geste désigne. Il le lit avec la clé de service, qui voit tout : la
// référence d'un scénario ne doit jamais dépendre des droits de l'appelant mis à l'épreuve.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from './jetons'

/** Le rattachement le plus ancien de l'affaire — comme `app.card_first_placement` — ou `null` s'il n'en a pas. */
export async function rattachementDe(requete: APIRequestContext, idCard: string): Promise<string | null> {
	const reponse = await requete.get(
		`${URL_API}/rest/v1/card_placements?card_id=eq.${idCard}&select=id&order=created_at.asc,id.asc&limit=1`,
		{ headers: enTetesService() },
	)
	if (reponse.status() !== 200) throw new Error(`lecture du rattachement de ${idCard} : HTTP ${reponse.status()}`)
	const [ligne] = (await reponse.json()) as { id: string }[]
	return ligne?.id ?? null
}

/**
 * Le corps d'un geste par rattachement, depuis un corps qui nomme l'affaire : `card_id` devient `p_placement`. Une
 * affaire sans rattachement — un identifiant inconnu, par exemple — transmet son identifiant tel quel, que la base
 * ne trouve pas : le refus mesuré (`card_not_found`) reste celui du produit, et n'est pas fabriqué ici.
 */
export async function corpsParRattachement(
	requete: APIRequestContext,
	corps: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	if (!('card_id' in corps)) return corps
	const { card_id: idCard, ...reste } = corps
	const rattachement = typeof idCard === 'string' ? await rattachementDe(requete, idCard) : null
	return { p_placement: rattachement ?? idCard, ...reste }
}
