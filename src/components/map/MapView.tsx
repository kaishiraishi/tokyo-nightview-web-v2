import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapLibre } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import type { LngLat, ProfileResponse } from '../../types/profile';
import 'maplibre-gl/dist/maplibre-gl.css';

type MapViewProps = {
    onProfileChange: (profile: ProfileResponse | null) => void;
};

export function MapView({ onProfileChange }: MapViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, isLoaded } = useMapLibre(containerRef);
    const { location: currentLocation, error: geoError } = useGeolocation();

    const [targetLocation, setTargetLocation] = useState<LngLat | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Handle map click to set target
    useEffect(() => {
        if (!map || !isLoaded) return;

        const handleClick = (e: maplibregl.MapMouseEvent) => {
            setTargetLocation({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
        };

        map.on('click', handleClick);

        return () => {
            map.off('click', handleClick);
        };
    }, [map, isLoaded]);

    // Fetch profile when both locations are set
    useEffect(() => {
        if (!currentLocation || !targetLocation) {
            onProfileChange(null);
            return;
        }

        const loadProfile = async () => {
            setLoading(true);
            setError(null);
            try {
                const start = new maplibregl.LngLat(currentLocation.lng, currentLocation.lat);
                const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                const distanceM = start.distanceTo(end);

                // 10m間隔でサンプリング（最低120点、最大500点に制限）
                const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                const profile = await fetchProfile(currentLocation, targetLocation, sampleCount);
                onProfileChange(profile);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load profile';
                setError(message);
                onProfileChange(null);
            } finally {
                setLoading(false);
            }
        };

        loadProfile();
    }, [currentLocation, targetLocation, onProfileChange]);

    // Center map on current location when available
    useEffect(() => {
        if (map && currentLocation && isLoaded) {
            map.flyTo({
                center: [currentLocation.lng, currentLocation.lat],
                zoom: 14,
                duration: 1000,
            });
        }
    }, [map, currentLocation, isLoaded]);

    return (
        <div className="relative w-full h-full">
            <div ref={containerRef} className="w-full h-full" />

            <MapOverlays
                map={map}
                currentLocation={currentLocation}
                targetLocation={targetLocation}
            />

            {/* Status overlay */}
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-4 max-w-sm">
                <h2 className="text-lg font-semibold mb-2">Tokyo Nightview - Step 1</h2>

                {geoError && (
                    <div className="text-red-600 text-sm mb-2">
                        Location error: {geoError}
                    </div>
                )}

                {currentLocation && (
                    <div className="text-sm text-gray-700 mb-2">
                        📍 Current: {currentLocation.lat.toFixed(5)}, {currentLocation.lng.toFixed(5)}
                    </div>
                )}

                {targetLocation && (
                    <div className="text-sm text-gray-700 mb-2">
                        🎯 Target: {targetLocation.lat.toFixed(5)}, {targetLocation.lng.toFixed(5)}
                    </div>
                )}

                {!targetLocation && (
                    <div className="text-sm text-gray-500">
                        Click on the map to select a target point
                    </div>
                )}

                {loading && (
                    <div className="text-sm text-blue-600">
                        Loading elevation profile...
                    </div>
                )}

                {error && (
                    <div className="text-sm text-red-600">
                        Error: {error}
                    </div>
                )}
            </div>
        </div>
    );
}
