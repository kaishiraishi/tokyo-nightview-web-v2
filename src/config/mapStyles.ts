// Stadia Maps Alidade Smooth Dark
// Note: Stadia Maps requires an API key for production domains. 
// You can add ?api_key=YOUR_KEY to the URL or configure domain validation.
export const STADIA_STYLE_DARK = 'https://tiles.stadiamaps.com/styles/alidade_smooth_dark.json';

export const CARTO_STYLE_DARK = import.meta.env.VITE_CARTO_STYLE_DARK || 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
export const CARTO_STYLE_LIGHT = import.meta.env.VITE_CARTO_STYLE_LIGHT || 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';

export const DEFAULT_STYLE = STADIA_STYLE_DARK;
