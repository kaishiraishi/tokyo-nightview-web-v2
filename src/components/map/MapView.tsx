import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapLibre } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import type { LngLat, ProfileResponse } from '../../types/profile';
import 'maplibre-gl/dist/maplibre-gl.css';

// Ray collision result with detailed information
type RayResult = {
    hit: boolean;
    distance: number | null;
    hitPoint: LngLat | null;
    elevation: number | null;
    reason: 'clear' | 'building' | 'terrain';
};

// Fan-shaped scanning configuration
type FanConfig = {
    deltaTheta: number;  // Fan angle width in degrees (e.g., 20, 40, 80)
    rayCount: number;    // Number of rays (e.g., 9, 13, 17)
    maxRange: number;    // Maximum ray distance in meters (e.g., 2000)
};

// Fan ray result extending RayResult with azimuth information
type FanRayResult = RayResult & {
    azimuth: number;        // Azimuth angle of this ray in degrees
    rayIndex: number;       // Index in the fan (0 to rayCount-1)
    maxRangePoint: LngLat;  // Endpoint at maxRange if no hit
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
    const [isFanMode, setIsFanMode] = useState<boolean>(false);
    const [fanConfig, setFanConfig] = useState<FanConfig>({
        deltaTheta: FAN_PRESETS.DELTA_THETA.MEDIUM,
        rayCount: FAN_PRESETS.RAY_COUNT.MEDIUM,
        maxRange: FAN_PRESETS.MAX_RANGE,
    });
    const [fanRayResults, setFanRayResults] = useState<FanRayResult[]>([]);

    // Ray-based occlusion detection with sight angle α
    function findFirstOcclusion(profile: ProfileResponse, alphaDeg: number): RayResult {
        // Constants
        const H_EYE = 1.6; // Eye height above ground (meters)
        const ALPHA_RAD = (alphaDeg * Math.PI) / 180; // Convert to radians

        // Observer eye level: Z0 = DSM(A) + h_eye
        const elevA = profile.elev_m[0];
        if (elevA === null) {
            return {
                hit: false,
                distance: null,
                hitPoint: null,
                elevation: null,
                reason: 'clear'
            };
        }
        const Z0 = elevA + H_EYE;

        // Ray height function: z_ray(d) = Z0 + tan(α) * d
        const tanAlpha = Math.tan(ALPHA_RAD);
        const zRay = (d: number) => Z0 + tanAlpha * d;

        // Find first collision: where DSM surface > ray height
        let prevDelta: number | null = null;

        for (let i = 1; i < profile.elev_m.length; i++) {
            const zi = profile.elev_m[i];
            const di = profile.distances_m[i];

            // Skip null elevation points
            if (zi === null) {
                prevDelta = null;
                continue;
            }

            // Calculate Δ_i = z_i - z_ray(d_i)
            const zRayI = zRay(di);
            const delta = zi - zRayI;

            // Check for collision: delta > 0 means terrain is above ray
            if (delta > 0) {
                // Collision detected!

                // If we have previous point, use linear interpolation for accurate hit position
                if (prevDelta !== null && prevDelta <= 0 && i > 1) {
                    const diPrev = profile.distances_m[i - 1];

                    // Linear interpolation: t = (0 - Δ_{i-1}) / (Δ_i - Δ_{i-1})
                    const t = (0 - prevDelta) / (delta - prevDelta);

                    // Interpolated hit distance: d_hit = d_{i-1} + t * (di - diPrev)
                    const dHit = diPrev + t * (di - diPrev);

                    // Interpolate lat/lng as well
                    const lngPrev = profile.lngs[i - 1];
                    const latPrev = profile.lats[i - 1];
                    const lngI = profile.lngs[i];
                    const latI = profile.lats[i];

                    const lngHit = lngPrev + t * (lngI - lngPrev);
                    const latHit = latPrev + t * (latI - latPrev);

                    // Interpolate elevation at hit point
                    const elevPrev = profile.elev_m[i - 1]!;
                    const elevHit = elevPrev + t * (zi - elevPrev);

                    // Determine reason: check if elevation is significantly above ground (building)
                    const avgGroundElev = (elevA + zi) / 2;
                    const reason = elevHit > avgGroundElev + 10 ? 'building' : 'terrain';

                    return {
                        hit: true,
                        distance: dHit,
                        hitPoint: { lng: lngHit, lat: latHit },
                        elevation: elevHit,
                        reason
                    };
                } else {
                    // No previous point or interpolation not possible, use current point
                    const avgGroundElev = (elevA + zi) / 2;
                    const reason = zi > avgGroundElev + 10 ? 'building' : 'terrain';

                    return {
                        hit: true,
                        distance: di,
                        hitPoint: { lng: profile.lngs[i], lat: profile.lats[i] },
                        elevation: zi,
                        reason
                    };
                }
            }

            prevDelta = delta;
        }

        // No collision detected - ray is clear
        return {
            hit: false,
            distance: null,
            hitPoint: null,
            elevation: null,
            reason: 'clear'
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
        sightAngle: number
    ): Promise<FanRayResult[]> {
        // Calculate center azimuth from source to target
        const thetaCenter = calculateAzimuth(sourceLocation, targetLocation);
        const { deltaTheta, rayCount, maxRange } = fanConfig;

        // Generate azimuth for each ray
        const rayAzimuths: number[] = [];
        for (let j = 0; j < rayCount; j++) {
            const theta_j = thetaCenter - deltaTheta / 2 + j * (deltaTheta / (rayCount - 1));
            rayAzimuths.push(theta_j);
        }

        // Generate profiles for all rays in parallel
        const profilePromises = rayAzimuths.map(async (azimuth, index) => {
            const endpoint = calculateEndpoint(sourceLocation, azimuth, maxRange);
            const distance = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
                .distanceTo(new maplibregl.LngLat(endpoint.lng, endpoint.lat));

            // Sample count based on distance
            const sampleCount = Math.min(500, Math.max(120, Math.ceil(distance / 20)));

            try {
                const profile = await fetchProfile(sourceLocation, endpoint, sampleCount);
                const result = findFirstOcclusion(profile, sightAngle);

                return {
                    ...result,
                    azimuth,
                    rayIndex: index,
                    maxRangePoint: endpoint,
                } as FanRayResult;
            } catch (error) {
                console.error(`[Fan Ray ${index}] Failed to fetch profile at azimuth ${azimuth.toFixed(1)}°:`, error);
                // Return clear result if fetch fails
                return {
                    hit: false,
                    distance: null,
                    hitPoint: null,
                    elevation: null,
                    reason: 'clear',
                    azimuth,
                    rayIndex: index,
                    maxRangePoint: endpoint,
                } as FanRayResult;
            }
        });

        const results = await Promise.all(profilePromises);

        // Log summary
        const hitCount = results.filter(r => r.hit).length;
        console.log(`[Fan Scan] ${rayCount} rays, ${hitCount} blocked, ${rayCount - hitCount} clear`);

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
            setRayResult(null);
            setFanRayResults([]);
            return;
        }

        const loadProfile = async () => {
            setLoading(true);
            setError(null);
            try {
                if (isFanMode) {
                    // Fan mode: Generate multiple rays
                    const results = await generateFanRays(sourceLocation, targetLocation, fanConfig, sightAngle);
                    setFanRayResults(results);

                    // Use center ray for backward compatibility with ProfileChart
                    const centerIndex = Math.floor(fanConfig.rayCount / 2);
                    const centerResult = results[centerIndex];
                    setRayResult(centerResult);
                    onRayResultChange(centerResult);

                    // Still fetch the center profile for ProfileChart display
                    const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                    const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                    const distanceM = start.distanceTo(end);
                    const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));
                    const profile = await fetchProfile(sourceLocation, targetLocation, sampleCount);
                    onProfileChange(profile);
                } else {
                    // Single ray mode (existing logic)
                    const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                    const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                    const distanceM = start.distanceTo(end);

                    // 10m間隔でサンプリング（最低120点、最大500点に制限）
                    const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                    const profile = await fetchProfile(sourceLocation, targetLocation, sampleCount);

                    // Calculate occlusion using ray-based detection with current sight angle
                    const result = findFirstOcclusion(profile, sightAngle);
                    setRayResult(result);

                    // Log occlusion result for debugging
                    if (result.hit && result.distance !== null) {
                        console.log(`[Occlusion α=${sightAngle}°] Ray blocked at ${result.distance.toFixed(1)}m (${result.reason})`);
                    } else {
                        console.log(`[Occlusion α=${sightAngle}°] Clear line of sight`);
                    }

                    // Notify parent of ray result
                    onRayResultChange(result);

                    onProfileChange(profile);
                    setFanRayResults([]); // Clear fan results in single mode
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
                                🧭 向き指定点: {targetLocation.lat.toFixed(5)}, {targetLocation.lng.toFixed(5)}
                                <div className="text-xs text-gray-500 mt-1">
                                    ※ この点は視線の方向を指定するためのものです
                                </div>
                            </div>
                        )}

                        {!targetLocation && (
                            <div className="text-sm text-gray-500 mb-2">
                                {isSettingSource ? (
                                    <span className="text-blue-600 font-semibold">地図をクリックして基準点を設定</span>
                                ) : (
                                    '地図をクリックして視線の向きを指定'
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

                        {/* Sight Angle Selector */}
                        <div className="border-t pt-3 mt-3">
                            <div className="text-xs font-semibold text-gray-700 mb-2">
                                視線角度 (α)
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.DOWN)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.DOWN
                                        ? 'bg-orange-500 text-white font-semibold'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    下向き -2°
                                </button>
                                <button
                                    onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.HORIZONTAL)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.HORIZONTAL
                                        ? 'bg-blue-500 text-white font-semibold'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    水平 0°
                                </button>
                                <button
                                    onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.UP)}
                                    className={`text-xs px-3 py-1.5 rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.UP
                                        ? 'bg-green-500 text-white font-semibold'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                        }`}
                                >
                                    上向き +2°
                                </button>
                            </div>
                            <div className="text-xs text-gray-500 mt-2">
                                現在: α={sightAngle}° {rayResult?.hit && rayResult.distance && `(${rayResult.distance.toFixed(1)}m で遮蔽)`}
                            </div>
                        </div>

                        {/* Fan Mode Toggle */}
                        <div className="border-t pt-3 mt-3">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={isFanMode}
                                    onChange={(e) => setIsFanMode(e.target.checked)}
                                    className="rounded"
                                />
                                <span className="font-semibold text-gray-700">扇形スキャンモード</span>
                            </label>
                        </div>

                        {/* Fan Controls (only when fan mode is active) */}
                        {isFanMode && (
                            <div className="border-t pt-3 mt-3">
                                <div className="text-xs font-semibold text-gray-700 mb-2">
                                    扇形幅 (Δθ)
                                </div>
                                <div className="flex gap-2 mb-3">
                                    <button
                                        onClick={() => setFanConfig({ ...fanConfig, deltaTheta: FAN_PRESETS.DELTA_THETA.NARROW })}
                                        className={`text-xs px-3 py-1.5 rounded transition-colors ${fanConfig.deltaTheta === FAN_PRESETS.DELTA_THETA.NARROW
                                            ? 'bg-blue-500 text-white font-semibold'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            }`}
                                    >
                                        狭 20°
                                    </button>
                                    <button
                                        onClick={() => setFanConfig({ ...fanConfig, deltaTheta: FAN_PRESETS.DELTA_THETA.MEDIUM })}
                                        className={`text-xs px-3 py-1.5 rounded transition-colors ${fanConfig.deltaTheta === FAN_PRESETS.DELTA_THETA.MEDIUM
                                            ? 'bg-blue-500 text-white font-semibold'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            }`}
                                    >
                                        中 40°
                                    </button>
                                    <button
                                        onClick={() => setFanConfig({ ...fanConfig, deltaTheta: FAN_PRESETS.DELTA_THETA.WIDE })}
                                        className={`text-xs px-3 py-1.5 rounded transition-colors ${fanConfig.deltaTheta === FAN_PRESETS.DELTA_THETA.WIDE
                                            ? 'bg-blue-500 text-white font-semibold'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            }`}
                                    >
                                        広 80°
                                    </button>
                                </div>

                                <div className="text-xs font-semibold text-gray-700 mb-2">
                                    レイ本数
                                </div>
                                <div className="flex gap-2 mb-3">
                                    <button
                                        onClick={() => setFanConfig({ ...fanConfig, rayCount: FAN_PRESETS.RAY_COUNT.COARSE })}
                                        className={`text-xs px-3 py-1.5 rounded transition-colors ${fanConfig.rayCount === FAN_PRESETS.RAY_COUNT.COARSE
                                            ? 'bg-green-500 text-white font-semibold'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            }`}
                                    >
                                        粗 9本
                                    </button>
                                    <button
                                        onClick={() => setFanConfig({ ...fanConfig, rayCount: FAN_PRESETS.RAY_COUNT.MEDIUM })}
                                        className={`text-xs px-3 py-1.5 rounded transition-colors ${fanConfig.rayCount === FAN_PRESETS.RAY_COUNT.MEDIUM
                                            ? 'bg-green-500 text-white font-semibold'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            }`}
                                    >
                                        中 13本
                                    </button>
                                    <button
                                        onClick={() => setFanConfig({ ...fanConfig, rayCount: FAN_PRESETS.RAY_COUNT.FINE })}
                                        className={`text-xs px-3 py-1.5 rounded transition-colors ${fanConfig.rayCount === FAN_PRESETS.RAY_COUNT.FINE
                                            ? 'bg-green-500 text-white font-semibold'
                                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                            }`}
                                    >
                                        細 17本
                                    </button>
                                </div>

                                <div className="text-xs text-gray-500">
                                    {fanRayResults.length > 0 ? (
                                        <>
                                            {fanConfig.rayCount}本中 {fanRayResults.filter(r => r.hit).length}本遮蔽 / {fanRayResults.filter(r => !r.hit).length}本クリア
                                        </>
                                    ) : (
                                        '計算中...'
                                    )}
                                </div>
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
                    </>
                )}
            </div>
        </div>
    );
}
