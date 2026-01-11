import { useEffect, useRef, useState, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { DEFAULT_STYLE } from '../config/mapStyles';

const BUILDINGS_3D_LAYER_ID = 'buildings-3d';
const BUILDINGS_3D_MIN_ZOOM = 15;

const TERRAIN_SOURCE_ID = 'terrain-dem';
const TERRAIN_HILLSHADE_LAYER_ID = 'terrain-hillshade';
const TERRAIN_MIN_ZOOM = 12.5;
const TERRAIN_EXAGGERATION = 1.2;

const PITCH_3D = 60;

// --- GSI -> Terrain-RGB conversion logic ---
const gsidem2terrainrgb = (r: number, g: number, b: number): number[] => {
    // 1. Calculate height from GSI (meters)
    let height = r * 655.36 + g * 2.56 + b * 0.01;
    if (r === 128 && g === 0 && b === 0) {
        height = 0;
    } else if (r >= 128) {
        height -= 167772.16;
    }

    // 2. Convert to Mapbox Terrain-RGB
    // Formula: (height + 10000) * 10
    height += 10000;
    height *= 10;

    const tB = (height / 256 - Math.floor(height / 256)) * 256;
    const tG =
        (Math.floor(height / 256) / 256 -
            Math.floor(Math.floor(height / 256) / 256)) *
        256;
    const tR =
        (Math.floor(Math.floor(height / 256) / 256) / 256 -
            Math.floor(Math.floor(Math.floor(height / 256) / 256) / 256)) *
        256;
    return [tR, tG, tB];
};

let _gsidemRegistered = false;

function registerGsidemProtocolOnce() {
    if (_gsidemRegistered) return;
    _gsidemRegistered = true;

    try {
        // MapLibre v5 requires async function that returns Promise<{data: ArrayBuffer}>
        maplibregl.addProtocol('gsidem', async (params) => {
            const url = params.url.replace('gsidem://', '');

            // Fetch the DEM tile
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const blob = await response.blob();

            // Convert to image
            const imageBitmap = await createImageBitmap(blob);

            // Draw to canvas and convert pixels
            const canvas = document.createElement('canvas');
            canvas.width = imageBitmap.width;
            canvas.height = imageBitmap.height;

            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Canvas context unavailable');
            }

            context.drawImage(imageBitmap, 0, 0);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;

            // Convert GSI encoding to Terrain-RGB
            for (let i = 0; i < data.length / 4; i++) {
                const tRGB = gsidem2terrainrgb(
                    data[i * 4],
                    data[i * 4 + 1],
                    data[i * 4 + 2],
                );
                data[i * 4] = tRGB[0];
                data[i * 4 + 1] = tRGB[1];
                data[i * 4 + 2] = tRGB[2];
            }

            context.putImageData(imageData, 0, 0);

            // Convert to PNG ArrayBuffer
            const finalBlob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((b) => {
                    if (b) resolve(b);
                    else reject(new Error('Canvas toBlob failed'));
                }, 'image/png');
            });

            const arrayBuffer = await finalBlob.arrayBuffer();

            // Return v5 format
            return { data: arrayBuffer };
        });
    } catch (err) {
        console.warn('gsidem protocol registration failed', err);
    }
}

type BuildingRef = {
    source: string;
    sourceLayer?: string;
    filter?: any;
};

function ensureOverlays(map: maplibregl.Map) {
    if (!map.getSource('overlays')) {
        map.addSource('overlays', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
        });
    }

    if (!map.getLayer('overlay-lines')) {
        map.addLayer({
            id: 'overlay-lines',
            type: 'line',
            source: 'overlays',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
                'line-color': '#3b82f6',
                'line-width': 2,
                'line-opacity': 0.8,
            },
        });
    }

    if (!map.getLayer('overlay-points')) {
        map.addLayer({
            id: 'overlay-points',
            type: 'circle',
            source: 'overlays',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
                'circle-radius': ['coalesce', ['get', 'radius'], 8],
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff',
            },
        });
    }
}

function firstSymbolLayerId(map: maplibregl.Map): string | undefined {
    const layers = map.getStyle().layers ?? [];
    const firstSymbol = layers.find((l: any) => l.type === 'symbol');
    return firstSymbol?.id;
}

function findBuildingRef(map: maplibregl.Map): BuildingRef | null {
    const style = map.getStyle();
    const layers = style.layers ?? [];

    const candidates = layers.filter((l: any) => {
        const id = (l.id ?? '').toLowerCase();
        const srcLayer = (l['source-layer'] ?? '').toLowerCase();
        return (
            (l.type === 'fill' || l.type === 'fill-extrusion') &&
            (id.includes('building') || id.includes('buildings') || srcLayer.includes('building'))
        );
    });

    const picked = (candidates[0] as any) ?? null;
    if (!picked?.source) return null;

    return {
        source: picked.source,
        sourceLayer: picked['source-layer'],
        filter: picked.filter,
    };
}

