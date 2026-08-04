// @spec CRM-007 (docs/BACKLOG.md) — contrat des variables d'environnement lues au build
// @spec docs/SPEC-webapp.md §6.1 (client), §12.2 (production) ; README.md §9
//
// Les deux variables sont déclarées **facultatives** parce qu'elles peuvent réellement
// manquer : Vite n'échoue pas au build lorsqu'un `.env` est incomplet. C'est
// `lireConfiguration` qui constate l'absence et fait afficher l'état de configuration
// incomplète — les typer obligatoires mentirait au compilateur.

/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_SUPABASE_URL?: string
	readonly VITE_SUPABASE_ANON_KEY?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}
