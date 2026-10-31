// @verifies CRM-074 (docs/BACKLOG.md) — tranche T2 : l'extraction du texte des pièces jointes de bout en bout, par le vrai
//           service `mail-sync` — la route interne puis la boucle de trente secondes ; de vrais fichiers déposés au vrai
//           stockage, lus sous la clé de service, extraits dans le processus enfant, rendus à la base
// @verifies docs/SPEC-pieces-jointes.md §3, §4.1, §4.2, §4.3, §13 ; docs/JOURNAL.md décisions 788 et 789
//
// Les fichiers sont ceux du seed (`supabase/seed/pieces-jointes/`), posés sur le message envoyé qui porte
// `proposition-monitoring.txt`. Les lignes de la preuve commencent par `tst-crm074` ; lignes et objets sont retirés à la fin.
// La boucle du service tourne pendant la preuve : la route et elle prennent par la base, sous bail, et l'état final est
// le même quel que soit celui des deux qui traite une pièce — la preuve lit donc l'état final, jamais les comptes de la
// route.

// @spec CRM-115 (docs/BACKLOG.md) T2, docs/SPEC-pile-par-session.md §6 : le conteneur se désigne par son service.
import { conteneur } from '../conteneur'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { lireEnv, urlApi } from '../env'
import { enTetesService } from '../api/jetons'

const CONTENEUR = conteneur('mail-sync')
const IMAGE = 'python:3.13.13-slim-bookworm'
const JETON = lireEnv('MAIL_SYNC_INTERNAL_TOKEN')
const URL_API = urlApi()
const REST = `${URL_API}/rest/v1`
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PIECES = join(import.meta.dirname, '..', '..', 'supabase', 'seed', 'pieces-jointes')

function docker(...arguments_: string[]): string {
	return execFileSync('docker', arguments_, { encoding: 'utf8', timeout: 300_000 }).trim()
}

let reseauMemo: string | undefined
function reseau(): string {
	reseauMemo ??= docker('inspect', CONTENEUR, '--format', '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
	return reseauMemo
}

function extraireParLaRoute(): Record<string, number> {
	const sortie = docker(
		'run', '--rm', '--network', reseau(), '-e', `JETON=${JETON}`, IMAGE, 'python', '-c',
		`
import os, urllib.error, urllib.request
r = urllib.request.Request("http://mail-sync:8080/internal/v1/attachments/extract?limit=50", data=b"", method="POST")
r.add_header("Authorization", "Bearer " + os.environ["JETON"])
try:
    with urllib.request.urlopen(r, timeout=180) as s:
        print(s.read().decode(), end="")
except urllib.error.HTTPError as e:
    print('{"http": %d}' % e.code, end="")
`,
	)
	return JSON.parse(sortie) as Record<string, number>
}

type Porteur = { message_id: string; card_id: string | null }
type Ligne = { id: string; filename: string; text_status: string | null; extracted_text: string | null; text_truncated: boolean }

async function porteur(request: APIRequestContext): Promise<Porteur> {
	const reponse = await request.get(`${REST}/mail_attachments?filename=eq.proposition-monitoring.txt&select=message_id,card_id&limit=1`, {
		headers: enTetesService(),
	})
	const [ligne] = (await reponse.json()) as Porteur[]
	if (ligne === undefined) throw new Error('le message porteur du seed (proposition-monitoring.txt) est absent')
	return ligne
}

const chemins: string[] = []

/** Dépose `contenu` au stockage (sauf `deposer: false`) et inscrit la pièce saine, comme le fait la relève. */
async function piece(
	request: APIRequestContext,
	p: Porteur,
	nom: string,
	type: string,
	contenu: Buffer,
	{ deposer = true }: { deposer?: boolean } = {},
): Promise<string> {
	const empreinte = createHash('sha256').update(contenu).update(nom).digest('hex')
	const chemin = `${ESPACE}/${p.message_id}/${empreinte}`
	if (deposer) {
		const depot = await request.post(`${URL_API}/storage/v1/object/mail-attachments/${chemin}`, {
			headers: { ...enTetesService(), 'Content-Type': type, 'x-upsert': 'true' },
			data: contenu,
		})
		expect([200, 201], await depot.text()).toContain(depot.status())
		chemins.push(chemin)
	}
	const ligne = await request.post(`${REST}/mail_attachments?select=id`, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: {
			message_id: p.message_id,
			card_id: p.card_id,
			filename: nom,
			mime_type: type,
			size_bytes: contenu.length,
			storage_path: chemin,
			sha256: empreinte,
			av_status: 'clean',
		},
	})
	expect(ligne.status(), await ligne.text()).toBe(201)
	return ((await ligne.json()) as { id: string }[])[0]!.id
}

