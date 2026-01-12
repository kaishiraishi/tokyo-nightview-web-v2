import { useEffect, useRef, useState, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { DEFAULT_STYLE } from '../config/mapStyles';

// ============================================
// PLATEAU MVT Configuration
// ============================================

const PLATEAU_MVT_URL =
    'https://indigo-lab.github.io/plateau-lod2-mvt/{z}/{x}/{y}.pbf';

const PLATEAU_SOURCE_ID = 'plateau-bldg-mvt';
const PLATEAU_LAYER_ID = 'plateau-bldg-extrusion';

// ============================================
// Overlay Helpers (for profile line, etc.)
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
// PLATEAU MVT Buildings (fill-extrusion)
// ============================================

function addPlateauExtrusion(map: maplibregl.Map) {
    // Add source if not exists
    if (!map.getSource(PLATEAU_SOURCE_ID)) {
        map.addSource(PLATEAU_SOURCE_ID, {
            type: 'vector',
            tiles: [PLATEAU_MVT_URL],
            minzoom: 10,
            maxzoom: 16,
            attribution: 'Data: "plateau-lod2-mvt" (CC-BY-4.0) / based on Project PLATEAU',
        });
        console.log('[PLATEAU] Source added');
    }

    // Add layer if not exists
    if (!map.getLayer(PLATEAU_LAYER_ID)) {
        // Insert below first symbol layer (labels)
        const firstSymbolId = map
            .getStyle()
            .layers?.find((l) => l.type === 'symbol')?.id;

        map.addLayer(
            {
                id: PLATEAU_LAYER_ID,
                type: 'fill-extrusion',
                source: PLATEAU_SOURCE_ID,
                'source-layer': 'bldg', // Fixed for this tileset
                minzoom: 10,
                paint: {
                    'fill-extrusion-color': '#9ca3af',
                    'fill-extrusion-opacity': 0.9,
                    'fill-extrusion-height': ['coalesce', ['get', 'z'], 0], // Height in meters
                    'fill-extrusion-base': 0,
                },
            },
            firstSymbolId
        );
        console.log('[PLATEAU] Extrusion layer added, beforeId:', firstSymbolId);
    }
}

function removePlateauExtrusion(map: maplibregl.Map) {
    if (map.getLayer(PLATEAU_LAYER_ID)) {
        map.removeLayer(PLATEAU_LAYER_ID);
        console.log('[PLATEAU] Layer removed');
    }
    if (map.getSource(PLATEAU_SOURCE_ID)) {
        map.removeSource(PLATEAU_SOURCE_ID);
        console.log('[PLATEAU] Source removed');
    }
}

// Debug: Check if features are loaded
function debugPlateauFeatures(map: maplibregl.Map) {
    map.once('idle', () => {
        const feats = map.querySourceFeatures(PLATEAU_SOURCE_ID, { sourceLayer: 'bldg' });
        console.log('[PLATEAU] Features loaded:', feats.length);
        if (feats.length > 0) {
            console.log('[PLATEAU] Sample properties:', feats.slice(0, 3).map(f => f.properties));
        }
    });
}

// ============================================
// Main Hook
// ============================================

export function useMapLibre(containerRef: RefObject<HTMLDivElement>) {
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        if (!containerRef.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: DEFAULT_STYLE,
            center: [139.76, 35.68], // Tokyo 23-ku area
            zoom: 15.2,             // Above minzoom 10 for PLATEAU tiles
            pitch: 60,              // 3D view
            bearing: 0,
        });

        if (map.scrollZoom && typeof map.scrollZoom.enable === 'function') {
            map.scrollZoom.enable();
        }

        map.on('load', () => {
            console.log('[Map] Loaded');

            ensureOverlays(map);

            // Add PLATEAU buildings
            addPlateauExtrusion(map);

            // Debug: check if features are loaded
            debugPlateauFeatures(map);

            setIsLoaded(true);
        });

        // Re-add on style reload
        map.on('style.load', () => {
            console.log('[Map] Style reloaded');
            addPlateauExtrusion(map);
        });

        mapRef.current = map;

        // Cleanup
        return () => {
            console.log('[Map] Cleanup');
            removePlateauExtrusion(map);
            map.remove();
            mapRef.current = null;
            setIsLoaded(false);
        };
    }, [containerRef]);

    return { map: mapRef.current, isLoaded };
}
