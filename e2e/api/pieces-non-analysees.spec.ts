// @verifies CRM-143 (docs/BACKLOG.md) — tranche T4 : le repli confirmé, par une requête directe qui contourne l'interface —
//           une pièce non analysée se télécharge après la confirmation de l'appelant et pas avant, jamais pour une collègue
//           qui n'a pas confirmé ; une pièce infectée jamais ; les refus de la confirmation ; l'anonyme rien ; aucune
//           écriture directe de la confirmation ni du verdict
// @verifies docs/SPEC-pieces-jointes.md §17.3, §17.9 (ligne « API ») ; docs/SCHEMA.md « Migration `0173` » ; CLAUDE.md §10
//
// TOUT SE MESURE HORS INTERFACE, avec de vrais jetons obtenus par la route de connexion. Les objets sont RÉELLEMENT
// déposés dans le bucket par la clé de service — le dépôt est le fait du service, comme en production —, et chaque ligne
// naît de la vraie table : sa raison (`av_skip_reason`) est posée par le déclencheur de la migration `0173`, selon que
// l'objet existe ou non. Le message porteur vient du seed (docs/SPEC-seed.md §2.19) : l'administratrice et le business
// developer le voient, la lectrice non.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const MSGID_CLASSE = '<seed-inbox-classe@p2enjoy.test>'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const REFUS = [400, 401, 403, 404]

type Message = { id: string; card_id: string | null }
type Piece = { id: string; av_status: string; av_skip_reason: string | null }

