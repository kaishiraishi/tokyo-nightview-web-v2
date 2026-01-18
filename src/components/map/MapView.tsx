import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapLibre } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';
import { CurrentLocationButton } from '../ui/CurrentLocationButton';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ScanSettingsModal } from '../ui/ScanSettingsModal';
import { SIGHT_ANGLE_PRESETS, FAN_PRESETS } from '../../config/scanConstants';

const NORTH_THRESHOLD_DEG = 5;

// Fan-shaped scanning configuration
type FanConfig = {
    deltaTheta: number;  // Fan angle width in degrees (e.g., 20, 40, 80)
    rayCount: number;    // Number of rays (e.g., 9, 13, 17)
    maxRange: number;    // Maximum ray distance in meters (e.g., 2000)
    fullScan: boolean;   // If true, scan 360° from source (no target needed)
};

type ScanStep = 'idle' | 'selecting_source' | 'selecting_target' | 'adjusting_angle' | 'scanning' | 'complete';

type MapViewProps = {
    onProfileChange: (profile: ProfileResponse | null) => void;
    onRayResultChange: (result: RayResult | null) => void;
    profile: ProfileResponse | null;
    hoveredIndex: number | null;
    clickedIndex: number | null;
    onZoomChange: (zoom: number) => void;
    isSidebarOpen: boolean;
    setIsSidebarOpen: (isOpen: boolean) => void;
};

