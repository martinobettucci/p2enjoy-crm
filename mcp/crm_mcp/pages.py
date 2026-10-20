# @spec CRM-102 (docs/BACKLOG.md) — tranche T2 : les pages publiques du connecteur
# @spec docs/SPEC-mcp.md §4 (« Compte en attente de vérification », « Droits en attente », « La connexion n'a pas abouti »),
#       §2.2 (adresse du connecteur) ; docs/DESIGN_SYSTEM.md §1 (charte), §5.12 (surface autonome : carte, titre, action)
# @spec Repris du connecteur Evoliz (p2enjoy-evoliz, `evoliz_mcp/pages.py`, révision 80a3e27). Écarts : textes du CRM,
#       aucune administration propre — elle vit dans la webapp (arbitrage A3) —, favicon du CRM (monogramme « P2 »).
"""Pages publiques : accueil, attentes (vérification, droits), erreur de connexion.

Surfaces autonomes du §5.12 du design system du CRM : fond, carte, nom du service,
titre, phrase explicative, action utile. Les tokens sont déclarés une fois sur
``:root`` et consommés par les règles ; aucune valeur visuelle n'est réécrite
ailleurs. Toute valeur dynamique est échappée.
"""

from __future__ import annotations

from html import escape

NOM_SERVICE = "P2Enjoy CRM — connecteur MCP"

# Favicon : pastille bleue et « € » blanc, lisible à 16 px, sans police distante.
# Favicon du produit (docs/DESIGN_SYSTEM.md §9) : carré arrondi bleu, « P » blanc, « 2 » jaune, sans police distante.
_FAVICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='8' fill='%2323468C'/%3E"
    "%3Cpath d='M8 23V9h5a4 4 0 0 1 0 8H8' fill='none' stroke='%23FFFFFF' stroke-width='2.5' stroke-linecap='round' "
    "stroke-linejoin='round'/%3E%3Cpath d='M18 13a3 3 0 0 1 6 0c0 3-6 5-6 10h6' fill='none' stroke='%23D9CF4A' "
    "stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"
)

# Icônes Lucide (trait 2 px), décoratives à côté d'un texte visible.
_ICONE_PRISE = (
    '<svg class="icone" aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22v-5"/>'
    '<path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></svg>'
)
_ICONE_SABLIER = (
    '<svg class="icone" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 22h14"/><path d="M5 2h14"/>'
    '<path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/>'
    '<path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>'
)
_ICONE_ALERTE = (
    '<svg class="icone" aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/>'
    '<line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'
)
_ICONE_COPIE = (
    '<svg class="icone" aria-hidden="true" viewBox="0 0 24 24"><rect width="14" height="14" x="8" y="8" '
    'rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>'
)

