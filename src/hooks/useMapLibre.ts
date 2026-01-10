import { useEffect, useRef, useState, type RefObject } from 'react';
import maplibregl from 'maplibre-gl';
import { DEFAULT_STYLE } from '../config/mapStyles';

const BUILDINGS_3D_LAYER_ID = 'buildings-3d';
const BUILDINGS_3D_MIN_ZOOM = 15;

const TERRAIN_SOURCE_ID = 'terrain-dem';
const TERRAIN_HILLSHADE_LAYER_ID = 'terrain-hillshade';
const TERRAIN_MIN_ZOOM = 12.5; // ここ以上で地形ON（好みで調整）
const TERRAIN_EXAGGERATION = 1.2;

const PITCH_3D = 60;



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

// 欠落に強い高さ推定
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

/**
 * 重要：高さはzoomで変えない（←これで「ズームで高さが変わる」症状を抑える）
 * フェードはopacityでやる
 */
function ensure3DBuildings(map: maplibregl.Map): boolean {
    if (map.getLayer(BUILDINGS_3D_LAYER_ID)) return true;

    const ref = findBuildingRef(map);
    if (!ref) {
        console.warn('[3D] No building layer found in this style. 3D buildings skipped.');
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
            // ズームで「出現」だけフェード（高さは固定）
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
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
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

    // hillshade は中ズームでも見せたいならここで visible にしてもOK
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
        // 無効化（型がうるさい場合があるので any 経由）
        anyMap.setTerrain(null);
    }
}

function setBuildingsEnabled(map: maplibregl.Map, enabled: boolean) {
    if (enabled) {
        const ok = ensure3DBuildings(map);
        if (!ok) return;
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

        const map = new maplibregl.Map({
            container: containerRef.current,
            style: DEFAULT_STYLE,
            center: [139.7, 35.68],
            zoom: 12,
            pitch: 0,
            bearing: 0,
        });

        // 明示的にスクロールズームを有効化（何らかの理由で無効化されている場合に備える）
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

                // pitchは「どっちかがON」の時だけ付ける（常時は重い）
                const wantPitch = terrainOn || buildingsOn;
                map.easeTo({ pitch: wantPitch ? PITCH_3D : 0, duration: 350 });
            };

            update();
            // 連続イベントでアニメーションを擦り合わせないよう、終了時に処理する
            map.on('zoomend', update);

            // style切替したときは custom layer/source が消えるので再注入
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
