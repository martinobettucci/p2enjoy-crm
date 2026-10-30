// @verifies CRM-071 (docs/BACKLOG.md) — tranche T5 : le lecteur du fichier (encodage, BOM, séparateur, guillemets, fins de
//           ligne), la reconnaissance des en-têtes, les lignes composées, l'appel, les comptes et le rapport
// @verifies docs/SPEC-vues-import-export.md §6.1, §6.2 bis, §6.5 ; docs/DESIGN_SYSTEM.md §5.77

import { describe, expect, it } from 'vitest'
import type { ClientCrm } from './supabase'
import {
	classerRefusImport,
	compter,
	correspondanceInitiale,
	correspondanceUtile,
	decoderFichier,
	detecterSeparateur,
	importerContacts,
	lignesPourImport,
	lireCsv,
	motifDe,
	rapportCsv,
	reconnaitreEnTete,
	type IssueLigne,
} from './import-csv'

const octets = (texte: string) => new TextEncoder().encode(texte).buffer as ArrayBuffer

describe('le fichier (§6.1)', () => {
	it('lit l’UTF-8 et retire le BOM ; replie sur Windows-1252 quand l’UTF-8 échoue', () => {
		expect(decoderFichier(octets('﻿Nom;Email'))).toBe('Nom;Email')
		// « Élise » en Windows-1252 : 0xC9 n'est pas de l'UTF-8 valide.
		const windows = new Uint8Array([0xc9, 0x6c, 0x69, 0x73, 0x65]).buffer
		expect(decoderFichier(windows)).toBe('Élise')
	})

	it('détecte le séparateur sur la ligne d’en-tête, hors guillemets', () => {
		expect(detecterSeparateur('Nom;Email\nA;b')).toBe(';')
		expect(detecterSeparateur('Nom,Email,Téléphone\n"A;B",c,d')).toBe(',')
		expect(detecterSeparateur('"Nom, prénom";Email')).toBe(';')
	})

	it('lit les guillemets, les guillemets doublés, un séparateur et une fin de ligne dans une cellule, CRLF ou LF', () => {
		const texte = 'Nom;Note\r\n"Dupont; Jean";"Il dit ""oui"""\r\n"Multi\nligne";x\nDernière;y'
		expect(lireCsv(texte)).toEqual([
			['Nom', 'Note'],
			['Dupont; Jean', 'Il dit "oui"'],
			['Multi\nligne', 'x'],
			['Dernière', 'y'],
		])
	})

	it('écarte les lignes entièrement vides, même en fin de fichier', () => {
		expect(lireCsv('Nom;Email\r\nA;a@b.test\r\n;\r\n\r\n')).toEqual([
			['Nom', 'Email'],
			['A', 'a@b.test'],
		])
	})
})

describe('les colonnes (§6.1)', () => {
	it('reconnaît les en-têtes usuels, sans accent ni casse ; un inconnu est ignoré', () => {
		expect(reconnaitreEnTete('  Nom ')).toBe('full_name')
		expect(reconnaitreEnTete('E-mail')).toBe('email')
		expect(reconnaitreEnTete('Téléphone')).toBe('phone')
		expect(reconnaitreEnTete('SOCIÉTÉ')).toBe('organization_name')
		expect(reconnaitreEnTete('Domaine de l’organisation')).toBe('organization_domain')
		expect(reconnaitreEnTete('Couleur préférée')).toBe('ignorer')
	})

	it('associe chaque champ à une seule colonne, la première', () => {
		expect(correspondanceInitiale(['Nom', 'Email', 'Courriel', 'Notes'])).toEqual(['full_name', 'email', 'ignorer', 'ignorer'])
	})

	it('il faut un nom de contact ou d’organisation', () => {
		expect(correspondanceUtile(['email', 'phone'])).toBe(false)
		expect(correspondanceUtile(['organization_name'])).toBe(true)
	})

	it('compose les lignes : une clé par champ associé, la valeur telle que le fichier la porte', () => {
		expect(lignesPourImport([['Anne', 'anne@x.test', 'Notes'], ['Bruno']], ['full_name', 'email', 'ignorer'])).toEqual([
			{ full_name: 'Anne', email: 'anne@x.test' },
			{ full_name: 'Bruno', email: '' },
		])
	})
})

describe('l’appel, les comptes et le rapport (§6.2 bis)', () => {
	const issues: IssueLigne[] = [
		{ line: 1, outcome: 'created', code: null, organization_created: true },
		{ line: 2, outcome: 'skipped', code: 'duplicate_email', organization_created: false },
		{ line: 3, outcome: 'refused', code: 'invalid_email', organization_created: false },
	]

	it('compte les issues, et les organisations créées', () => {
		expect(compter(issues)).toEqual({ crees: 1, ignores: 1, refuses: 1, organisations: 1 })
	})

	it('traduit un code connu, replie un code inconnu', () => {
		expect(motifDe('duplicate_email')).toBe('import.motif.duplicate_email')
		expect(motifDe('code_futur')).toBe('import.motif.unknown')
		expect(motifDe(null)).toBeNull()
	})

	it('le rapport porte les lignes écartées telles que le fichier les portait, leur rang et leur motif', () => {
		const rapport = rapportCsv(['Nom', 'Email'], [['Anne', 'anne@x.test'], ['Bruno', 'anne@x.test'], ['Chloé', 'pas-un-email']], issues)
		expect(rapport.split('\r\n')).toEqual([
			'﻿Nom;Email;Ligne;Motif',
			'Bruno;anne@x.test;2;Un contact de l’espace porte déjà cet email.',
			'Chloé;pas-un-email;3;Email invalide.',
			'',
		])
	})

	it('appelle import_contacts en simulation ou confirmé, et classe les refus', async () => {
		const appels: unknown[][] = []
		const client = {
			rpc: (...args: unknown[]) => {
				appels.push(args)
				return Promise.resolve({ data: issues, error: null, status: 200 })
			},
		} as unknown as ClientCrm
		expect(await importerContacts(client, 'ws-1', [{ full_name: 'Anne' }], true)).toEqual({ statut: 'juge', issues })
		expect(appels[0]).toEqual(['import_contacts', { p_workspace: 'ws-1', p_rows: [{ full_name: 'Anne' }], p_dry_run: true }])
		expect(classerRefusImport(400, 'import_too_large')).toBe('trop-grand')
		expect(classerRefusImport(404, 'workspace_not_found')).toBe('introuvable')
		expect(classerRefusImport(undefined, 'Failed to fetch')).toBe('network')
	})
})
