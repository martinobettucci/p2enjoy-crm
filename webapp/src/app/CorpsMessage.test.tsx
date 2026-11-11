// @verifies CRM-140 (docs/BACKLOG.md) — tranche T3 : le corps du message ouvert — le cadre et ses attributs EXACTS (ni
//           `allow-scripts` ni `allow-same-origin`), le HTML jamais posé dans le DOM de l'écran, le bandeau, le clic, la phrase
//           d'état qui reçoit le focus, le premier état rendu à un autre message, l'attente des images intégrées, le repli sur
//           le texte, les adresses web d'un corps texte
// @verifies docs/SPEC-mail-subsystem.md §30.2, §30.3, §30.5, §30.7, §30.11 (ligne « Vitest, écran ») ; docs/DESIGN_SYSTEM.md
//           §5.100

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { PieceJointe } from '../lib/inbox'
import type { ClientCrm } from '../lib/supabase'
import { BAC_A_SABLE, CorpsMessage } from './CorpsMessage'

afterEach(cleanup)

const HTML = '<p>Bonjour <b>Camille</b></p><a href="https://partenaire-demo.test/offre">l’offre</a><img src="https://images.partenaire-demo.test/banniere.png" alt="Bannière"><script>alert(1)</script>'

const cadre = () => screen.getByTestId('inbox-corps-cadre') as HTMLIFrameElement
const documentServi = () => new DOMParser().parseFromString(cadre().getAttribute('srcdoc') ?? '', 'text/html')

describe('CorpsMessage — le cadre (§30.3)', () => {
	it('porte EXACTEMENT ses droits, un titre, et aucun référent', () => {
		render(<CorpsMessage html={HTML} texte="Bonjour Camille" pieces={[]} client={null} />)
		expect(BAC_A_SABLE).toBe('allow-popups allow-popups-to-escape-sandbox')
		expect(cadre().getAttribute('sandbox')).toBe(BAC_A_SABLE)
		expect(cadre().getAttribute('sandbox')).not.toMatch(/allow-scripts|allow-same-origin|allow-forms|allow-top-navigation|allow-modals/)
		expect(cadre().getAttribute('referrerpolicy')).toBe('no-referrer')
		expect(cadre().getAttribute('title')).toBe('Contenu du message')
		expect(cadre().hasAttribute('src')).toBe(false)
	})

	it('le HTML de l’expéditeur n’atteint jamais le DOM de l’écran : il n’est que dans `srcdoc`, nettoyé', () => {
		const { container } = render(<CorpsMessage html={HTML} texte="Bonjour Camille" pieces={[]} client={null} />)
		expect(container.querySelector('b, script, a[href*="partenaire"], img')).toBeNull()
		const servi = documentServi()
		expect(servi.querySelector('script')).toBeNull()
		expect(servi.querySelector('b')!.textContent).toBe('Camille')
		expect(servi.querySelector('a')!.getAttribute('rel')).toBe('noopener noreferrer')
	})
})

describe('CorpsMessage — le bandeau des images distantes (§30.5)', () => {
	it('bloque, propose, puis affiche pour ce message seulement, et pose le focus sur la phrase d’état', async () => {
		render(<CorpsMessage html={HTML} texte="Bonjour" pieces={[]} client={null} />)
		expect(screen.getByTestId('bandeau-images').textContent).toContain('Les images distantes de ce message sont bloquées')
		expect(documentServi().querySelector('img')!.hasAttribute('src')).toBe(false)
		expect(documentServi().querySelector('meta[http-equiv]')!.getAttribute('content')).toContain('img-src data:;')

		await userEvent.click(screen.getByTestId('afficher-images'))
		expect(screen.queryByTestId('afficher-images')).toBeNull()
		const phrase = screen.getByTestId('images-affichees')
		expect(phrase.textContent).toBe('Images affichées pour ce message.')
		expect(phrase.getAttribute('role')).toBe('status')
		await waitFor(() => expect(document.activeElement).toBe(phrase))
		expect(documentServi().querySelector('img')!.getAttribute('src')).toBe('https://images.partenaire-demo.test/banniere.png')
		expect(documentServi().querySelector('meta[http-equiv]')!.getAttribute('content')).toContain('img-src data: https: http:;')
	})

	it('un autre message, monté avec sa clé, repart bloqué', async () => {
		const { rerender } = render(<CorpsMessage key="m1" html={HTML} texte="" pieces={[]} client={null} />)
		await userEvent.click(screen.getByTestId('afficher-images'))
		rerender(<CorpsMessage key="m2" html={HTML} texte="" pieces={[]} client={null} />)
		expect(screen.getByTestId('afficher-images')).toBeTruthy()
		expect(documentServi().querySelector('img')!.hasAttribute('src')).toBe(false)
	})

	it('un courrier sans image distante n’a pas de bandeau', () => {
		render(<CorpsMessage html="<p>Rien à charger</p>" texte="" pieces={[]} client={null} />)
		expect(screen.queryByTestId('bandeau-images')).toBeNull()
		expect(cadre()).toBeTruthy()
	})
})

