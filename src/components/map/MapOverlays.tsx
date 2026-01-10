import { useEffect } from 'react';
import type maplibregl from 'maplibre-gl';
import type { LngLat } from '../../types/profile';

type MapOverlaysProps = {
    map: maplibregl.Map | null;
    currentLocation: LngLat | null;
    targetLocation: LngLat | null;
};

export function MapOverlays({ map, currentLocation, targetLocation }: MapOverlaysProps) {
    useEffect(() => {
        if (!map) return;

        const features: GeoJSON.Feature[] = [];

        // Add current location marker
        if (currentLocation) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [currentLocation.lng, currentLocation.lat],
                },
                properties: {
                    color: '#3b82f6', // Blue
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

        // Add line between current and target
        if (currentLocation && targetLocation) {
            features.push({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: [
                        [currentLocation.lng, currentLocation.lat],
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
    }, [map, currentLocation, targetLocation]);

    return null;
}
