import { useEffect, useRef, useState, useMemo, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { useGsiTerrainSource } from 'maplibre-gl-gsi-terrain';
import { DEFAULT_STYLE } from '../config/mapStyles';

// ============================================
// PLATEAU MVT Configuration
// ============================================

const PLATEAU_MVT_URL =
    'https://ysk766.github.io/plateau_tokyo_2023_mvt_lod1/{z}/{x}/{y}.pbf';

const SOURCE_LAYER_ID = 'tokyo_all_fixedgeojsonl';
const HEIGHT_PROPERTY = 'height';

const PLATEAU_SOURCE_ID = 'plateau-bldg-mvt';
const PLATEAU_LAYER_ID = 'plateau-bldg-extrusion';

// ============================================
// Terrain Configuration
// ============================================

const TERRAIN_SOURCE_ID = 'terrainSource';
const HILLSHADE_SOURCE_ID = 'terrainHillshade';
const HILLSHADE_LAYER_ID = 'terrainHillshadeLayer';
const TERRAIN_EXAGGERATION = 1.8;

// ============================================
// VIIRS Night Light Configuration
// ============================================

const VIIRS_SOURCE_ID = 'viirs-nightlight';
const VIIRS_LAYER_ID = 'viirs-nightlight-layer';

const AERIAL_SOURCE_ID = 'aerial-photo';
const AERIAL_LAYER_ID = 'aerial-photo-layer';
const AERIAL_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg';

function addVIIRSNightLight(map: maplibregl.Map) {
    if (!map.getSource(VIIRS_SOURCE_ID)) {
        map.addSource(VIIRS_SOURCE_ID, {
            type: 'raster',
            tiles: [`${import.meta.env.BASE_URL}viirs_heat_tiles/tiles/{z}/{x}/{y}.png`],
            tileSize: 256,
            minzoom: 10,
            maxzoom: 12,
        });
        console.log('[VIIRS] Source added');
    }

    if (!map.getLayer(VIIRS_LAYER_ID)) {
        map.addLayer({
            id: VIIRS_LAYER_ID,
            type: 'raster',
            source: VIIRS_SOURCE_ID,
            layout: {
                visibility: 'none', // 常に非表示（サンプリング用にソースのみ利用）
            },
            paint: {
                'raster-opacity': 0,
            },
        });
        console.log('[VIIRS] Layer added as hidden');
    }
}

function addAerialPhoto(map: maplibregl.Map) {
    if (!map.getSource(AERIAL_SOURCE_ID)) {
        map.addSource(AERIAL_SOURCE_ID, {
            type: 'raster',
            tiles: [AERIAL_TILE_URL],
            tileSize: 256,
            attribution: '国土地理院',
        });
        console.log('[Aerial] Source added');
    }

    if (!map.getLayer(AERIAL_LAYER_ID)) {
        // ラベルなどの最下層にあるシンボルレイヤーを取得し、その手前に挿入する
        const firstSymbolId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;

        map.addLayer(
            {
                id: AERIAL_LAYER_ID,
                type: 'raster',
                source: AERIAL_SOURCE_ID,
                layout: {
                    visibility: 'none',
                },
                paint: {
                    'raster-opacity': 1,
                },
            },
            firstSymbolId
        );
        console.log('[Aerial] Layer added (hidden by default)');
    }
}

// ============================================
// Overlay Helpers
// ============================================

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
                'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
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

// ============================================
// PLATEAU MVT Buildings
// ============================================

function addPlateauExtrusion(map: maplibregl.Map) {
    if (!map.getSource(PLATEAU_SOURCE_ID)) {
        map.addSource(PLATEAU_SOURCE_ID, {
            type: 'vector',
            tiles: [PLATEAU_MVT_URL],
            minzoom: 10,
            maxzoom: 15,
            attribution: 'plateau_tokyo_2023_mvt_lod1',
        });
        console.log('[PLATEAU] Source added');
    }

    if (!map.getLayer(PLATEAU_LAYER_ID)) {
        const firstSymbolId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;

        // ズームレベル13以上で表示、フェードイン効果付き
        map.addLayer(
            {
                id: PLATEAU_LAYER_ID,
                type: 'fill-extrusion',
                source: PLATEAU_SOURCE_ID,
                'source-layer': SOURCE_LAYER_ID,
                minzoom: 13,
                paint: {
                    'fill-extrusion-color': '#9ca3af',
                    // ズーム13-14でフェードイン (0→0.9)
                    'fill-extrusion-opacity': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        13, 0,
                        14, 0.9,
                    ],
                    'fill-extrusion-height': ['coalesce', ['get', HEIGHT_PROPERTY], 10],
                    'fill-extrusion-base': 0,
                },
            },
            firstSymbolId
        );
        console.log('[PLATEAU] Layer added (minzoom: 13)');
    }
}

// ============================================
// Label Localization (Force Japanese)
// ============================================
function forceJapaneseLabels(map: maplibregl.Map) {
    const style = map.getStyle();
    if (!style || !style.layers) return;

    for (const layer of style.layers) {
        if (layer.type === 'symbol') {
            const layout = layer.layout || {};
            // If it has a text-field, overwrite it to prioritize Japanese
            if (layout['text-field']) {
                map.setLayoutProperty(layer.id, 'text-field', [
                    'coalesce',
                    ['get', 'name:ja'],
                    ['get', 'name'],
                    ['get', 'name:latin']
                ]);
            }
        }
    }
    console.log('[Map] Labels forced to Japanese');
}

