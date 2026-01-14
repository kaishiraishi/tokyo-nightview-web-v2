import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LngLat } from '../../types/profile';

type MapOverlaysProps = {
    map: maplibregl.Map | null;
    sourceLocation: LngLat | null;
    currentLocation: LngLat | null;
    targetLocation: LngLat | null;
};

export function MapOverlays({ map, sourceLocation, currentLocation, targetLocation }: MapOverlaysProps) {
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

        // Add line between source and target
        if (sourceLocation && targetLocation) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [sourceLocation.lng, sourceLocation.lat],
                        [targetLocation.lng, targetLocation.lat],
                    ],
                },
                properties: {},
            });
        }

        const source = map.getSource('overlays') as maplibregl.GeoJSONSource;
        if (source) {
            source.setData({
                type: 'FeatureCollection',
                features,
            });
        }
    }, [map, sourceLocation, currentLocation, targetLocation]);

    return null;
}
