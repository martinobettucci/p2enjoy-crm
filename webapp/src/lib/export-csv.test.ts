// @verifies CRM-071 (docs/BACKLOG.md) — tranche T4 : le fichier CSV — cellules, guillemets, injection de formule, BOM, CRLF,
//           colonnes des deux exports, nom du jour, appels et refus
// @verifies docs/SPEC-vues-import-export.md §5.1, §5.2, §5.3 ; docs/DESIGN_SYSTEM.md §5.76

import { describe, expect, it } from 'vitest'
import type { ClientCrm } from './supabase'
import {
	celluleCsv,
	classerRefusExport,
	csvAffaires,
	csvContacts,
	dateDuJour,
	documentCsv,
	exporterAffaires,
	type LigneExportAffaire,
} from './export-csv'

describe('une cellule (§5.3)', () => {
	it('une valeur absente est vide, un nombre garde son point décimal', () => {
		expect(celluleCsv(null)).toBe('')
		expect(celluleCsv(undefined)).toBe('')
		expect(celluleCsv(72000.5)).toBe('72000.5')
		expect(celluleCsv(-15)).toBe('-15')
	})

	it('le séparateur, un guillemet ou une fin de ligne mettent la cellule entre guillemets, ses guillemets doublés', () => {
		expect(celluleCsv('Ville de Lyon')).toBe('Ville de Lyon')
		expect(celluleCsv('Partenaire; Prioritaire')).toBe('"Partenaire; Prioritaire"')
		expect(celluleCsv('Le « lot » dit "A"')).toBe('"Le « lot » dit ""A"""')
		expect(celluleCsv('ligne 1\nligne 2')).toBe('"ligne 1\nligne 2"')
	})

	it('une cellule à risque de formule est préfixée d’une apostrophe, jamais exécutée par le tableur', () => {
		expect(celluleCsv('=HYPERLINK("http://exemple.test")')).toBe('"\'=HYPERLINK(""http://exemple.test"")"')
		expect(celluleCsv('+33 6 12 34 56 78')).toBe("'+33 6 12 34 56 78")
		expect(celluleCsv('-rabais')).toBe("'-rabais")
		expect(celluleCsv('@SUM(A1)')).toBe("'@SUM(A1)")
		expect(celluleCsv('\tcaché')).toBe("'\tcaché")
	})
})

describe('le fichier (§5.3)', () => {
	it('commence par le BOM et termine chaque ligne par CRLF, en-têtes compris', () => {
		const fichier = documentCsv(['A', 'B'], [[1, null], ['x;y', 'z']])
		expect(fichier).toBe('﻿A;B\r\n1;\r\n"x;y";z\r\n')
	})

	it('une liste vide rend un fichier qui ne porte que ses en-têtes', () => {
		expect(documentCsv(['A'], [])).toBe('﻿A\r\n')
	})

	it('nomme le jour local en AAAA-MM-JJ', () => {
		expect(dateDuJour(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03')
	})
})

describe('les colonnes des deux exports (§5.1)', () => {
	const affaire: LigneExportAffaire = {
		card_id: 'c-1',
		title: 'Refonte intranet Ville de Lyon',
		labels: 'Partenaire, Prioritaire',
		owner_name: 'Driss Lemoine',
		step_label: 'Négociation',
		amount: 72000,
		currency: 'EUR',
		next_action: 'Négocier le lot accessibilité',
		next_action_at: '2026-10-27T09:00:00+00:00',
		track_slug: 'studio-web',
		channel_slug: 'refonte',
	}

	it('les affaires : les colonnes de l’écran, l’identifiant et l’adresse de la fiche', () => {
		const lignes = csvAffaires([affaire], 'https://crm.exemple.test').split('\r\n')
		expect(lignes[0]).toBe('﻿Identifiant;Affaire;Étiquettes;Responsable;Étape;Montant;Devise;Prochaine action;Échéance;Adresse de la fiche')
		expect(lignes[1]).toBe(
			'c-1;Refonte intranet Ville de Lyon;Partenaire, Prioritaire;Driss Lemoine;Négociation;72000;EUR;Négocier le lot accessibilité;2026-10-27T09:00:00+00:00;https://crm.exemple.test/tracks/studio-web/refonte/cards/c-1',
		)
	})

	it('le carnet : un contact anonymisé sort sans coordonnées', () => {
		const lignes = csvContacts([
			{
				contact_id: 'k-1',
				full_name: 'Contact anonymisé',
				email: null,
				phone: null,
				role_title: null,
				organization_name: 'Sogexia',
				organization_domain: 'sogexia.fr',
				created_at: '2026-01-02T00:00:00+00:00',
				anonymized_at: '2026-10-01T00:00:00+00:00',
			},
		]).split('\r\n')
		expect(lignes[0]).toBe('﻿Identifiant;Nom;Email;Téléphone;Fonction;Organisation;Domaine de l’organisation;Créé le;Anonymisé le')
		expect(lignes[1]).toBe('k-1;Contact anonymisé;;;;Sogexia;sogexia.fr;2026-01-02T00:00:00+00:00;2026-10-01T00:00:00+00:00')
	})
})

describe('les appels et leurs refus (§5.2)', () => {
	it('nomme chaque refus de la base', () => {
		expect(classerRefusExport(400, 'export_too_large')).toBe('trop-grand')
		expect(classerRefusExport(404, 'channel_not_found')).toBe('introuvable')
		expect(classerRefusExport(404, 'workspace_not_found')).toBe('introuvable')
		expect(classerRefusExport(undefined, 'Failed to fetch')).toBe('network')
		expect(classerRefusExport(500, 'boom')).toBe('unknown')
	})

	it('appelle export_cards avec les filtres de l’écran et rend les lignes', async () => {
		const appels: unknown[][] = []
		const client = {
			rpc: (...args: unknown[]) => {
				appels.push(args)
				return Promise.resolve({ data: [{ card_id: 'c-1' }], error: null, status: 200 })
			},
		} as unknown as ClientCrm
		const issue = await exporterAffaires(client, 'channel-1', { sort: 'amount' })
		expect(appels[0]).toEqual(['export_cards', { p_channel: 'channel-1', p_filters: { sort: 'amount' } }])
		expect(issue).toEqual({ statut: 'pret', lignes: [{ card_id: 'c-1' }] })
	})
})