_STYLE = """
:root {
  --color-brand: #23468C;
  --color-brand-hover: #1C386F;
  --color-brand-soft: #E9EEF7;
  --color-brand-on-soft: #1C386F;
  --color-success-on-soft: #1A6B27;
  --color-danger: #F24141;
  --color-danger-soft: #FDECEC;
  --color-danger-on-soft: #A51B1B;
  --color-ink: #0D0D0D;
  --color-bg: #F7F8FA;
  --color-surface: #FFFFFF;
  --color-border: #E5E7EB;
  --color-text-2: #4B5563;
  --color-text-3: #6B7280;
  --radius-sm: 8px;
  --radius-lg: 14px;
  --size-target: 40px;
  --shadow-card: 0 1px 3px rgb(0 0 0 / .06);
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; min-height: 100vh; background: var(--color-bg); color: var(--color-ink);
  font: 15px/1.55 ui-sans-serif, system-ui, sans-serif;
  display: flex; justify-content: center; align-items: flex-start; padding: 16px;
}
@media (min-width: 768px) { body { align-items: center; padding: 32px; } }
main {
  width: 100%; max-width: 560px; background: var(--color-surface);
  border: 1px solid var(--color-border); border-radius: var(--radius-lg);
  box-shadow: var(--shadow-card); padding: 24px;
}
@media (min-width: 768px) { main { padding: 32px; } }
.marque { margin: 0 0 16px; font-size: 13px; color: var(--color-text-2); display: flex; gap: 8px; align-items: center; }
.marque .icone { color: var(--color-brand); }
h1 { margin: 0 0 8px; font-size: 26px; font-weight: 700; color: var(--color-ink); }
h2 { margin: 24px 0 8px; font-size: 16px; font-weight: 700; color: var(--color-ink); }
p { margin: 0 0 12px; color: var(--color-text-2); }
ol { margin: 0; padding-left: 24px; color: var(--color-text-2); }
li { margin: 0 0 4px; }
code, .technique { font-family: ui-monospace, monospace; }
.icone { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor;
  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.champ { margin: 16px 0 0; }
.champ label { display: block; font-size: 13px; color: var(--color-text-2); margin: 0 0 4px; }
.champ input {
  display: block; width: 100%; min-height: var(--size-target); padding: 0 12px;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-bg); color: var(--color-ink); cursor: default; font-size: 15px;
}
.aide { font-size: 13px; color: var(--color-text-3); margin: 4px 0 0; }
.bouton {
  display: inline-flex; align-items: center; gap: 8px; min-height: var(--size-target);
  padding: 0 16px; border-radius: var(--radius-sm); font: inherit; cursor: pointer; text-decoration: none;
}
.bouton-secondaire { background: var(--color-surface); color: var(--color-ink); border: 1px solid var(--color-border); }
.bouton-secondaire:hover { background: var(--color-bg); }
.bouton-primaire { background: var(--color-brand); color: #FFFFFF; border: 1px solid var(--color-brand); }
.bouton-primaire:hover { background: var(--color-brand-hover); }
.bouton:focus-visible, .champ input:focus-visible, a:focus-visible {
  outline: 2px solid var(--color-brand); outline-offset: 2px;
}
a { color: var(--color-brand); }
.actions-champ { margin: 12px 0 0; }
.etat { font-size: 13px; color: var(--color-success-on-soft); margin: 4px 0 0; min-height: 20px; }
.refus {
  display: flex; gap: 12px; align-items: flex-start; margin: 16px 0;
  padding: 12px 16px; border-radius: var(--radius-sm);
  background: var(--color-danger-soft); color: var(--color-danger-on-soft);
}
.refus p { color: var(--color-danger-on-soft); margin: 0; }
.attente {
  display: flex; gap: 12px; align-items: flex-start; margin: 16px 0;
  padding: 12px 16px; border-radius: var(--radius-sm);
  background: var(--color-brand-soft); color: var(--color-brand-on-soft);
}
.attente p { color: var(--color-brand-on-soft); margin: 0; }
.actions { margin: 24px 0 0; display: flex; gap: 8px; flex-wrap: wrap; }
@media (prefers-reduced-motion: no-preference) { .bouton { transition: background-color 150ms ease-out; } }
"""


def _page(titre: str, corps: str, script: str = "") -> str:
    return f"""<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{escape(titre)} — {escape(NOM_SERVICE)}</title>
<link rel="icon" href="{_FAVICON}">
<style>{_STYLE}</style>
</head>
<body>
<main>
<p class="marque">{_ICONE_PRISE}<span>{escape(NOM_SERVICE)}</span></p>
{corps}
</main>
{script}
</body>
</html>
"""