describe('CorpsMessage — les images intégrées (§30.6)', () => {
	const PIECE: PieceJointe = {
		id: 'p1',
		nom: 'logo.png',
		type: 'image/png',
		taille: 4,
		chemin: 'w/m/logo',
		statutAnalyse: 'clean',
		raisonNonAnalyse: null,
		recueLe: '2026-11-11T08:00:00Z',
		confirmee: false,
		contentId: 'logo@p2enjoy',
	}

	it('montre l’attente, puis le cadre avec l’image en `data:`, sans clic', async () => {
		let liberer: (valeur: { data: Blob; error: null }) => void = () => undefined
		const client = {
			storage: { from: () => ({ download: () => new Promise((resoudre) => (liberer = resoudre)) }) },
		} as unknown as ClientCrm
		render(<CorpsMessage html={'<p>Signé</p><img src="cid:logo@p2enjoy">'} texte="" pieces={[PIECE]} client={client} />)
		expect(screen.getByTestId('corps-preparation').getAttribute('aria-label')).toBe('Préparation du message…')
		expect(screen.queryByTestId('inbox-corps-cadre')).toBeNull()
		liberer({ data: new Blob([new Uint8Array([1, 2, 3, 4])]), error: null })
		await screen.findByTestId('inbox-corps-cadre')
		expect(documentServi().querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AQIDBA==')
		expect(screen.queryByTestId('bandeau-images')).toBeNull()
	})
})

describe('CorpsMessage — le repli sur le texte (§30.2, §30.7)', () => {
	it('sans HTML, le texte, ses adresses web en liens qui ouvrent un onglet sans référent', () => {
		render(<CorpsMessage html={null} texte={'Le devis : https://p2enjoy.test/devis.\nMerci.'} pieces={[]} client={null} />)
		expect(screen.queryByTestId('inbox-corps-cadre')).toBeNull()
		const lien = screen.getByRole('link', { name: 'https://p2enjoy.test/devis' })
		expect(lien.getAttribute('href')).toBe('https://p2enjoy.test/devis')
		expect(lien.getAttribute('target')).toBe('_blank')
		expect(lien.getAttribute('rel')).toBe('noopener noreferrer')
		expect(screen.getByTestId('inbox-corps').textContent).toBe('Le devis : https://p2enjoy.test/devis.\nMerci.')
	})

	it('un HTML que le nettoyage vide se rabat sur le texte, puis sur la phrase du corps vide', () => {
		const { rerender } = render(<CorpsMessage html="<script>alert(1)</script>" texte="Version texte" pieces={[]} client={null} />)
		expect(screen.queryByTestId('inbox-corps-cadre')).toBeNull()
		expect(screen.getByTestId('inbox-corps').textContent).toBe('Version texte')
		rerender(<CorpsMessage html="<script>alert(1)</script>" texte="" pieces={[]} client={null} />)
		expect(screen.getByTestId('inbox-corps').textContent).toBe('Ce message ne comporte aucun texte.')
	})

	it('un HTML vide ou blanc est un message sans HTML', () => {
		render(<CorpsMessage html={'  \n '} texte="Texte" pieces={[]} client={null} />)
		expect(screen.queryByTestId('inbox-corps-cadre')).toBeNull()
		expect(screen.getByTestId('inbox-corps').textContent).toBe('Texte')
	})
})
