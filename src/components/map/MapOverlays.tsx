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
};

export function MapOverlays({ map, sourceLocation, currentLocation, targetLocation, rayResult, profile, hoveredIndex, isFanMode, fanRayResults }: MapOverlaysProps) {
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
            if (terrainStart === null && zFromResults === undefined) {
                overlayRef.current.setProps({ layers: [] });
                return;
            }

            // Raw start Z (DSM preferred, else Terrain + Eye)
            const rawStartZ =
                (zFromResults !== undefined && Number.isFinite(zFromResults))
                    ? zFromResults
                    : (terrainStart! + H_EYE);

            // ✅ Calculate offset to align DSM data with Visual Terrain
            // verticalOffset = TerrainSurface - (DSM_Ground_Surface)
            const verticalOffset =
                (terrainStart !== null && zFromResults !== undefined && Number.isFinite(zFromResults))
                    ? (terrainStart - (zFromResults - H_EYE))
                    : 0;

            // ✅ Corrected Start Z
            const startZ = rawStartZ + verticalOffset;

            // Draw Source (Blue) in Deck
            anchors.push({
                position: [startLng, startLat, startZ + 0.3], // Slightly raised for visibility
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

            fanRayResults.forEach((r, i) => {
                if (!r.rayGeometry) return;

                const endLng = r.rayGeometry.end.lng;
                const endLat = r.rayGeometry.end.lat;

                const endZRaw = r.rayGeometry.end.z;
                const tzEnd = terrainZ(endLng, endLat);

                let endZ: number;
                let zKind: 'raw' | 'terrain' | 'fallback';

                if (r.hit) {
                    // Occluded: Prefer DSM occlusion point (end.z), align to display system
                    if (Number.isFinite(endZRaw)) {
                        endZ = (endZRaw as number) + verticalOffset;
                        zKind = 'raw';
                    } else if (tzEnd !== null) {
                        // Rare case where raw is missing, fall back to terrain
                        endZ = tzEnd + EPS;
                        zKind = 'terrain';
                    } else {
                        // Horizontal fallback maintained
                        endZ = startZ;
                        zKind = 'fallback';
                    }
                } else {
                    // ✅ Range display: No occlusion → drop to terrain (don't use air end.z)
                    if (tzEnd !== null) {
                        endZ = tzEnd + EPS;
                        zKind = 'terrain';
                    } else {
                        // Horizontal fallback maintained (ray won't disappear)
                        endZ = startZ;
                        zKind = 'fallback';
                    }
                }

                rays.push({
                    source: [startLng, startLat, startZ],
                    target: [endLng, endLat, endZ],
                    color: r.hit ? [239, 68, 68] : [16, 185, 129],
                    zKind,
                });

                // ✅ Endpoint visualization (color-coded by Z source)
                const endColor =
                    zKind === 'raw' ? [168, 85, 247] : // Purple: end.z available
                        zKind === 'terrain' ? [234, 179, 8] : // Yellow: terrainZ available
                            [107, 114, 128]; // Gray: fallback (startZ)

                rayEnds.push({
                    position: [endLng, endLat, endZ + 0.2],
                    color: endColor,
                    radius: zKind === 'fallback' ? 6 : 5,
                    i,
                    zKind,
                    endZRaw,
                    tz: tzEnd,
                });

                // Place orange hit point on the interpolated line
                if (r.hit && r.hitPoint) {
                    const haversineMeters = (a: any, b: any) => {
                        const R = 6371000;
                        const toRad = (d: number) => (d * Math.PI) / 180;
                        const dLat = toRad(b.lat - a.lat);
                        const dLng = toRad(b.lng - a.lng);
                        const lat1 = toRad(a.lat);
                        const lat2 = toRad(b.lat);
                        const h =
                            Math.sin(dLat / 2) ** 2 +
                            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
                        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
                    };

                    const A = { lng: startLng, lat: startLat };
                    const B = { lng: endLng, lat: endLat };
                    const H = { lng: r.hitPoint.lng, lat: r.hitPoint.lat };

                    const AB = haversineMeters(A, B);
                    const AH = haversineMeters(A, H);
                    const t = AB > 0 ? Math.max(0, Math.min(1, AH / AB)) : 0;

                    const hitZ = startZ + t * (endZ - startZ);

                    hits.push({
                        position: [H.lng, H.lat, hitZ + 0.2], // Slightly raised
                        color: [245, 158, 11],
                        radius: 8,
                    });
                }
            });

            // ✅ Console logging for debugging
            const counts = rayEnds.reduce((acc: any, d: any) => {
                acc[d.zKind] = (acc[d.zKind] ?? 0) + 1;
                return acc;
            }, {});
            console.log('[fan ray endZ kinds]', counts);

            // First 20 rays detailed
            console.table(rayEnds.slice(0, 20).map((d: any) => ({
                i: d.i,
                zKind: d.zKind,
                endZRaw: d.endZRaw,
                tz: d.tz,
                lng: d.position[0],
                lat: d.position[1],
                endZ: d.position[2],
            })));

            // ✅ dz measurement (DSM ellipsoid height vs GSI geoid height difference)
            const dzSamples = rayEnds.slice(0, 8).map((d: any) => {
                const Zmap = d.tz;
                const Zraw = d.endZRaw;
                return {
                    i: d.i,
                    zKind: d.zKind,
                    dz_map_minus_raw: (Number.isFinite(Zraw) && Zmap !== null) ? (Zmap - Zraw) : null,
                    tz: Zmap,
                    endZRaw: Zraw
                };
            });
            console.log('[dz measurement] DSM vs GSI terrain:');
            console.table(dzSamples);
        } else if (sourceLocation && targetLocation) {
            const tStart = terrainZ(sourceLocation.lng, sourceLocation.lat);
            const tEnd = terrainZ(targetLocation.lng, targetLocation.lat);

            const startZ = (tStart ?? 0) + H_EYE;
            const endZ = (tEnd ?? 0) + EPS;

            rays.push({
                source: [sourceLocation.lng, sourceLocation.lat, startZ],
                target: [targetLocation.lng, targetLocation.lat, endZ],
                color: rayResult?.hit ? [239, 68, 68] : [16, 185, 129],
            });

            // Draw Blue/Red markers in Deck
            anchors.push({ position: [sourceLocation.lng, sourceLocation.lat, startZ], color: [59, 130, 246], radius: 12 });
            anchors.push({ position: [targetLocation.lng, targetLocation.lat, endZ], color: [239, 68, 68], radius: 10 });

            if (rayResult?.hit && rayResult.hitPoint) {
                hits.push({
                    position: [rayResult.hitPoint.lng, rayResult.hitPoint.lat, rayResult.hitPoint.z ?? endZ],
                    color: [245, 158, 11],
                    radius: 8,
                });
            }
        }

        const layers = [
            new LineLayer({
                id: 'rays-3d',
                data: rays,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getSourcePosition: (d: any) => d.source,
                getTargetPosition: (d: any) => d.target,
                getColor: (d: any) => d.color,
                getWidth: 4,            // Thinner for fan
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
            // ✅ Anchors (Blue/Red markers) in Deck
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
            // ✅ Ray endpoints (color-coded by Z source)
            new ScatterplotLayer({
                id: 'ray-ends-3d',
                data: rayEnds,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.color,
                getRadius: (d: any) => d.radius ?? 5,
                radiusUnits: 'pixels',
                stroked: true,
                getLineColor: [255, 255, 255],
                getLineWidth: 1,
                parameters: { depthTest: false },
            }),
        ];

        overlayRef.current.setProps({ layers });
    }, [isFanMode, fanRayResults, rayResult, map, sourceLocation, targetLocation]);


    // Update GeoJSON markers (Source, Target, Current, Hover)
    useEffect(() => {
        if (!map) return;

        const features: GeoJSON.Feature[] = [];

        // Source Marker - REMOVED (Rendered in Deck.gl)

        // Current Location Marker
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

        // Target Marker - REMOVED (Rendered in Deck.gl)

        // Hover Marker
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
