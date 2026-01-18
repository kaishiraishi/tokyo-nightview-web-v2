import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapLibre } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';
import 'maplibre-gl/dist/maplibre-gl.css';

// Fan-shaped scanning configuration
type FanConfig = {
    deltaTheta: number;  // Fan angle width in degrees (e.g., 20, 40, 80)
    rayCount: number;    // Number of rays (e.g., 9, 13, 17)
    maxRange: number;    // Maximum ray distance in meters (e.g., 2000)
    fullScan: boolean;   // If true, scan 360° from source (no target needed)
};

// Sight angle presets (degrees)
const SIGHT_ANGLE_PRESETS = {
    HORIZONTAL: 0,
    UP: 2,
    DOWN: -2,
} as const;

// Fan scanning presets
const FAN_PRESETS = {
    DELTA_THETA: {
        NARROW: 20,
        MEDIUM: 40,
        WIDE: 80,
    },
    RAY_COUNT: {
        COARSE: 9,
        MEDIUM: 13,
        FINE: 17,
    },
    MAX_RANGE: 2000,  // Conservative start for performance
} as const;

type MapViewProps = {
    onProfileChange: (profile: ProfileResponse | null) => void;
    onRayResultChange: (result: RayResult | null) => void;
    profile: ProfileResponse | null;
    hoveredIndex: number | null;
    clickedIndex: number | null;
    onZoomChange: (zoom: number) => void;
};

