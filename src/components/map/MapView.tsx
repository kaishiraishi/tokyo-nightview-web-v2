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
    profile: ProfileResponse | null;
    hoveredIndex: number | null;
    clickedIndex: number | null;
};

export function MapView({ onProfileChange, profile, hoveredIndex, clickedIndex }: MapViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, isLoaded } = useMapLibre(containerRef);
    const { location: currentLocation, error: geoError } = useGeolocation();

    const [sourceLocation, setSourceLocation] = useState<LngLat | null>(null);
    const [targetLocation, setTargetLocation] = useState<LngLat | null>(null);
    const [isSettingSource, setIsSettingSource] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // Auto-set source location from geolocation when available
    useEffect(() => {
        if (currentLocation) {
            setSourceLocation(currentLocation);
        }
    }, [currentLocation]);

    // Fallback: Use map center when geolocation fails
    useEffect(() => {
        if (geoError && map && !sourceLocation) {
            const center = map.getCenter();
            setSourceLocation({ lng: center.lng, lat: center.lat });
        }
    }, [geoError, map, sourceLocation]);

    // Handle manual source location selection
    useEffect(() => {
        if (!map || !isLoaded || !isSettingSource) return;

        const handleSourceClick = (e: maplibregl.MapMouseEvent) => {
            setSourceLocation({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            setIsSettingSource(false);
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleSourceClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleSourceClick);
        };
    }, [map, isLoaded, isSettingSource]);

    // Handle map click to set target (only when not setting source)
    useEffect(() => {
        if (!map || !isLoaded || isSettingSource) return;

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
    }, [map, isLoaded, isSettingSource]);

    // Fetch profile when both source and target locations are set
    useEffect(() => {
        if (!sourceLocation || !targetLocation) {
            onProfileChange(null);
            return;
        }

        const loadProfile = async () => {
            setLoading(true);
            setError(null);
            try {
                const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                const distanceM = start.distanceTo(end);

                // 10m間隔でサンプリング（最低120点、最大500点に制限）
                const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                const profile = await fetchProfile(sourceLocation, targetLocation, sampleCount);
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
    }, [sourceLocation, targetLocation, onProfileChange]);

    // Fly to clicked point on profile chart
    useEffect(() => {
        if (!map || !profile || clickedIndex === null) return;

        const lng = profile.lngs[clickedIndex];
        const lat = profile.lats[clickedIndex];
        const elev = profile.elev_m[clickedIndex];

        if (elev === null) return;  // Skip null elevation points

        map.flyTo({
            center: [lng, lat],
            pitch: 60,
            duration: 1500,
        });
    }, [map, profile, clickedIndex]);

    // Center map on current location when available
    useEffect(() => {
        if (map && currentLocation && isLoaded) {
            map.flyTo({
                center: [currentLocation.lng, currentLocation.lat],
                duration: 1000,
            });
        }
    }, [map, currentLocation, isLoaded]);

    return (
        <div className="relative w-full h-full">
            <div ref={containerRef} className="w-full h-full" />

            <MapOverlays
                map={map}
                sourceLocation={sourceLocation}
                currentLocation={currentLocation}
                targetLocation={targetLocation}
                profile={profile}
                hoveredIndex={hoveredIndex}
            />

            {/* Status overlay */}
            <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-4 max-w-sm">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold mb-2">Tokyo Nightview - Step 1</h2>
                    <button
                        aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                        onClick={() => setIsCollapsed((s) => !s)}
                        className="ml-2 text-sm bg-gray-100 hover:bg-gray-200 rounded px-2 py-1"
                    >
                        {isCollapsed ? '▾' : '▴'}
                    </button>
                </div>

                {!isCollapsed && (
                    <>
                        {geoError && (
                    <div className="text-amber-600 text-sm mb-2 p-2 bg-amber-50 rounded">
                        <div className="font-semibold">📍 位置情報が利用できません</div>
                        <div className="mt-1 text-xs">
                            {geoError.includes('denied') || geoError.includes('permission') ? (
                                <>
                                    ブラウザの設定で位置情報を許可してください。<br />
                                    または地図中心を基準点として使用します。
                                </>
                            ) : (
                                <>位置情報エラー: {geoError}</>
                            )}
                        </div>
                    </div>
                )}

                {sourceLocation && (
                    <div className="text-sm text-gray-700 mb-2">
                        📍 基準点: {sourceLocation.lat.toFixed(5)}, {sourceLocation.lng.toFixed(5)}
                        {currentLocation && sourceLocation === currentLocation && (
                            <span className="text-xs text-green-600 ml-1">(現在地)</span>
                        )}
                    </div>
                )}

                {targetLocation && (
                    <div className="text-sm text-gray-700 mb-2">
                        🎯 目標点: {targetLocation.lat.toFixed(5)}, {targetLocation.lng.toFixed(5)}
                    </div>
                )}

                {!targetLocation && (
                    <div className="text-sm text-gray-500 mb-2">
                        {isSettingSource ? (
                            <span className="text-blue-600 font-semibold">地図をクリックして基準点を設定</span>
                        ) : (
                            '地図をクリックして目標点を選択'
                        )}
                    </div>
                )}

                <div className="flex gap-2 mb-2">
                    <button
                        onClick={() => setIsSettingSource(true)}
                        disabled={isSettingSource}
                        className="text-xs bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        基準点を手動設定
                    </button>
                </div>

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
                    </>
                )}
            </div>
        </div>
    );
}
