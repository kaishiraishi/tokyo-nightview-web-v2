/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_DSM_API_BASE_URL: string
    readonly VITE_CARTO_STYLE_DARK: string
    readonly VITE_CARTO_STYLE_LIGHT: string
    readonly VITE_SUPABASE_URL: string
    readonly VITE_SUPABASE_ANON_KEY: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