async function porteur(request: APIRequestContext): Promise<Message> {
	const reponse = await request.get(
		`${URL_API}/rest/v1/mail_messages?select=id,card_id&rfc822_message_id=eq.${encodeURIComponent(MSGID_CLASSE)}`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	const [message] = (await reponse.json()) as Message[]
	expect(message, 'le message du seed').toBeDefined()
	return message!
}

const telecharger = (request: APIRequestContext, chemin: string, entetes: Record<string, string>) =>
	request.get(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, { headers: entetes })

const confirmer = (request: APIRequestContext, id: string, entetes: Record<string, string>) =>
	request.post(`${URL_API}/rest/v1/rpc/acknowledge_unscanned_attachment`, {
		headers: entetes,
		data: { p_attachment_id: id },
	})

test.describe('pièces non analysées — le repli confirmé (§17.3)', () => {
	test('la confirmation de l’appelant ouvre le téléchargement, et la sienne seule ; une infectée jamais ; chaque refus nommé', async ({
		request,
	}) => {
		const message = await porteur(request)
		const empreintes = { nonAnalysee: '1'.repeat(64), infectee: '2'.repeat(64), lourde: '3'.repeat(64), jeune: '4'.repeat(64) }
		const cheminDe = (empreinte: string) => `${WORKSPACE}/${message.id}/${empreinte}`
		const identifiants: string[] = []

		const deposer = async (empreinte: string) => {
			const depot = await request.post(`${URL_API}/storage/v1/object/mail-attachments/${cheminDe(empreinte)}`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/octet-stream' },
				data: Buffer.from(`contenu ${empreinte.slice(0, 1)}`),
			})
			expect([200, 201], await depot.text()).toContain(depot.status())
		}
		const inserer = async (empreinte: string, statut: string, recueLe?: string): Promise<Piece> => {
			const ligne = await request.post(`${URL_API}/rest/v1/mail_attachments?select=id,av_status,av_skip_reason`, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					message_id: message.id,
					card_id: message.card_id,
					filename: `piece-${empreinte.slice(0, 1)}.bin`,
					mime_type: 'application/octet-stream',
					size_bytes: 12,
					storage_path: cheminDe(empreinte),
					sha256: empreinte,
					av_status: statut,
					...(recueLe === undefined ? {} : { created_at: recueLe }),
				},
			})
			expect(ligne.status(), await ligne.text()).toBe(201)
			const [creee] = (await ligne.json()) as Piece[]
			identifiants.push(creee!.id)
			return creee!
		}

		try {
			// Une pièce reçue sans antivirus : son objet est déposé, sa raison est `scanner_unavailable`.
			await deposer(empreintes.nonAnalysee)
			const nonAnalysee = await inserer(empreintes.nonAnalysee, 'skipped')
			expect(nonAnalysee.av_skip_reason).toBe('scanner_unavailable')
			// Une infectée, déposée elle aussi : c'est l'objet qui existe et qui reste refusé.
			await deposer(empreintes.infectee)
			const infectee = await inserer(empreintes.infectee, 'infected')
			// Une trop volumineuse : aucun objet, sa raison est `too_large`.
			const lourde = await inserer(empreintes.lourde, 'skipped')
			expect(lourde.av_skip_reason).toBe('too_large')
			// Une pièce en cours d'analyse, reçue il y a une minute.
			await deposer(empreintes.jeune)
			const jeune = await inserer(empreintes.jeune, 'pending', new Date(Date.now() - 60_000).toISOString())

			const admin = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))
			const collegue = enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test'))
			const lectrice = enTetesAuthentifies(await jetonDe('viewer@p2enjoy.test'))

			// AVANT LA CONFIRMATION, la pièce non analysée est refusée — à l'objet qui EXISTE.
			const avant = await telecharger(request, cheminDe(empreintes.nonAnalysee), admin)
			expect(REFUS, `avant confirmation : ${avant.status()}`).toContain(avant.status())

			// LA CONFIRMATION, puis le téléchargement réel, son contenu étant celui déposé.
			const confirmation = await confirmer(request, nonAnalysee.id, admin)
			expect(confirmation.status(), await confirmation.text()).toBe(200)
			const date = (await confirmation.json()) as string
			expect(Number.isNaN(Date.parse(date))).toBe(false)
			const apres = await telecharger(request, cheminDe(empreintes.nonAnalysee), admin)
			expect(apres.status(), await apres.text()).toBe(200)
			expect(await apres.text()).toBe('contenu 1')

			// IDEMPOTENTE : une seconde confirmation rend la même date.
			const encore = await confirmer(request, nonAnalysee.id, admin)
			expect(encore.status()).toBe(200)
			expect(await encore.json()).toBe(date)

			// LA COLLÈGUE VOIT LE MESSAGE, MAIS N'A PAS CONFIRMÉ : refusée. La confirmation est par personne.
			const collegueRefusee = await telecharger(request, cheminDe(empreintes.nonAnalysee), collegue)
			expect(REFUS, `collègue sans confirmation : ${collegueRefusee.status()}`).toContain(collegueRefusee.status())
			// Elle ne lit pas la confirmation de l'administratrice : la table ne rend que les siennes.
			const sienne = await request.get(
				`${URL_API}/rest/v1/mail_attachment_risk_acknowledgments?select=user_id&attachment_id=eq.${nonAnalysee.id}`,
				{ headers: collegue },
			)
			expect(sienne.status()).toBe(200)
			expect(await sienne.json()).toEqual([])

			// L'INFECTÉE : la confirmation est refusée, et le téléchargement aussi, avant comme après.
			const infecteeConfirmee = await confirmer(request, infectee.id, admin)
			expect(infecteeConfirmee.ok()).toBe(false)
			expect(await infecteeConfirmee.text()).toContain('attachment_infected')
			const infecteeRefusee = await telecharger(request, cheminDe(empreintes.infectee), admin)
			expect(REFUS, `infectée : ${infecteeRefusee.status()}`).toContain(infecteeRefusee.status())

			// LA TROP VOLUMINEUSE n'a rien à télécharger ; la JEUNE est en cours d'analyse.
			const lourdeConfirmee = await confirmer(request, lourde.id, admin)
			expect(lourdeConfirmee.ok()).toBe(false)
			expect(await lourdeConfirmee.text()).toContain('attachment_not_stored')
			const jeuneConfirmee = await confirmer(request, jeune.id, admin)
			expect(jeuneConfirmee.ok()).toBe(false)
			expect(await jeuneConfirmee.text()).toContain('attachment_scanning')
			const jeuneRefusee = await telecharger(request, cheminDe(empreintes.jeune), admin)
			expect(REFUS, `jeune : ${jeuneRefusee.status()}`).toContain(jeuneRefusee.status())

			// LA LECTRICE NE VOIT PAS LE MESSAGE : la pièce n'existe pas pour elle (404, sans distinguer l'interdit).
			const lectriceConfirmee = await confirmer(request, nonAnalysee.id, lectrice)
			expect(lectriceConfirmee.status()).toBe(404)
			expect(await lectriceConfirmee.text()).toContain('attachment_not_found')

			// L'ANONYME : ni la confirmation, ni le téléchargement.
			const anonyme = await confirmer(request, nonAnalysee.id, enTetesAnonymes())
			expect(anonyme.ok()).toBe(false)
			expect([401, 403]).toContain(anonyme.status())
			const anonymeRefuse = await telecharger(request, cheminDe(empreintes.nonAnalysee), enTetesAnonymes())
			expect(REFUS).toContain(anonymeRefuse.status())

			// AUCUNE ÉCRITURE DIRECTE : ni une confirmation posée à la main, ni un verdict écrit par une session.
			const direct = await request.post(`${URL_API}/rest/v1/mail_attachment_risk_acknowledgments`, {
				headers: collegue,
				data: { attachment_id: nonAnalysee.id, user_id: '00000000-0000-0000-0000-000000000000' },
			})
			expect([401, 403], await direct.text()).toContain(direct.status())
			const verdict = await request.post(`${URL_API}/rest/v1/rpc/mail_attachment_record_scan`, {
				headers: admin,
				data: { p_attachment_id: nonAnalysee.id, p_status: 'clean' },
			})
			expect([401, 403, 404], await verdict.text()).toContain(verdict.status())
			const relue = await request.get(`${URL_API}/rest/v1/mail_attachments?select=av_status&id=eq.${nonAnalysee.id}`, {
				headers: enTetesService(),
			})
			expect(await relue.json()).toEqual([{ av_status: 'skipped' }])
		} finally {
			// LE SEED N'EST JAMAIS TOUCHÉ : le scénario retire ce qu'il a créé, par identifiant (la confirmation part en cascade).
			for (const identifiant of identifiants) {
				await request.delete(`${URL_API}/rest/v1/mail_attachments?id=eq.${identifiant}`, { headers: enTetesService() })
			}
			for (const empreinte of Object.values(empreintes)) {
				await request.delete(`${URL_API}/storage/v1/object/mail-attachments/${cheminDe(empreinte)}`, {
					headers: enTetesService(),
				})
			}
		}
	})
})