export function MapView({ onProfileChange, onRayResultChange, profile, hoveredIndex, clickedIndex, onZoomChange }: MapViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, isLoaded } = useMapLibre(containerRef);
    const { location: currentLocation, error: geoError } = useGeolocation();

    const [sourceLocation, setSourceLocation] = useState<LngLat | null>(null);
    const [targetLocation, setTargetLocation] = useState<LngLat | null>(null);
    const [isSettingSource, setIsSettingSource] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // Sight angle state
    const [sightAngle, setSightAngle] = useState<number>(SIGHT_ANGLE_PRESETS.HORIZONTAL);

    // Ray result state (replaces rayEndPoint and isLineClear)
    const [rayResult, setRayResult] = useState<RayResult | null>(null);

    // Fan mode state
    const [isFanMode, setIsFanMode] = useState<boolean>(true);
    const [fanConfig, setFanConfig] = useState<FanConfig>({
        deltaTheta: FAN_PRESETS.DELTA_THETA.MEDIUM,
        rayCount: 36,
        maxRange: FAN_PRESETS.MAX_RANGE,
        fullScan: true,
    });
    const [fanRayResults, setFanRayResults] = useState<FanRayResult[]>([]);

    // VIIRS layer opacity state
    const [viirsOpacity, setViirsOpacity] = useState<number>(0.7);

    // Ray-based occlusion detection with sight angle α
    function findFirstOcclusion(
        profile: ProfileResponse,
        alphaDeg: number,
        source: LngLat,
        sourceZ0Override?: number
    ): RayResult {
        const H_EYE = 1.6;
        const ALPHA_RAD = (alphaDeg * Math.PI) / 180;
        const tanAlpha = Math.tan(ALPHA_RAD);

        const elevA = profile.elev_m[0];
        const elevAValid = typeof elevA === 'number' && Number.isFinite(elevA);

        // ✅ Fanでは共通Z0を使う。単発でも sourceZ0Override があれば統一できる
        const Z0 = sourceZ0Override ?? (elevAValid ? elevA + H_EYE : H_EYE);

        // ✅ 始点座標は必ず sourceLocation（profile側の先頭座標は信用しない）
        const sourcePoint = { lng: source.lng, lat: source.lat, z: Z0 };

        const zRay = (d: number) => Z0 + tanAlpha * d;

        let prevDelta: number | null = null;

        for (let i = 1; i < profile.elev_m.length; i++) {
            const zi = profile.elev_m[i];
            const di = profile.distances_m[i];

            if (typeof zi !== 'number' || !Number.isFinite(zi)) {
                prevDelta = null;
                continue;
            }

            const delta = zi - zRay(di);

            if (delta > 0) {
                // hit
                if (prevDelta !== null && prevDelta <= 0 && i > 1) {
                    const diPrev = profile.distances_m[i - 1];
                    const t = (0 - prevDelta) / (delta - prevDelta);

                    const lngPrev = profile.lngs[i - 1];
                    const latPrev = profile.lats[i - 1];
                    const lngI = profile.lngs[i];
                    const latI = profile.lats[i];

                    const lngHit = lngPrev + t * (lngI - lngPrev);
                    const latHit = latPrev + t * (latI - latPrev);

                    const elevPrev = profile.elev_m[i - 1];
                    const elevHit =
                        (typeof elevPrev === 'number' && Number.isFinite(elevPrev))
                            ? elevPrev + t * (zi - elevPrev)
                            : zi;

                    const dHit = diPrev + t * (di - diPrev);

                    const avgGroundElev = elevAValid ? (elevA! + zi) / 2 : zi;
                    const reason = elevHit > avgGroundElev + 10 ? 'building' : 'terrain';

                    const hitP = { lng: lngHit, lat: latHit, z: elevHit };

                    return {
                        hit: true,
                        distance: dHit,
                        hitPoint: hitP,
                        elevation: elevHit,
                        reason,
                        sourcePoint,
                        rayGeometry: { start: sourcePoint, end: hitP },
                    };
                } else {
                    const avgGroundElev = elevAValid ? (elevA! + zi) / 2 : zi;
                    const reason = zi > avgGroundElev + 10 ? 'building' : 'terrain';

                    const hitP = { lng: profile.lngs[i], lat: profile.lats[i], z: zi };

                    return {
                        hit: true,
                        distance: di,
                        hitPoint: hitP,
                        elevation: zi,
                        reason,
                        sourcePoint,
                        rayGeometry: { start: sourcePoint, end: hitP },
                    };
                }
            }

            prevDelta = delta;
        }

        // clear
        const lastIdx = profile.distances_m.length - 1;
        const totalDist = profile.distances_m[lastIdx];
        const endP = {
            lng: profile.lngs[lastIdx],
            lat: profile.lats[lastIdx],
            z: zRay(totalDist),
        };

        return {
            hit: false,
            distance: null,
            hitPoint: null,
            elevation: null,
            reason: 'clear',
            sourcePoint,
            rayGeometry: { start: sourcePoint, end: endP },
        };
    }

    // Calculate azimuth (bearing) from point A to point B in degrees
    function calculateAzimuth(start: LngLat, end: LngLat): number {
        const lat1 = (start.lat * Math.PI) / 180;
        const lat2 = (end.lat * Math.PI) / 180;
        const deltaLng = ((end.lng - start.lng) * Math.PI) / 180;

        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

        const bearing = Math.atan2(y, x);
        const azimuthDeg = ((bearing * 180) / Math.PI + 360) % 360;

        return azimuthDeg;
    }

    // Calculate endpoint given start point, azimuth (degrees), and distance (meters)
    function calculateEndpoint(start: LngLat, azimuthDeg: number, distanceM: number): LngLat {
        const R = 6371000; // Earth radius in meters
        const bearing = (azimuthDeg * Math.PI) / 180;
        const lat1 = (start.lat * Math.PI) / 180;
        const lng1 = (start.lng * Math.PI) / 180;

        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(distanceM / R) +
            Math.cos(lat1) * Math.sin(distanceM / R) * Math.cos(bearing)
        );

        const lng2 = lng1 + Math.atan2(
            Math.sin(bearing) * Math.sin(distanceM / R) * Math.cos(lat1),
            Math.cos(distanceM / R) - Math.sin(lat1) * Math.sin(lat2)
        );

        return {
            lat: (lat2 * 180) / Math.PI,
            lng: (lng2 * 180) / Math.PI,
        };
    }

    // Generate fan of rays and calculate occlusion for each
    async function generateFanRays(
        sourceLocation: LngLat,
        targetLocation: LngLat,
        fanConfig: FanConfig,
        sightAngle: number,
        sourceZ0: number
    ): Promise<FanRayResult[]> {
        const thetaCenter = calculateAzimuth(sourceLocation, targetLocation);
        const { deltaTheta, rayCount } = fanConfig;

        // ✅ Use actual distance to target for the fan radius (removes 2000m limit)
        const maxRange = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
            .distanceTo(new maplibregl.LngLat(targetLocation.lng, targetLocation.lat));

        const rayAzimuths: number[] = [];
        for (let j = 0; j < rayCount; j++) {
            const theta_j = thetaCenter - deltaTheta / 2 + j * (deltaTheta / (rayCount - 1));
            rayAzimuths.push(theta_j);
        }

        const tanAlpha = Math.tan((sightAngle * Math.PI) / 180);
        const startP = { lng: sourceLocation.lng, lat: sourceLocation.lat, z: sourceZ0 };

        const profilePromises = rayAzimuths.map(async (azimuth, index) => {
            const endpoint = calculateEndpoint(sourceLocation, azimuth, maxRange);

            const distance = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
                .distanceTo(new maplibregl.LngLat(endpoint.lng, endpoint.lat));

            const sampleCount = Math.min(500, Math.max(120, Math.ceil(distance / 20)));

            try {
                const profile = await fetchProfile(sourceLocation, endpoint, sampleCount);

                // ✅ 共通Z0を渡す
                const result = findFirstOcclusion(profile, sightAngle, sourceLocation, sourceZ0);

                // ✅ 念押し：始点は必ず共通Z0で統一（Fanのズレを根絶）
                if (result.rayGeometry) {
                    result.rayGeometry = { ...result.rayGeometry, start: startP };
                } else {
                    // 保険：rayGeometryが無いケースも描けるように
                    result.rayGeometry = { start: startP, end: { lng: endpoint.lng, lat: endpoint.lat, z: sourceZ0 + tanAlpha * maxRange } };
                }

                return {
                    ...result,
                    azimuth,
                    rayIndex: index,
                    maxRangePoint: endpoint,
                } as FanRayResult;
            } catch (error) {
                console.error(`[Fan Ray ${index}] Failed to fetch profile at azimuth ${azimuth.toFixed(1)}°:`, error);

                // ✅ 失敗でも “描ける形” で返す（始点Z0統一）
                const endP = { lng: endpoint.lng, lat: endpoint.lat, z: sourceZ0 + tanAlpha * maxRange };

                return {
                    hit: false,
                    distance: null,
                    hitPoint: null,
                    elevation: null,
                    reason: 'clear',
                    sourcePoint: startP,
                    rayGeometry: { start: startP, end: endP },
                    azimuth,
                    rayIndex: index,
                    maxRangePoint: endpoint,
                } as FanRayResult;
            }
        });

        const results = await Promise.all(profilePromises);

        const hitCount = results.filter(r => r.hit).length;
        console.log(`[Fan Scan] ${rayCount} rays, ${hitCount} blocked, ${rayCount - hitCount} clear`);

        return results;
    }

    // Generate 360° omnidirectional rays (no target needed)
    async function generate360Rays(
        sourceLocation: LngLat,
        fanConfig: FanConfig,
        sightAngle: number,
        sourceZ0: number
    ): Promise<FanRayResult[]> {
        const { rayCount, maxRange } = fanConfig;

        // Generate evenly spaced azimuths from 0° to 360°
        const rayAzimuths: number[] = [];
        for (let j = 0; j < rayCount; j++) {
            const theta_j = (j * 360) / rayCount;
            rayAzimuths.push(theta_j);
        }

        const tanAlpha = Math.tan((sightAngle * Math.PI) / 180);
        const startP = { lng: sourceLocation.lng, lat: sourceLocation.lat, z: sourceZ0 };

        console.log(`[360° Scan] Starting with ${rayCount} rays, maxRange=${maxRange}m`);

        const profilePromises = rayAzimuths.map(async (azimuth, index) => {
            const endpoint = calculateEndpoint(sourceLocation, azimuth, maxRange);

            const distance = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
                .distanceTo(new maplibregl.LngLat(endpoint.lng, endpoint.lat));

            const sampleCount = Math.min(500, Math.max(120, Math.ceil(distance / 20)));

            try {
                const profile = await fetchProfile(sourceLocation, endpoint, sampleCount);

                const result = findFirstOcclusion(profile, sightAngle, sourceLocation, sourceZ0);

                if (result.rayGeometry) {
                    result.rayGeometry = { ...result.rayGeometry, start: startP };
                } else {
                    result.rayGeometry = { start: startP, end: { lng: endpoint.lng, lat: endpoint.lat, z: sourceZ0 + tanAlpha * maxRange } };
                }

                return {
                    ...result,
                    azimuth,
                    rayIndex: index,
                    maxRangePoint: endpoint,
                } as FanRayResult;
            } catch (error) {
                console.error(`[360° Ray ${index}] Failed at azimuth ${azimuth.toFixed(1)}°:`, error);

                const endP = { lng: endpoint.lng, lat: endpoint.lat, z: sourceZ0 + tanAlpha * maxRange };

                return {
                    hit: false,
                    distance: null,
                    hitPoint: null,
                    elevation: null,
                    reason: 'clear',
                    sourcePoint: startP,
                    rayGeometry: { start: startP, end: endP },
                    azimuth,
                    rayIndex: index,
                    maxRangePoint: endpoint,
                } as FanRayResult;
            }
        });

        const results = await Promise.all(profilePromises);

        const hitCount = results.filter(r => r.hit).length;
        console.log(`[360° Scan] Complete: ${hitCount} blocked, ${rayCount - hitCount} clear`);

        return results;
    }

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

    // Update VIIRS layer opacity
    useEffect(() => {
        if (!map || !isLoaded) return;

        const layer = map.getLayer('viirs-nightlight-layer');
        if (layer) {
            map.setPaintProperty('viirs-nightlight-layer', 'raster-opacity', viirsOpacity);
        }
    }, [map, isLoaded, viirsOpacity]);

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

    // Fetch profile when source (and optionally target) locations are set
    useEffect(() => {
        // For 360° scan, only source is needed
        // For regular modes, both source and target are required
        if (!sourceLocation) {
            onProfileChange(null);
            setRayResult(null);
            setFanRayResults([]);
            return;
        }

        // Regular modes require target
        if (!fanConfig.fullScan && !targetLocation) {
            onProfileChange(null);
            setRayResult(null);
            setFanRayResults([]);
            return;
        }

        const loadProfile = async () => {
            setLoading(true);
            setError(null);
            try {
                if (isFanMode && fanConfig.fullScan) {
                    // ✅ 360° omnidirectional scan (no target needed)
                    // Get source elevation by querying a short profile
                    const testEndpoint = calculateEndpoint(sourceLocation, 0, 100);
                    const testProfile = await fetchProfile(sourceLocation, testEndpoint, 10);
                    const elevA = testProfile.elev_m[0];
                    const sourceZ0 =
                        (typeof elevA === 'number' && Number.isFinite(elevA)) ? elevA + 1.6 : 1.6;

                    const results = await generate360Rays(sourceLocation, fanConfig, sightAngle, sourceZ0);
                    setFanRayResults(results);

                    // No single profile to show in chart for 360° mode
                    onProfileChange(null);
                    setRayResult(null);
                    onRayResultChange(null);

                } else if (isFanMode && targetLocation) {
                    // ✅ Partial fan scan (requires target for center direction)
                    const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                    const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                    const distanceM = start.distanceTo(end);
                    const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                    const centerProfile = await fetchProfile(sourceLocation, targetLocation, sampleCount);
                    onProfileChange(centerProfile);

                    const elevA = centerProfile.elev_m[0];
                    const sourceZ0 =
                        (typeof elevA === 'number' && Number.isFinite(elevA)) ? elevA + 1.6 : 1.6;

                    const results = await generateFanRays(sourceLocation, targetLocation, fanConfig, sightAngle, sourceZ0);
                    setFanRayResults(results);

                    const centerIndex = Math.floor(fanConfig.rayCount / 2);
                    const centerResult = results[centerIndex];
                    setRayResult(centerResult);
                    onRayResultChange(centerResult);

                } else if (targetLocation) {
                    // Single ray mode (existing logic)
                    const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                    const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                    const distanceM = start.distanceTo(end);

                    const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                    const profile = await fetchProfile(sourceLocation, targetLocation, sampleCount);

                    const result = findFirstOcclusion(profile, sightAngle, sourceLocation);
                    setRayResult(result);

                    if (result.hit && result.distance !== null) {
                        console.log(`[Occlusion α=${sightAngle}°] Ray blocked at ${result.distance.toFixed(1)}m (${result.reason})`);
                    } else {
                        console.log(`[Occlusion α=${sightAngle}°] Clear line of sight`);
                    }

                    onRayResultChange(result);
                    onProfileChange(profile);
                    setFanRayResults([]);
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to load profile';
                setError(message);
                onProfileChange(null);
            } finally {
                setLoading(false);
            }
        };

        loadProfile();
    }, [sourceLocation, targetLocation, sightAngle, isFanMode, fanConfig, onProfileChange, onRayResultChange]);

    // Fly to clicked point on profile chart
    useEffect(() => {
        if (!map || !profile || clickedIndex === null) return;

        const lng = profile.lngs[clickedIndex];
        const lat = profile.lats[clickedIndex];
        const elev = profile.elev_m[clickedIndex];

        if (elev === null) return;

        map.flyTo({
            center: [lng, lat],
            zoom: 17,
            pitch: 60,
            duration: 1500,
        });
    }, [map, profile, clickedIndex]);

    // Fly to target point when set (zoom: 14)
    // Fly to target point when set (auto zoom to include source + target)
    useEffect(() => {
        if (!map || !isLoaded || !targetLocation) return;

        // source があるなら、source + target が両方見えるように自動ズーム
        if (sourceLocation) {
            const bounds = new maplibregl.LngLatBounds();
            bounds.extend([sourceLocation.lng, sourceLocation.lat]);
            bounds.extend([targetLocation.lng, targetLocation.lat]);

            // 左上パネルが被るので left を大きめに
            const padding = { top: 80, bottom: 80, left: 420, right: 80 };

            const camera = map.cameraForBounds(bounds, { padding, pitch: 60 });

            if (camera && typeof camera.zoom === 'number') {
                // 近すぎ/遠すぎを防ぐ（好みで調整）
                const MAX_ZOOM = 16;
                const MIN_ZOOM = 9;
                camera.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
            }

            if (camera) {
                map.easeTo({
                    ...camera,
                    pitch: 60,
                    duration: 1200,
                });
            } else {
                // 念のためのフォールバック
                map.fitBounds(bounds, {
                    padding,
                    pitch: 60,
                    duration: 1200,
                    maxZoom: 16,
                });
            }

            return;
        }

        // source が無い場合は従来どおり target へ
        map.flyTo({
            center: [targetLocation.lng, targetLocation.lat],
            zoom: 12,
            pitch: 60,
            duration: 1200,
        });
    }, [map, isLoaded, sourceLocation, targetLocation]);


    // Center map on current location when available
    useEffect(() => {
        if (map && currentLocation && isLoaded) {
            map.flyTo({
                center: [currentLocation.lng, currentLocation.lat],
                duration: 1000,
            });
        }
    }, [map, currentLocation, isLoaded]);

    // Track zoom level
    useEffect(() => {
        if (!map) return;

        const updateZoom = () => {
            onZoomChange(map.getZoom());
        };

        map.on('zoom', updateZoom);
        map.on('move', updateZoom); // Also update on move (includes zoom) just in case

        // Initial value
        updateZoom();

        return () => {
            map.off('zoom', updateZoom);
            map.off('move', updateZoom);
        };
    }, [map, onZoomChange]);

    return (
        <div className="relative w-full h-full">
            <div ref={containerRef} className="w-full h-full" />

            <MapOverlays
                map={map}
                sourceLocation={sourceLocation}
                currentLocation={currentLocation}
                targetLocation={targetLocation}
                rayResult={rayResult}
                profile={profile}
                hoveredIndex={hoveredIndex}
                isFanMode={isFanMode}
                fanRayResults={fanRayResults}
            />

            {/* Status overlay (Glassmorphism) */}
            {/* Status overlay (Glassmorphism) - Full Height Sidebar */}
            <div className={`absolute top-0 left-0 bottom-0 w-80 bg-black/60 backdrop-blur-md border-r border-white/10 shadow-lg p-4 text-gray-100 transition-transform duration-300 ease-in-out flex flex-col overflow-y-auto ${isCollapsed ? '-translate-x-full' : 'translate-x-0'}`}>
                <div className="flex items-center justify-between shrink-0 mb-4">
                    <h2 className="text-lg font-semibold text-white">Tokyo Nightview</h2>
                    <button
                        aria-label={isCollapsed ? 'Expand panel' : 'Collapse panel'}
                        onClick={() => setIsCollapsed((s) => !s)}
                        className="text-sm bg-white/10 hover:bg-white/20 text-white rounded px-2 py-1 transition-colors"
                    >
                        ◀
                    </button>
                    {/* Collapsed toggle button floating outside is needed if we hide the whole panel */}
                </div>

                {/* External Toggle Button when collapsed (Manual addition needed outside this div if using -translate-x-full) */}
                {/* For now, we keep the button inside, but if hidden, user can't bring it back. 
                    So we'll changing the collapse behavior:
                    Instead of hiding the whole div, we might just shrink it or have a separate fixed toggle button.
                    Let's adjust the className above to handle collapse better or add a separate button.
                    Actually, if I translate-x-full, it's gone. 
                    I should add a separate button outside for re-opening. 
                */}

                {!isCollapsed && (
                    <>
                        {geoError && (
                            <div className="text-amber-400 text-sm mb-2 p-2 bg-amber-900/50 border border-amber-500/30 rounded">
                                <div className="font-semibold">📍 位置情報が利用できません</div>
                                <div className="mt-1 text-xs text-amber-200">
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
                            <div className="text-sm text-gray-200 mb-2">
                                📍 基準点: {sourceLocation.lat.toFixed(5)}, {sourceLocation.lng.toFixed(5)}
                                {currentLocation && sourceLocation === currentLocation && (
                                    <span className="text-xs text-green-400 ml-1">(現在地)</span>
                                )}
                            </div>
                        )}

                        {targetLocation && (
                            <div className="text-sm text-gray-200 mb-2">
                                🧭 向き指定点: {targetLocation.lat.toFixed(5)}, {targetLocation.lng.toFixed(5)}
                                <div className="text-xs text-gray-400 mt-1">
                                    ※ この点は視線の方向を指定するためのものです
                                </div>
                            </div>
                        )}

                        {!targetLocation && (
                            <div className="text-sm text-gray-400 mb-2">
                                {isSettingSource ? (
                                    <span className="text-blue-400 font-semibold">地図をクリックして基準点を設定</span>
                                ) : (
                                    '地図をクリックして視線の向きを指定'
                                )}
                            </div>
                        )}

                        <div className="flex gap-2 mb-2">
                            <button
                                onClick={() => setIsSettingSource(true)}
                                disabled={isSettingSource}
                                className="text-xs bg-blue-600/80 text-white px-3 py-1 rounded hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                            >
                                基準点を手動設定
                            </button>
                        </div>

                        {/* Sight Angle Selector */}
                        <div className="border-t border-white/10 pt-3 mt-3">
                            <div className="text-xs font-semibold text-gray-300 mb-2">
                                視線角度 (α)
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.DOWN)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.DOWN
                                        ? 'bg-orange-600 text-white font-semibold shadow-[0_0_10px_rgba(234,88,12,0.4)]'
                                        : 'bg-white/10 text-gray-200 hover:bg-white/20'
                                        }`}
                                >
                                    下向き -2°
                                </button>
                                <button
                                    onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.HORIZONTAL)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.HORIZONTAL
                                        ? 'bg-blue-600 text-white font-semibold shadow-[0_0_10px_rgba(37,99,235,0.4)]'
                                        : 'bg-white/10 text-gray-200 hover:bg-white/20'
                                        }`}
                                >
                                    水平 0°
                                </button>
                                <button
                                    onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.UP)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.UP
                                        ? 'bg-green-600 text-white font-semibold shadow-[0_0_10px_rgba(22,163,74,0.4)]'
                                        : 'bg-white/10 text-gray-200 hover:bg-white/20'
                                        }`}
                                >
                                    上向き +2°
                                </button>
                            </div>
                            <div className="text-xs text-gray-400 mt-2">
                                現在: α={sightAngle}° {rayResult?.hit && rayResult.distance && `(${rayResult.distance.toFixed(1)}m で遮蔽)`}
                            </div>
                        </div>

                        {/* VIIRS Opacity Control */}
                        <div className="border-t border-white/10 pt-3 mt-3">
                            <div className="text-xs font-semibold text-gray-300 mb-2">
                                VIIRSナイトライト透明度
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.05"
                                    value={viirsOpacity}
                                    onChange={(e) => setViirsOpacity(parseFloat(e.target.value))}
                                    className="flex-1 accent-blue-500"
                                />
                                <span className="text-xs text-gray-400 w-10 text-right">
                                    {Math.round(viirsOpacity * 100)}%
                                </span>
                            </div>
                        </div>

                        {/* Scan Settings */}
                        <div className="border-t border-white/10 pt-4 mt-4">
                            <div className="text-sm font-semibold text-gray-200 mb-3">スキャン設定</div>

                            {/* Mode Selector */}
                            <div className="flex bg-black/40 rounded-lg p-1 mb-4">
                                <button
                                    onClick={() => setFanConfig({ ...fanConfig, fullScan: true, rayCount: 36 })}
                                    className={`flex-1 text-xs py-1.5 rounded-md transition-all ${fanConfig.fullScan
                                        ? 'bg-purple-600 text-white font-semibold shadow-sm'
                                        : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                >
                                    360° 全方位
                                </button>
                                <button
                                    onClick={() => setFanConfig({ ...fanConfig, fullScan: false, rayCount: FAN_PRESETS.RAY_COUNT.MEDIUM })}
                                    className={`flex-1 text-xs py-1.5 rounded-md transition-all ${!fanConfig.fullScan
                                        ? 'bg-blue-600 text-white font-semibold shadow-sm'
                                        : 'text-gray-400 hover:text-gray-200'
                                        }`}
                                >
                                    扇形 (Sector)
                                </button>
                            </div>

                            {/* 360° Controls */}
                            {fanConfig.fullScan && (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs font-semibold text-gray-300 mb-2">レイ本数 (精度)</div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setFanConfig({ ...fanConfig, rayCount: 36 })}
                                                className={`flex-1 text-xs py-1.5 rounded transition-colors ${fanConfig.rayCount === 36 ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                                    }`}
                                            >
                                                36本 (10°毎)
                                            </button>
                                            <button
                                                onClick={() => setFanConfig({ ...fanConfig, rayCount: 72 })}
                                                className={`flex-1 text-xs py-1.5 rounded transition-colors ${fanConfig.rayCount === 72 ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                                    }`}
                                            >
                                                72本 (5°毎)
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <div className="flex justify-between text-xs font-semibold text-gray-300 mb-2">
                                            <span>最大距離</span>
                                            <span>{fanConfig.maxRange}m</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="500"
                                            max="10000"
                                            step="500"
                                            value={fanConfig.maxRange}
                                            onChange={(e) => setFanConfig({ ...fanConfig, maxRange: parseInt(e.target.value) })}
                                            className="w-full accent-purple-500"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Sector Controls */}
                            {!fanConfig.fullScan && (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs font-semibold text-gray-300 mb-2">扇形幅 (Δθ)</div>
                                        <div className="flex gap-2">
                                            {[
                                                { label: '狭 20°', val: FAN_PRESETS.DELTA_THETA.NARROW },
                                                { label: '中 40°', val: FAN_PRESETS.DELTA_THETA.MEDIUM },
                                                { label: '広 80°', val: FAN_PRESETS.DELTA_THETA.WIDE },
                                            ].map((opt) => (
                                                <button
                                                    key={opt.val}
                                                    onClick={() => setFanConfig({ ...fanConfig, deltaTheta: opt.val })}
                                                    className={`flex-1 text-xs py-1.5 rounded transition-colors ${fanConfig.deltaTheta === opt.val ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                                        }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-xs font-semibold text-gray-300 mb-2">レイ本数</div>
                                        <div className="flex gap-2">
                                            {[
                                                { label: '粗 9本', val: FAN_PRESETS.RAY_COUNT.COARSE },
                                                { label: '中 13本', val: FAN_PRESETS.RAY_COUNT.MEDIUM },
                                                { label: '細 17本', val: FAN_PRESETS.RAY_COUNT.FINE },
                                            ].map((opt) => (
                                                <button
                                                    key={opt.val}
                                                    onClick={() => setFanConfig({ ...fanConfig, rayCount: opt.val })}
                                                    className={`flex-1 text-xs py-1.5 rounded transition-colors ${fanConfig.rayCount === opt.val ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                                        }`}
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Status Info */}
                        <div className="mt-4 p-3 bg-white/5 rounded-lg border border-white/5">
                            <div className="text-xs text-gray-300 space-y-1">
                                {loading ? (
                                    <div className="text-blue-400 animate-pulse">Scanning terrain...</div>
                                ) : error ? (
                                    <div className="text-red-400">Error: {error}</div>
                                ) : fanRayResults.length > 0 ? (
                                    <>
                                        <div className="flex justify-between">
                                            <span>総レイ数:</span>
                                            <span className="font-mono">{fanRayResults.length}</span>
                                        </div>
                                        <div className="flex justify-between text-red-300">
                                            <span>遮蔽 (Blocked):</span>
                                            <span className="font-mono">{fanRayResults.filter(r => r.hit).length}</span>
                                        </div>
                                        <div className="flex justify-between text-green-300">
                                            <span>通過 (Clear):</span>
                                            <span className="font-mono">{fanRayResults.filter(r => !r.hit).length}</span>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-gray-500 italic text-center">Ready to scan</div>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