function heightExpr(): any {
    return [
        'coalesce',
        ['to-number', ['get', 'render_height'], 0],
        ['to-number', ['get', 'height'], 0],
        ['*', ['to-number', ['get', 'levels'], 0], 3],
        0,
    ];
}

function baseHeightExpr(): any {
    return [
        'coalesce',
        ['to-number', ['get', 'render_min_height'], 0],
        ['to-number', ['get', 'min_height'], 0],
        0,
    ];
}

function ensure3DBuildings(map: maplibregl.Map): boolean {
    if (map.getLayer(BUILDINGS_3D_LAYER_ID)) return true;

    const ref = findBuildingRef(map);
    if (!ref) {
        return false;
    }

    const beforeId = firstSymbolLayerId(map);

    const layer: any = {
        id: BUILDINGS_3D_LAYER_ID,
        type: 'fill-extrusion',
        source: ref.source,
        minzoom: BUILDINGS_3D_MIN_ZOOM,
        paint: {
            'fill-extrusion-color': '#9ca3af',
            'fill-extrusion-height': heightExpr(),
            'fill-extrusion-base': baseHeightExpr(),
            'fill-extrusion-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                BUILDINGS_3D_MIN_ZOOM - 0.2,
                0,
                BUILDINGS_3D_MIN_ZOOM + 0.3,
                0.85,
            ],
        },
        layout: {
            visibility: 'none',
        },
    };

    if (ref.sourceLayer) layer['source-layer'] = ref.sourceLayer;
    if (ref.filter) layer.filter = ref.filter;

    map.addLayer(layer, beforeId);
    return true;
}

function ensureTerrainResources(map: maplibregl.Map) {
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, {
            type: 'raster-dem',
            tiles: ['gsidem://https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '国土地理院',
            maxzoom: 14,
        } as any);
    }

    if (!map.getLayer(TERRAIN_HILLSHADE_LAYER_ID)) {
        map.addLayer({
            id: TERRAIN_HILLSHADE_LAYER_ID,
            type: 'hillshade',
            source: TERRAIN_SOURCE_ID,
            paint: {
                'hillshade-exaggeration': 0.8,
                'hillshade-shadow-color': 'rgba(0, 0, 0, 0.4)',
            },
            layout: {
                visibility: 'none',
            },
        } as any);
    }
}

function setTerrainEnabled(map: maplibregl.Map, enabled: boolean) {
    ensureTerrainResources(map);

    map.setLayoutProperty(
        TERRAIN_HILLSHADE_LAYER_ID,
        'visibility',
        enabled ? 'visible' : 'none'
    );

    const anyMap = map as any;
    if (typeof anyMap.setTerrain !== 'function') {
        console.warn('[Terrain] map.setTerrain is not available in this maplibre-gl version.');
        return;
    }

    if (enabled) {
        anyMap.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: TERRAIN_EXAGGERATION });
    } else {
        anyMap.setTerrain(null);
    }
}

function setBuildingsEnabled(map: maplibregl.Map, enabled: boolean) {
    if (enabled) {
        ensure3DBuildings(map);
    }
    if (!map.getLayer(BUILDINGS_3D_LAYER_ID)) return;

    map.setLayoutProperty(
        BUILDINGS_3D_LAYER_ID,
        'visibility',
        enabled ? 'visible' : 'none'
    );
}

export function useMapLibre(containerRef: RefObject<HTMLDivElement>) {
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        registerGsidemProtocolOnce();

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: DEFAULT_STYLE,
            center: [139.7, 35.68],
            zoom: 12,
            pitch: 0,
            bearing: 0,
        });

        if (map.scrollZoom && typeof map.scrollZoom.enable === 'function') {
            map.scrollZoom.enable();
        }

        const attachManagers = () => {
            ensureOverlays(map);

            let lastTerrain: boolean | null = null;
            let lastBuildings: boolean | null = null;

            const update = () => {
                const z = map.getZoom();

                const terrainOn = z >= TERRAIN_MIN_ZOOM;
                const buildingsOn = z >= BUILDINGS_3D_MIN_ZOOM;

                if (lastTerrain !== terrainOn) {
                    lastTerrain = terrainOn;
                    setTerrainEnabled(map, terrainOn);
                }

                if (lastBuildings !== buildingsOn) {
                    lastBuildings = buildingsOn;
                    setBuildingsEnabled(map, buildingsOn);
                }

                const wantPitch = terrainOn || buildingsOn;
                map.easeTo({ pitch: wantPitch ? PITCH_3D : 0, duration: 350 });
            };

            update();
            map.on('zoomend', update);

            map.on('style.load', () => {
                lastTerrain = null;
                lastBuildings = null;
                update();
            });
        };

        map.on('load', () => {
            attachManagers();
            setIsLoaded(true);
        });

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            setIsLoaded(false);
        };
    }, [containerRef]);

    return { map: mapRef.current, isLoaded };
}
