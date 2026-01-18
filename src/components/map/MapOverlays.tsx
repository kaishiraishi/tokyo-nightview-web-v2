import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';

type MapOverlaysProps = {
    map: maplibregl.Map | null;
    sourceLocation: LngLat | null;
    currentLocation: LngLat | null;
    targetLocation: LngLat | null;
    rayResult: RayResult | null;
    profile: ProfileResponse | null;
    hoveredIndex: number | null;
    isFanMode: boolean;
    fanRayResults: FanRayResult[];
    previewFanConfig?: {
        deltaTheta: number;
        rayCount: number;
    } | null;
};

export function MapOverlays({ map, sourceLocation, currentLocation, targetLocation, rayResult, profile, hoveredIndex, isFanMode, fanRayResults, previewFanConfig }: MapOverlaysProps) {
    const overlayRef = useRef<MapboxOverlay | null>(null);

    // Initialize Deck.gl Overlay
    useEffect(() => {
        if (!map) return;
        if (overlayRef.current) return;

        // Use interleaved: false for easier debugging (overlay mode)
        const overlay = new MapboxOverlay({
            interleaved: false,
            layers: []
        });

        const add = () => {
            map.addControl(overlay);
            overlayRef.current = overlay;
        };

        if (map.loaded()) {
            add();
        } else {
            map.once('load', add);
        }

        return () => {
            map.off('load', add);
            if (overlayRef.current) {
                map.removeControl(overlayRef.current);
                overlayRef.current = null;
            }
        };
    }, [map]);

    // Update Deck.gl layers (Rays & Hit Points & Anchors)
    useEffect(() => {
        if (!overlayRef.current || !map) return;

        const rays: any[] = [];
        const hits: any[] = [];
        const anchors: any[] = []; // ✅ Deck marker anchors
        const rayEnds: any[] = []; // ✅ Ray endpoint visualization
        let rimSegs: Array<{ source: [number, number, number], target: [number, number, number], color: [number, number, number, number] }> = [];  // ✅ Rim arc segments

        const terrainZ = (lng: number, lat: number): number | null => {
            const fn = (map as any).queryTerrainElevation;
            if (typeof fn !== 'function') return null;

            // Mapbox supports {exaggerated: true}
            const zEx = fn.call(map, [lng, lat], { exaggerated: true });
            if (Number.isFinite(zEx)) return zEx;

            const z = fn.call(map, [lng, lat]);
            if (!Number.isFinite(z)) return null;

            // Manual exaggeration fallback
            const terrain = (map as any).getTerrain?.();
            const ex = terrain?.exaggeration;
            if (Number.isFinite(ex)) return z * ex;

            return z;
        };

        const H_EYE = 1.6;
        const EPS = 0.1;

        // ✅ Gradient helpers for radar-style visualization
        const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const lerpColor = (a: [number, number, number, number], b: [number, number, number, number], t: number) =>
            [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)] as [number, number, number, number];

        // 赤→黄→緑 (t=0近い=赤, t=1遠い=緑)
        const rampRYG = (t: number): [number, number, number, number] => {
            const u = clamp01(t); // t=0→赤, t=1→緑 (no inversion)
            const RED: [number, number, number, number] = [255, 60, 60, 230];
            const YEL: [number, number, number, number] = [255, 210, 0, 230];
            const GRN: [number, number, number, number] = [0, 255, 170, 230];
            if (u < 0.5) return lerpColor(RED, YEL, u / 0.5);
            return lerpColor(YEL, GRN, (u - 0.5) / 0.5);
        };

        const haversineMeters = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
            const R = 6371000;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const dLat = toRad(b.lat - a.lat);
            const dLng = toRad(b.lng - a.lng);
            const lat1 = toRad(a.lat);
            const lat2 = toRad(b.lat);
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
        };

        // Fixed range for gradient normalization (adjustable)
        const RANGE_MIN_M = 100;
        const RANGE_MAX_M = 2000;

        if (isFanMode) {
            if (!sourceLocation) {
                overlayRef.current.setProps({ layers: [] });
                return;
            }

            const startLng = sourceLocation.lng;
            const startLat = sourceLocation.lat;

            // DSM-derived Z (from MapView results)
            const zFromResults = fanRayResults.find(
                r => Number.isFinite(r.rayGeometry?.start.z as number)
            )?.rayGeometry?.start.z as number | undefined;

            // Map terrain surface Z
            const terrainStart = terrainZ(startLng, startLat);

            // If neither DSM nor Terrain is available, skip rendering to avoid artifacts
            // BUT allow rendering if we are in preview mode (just use fallback Z)
            if (terrainStart === null && zFromResults === undefined && !previewFanConfig) {
                overlayRef.current.setProps({ layers: [] });
                return;
            }

            // Raw start Z (DSM preferred, else Terrain + Eye)
            const rawStartZ =
                (zFromResults !== undefined && Number.isFinite(zFromResults))
                    ? zFromResults
                    : ((terrainStart ?? 0) + H_EYE);

            // ✅ Calculate offset to align DSM data with Visual Terrain
            const verticalOffset =
                (terrainStart !== null && zFromResults !== undefined && Number.isFinite(zFromResults))
                    ? (terrainStart - (zFromResults - H_EYE))
                    : 0;

            // ✅ Corrected Start Z
            const startZ = rawStartZ + verticalOffset;

            // Draw Source (Blue) in Deck
            anchors.push({
                position: [startLng, startLat, startZ + 0.3],
                color: [59, 130, 246], // blue
                radius: 12,
            });

            // Draw Target (Red) in Deck if exists
            if (targetLocation) {
                const tZ = terrainZ(targetLocation.lng, targetLocation.lat);
                if (tZ !== null) {
                    anchors.push({
                        position: [targetLocation.lng, targetLocation.lat, tZ + EPS],
                        color: [239, 68, 68], // red
                        radius: 10,
                    });
                }
            }

            const hasResults = fanRayResults.length > 0;

            // --- MODE: RESULTS (Confirmed results exist) ---
            if (hasResults) {
                const scanMaxRangeM = fanRayResults.reduce((mx, r) => {
                    if (!r.rayGeometry) return mx;
                    const A = { lng: startLng, lat: startLat };
                    const m = r.maxRangePoint
                        ? haversineMeters(A, { lng: r.maxRangePoint.lng, lat: r.maxRangePoint.lat })
                        : haversineMeters(A, { lng: r.rayGeometry.end.lng, lat: r.rayGeometry.end.lat });
                    return Math.max(mx, m);
                }, 0);
                const rangeMin = RANGE_MIN_M;
                const rangeMax = Math.max(RANGE_MAX_M, scanMaxRangeM);

                fanRayResults.forEach((r, i) => {
                    if (!r.rayGeometry) return;

                    const endLng = r.rayGeometry.end.lng;
                    const endLat = r.rayGeometry.end.lat;

                    const endZRaw = r.rayGeometry.end.z;
                    const tzEnd = terrainZ(endLng, endLat);

                    let endZ: number;
                    let zKind: 'raw' | 'terrain' | 'fallback';

                    if (r.hit) {
                        if (Number.isFinite(endZRaw)) {
                            endZ = (endZRaw as number) + verticalOffset;
                            zKind = 'raw';
                        } else if (tzEnd !== null) {
                            endZ = tzEnd + EPS;
                            zKind = 'terrain';
                        } else {
                            endZ = startZ;
                            zKind = 'fallback';
                        }
                    } else {
                        if (tzEnd !== null) {
                            endZ = tzEnd + EPS;
                            zKind = 'terrain';
                        } else {
                            endZ = startZ;
                            zKind = 'fallback';
                        }
                    }

                    const A = { lng: startLng, lat: startLat };
                    const maxRangeM = r.maxRangePoint
                        ? haversineMeters(A, { lng: r.maxRangePoint.lng, lat: r.maxRangePoint.lat })
                        : haversineMeters(A, { lng: endLng, lat: endLat });

                    const visibleM = (r.hit && Number.isFinite(r.distance as number) && (r.distance as number) > 0)
                        ? (r.distance as number)
                        : maxRangeM;

                    const tVis = clamp01((visibleM - rangeMin) / (rangeMax - rangeMin));
                    const rimColor = rampRYG(tVis);

                    rays.push({
                        source: [startLng, startLat, startZ],
                        target: [endLng, endLat, endZ],
                        color: [80, 220, 255, 180], // Cyan
                        zKind,
                    });

                    rayEnds.push({
                        position: [endLng, endLat, endZ + 0.2],
                        color: rimColor,
                        rimColor,
                        radius: 5,
                        i,
                        zKind,
                        endZRaw,
                        tz: tzEnd,
                        tVis,
                    });

                    if (r.hit && r.hitPoint) {
                        const A = { lng: startLng, lat: startLat };
                        const B = { lng: endLng, lat: endLat };
                        const H = { lng: r.hitPoint.lng, lat: r.hitPoint.lat };
                        const AB = haversineMeters(A, B);
                        const AH = haversineMeters(A, H);
                        const t = AB > 0 ? Math.max(0, Math.min(1, AH / AB)) : 0;
                        const hitZ = startZ + t * (endZ - startZ);
                        hits.push({
                            position: [H.lng, H.lat, hitZ + 0.2],
                            color: [245, 158, 11],
                            radius: 8,
                        });
                    }
                });

                // ✅ Create rim segments for rainbow arc visualization
                const sortedEnds = [...rayEnds].sort((a: any, b: any) => a.i - b.i);

                rimSegs = [];
                for (let k = 0; k < sortedEnds.length - 1; k++) {
                    const p0 = sortedEnds[k];
                    const p1 = sortedEnds[k + 1];
                    rimSegs.push({
                        source: p0.position as [number, number, number],
                        target: p1.position as [number, number, number],
                        color: p0.rimColor ?? [255, 255, 255, 200],
                    });
                }

                // ✅ Only close rim for 360° scans
                const isFullCircle =
                    fanRayResults.length > 3 &&
                    Math.abs(((fanRayResults[fanRayResults.length - 1].azimuth - fanRayResults[0].azimuth + 360) % 360) - 360) < 15;

                if (isFullCircle && sortedEnds.length > 2) {
                    const pLast = sortedEnds[sortedEnds.length - 1];
                    const pFirst = sortedEnds[0];
                    rimSegs.push({
                        source: pLast.position as [number, number, number],
                        target: pFirst.position as [number, number, number],
                        color: pLast.rimColor ?? [255, 255, 255, 200],
                    });
                }
            }
            // --- MODE: PREVIEW (No results, interactive adjustment) ---
            else if (previewFanConfig && targetLocation) {
                const { deltaTheta } = previewFanConfig;

                const centerAzimuth = ((): number => {
                    const y = Math.sin((targetLocation.lng - startLng) * Math.PI / 180) * Math.cos(targetLocation.lat * Math.PI / 180);
                    const x = Math.cos(startLat * Math.PI / 180) * Math.sin(targetLocation.lat * Math.PI / 180) -
                        Math.sin(startLat * Math.PI / 180) * Math.cos(targetLocation.lat * Math.PI / 180) * Math.cos((targetLocation.lng - startLng) * Math.PI / 180);
                    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
                })();

                const distM = haversineMeters({ lng: startLng, lat: startLat }, { lng: targetLocation.lng, lat: targetLocation.lat });

                const drawPreviewRay = (azimuth: number, isCenter: boolean) => {
                    const R = 6371000;
                    const br = azimuth * Math.PI / 180;
                    const lat1 = startLat * Math.PI / 180;
                    const lng1 = startLng * Math.PI / 180;
                    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distM / R) + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br));
                    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1), Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2));
                    const endLat = lat2 * 180 / Math.PI;
                    const endLng = lng2 * 180 / Math.PI;

                    const tZ = terrainZ(endLng, endLat) ?? 0;
                    const endZ = tZ + EPS;

                    rays.push({
                        source: [startLng, startLat, startZ],
                        target: [endLng, endLat, endZ],
                        color: isCenter ? [255, 255, 255, 100] : [80, 220, 255, 120],
                    });

                    return [endLng, endLat, endZ] as [number, number, number];
                };

                const pLeft = drawPreviewRay(centerAzimuth - deltaTheta / 2, false);
                const pCenter = drawPreviewRay(centerAzimuth, true);
                const pRight = drawPreviewRay(centerAzimuth + deltaTheta / 2, false);

                rimSegs = [
                    { source: pLeft, target: pCenter, color: [80, 220, 255, 120] },
                    { source: pCenter, target: pRight, color: [80, 220, 255, 120] }
                ];

                // Add center anchor red
                anchors.push({ position: pCenter, color: [239, 68, 68], radius: 10 });
            }

        } else if (sourceLocation && targetLocation) {
            // SINGLE RAY (NO FAN)
            const tStart = terrainZ(sourceLocation.lng, sourceLocation.lat);
            const tEnd = terrainZ(targetLocation.lng, targetLocation.lat);

            const startZ = (tStart ?? 0) + H_EYE;
            const endZ = (tEnd ?? 0) + EPS;

            rays.push({
                source: [sourceLocation.lng, sourceLocation.lat, startZ],
                target: [targetLocation.lng, targetLocation.lat, endZ],
                color: rayResult?.hit ? [239, 68, 68] : [16, 185, 129],
            });

            anchors.push({ position: [sourceLocation.lng, sourceLocation.lat, startZ], color: [59, 130, 246], radius: 12 });
            anchors.push({ position: [targetLocation.lng, targetLocation.lat, endZ], color: [239, 68, 68], radius: 10 });

            if (rayResult?.hit && rayResult.hitPoint) {
                const A = { lng: sourceLocation.lng, lat: sourceLocation.lat };
                const B = { lng: targetLocation.lng, lat: targetLocation.lat };
                const H = { lng: rayResult.hitPoint.lng, lat: rayResult.hitPoint.lat };

                const AB = haversineMeters(A, B);
                const AH = haversineMeters(A, H);
                const t = AB > 0 ? Math.max(0, Math.min(1, AH / AB)) : 0;

                const hitZ = startZ + t * (endZ - startZ);

                hits.push({
                    position: [H.lng, H.lat, hitZ + 0.2],
                    color: [245, 158, 11],
                    radius: 8,
                });
            }
        }

        const layers = [
            new LineLayer({
                id: 'fan-rim',
                data: rimSegs,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getSourcePosition: (d: any) => d.source,
                getTargetPosition: (d: any) => d.target,
                getColor: (d: any) => d.color,
                getWidth: 6,
                widthUnits: 'pixels',
                parameters: { depthTest: false },
            }),
            new LineLayer({
                id: 'rays-3d',
                data: rays,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getSourcePosition: (d: any) => d.source,
                getTargetPosition: (d: any) => d.target,
                getColor: (d: any) => d.color,
                getWidth: 2,
                widthUnits: 'pixels',
                parameters: { depthTest: false },
            }),
            new ScatterplotLayer({
                id: 'hits-3d',
                data: hits,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.color,
                getRadius: (d: any) => d.radius ?? 8,
                radiusUnits: 'pixels',
                stroked: true,
                getLineColor: [255, 255, 255],
                getLineWidth: 2,
                parameters: { depthTest: false },
            }),
            new ScatterplotLayer({
                id: 'anchors-3d',
                data: anchors,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.color,
                getRadius: (d: any) => d.radius ?? 10,
                radiusUnits: 'pixels',
                stroked: true,
                getLineColor: [255, 255, 255],
                getLineWidth: 3,
                parameters: { depthTest: false },
            }),

        ];

        overlayRef.current.setProps({ layers });
    }, [isFanMode, fanRayResults, rayResult, map, sourceLocation, targetLocation, previewFanConfig]);


    // Update GeoJSON markers (Source, Target, Current, Hover)
    useEffect(() => {
        if (!map) return;

        const features: GeoJSON.Feature[] = [];

        if (currentLocation && currentLocation !== sourceLocation) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [currentLocation.lng, currentLocation.lat],
                },
                properties: {
                    color: '#10b981', // Green
                    type: 'current',
                },
            });
        }

        if (profile && hoveredIndex !== null) {
            const lng = profile.lngs[hoveredIndex];
            const lat = profile.lats[hoveredIndex];
            const elev = profile.elev_m[hoveredIndex];

            if (elev !== null) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat],
                    },
                    properties: {
                        color: '#ef4444', // Red
                        type: 'hover',
                    },
                });
            }
        }

        const source = map.getSource('overlays') as maplibregl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features,
            });
        }
    }, [map, sourceLocation, currentLocation, targetLocation, profile, hoveredIndex]);

    return null;
}
