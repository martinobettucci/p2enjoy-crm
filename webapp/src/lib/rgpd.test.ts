// @verifies CRM-072 (docs/BACKLOG.md) — tranche T3 : les deux appels du volet RGPD et la traduction de leurs refus
// @verifies docs/SPEC-audit.md §7.1 (l'export rendu tel quel), §7.2 (le nom retapé transmis, les refus nommés), §9 (le
//           nom du fichier) ; docs/DESIGN_SYSTEM.md §5.67 (dictionnaire fermé) ; docs/JOURNAL.md décision 732

import { describe, expect, it } from 'vitest'
import { anonymiserContact, contenuFichierExport, exporterContact, motifRefusRgpd, nomFichierExport } from './rgpd'
import type { ClientCrm } from './supabase'

function client(reponse: { data: unknown; error: { code?: string; message?: string } | null; status: number }) {
	const appels: { fonction: string; args: unknown }[] = []
	const fake = {
		rpc(fonction: string, args: unknown) {
			appels.push({ fonction, args })
			return Promise.resolve(reponse)
		},
	}
	return { client: fake as unknown as ClientCrm, appels }
}

describe('les refus, nommés par le code de la base', () => {
	it('traduit chaque code, puis le statut, sans jamais rendre le message du serveur', () => {
		expect(motifRefusRgpd({ code: '42501', message: 'reserved_to_admins' }, 403)).toBe('reserve')
		expect(motifRefusRgpd({ code: 'P0002', message: 'contact_not_found' }, 404)).toBe('introuvable')
		expect(motifRefusRgpd({ code: '22023', message: 'confirmation_mismatch' }, 400)).toBe('confirmation')
		expect(motifRefusRgpd({ code: 'P0001', message: 'contact_anonymized' }, 400)).toBe('deja-anonymise')
		expect(motifRefusRgpd(null, 0)).toBe('reseau')
		expect(motifRefusRgpd({ code: 'XX000', message: 'autre' }, 500)).toBe('inconnu')
	})
})

describe('l’export', () => {
	it('appelle export_contact et rend l’objet tel quel', async () => {
		const { client: c, appels } = client({ data: { format: 'p2enjoy-crm/contact-export/1' }, error: null, status: 200 })
		expect(await exporterContact(c, 'c1')).toEqual({ ok: true, donnees: { format: 'p2enjoy-crm/contact-export/1' } })
		expect(appels).toEqual([{ fonction: 'export_contact', args: { p_contact: 'c1' } }])
	})

	it('un refus est nommé', async () => {
		const { client: c } = client({ data: null, error: { code: '42501', message: 'reserved_to_admins' }, status: 403 })
		expect(await exporterContact(c, 'c1')).toEqual({ ok: false, motif: 'reserve' })
	})

	it('le fichier : huit caractères de l’identifiant et le jour local ; un JSON indenté terminé par une ligne', () => {
		expect(nomFichierExport('a0d17000-0000-4000-8000-0000000000c1', new Date(2026, 9, 6, 23, 30))).toBe(
			'contact-a0d17000-2026-10-06.json',
		)
		expect(contenuFichierExport({ a: 1 })).toBe('{\n  "a": 1\n}\n')
	})
})

describe('l’anonymisation', () => {
	it('transmet le nom retapé à la base, qui compare', async () => {
		const { client: c, appels } = client({ data: null, error: null, status: 204 })
		expect(await anonymiserContact(c, 'c1', 'Régis Témoin')).toEqual({ ok: true })
		expect(appels).toEqual([{ fonction: 'anonymize_contact', args: { p_contact: 'c1', p_confirmation: 'Régis Témoin' } }])
	})

	it('le nom retapé différent et le contact déjà anonymisé sont deux refus distincts', async () => {
		const differe = client({ data: null, error: { code: '22023', message: 'confirmation_mismatch' }, status: 400 })
		expect(await anonymiserContact(differe.client, 'c1', 'x')).toEqual({ ok: false, motif: 'confirmation' })
		const deja = client({ data: null, error: { code: 'P0001', message: 'contact_anonymized' }, status: 400 })
		expect(await anonymiserContact(deja.client, 'c1', 'x')).toEqual({ ok: false, motif: 'deja-anonymise' })
	})
})
