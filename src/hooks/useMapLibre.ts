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

        map.addLayer(
            {
                id: PLATEAU_LAYER_ID,
                type: 'fill-extrusion',
                source: PLATEAU_SOURCE_ID,
                'source-layer': SOURCE_LAYER_ID,
                minzoom: 10,
                paint: {
                    'fill-extrusion-color': '#9ca3af',
                    'fill-extrusion-opacity': 0.9,
                    'fill-extrusion-height': ['coalesce', ['get', HEIGHT_PROPERTY], 10],
                    'fill-extrusion-base': 0,
                },
            },
            firstSymbolId
        );
        console.log('[PLATEAU] Layer added');

        // Debug: check features
        map.once('idle', () => {
            const feats = map.querySourceFeatures(PLATEAU_SOURCE_ID, { sourceLayer: SOURCE_LAYER_ID });
            console.log('[PLATEAU] Features loaded:', feats.length);
            if (feats.length > 0) {
                console.log('[PLATEAU] Sample:', feats[0].properties);
            }
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
    if (!map.getSource(TERRAIN_SOURCE_ID)) {
        map.addSource(TERRAIN_SOURCE_ID, gsiTerrainSource as any);
        console.log('[Terrain] Source added');
    }

    try {
        map.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration });
        console.log('[Terrain] Enabled');
    } catch (err) {
        console.warn('[Terrain] setTerrain error:', err);
    }

    if (!map.getSource(HILLSHADE_SOURCE_ID)) {
        map.addSource(HILLSHADE_SOURCE_ID, { ...(gsiTerrainSource as any) } as any);
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

export function useMapLibre(containerRef: RefObject<HTMLDivElement>) {
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    const gsiTerrainSource = useMemo(
        () => useGsiTerrainSource(maplibregl.addProtocol, { maxzoom: 14 }),
        []
    );

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: DEFAULT_STYLE,
            center: [139.76, 35.68],
            zoom: 15.2,
            pitch: 60,
            bearing: 0,
            maxPitch: 85,
        });

        map.scrollZoom?.enable?.();

        map.on('load', () => {
            console.log('[Map] Loaded');
            ensureOverlays(map);
            addTerrain(map, gsiTerrainSource, TERRAIN_EXAGGERATION);
            addPlateauExtrusion(map);
            setIsLoaded(true);
        });

        map.on('style.load', () => {
            console.log('[Map] Style reloaded');
            addTerrain(map, gsiTerrainSource, TERRAIN_EXAGGERATION);
            addPlateauExtrusion(map);
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