export function MapView({ onProfileChange, onRayResultChange, profile, hoveredIndex, clickedIndex, onZoomChange, isSidebarOpen, setIsSidebarOpen }: MapViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, isLoaded } = useMapLibre(containerRef);
    const { location: currentLocation, error: geoError } = useGeolocation();

    // Modal State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const [sourceLocation, setSourceLocation] = useState<LngLat | null>(null);
    const [targetLocation, setTargetLocation] = useState<LngLat | null>(null);
    const [scanStep, setScanStep] = useState<ScanStep>('idle');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Interactive Fan Adjustment State
    const [previewDeltaTheta, setPreviewDeltaTheta] = useState<number | null>(null);

    // Smart Location / North Reset State
    const [mapBearing, setMapBearing] = useState<number>(0);
    const [northResetTrigger, setNorthResetTrigger] = useState<number>(0);
    const [isLocating, setIsLocating] = useState(false);
    const [locateError, setLocateError] = useState<string | null>(null);

    const isNorthUp = Math.abs(mapBearing) <= NORTH_THRESHOLD_DEG;
    // const [isCollapsed, setIsCollapsed] = useState(false); // Lifted to App.tsx

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

        // Defensive coding: access map safely
        const layer = map.getLayer ? map.getLayer('viirs-nightlight-layer') : null;

        if (layer && map.setPaintProperty) {
            map.setPaintProperty('viirs-nightlight-layer', 'raster-opacity', viirsOpacity);
        }
    }, [map, isLoaded, viirsOpacity]);

    // Handle source location selection (Step 1)
    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'selecting_source') return;

        const handleSourceClick = (e: maplibregl.MapMouseEvent) => {
            setSourceLocation({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            // Auto advance to next step
            setScanStep('selecting_target');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleSourceClick);

        return () => {
            // Only reset cursor if we strictly leave the selection modes, 
            // but 'selecting_target' also needs crosshair.
            // Simplification: just reset here, next effect picks it up.
            map.getCanvas().style.cursor = '';
            map.off('click', handleSourceClick);
        };
    }, [map, isLoaded, scanStep]);

    // Handle target location selection (Step 2)
    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'selecting_target') return;

        const handleTargetClick = (e: maplibregl.MapMouseEvent) => {
            setTargetLocation({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            // Auto advance to next step
            setScanStep('adjusting_angle');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleTargetClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleTargetClick);
        };
    }, [map, isLoaded, scanStep]);

    // Handle Angle Adjustment (Step 3) - Interactive
    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'adjusting_angle' || !sourceLocation || !targetLocation) {
            if (previewDeltaTheta !== null) setPreviewDeltaTheta(null);
            return;
        }

        // Initialize preview with current config
        if (previewDeltaTheta === null) {
            setPreviewDeltaTheta(fanConfig.deltaTheta);
        }

        const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
            const centerAz = calculateAzimuth(sourceLocation, targetLocation);
            const mouseAz = calculateAzimuth(sourceLocation, { lng: e.lngLat.lng, lat: e.lngLat.lat });
            let diff = Math.abs(mouseAz - centerAz);
            if (diff > 180) diff = 360 - diff;

            // Dynamic angle: 2 * diff
            const newDelta = Math.max(1, Math.min(360, diff * 2));
            setPreviewDeltaTheta(newDelta);
        };

        const handleClick = () => {
            if (previewDeltaTheta !== null) {
                setFanConfig(prev => ({ ...prev, deltaTheta: previewDeltaTheta }));
                executeScan({ deltaTheta: previewDeltaTheta }); // Pass override
            }
        };

        map.on('mousemove', handleMouseMove);
        map.on('click', handleClick);
        // Using cursor: alias to indicate interactive adjustment
        map.getCanvas().style.cursor = 'col-resize';

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('click', handleClick);
            map.getCanvas().style.cursor = '';
        };
    }, [map, isLoaded, scanStep, sourceLocation, targetLocation, previewDeltaTheta, fanConfig]);

    // Execute Scan Logic (Manual Trigger)
    const executeScan = async (configOverride?: Partial<FanConfig>) => {
        if (!sourceLocation) {
            setError("観測点が設定されていません");
            return;
        }

        // Clear previous results
        onProfileChange(null);
        setRayResult(null);
        setFanRayResults([]);

        setLoading(true);
        setError(null);

        try {
            const currentConfig = { ...fanConfig, ...configOverride };

            if (isFanMode && currentConfig.fullScan) {
                // 360° Scan
                const testEndpoint = calculateEndpoint(sourceLocation, 0, 100);
                const testProfile = await fetchProfile(sourceLocation, testEndpoint, 10);
                const elevA = testProfile.elev_m[0];
                const sourceZ0 = (typeof elevA === 'number' && Number.isFinite(elevA)) ? elevA + 1.6 : 1.6;

                const results = await generate360Rays(sourceLocation, currentConfig, sightAngle, sourceZ0);
                setFanRayResults(results);
            } else if (isFanMode && targetLocation) {
                // Fan Scan
                const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                const distanceM = start.distanceTo(end);
                const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                const centerProfile = await fetchProfile(sourceLocation, targetLocation, sampleCount);
                onProfileChange(centerProfile);

                const elevA = centerProfile.elev_m[0];
                const sourceZ0 = (typeof elevA === 'number' && Number.isFinite(elevA)) ? elevA + 1.6 : 1.6;

                const results = await generateFanRays(sourceLocation, targetLocation, currentConfig, sightAngle, sourceZ0);
                setFanRayResults(results);

                const centerIndex = Math.floor(currentConfig.rayCount / 2);
                const centerResult = results[centerIndex];
                setRayResult(centerResult);
                onRayResultChange(centerResult);
            } else if (targetLocation) {
                // Single Ray
                const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                const end = new maplibregl.LngLat(targetLocation.lng, targetLocation.lat);
                const distanceM = start.distanceTo(end);
                const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                const profile = await fetchProfile(sourceLocation, targetLocation, sampleCount);
                const result = findFirstOcclusion(profile, sightAngle, sourceLocation);
                setRayResult(result);
                onRayResultChange(result);
                onProfileChange(profile);
            }

            // Mark complete
            setScanStep('scanning'); // or 'complete'
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to execute scan';
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    // Fly to clicked point on profile chart
    useEffect(() => {
        if (!map || !profile || clickedIndex === null) return;

        const lng = profile.lngs[clickedIndex];
        const lat = profile.lats[clickedIndex];
        const elev = profile.elev_m[clickedIndex];

        if (elev === null) return;

        // Safety check: Ensure coordinates are valid before flying
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

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
        return () => {
            map.off('zoom', updateZoom);
            map.off('move', updateZoom);
        };
    }, [map, onZoomChange]);

    // Track map rotation (Bearing)
    useEffect(() => {
        if (!map) return;

        const updateBearing = () => {
            // map.getBearing() returns -180 to 180 (usually)
            setMapBearing(map.getBearing());
        };

        map.on('rotate', updateBearing);
        map.on('move', updateBearing); // move includes rotation often

        updateBearing(); // initial

        return () => {
            map.off('rotate', updateBearing);
            map.off('move', updateBearing);
        };
    }, [map]);

    // Effect: Handle North Reset Trigger
    useEffect(() => {
        if (!map || northResetTrigger === 0) return;

        map.flyTo({
            bearing: 0,
            pitch: 0,
            duration: 600,
            easing: (t) => t * (2 - t), // easeOutQuad
        });
    }, [map, northResetTrigger]);


    // Handler: Reset or Locate
    const handleResetLocate = () => {
        if (!map) return;

        // 1. If not North Up -> Reset to North
        if (!isNorthUp) {
            setNorthResetTrigger(Date.now());
            return;
        }

        // 2. If North Up -> Current Location
        if (isLocating) return; // Prevent double click
        setIsLocating(true);
        setLocateError(null);

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { longitude, latitude } = pos.coords;
                // Fly to location
                map.flyTo({
                    center: [longitude, latitude],
                    zoom: 16,
                    duration: 1200,
                    essential: true
                });

                // Note: The useGeolocation hook will likely pick this up if watching, 
                // but we might want to manually update source if currently setting source?
                // For now, adhering to spec: "currentLocation changed -> flyTo". 
                // But we are doing explicit flyTo here on success to be snappy.
                // Does useGeolocation hook update `currentLocation`? Yes it does watches.

                setIsLocating(false);
            },
            (err) => {
                console.error("Geolocation failed", err);
                setLocateError(err.message);
                setIsLocating(false);
                // Ideally show toast here, for now relying on UI error state if any, or console
                alert(`位置情報の取得に失敗しました: ${err.message}`);
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    };

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
                previewFanConfig={(scanStep === 'adjusting_angle' && previewDeltaTheta !== null)
                    ? { deltaTheta: previewDeltaTheta, rayCount: fanConfig.rayCount }
                    : null
                }
            />

            {/* Sidebar toggle button (Always visible when collapsed) */}
            {!isSidebarOpen && (
                <button
                    aria-label="Expand panel"
                    onClick={() => setIsSidebarOpen(true)}
                    className="absolute top-4 left-4 z-50 p-2 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg text-white shadow-lg hover:bg-black/80 transition-all"
                >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                </button>
            )}

            {/* Sidebar Overlay */}
            <div
                className={`absolute top-0 left-0 h-full w-80 bg-black/80 backdrop-blur-md border-r border-white/10 transition-transform duration-300 z-10 p-4 overflow-y-auto ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    }`}
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-6 border-b border-white/10 pb-4">
                    <h1 className="text-lg font-bold text-white tracking-wider flex items-center gap-2">
                        <span className="text-xl">🌃</span> Tokyo Nightview
                    </h1>
                    <button
                        onClick={() => setIsSidebarOpen(false)}
                        className="p-1 hover:bg-white/10 rounded-full transition-colors"
                    >
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

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

                {/* Workflow Status / Wizard UI */}
                <div className="mb-4 space-y-2">
                    <div className="flex justify-between items-center bg-white/10 p-2 rounded">
                        <span className={`text-xs font-bold ${scanStep === 'idle' ? 'text-gray-400' : 'text-blue-400'}`}>
                            Step: {scanStep.replace('_', ' ').toUpperCase()}
                        </span>
                        {scanStep !== 'idle' && (
                            <button
                                onClick={() => {
                                    setScanStep('idle');
                                    setSourceLocation(null);
                                    setTargetLocation(null);
                                    setFanRayResults([]);
                                }}
                                className="text-xs text-red-400 hover:text-red-300 underline"
                            >
                                Reset
                            </button>
                        )}
                    </div>

                    {scanStep === 'idle' && (
                        <button
                            onClick={() => {
                                setScanStep('selecting_source');
                                setIsSidebarOpen(true);
                                setFanConfig(prev => ({ ...prev, fullScan: false }));
                            }}
                            className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded shadow-lg text-sm transition-all"
                        >
                            📡 新規スキャン開始
                        </button>
                    )}

                    {scanStep === 'selecting_source' && (
                        <div className="p-3 bg-blue-900/40 border border-blue-500/30 rounded text-sm text-blue-200 animate-pulse">
                            📍 地図をクリックして <b>観測点(Source)</b> を決定してください
                        </div>
                    )}

                    {scanStep === 'selecting_target' && (
                        <div className="p-3 bg-green-900/40 border border-green-500/30 rounded text-sm text-green-200 animate-pulse">
                            🎯 地図をクリックして <b>目標点(Target)</b> を決定してください
                        </div>
                    )}

                    {scanStep === 'adjusting_angle' && (
                        <div className="space-y-2">
                            <div className="p-2 bg-purple-900/40 border border-purple-500/30 rounded text-xs text-purple-200">
                                📐 扇形の角度・範囲を調整し、実行してください
                            </div>
                            <button
                                onClick={() => executeScan()}
                                className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded shadow-lg text-sm transition-all"
                            >
                                ▶ スキャン実行
                            </button>
                        </div>
                    )}
                </div>

                {sourceLocation && (
                    <div className="text-sm text-gray-200 mb-2">
                        {/* Status text removed as per request */}
                    </div>
                )}

                {targetLocation && (
                    <div className="text-sm text-gray-200 mb-2">
                        {/* Status text removed as per request */}
                    </div>
                )}


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
            </div>

            {/* Current Location Button & Settings Button */}
            <div className="absolute bottom-6 right-6 flex gap-4 md:bottom-8 md:right-8 z-50 pointer-events-auto">
                {/* Settings Button */}
                <button
                    onClick={() => {
                        console.log('Settings clicked');
                        setIsSettingsOpen(true);
                    }}
                    className="group bg-black/60 backdrop-blur-md border border-white/10 text-white rounded-lg shadow-lg p-3 hover:bg-white/10 hover:border-white/20 active:scale-95 transition-all duration-200 flex items-center justify-center cursor-pointer"
                    aria-label="スキャン設定"
                >
                    <span className="text-xl">⚙️</span>
                </button>

                <CurrentLocationButton
                    onClick={() => {
                        console.log('Location clicked');
                        handleResetLocate();
                    }}
                    isNorthUp={isNorthUp}
                    disabled={isLocating}
                    className="relative bottom-auto right-auto border-none shadow-none cursor-pointer"
                />
            </div>
            {locateError && (
                <div className="absolute bottom-24 right-6 md:right-8 bg-red-900/80 text-white text-xs px-2 py-1 rounded backdrop-blur border border-red-500/30 z-20">
                    {locateError}
                </div>
            )}

            {/* Settings Modal */}
            <ScanSettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                sightAngle={sightAngle}
                setSightAngle={setSightAngle}
                viirsOpacity={viirsOpacity}
                setViirsOpacity={setViirsOpacity}
                fanConfig={fanConfig}
                setFanConfig={setFanConfig}
                rayResult={rayResult}
            />
        </div>
    );
}