def accueil(url_mcp: str) -> str:
    """Page d'accueil : ce qu'est le service, son adresse, sa règle d'accès."""
    corps = f"""<h1>Connecteur MCP du CRM</h1>
<p>Pilotez le CRM P2Enjoy depuis votre assistant : tracks et channels, affaires, contacts, budgets, temps passé,
objectifs et messagerie.</p>
<p>Réservé aux comptes vérifiés du SSO lelabs. L'assistant agit en votre nom, avec vos droits dans le CRM, et dans
ceux qu'un superadministrateur de la plateforme accorde au connecteur.</p>
<div class="champ">
  <label for="adresse">Adresse du connecteur</label>
  <input id="adresse" class="technique" type="text" readonly value="{escape(url_mcp)}"
    aria-describedby="adresse-aide adresse-etat">
  <p class="aide" id="adresse-aide">Valeur fournie par le serveur.</p>
  <p class="actions-champ"><button type="button" class="bouton bouton-secondaire" id="copier">{_ICONE_COPIE}<span>Copier l'adresse du connecteur</span></button></p>
  <p class="etat" id="adresse-etat" role="status"></p>
</div>
<h2>Ajouter le connecteur</h2>
<ol>
  <li>Dans votre client MCP, ajoutez un connecteur personnalisé avec cette adresse.</li>
  <li>Autorisez l'accès sur la page de consentement ; cochez « Stay signed in » pour rester connecté entre deux pauses.</li>
  <li>Connectez-vous avec votre compte lelabs.</li>
</ol>
<h2>Administrer</h2>
<p>Les superadministrateurs accordent les droits du connecteur depuis le CRM, dans « Plateforme ».</p>"""
    script = """<script>
document.getElementById('copier').addEventListener('click', async function () {
  var champ = document.getElementById('adresse');
  var etat = document.getElementById('adresse-etat');
  try {
    await navigator.clipboard.writeText(champ.value);
    etat.textContent = 'Adresse copiée.';
  } catch (e) {
    champ.focus(); champ.select();
    etat.textContent = 'Copie impossible : adresse sélectionnée, copiez-la au clavier.';
  }
});
</script>"""
    return _page("Accueil", corps, script)


def droits_en_attente(*, courriel: str | None) -> str:
    """Compte vérifié, inscrit, sans aucun droit : une attente, pas une erreur (journal, décision 26)."""
    qui = (
        f"Votre compte <span class=\"technique\">{escape(courriel)}</span> est reconnu"
        if courriel
        else "Votre compte est reconnu"
    )
    corps = f"""<h1>Droits en attente</h1>
<div class="attente" role="status">{_ICONE_SABLIER}
<p>{qui}, mais aucun droit ne vous a encore été accordé sur ce connecteur.
Aucun accès n'a été accordé à votre client MCP.</p></div>
<p>Un superadministrateur de la plateforme choisit, espace par espace, ce que le
connecteur peut consulter, ajouter, modifier ou mettre à la corbeille en votre nom.
Votre compte figure désormais dans sa liste. Une fois vos droits accordés, relancez
la connexion depuis votre client MCP.</p>"""
    return _page("Droits en attente", corps)


def verification_attendue(*, courriel: str | None, compte_url: str) -> str:
    """Compte authentifié qui ne porte pas encore ``verified`` : une attente, pas une erreur (SSO.md)."""
    qui = (
        f"Votre compte <span class=\"technique\">{escape(courriel)}</span> est connecté"
        if courriel
        else "Votre compte est connecté"
    )
    corps = f"""<h1>Compte en attente de vérification</h1>
<div class="attente" role="status">{_ICONE_SABLIER}
<p>{qui} au SSO lelabs, mais il n'a pas encore été vérifié. Aucun accès n'a
été accordé à votre client MCP.</p></div>
<p>Un administrateur du SSO vérifie chaque compte à la main, à partir du profil
public déclaré à l'inscription ; ce geste n'est ni automatique ni immédiat. Votre
adresse électronique doit aussi être vérifiée chez lelabs. Une fois votre compte
vérifié, un superadministrateur de la plateforme pourra accorder des droits au
connecteur.</p>
<p class="actions"><a class="bouton bouton-primaire" href="{escape(compte_url)}">Ouvrir mon espace de compte</a></p>"""
    return _page("Compte en attente de vérification", corps)


def erreur_connexion() -> str:
    """Le jeton rendu par le SSO n'a pas pu être vérifié."""
    corps = f"""<h1>La connexion n'a pas abouti</h1>
<div class="refus" role="alert">{_ICONE_ALERTE}
<p>Le jeton rendu par le SSO lelabs n'a pas pu être vérifié. Aucun accès n'a
été accordé à votre client MCP.</p></div>
<p>Relancez la connexion depuis votre client MCP. Si le refus persiste,
signalez-le à l'équipe qui exploite ce service, avec l'heure de la tentative.</p>"""
    return _page("Connexion refusée", corps)
