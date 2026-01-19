# Directory Report: tokyo_nightview_web_v2

Generated overview of the repository structure and key module responsibilities. This report omits `node_modules/`, `.git/`, and build cache directories for clarity.

## Top-Level Structure

```
.
├─ src/                       # Frontend source (React + MapLibre + deck.gl)
├─ public/                    # Static assets served by Vite
├─ tools/                     # Local tooling (DSM profile API)
├─ tile_DSM/                  # TerrainRGB tiles for DSM backend
├─ viirs_heat_tiles/          # VIIRS nightlight tiles
├─ dist/                      # Production build output (Vite)
├─ index.html                 # Vite entry HTML
├─ package.json               # Scripts, deps
├─ tsconfig*.json             # TypeScript configs
├─ vite.config.ts             # Vite dev/proxy config
├─ tailwind.config.js         # Tailwind setup
├─ postcss.config.js          # PostCSS setup
├─ vite*.log                  # Local dev logs
└─ SERVER_RESTART.md          # Local ops note
```

## src/ (Frontend)

```
src/
├─ main.tsx
├─ App.tsx
├─ index.css
├─ config/
│  ├─ mapStyles.ts
│  └─ scanConstants.ts
├─ components/
│  ├─ map/
│  │  ├─ MapView.tsx
│  │  ├─ MapViewAnalyze.tsx
│  │  ├─ MapOverlays.tsx
│  │  └─ types.ts
│  ├─ ui/
│  │  ├─ CurrentLocationButton.tsx
│  │  └─ ScanSettingsModal.tsx
│  └─ profile/
│     └─ ProfileChart.tsx
├─ hooks/
│  ├─ useMapLibre.ts
│  └─ useGeolocation.ts
├─ lib/
│  ├─ api/dsmApi.ts
│  └─ plateau/catalog.ts
└─ types/
   └─ profile.ts
```

### Entry Points
- `src/main.tsx`: React entry, mounts `App` and imports `index.css`.
- `src/App.tsx`: Owns global UI state (mode, profile, hovered/clicked indices, zoom, sidebar open). Renders `MapView` full-screen.
- `src/index.css`: Global styles (Tailwind base included; see Tailwind config).

### config/
- `src/config/mapStyles.ts`: Exposes Carto GL style URLs and `DEFAULT_STYLE` (dark by default).
- `src/config/scanConstants.ts`: Presets for sight angles and fan scan parameters.

### components/map/
- `src/components/map/MapView.tsx`: Primary map container. Initializes MapLibre via `useMapLibre`, maintains scanning state, executes scan requests, and coordinates overlays + UI. Includes the mode toggle and global map UI controls.
- `src/components/map/MapViewAnalyze.tsx`: Analyze-side UI and interaction flow (source/target selection, angle adjustment, sidebar). Used as the “analysis UI” even when mode is explore.
- `src/components/map/MapOverlays.tsx`: Deck.gl overlay rendering (rays, anchors, hit points, preview fan). Also contains ring overlay plumbing (currently disabled in MapView). Uses `MapboxOverlay` interop.
- `src/components/map/types.ts`: Shared map types (`MapMode`, `ScanStep`, `FanConfig`).

### components/ui/
- `src/components/ui/CurrentLocationButton.tsx`: Compass/current-location control; switches between north-reset and location mode.
- `src/components/ui/ScanSettingsModal.tsx`: Modal to adjust scan parameters (sight angle, ray count, range, VIIRS opacity).

### components/profile/
- `src/components/profile/ProfileChart.tsx`: Profile chart UI (currently not rendered in `App.tsx`).

### hooks/
- `src/hooks/useMapLibre.ts`: MapLibre setup, including terrain (GSI), PLATEAU building extrusion (MVT), and VIIRS raster layer. Adds custom overlay sources and handles style reloads.
- `src/hooks/useGeolocation.ts`: Geolocation watcher for current location updates + error state.

### lib/
- `src/lib/api/dsmApi.ts`: Client for `/profile` DSM endpoint. Uses timeout and supports dev proxy or explicit base.
- `src/lib/plateau/catalog.ts`: Fetches PLATEAU dataset catalog, resolves tileset URLs, caches results.

### types/
- `src/types/profile.ts`: Shared domain types for profiles and ray results.

## tools/

```
tools/
└─ dsm-api/
   ├─ server.py
   ├─ requirements.txt
   ├─ run.sh
   ├─ .env
   └─ dsm.log
```

- `tools/dsm-api/server.py`: FastAPI backend serving `/profile` using TerrainRGB tiles from `tile_DSM/terrainrgb_out/tiles`. Computes geodesic sampling with pyproj and returns profile arrays.
- `requirements.txt`: Python deps for DSM API.
- `run.sh`: Local helper to run the API.
- `.env`, `dsm.log`: Local runtime configuration/log.

## tile_DSM/

Holds TerrainRGB raster tiles used by the DSM API (`tools/dsm-api`). Key subdirectories include:
- `tile_DSM/terrainrgb_out/tiles`: PNG tile pyramid used for elevation decoding.
- `tile_DSM/tile_png_out`: Additional tile outputs.

## viirs_heat_tiles/

Nightlight tiles consumed by the MapLibre raster layer.
- `viirs_heat_tiles/tiles`: Raster tile pyramid referenced in `useMapLibre.ts` (served locally).
- `viirs_heat_tiles/work`: Working files (likely QGIS/processing output).

## public/

Static assets served as-is by Vite (not listed here; keep in sync with frontend expectations).

## dist/

Vite production build output. Generally treated as generated artifacts; not hand-edited.

## Root Config & Misc
- `package.json`: Vite/React app scripts; DSM API helper commands (`dev:api`, `dev:all`).
- `vite.config.ts`: Dev server + API proxy (`/api` -> local DSM API).
- `tailwind.config.js`, `postcss.config.js`: Tailwind + PostCSS setup.
- `tsconfig.json`, `tsconfig.node.json`: TypeScript configs for app and tooling.
- `SERVER_RESTART.md`: Local ops note.
- `vite*.log`: Local dev logs.

## Notes / Current Behavior Snapshot
- Mode toggle exists but analyze mode is currently configured to show no UI; explore mode uses the analyze sidebar and scan flow.
- Profile chart is removed from `App.tsx` rendering, but profile state still exists.
- Map overlays rely on deck.gl and MapLibre with terrain + PLATEAU + VIIRS layers configured in `useMapLibre.ts`.

