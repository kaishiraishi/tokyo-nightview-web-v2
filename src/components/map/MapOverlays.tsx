import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LngLat, ProfileResponse } from '../../types/profile';

// Ray collision result type (same as in MapView)
type RayResult = {
    hit: boolean;
    distance: number | null;
    hitPoint: LngLat | null;
    elevation: number | null;
    reason: 'clear' | 'building' | 'terrain';
};

// Fan ray result (same as in MapView)
type FanRayResult = RayResult & {
    azimuth: number;
    rayIndex: number;
    maxRangePoint: LngLat;
};

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
    useEffect(() => {
        if (!map) return;

        const features: GeoJSON.Feature[] = [];

        // Add source location marker (blue)
        if (sourceLocation) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [sourceLocation.lng, sourceLocation.lat],
                },
                properties: {
                    color: '#3b82f6', // Blue
                    type: 'source',
                },
            });
        }

        // Add current location marker (green halo) if different from source
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

        // Add target location marker
        if (targetLocation) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [targetLocation.lng, targetLocation.lat],
                },
                properties: {
                    color: '#ef4444', // Red
                    type: 'target',
                },
            });
        }

        // Fan mode: Render multiple rays
        if (isFanMode && fanRayResults.length > 0 && sourceLocation) {
            fanRayResults.forEach((result) => {
                // Determine endpoint: hit point or max range point
                const endpoint = result.hitPoint || result.maxRangePoint;

                // Add ray line
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [sourceLocation.lng, sourceLocation.lat],
                            [endpoint.lng, endpoint.lat],
                        ],
                    },
                    properties: {
                        color: result.hit ? '#ef4444' : '#10b981', // Red if blocked, green if clear
                        opacity: 0.7,
                        type: 'fan-ray',
                    },
                });

                // Add hit point marker if ray is blocked
                if (result.hit && result.hitPoint) {
                    features.push({
                        type: 'Feature',
                        geometry: {
                            type: 'Point',
                            coordinates: [result.hitPoint.lng, result.hitPoint.lat],
                        },
                        properties: {
                            color: '#f59e0b', // Amber for hit points
                            type: 'fan-hit',
                            radius: 5,
                        },
                    });
                }
            });
        } else if (!isFanMode) {
            // Single ray mode: Render single ray (only if not in fan mode)
            const rayEndPoint = rayResult?.hitPoint || targetLocation;
            const isLineClear = !rayResult?.hit;

            if (sourceLocation && rayEndPoint) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: [
                            [sourceLocation.lng, sourceLocation.lat],
                            [rayEndPoint.lng, rayEndPoint.lat],
                        ],
                    },
                    properties: {
                        color: isLineClear ? '#3b82f6' : '#ef4444', // Blue if clear, red if occluded
                    },
                });
            }

            // Add occlusion point marker (if ray is blocked)
            if (!isLineClear && rayEndPoint && targetLocation &&
                (rayEndPoint.lng !== targetLocation.lng || rayEndPoint.lat !== targetLocation.lat)) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [rayEndPoint.lng, rayEndPoint.lat],
                    },
                    properties: {
                        color: '#f59e0b', // Amber/orange for occlusion point
                        type: 'occlusion',
                        radius: 10,
                    },
                });
            }
        }

        // Add hovered point marker (red highlight)
        if (profile && hoveredIndex !== null) {
            const lng = profile.lngs[hoveredIndex];
            const lat = profile.lats[hoveredIndex];
            const elev = profile.elev_m[hoveredIndex];

            if (elev !== null) {  // Only show if elevation is valid
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat],
                    },
                    properties: {
                        color: '#ef4444',  // Red
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
    }, [map, sourceLocation, currentLocation, targetLocation, rayResult, profile, hoveredIndex, isFanMode, fanRayResults]);

    return null;
}