async function lire(request: APIRequestContext): Promise<Map<string, Ligne>> {
	const reponse = await request.get(
		`${REST}/mail_attachments?filename=like.${encodeURIComponent('tst-crm074*')}&select=id,filename,text_status,extracted_text,text_truncated`,
		{ headers: enTetesService() },
	)
	return new Map(((await reponse.json()) as Ligne[]).map((l) => [l.filename, l]))
}

const fichier = (nom: string) => readFileSync(join(PIECES, nom))

test.describe('l’extraction du texte des pièces jointes — par le vrai mail-sync (docs/SPEC-pieces-jointes.md §4)', () => {
	test.afterEach(async ({ request }) => {
		await request.delete(`${REST}/mail_attachments?filename=like.${encodeURIComponent('tst-crm074*')}`, { headers: enTetesService() })
		if (chemins.length > 0) {
			await request.delete(`${URL_API}/storage/v1/object/mail-attachments`, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { prefixes: chemins.splice(0) },
			})
		}
	})

	test('la route extrait chaque format ; un scan est vide, un faux fichier non reconnu, un objet absent en échec, une image ignorée', async ({
		request,
	}) => {
		test.setTimeout(240_000)
		const p = await porteur(request)
		await piece(request, p, 'tst-crm074-devis.pdf', 'application/pdf', fichier('devis-refonte-vertuo.pdf'))
		await piece(request, p, 'tst-crm074-scan.pdf', 'application/pdf', fichier('plan-signe-scanne.pdf'))
		await piece(request, p, 'tst-crm074-cahier.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fichier('cahier-des-charges.docx'))
		await piece(request, p, 'tst-crm074-budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fichier('budget-previsionnel.xlsx'))
		await piece(request, p, 'tst-crm074-maquette.png', 'image/png', fichier('maquette-accueil.png'))
		await piece(request, p, 'tst-crm074-faux.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('pas une archive'))
		await piece(request, p, 'tst-crm074-absent.pdf', 'application/pdf', Buffer.from('%PDF-1.4 jamais déposé'), { deposer: false })

		const route = extraireParLaRoute()
		expect(route['http'], 'la route répond').toBeUndefined()

		await expect
			.poll(async () => [...(await lire(request)).values()].filter((l) => l.text_status === 'pending').length, { timeout: 120_000 })
			.toBe(0)
		const lignes = await lire(request)
		const devis = lignes.get('tst-crm074-devis.pdf')!
		expect(devis.text_status).toBe('extracted')
		expect(devis.extracted_text).toContain('Devis n° 2026-118 — Refonte du monitoring Vertuo')
		expect(devis.extracted_text).toContain('Total hors taxes : 11 000 €')
		expect(lignes.get('tst-crm074-scan.pdf')).toMatchObject({ text_status: 'empty', extracted_text: null })
		expect(lignes.get('tst-crm074-cahier.docx')!.extracted_text).toBe(
			'Cahier des charges — Refonte du monitoring\nObjectif : remplacer les alertes par courriel par un tableau de bord partagé.\n' +
				'Périmètre : les quarante sondes du site de production et leurs seuils.\nLivraison attendue avant la fin du trimestre.',
		)
		expect(lignes.get('tst-crm074-budget.xlsx')!.extracted_text).toBe('Poste Montant\nAudit 3200\nTableaux de bord 7800\nTotal 11000')
		expect(lignes.get('tst-crm074-maquette.png')!.text_status, 'une image n’est pas à extraire').toBeNull()
		expect(lignes.get('tst-crm074-faux.docx')!.text_status).toBe('unsupported')
		expect(lignes.get('tst-crm074-absent.pdf')!.text_status, 'un objet absent est définitif').toBe('failed')
	})

	test('la boucle du service extrait seule une pièce arrivée, sans appel de la route', async ({ request }) => {
		test.setTimeout(180_000)
		const p = await porteur(request)
		await piece(request, p, 'tst-crm074-boucle.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fichier('cahier-des-charges.docx'))
		await expect
			.poll(async () => (await lire(request)).get('tst-crm074-boucle.docx')?.text_status, { timeout: 90_000, intervals: [2_000] })
			.toBe('extracted')
		// Le journal du service nomme la pièce par son identifiant, jamais par son nom ni son texte.
		const journal = docker('logs', '--since', '5m', CONTENEUR)
		expect(journal).not.toContain('tst-crm074-boucle.docx')
		expect(journal).not.toContain('Cahier des charges')
	})
})