// ============================================
// Mask Non-Tokyo Areas
// ============================================
function addTokyoMask(map: maplibregl.Map) {
    const MASK_SOURCE_ID = 'tokyo-mask-source';
    const MASK_LAYER_ID = 'tokyo-mask-layer';

    const WORLD_BOUNDS = [
        [-180, -90],
        [180, -90],
        [180, 90],
        [-180, 90],
        [-180, -90],
    ];

    // Counter-clockwise for global outer ring (GeoJSON recommendation)
    // Actually MapLibre usually takes external ring as CCW? Or CW?
    // Let's stick to standard: Exterior ring CCW, Interior ring CW. The standard is confusing.
    // Spec says: Exterior ring is CCW.

    // Tokyo Rect (Hole)
    // [138.9, 35.2] to [140.2, 35.9]
    // Clockwise for hole
    const TOKYO_HOLE = [
        [138.9, 35.2], // SW
        [138.9, 35.9], // NW
        [140.2, 35.9], // NE
        [140.2, 35.2], // SE
        [138.9, 35.2], // SW
    ];

    if (!map.getSource(MASK_SOURCE_ID)) {
        map.addSource(MASK_SOURCE_ID, {
            type: 'geojson',
            data: {
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [WORLD_BOUNDS, TOKYO_HOLE],
                },
                properties: {},
            },
        });
    }

    if (!map.getLayer(MASK_LAYER_ID)) {
        map.addLayer({
            id: MASK_LAYER_ID,
            type: 'fill',
            source: MASK_SOURCE_ID,
            layout: {},
            paint: {
                'fill-color': '#000000',
                'fill-opacity': 0.4,
            },
        });
    }
}

// ============================================
// GSI Terrain
// ============================================

function addTerrain(
    map: maplibregl.Map,
    gsiTerrainSource: maplibregl.SourceSpecification,
    exaggeration: number
) {
    const terrainSource = { ...(gsiTerrainSource as any) } as any;
    if ('scheme' in terrainSource) {
        delete terrainSource.scheme;
    }

    if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, terrainSource);
        console.log('[Terrain] Source added');
    }

    try {
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
        console.log('[Terrain] Enabled');
    } catch (err) {
        console.warn('[Terrain] setTerrain error:', err);
    }

    if (!map.getSource(HILLSHADE_SOURCE_ID)) {
        map.addSource(HILLSHADE_SOURCE_ID, { ...terrainSource } as any);
    }

    if (!map.getLayer(HILLSHADE_LAYER_ID)) {
        map.addLayer({
            id: HILLSHADE_LAYER_ID,
            type: 'hillshade',
            source: HILLSHADE_SOURCE_ID,
            paint: { 'hillshade-exaggeration': 0.4 },
        });
        console.log('[Terrain] Hillshade added');
    }
}

// ============================================
// Main Hook
// ============================================

const TOKYO_BOUNDS: maplibregl.LngLatBoundsLike = [
    [138.9, 35.2],
    [140.2, 35.9],
];

export function useMapLibre(containerRef: RefObject<HTMLDivElement>) {
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    const gsiTerrainSource = useMemo(
        () => useGsiTerrainSource(maplibregl.addProtocol, { maxzoom: 9 }),
        []
    );

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: DEFAULT_STYLE,
            center: [139.76, 35.68],
            zoom: 9,
            pitch: 0,
            bearing: 0,
            maxPitch: 85,
        });

        map.scrollZoom?.enable?.();

        map.on('load', () => {
            // Prevent race condition: if this map was already cleaned up (removed), ignore the load event
            if (mapRef.current !== map) return;

            console.log('[Map] Loaded');
            map.fitBounds(TOKYO_BOUNDS, {
                padding: { top: 40, bottom: 40, left: 40, right: 40 },
                pitch: 0,
                bearing: 0,
                duration: 0,
                maxZoom: 11,
            });
            ensureOverlays(map);
            addTerrain(map, gsiTerrainSource, TERRAIN_EXAGGERATION);
            addPlateauExtrusion(map);
            addVIIRSNightLight(map);
            addAerialPhoto(map);

            // Mask non-Tokyo areas
            addTokyoMask(map);

            // Apply label fix
            forceJapaneseLabels(map);

            setIsLoaded(true);
        });

        map.on('style.load', () => {
            console.log('[Map] Style reloaded');
            addTerrain(map, gsiTerrainSource, TERRAIN_EXAGGERATION);
            addVIIRSNightLight(map);
            addAerialPhoto(map);
            addPlateauExtrusion(map);

            // Mask non-Tokyo areas
            addTokyoMask(map);

            // Apply label fix
            forceJapaneseLabels(map);
        });

        mapRef.current = map;

        return () => {
            map.remove();
            mapRef.current = null;
            setIsLoaded(false);
        };
    }, [containerRef, gsiTerrainSource]);

    return { map: mapRef.current, isLoaded };
}
