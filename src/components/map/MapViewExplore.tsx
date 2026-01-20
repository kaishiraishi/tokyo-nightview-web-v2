import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapLibre } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';
import { CurrentLocationButton } from '../ui/CurrentLocationButton';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { FanConfig, ScanStep } from './types';

const NORTH_THRESHOLD_DEG = 5;
const SIGHT_ANGLE_PRESETS = {
    HORIZONTAL: 0,
};
const FAN_PRESETS = {
    DELTA_THETA: {
        MEDIUM: 60,
    },
    MAX_RANGE: 2000,
};

type MapViewProps = {
    onProfileChange: (profile: ProfileResponse | null) => void;
    onRayResultChange: (result: RayResult | null) => void;
    onScanStatusChange: (status: {
        scanStep: ScanStep;
        loading: boolean;
        error: string | null;
        rayResult: RayResult | null;
        previewDeltaTheta: number | null;
        deltaTheta: number;
        fanStats: { total: number; blocked: number; clear: number };
    }) => void;
    onResetReady: (resetFn: () => void) => void;
    profile: ProfileResponse | null;
    hoveredIndex: number | null;
    clickedIndex: number | null;
    onZoomChange: (zoom: number) => void;
};

export function MapViewExplore({
    onProfileChange,
    onRayResultChange,
    onScanStatusChange,
    onResetReady,
    profile,
    hoveredIndex,
    clickedIndex,
    onZoomChange,
}: MapViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, isLoaded } = useMapLibre(containerRef);
    const { location: currentLocation, error: geoError } = useGeolocation();

    // Modal State
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const settingsPanelRef = useRef<HTMLDivElement | null>(null);
    const settingsButtonRef = useRef<HTMLButtonElement | null>(null);

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
    const hasAutoSetSourceRef = useRef(false);

    const isNorthUp = Math.abs(mapBearing) <= NORTH_THRESHOLD_DEG;
    // const [isCollapsed, setIsCollapsed] = useState(false); // Lifted to App.tsx

    // Sight angle state
    const [sightAngle] = useState<number>(SIGHT_ANGLE_PRESETS.HORIZONTAL);

    // Ray result state (replaces rayEndPoint and isLineClear)
    const [rayResult, setRayResult] = useState<RayResult | null>(null);

    // Fan mode state
    const [isFanMode] = useState<boolean>(true);
    const [fanConfig, setFanConfig] = useState<FanConfig>({
        deltaTheta: FAN_PRESETS.DELTA_THETA.MEDIUM,
        rayCount: 36,
        maxRange: FAN_PRESETS.MAX_RANGE,
    });
    const [fanRayResults, setFanRayResults] = useState<FanRayResult[]>([]);

    // VIIRS controls
    const [viirsEnabled, setViirsEnabled] = useState(true);
    const [viirsOpacity, setViirsOpacity] = useState<number>(0.2);
    const [isViirsPanelOpen, setIsViirsPanelOpen] = useState(false);
    const viirsPanelRef = useRef<HTMLDivElement | null>(null);
    const viirsButtonRef = useRef<HTMLButtonElement | null>(null);

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

    // Fallback: Use map center when geolocation fails
    useEffect(() => {
        if (geoError && map && !sourceLocation) {
            const center = map.getCenter();
            setSourceLocation({ lng: center.lng, lat: center.lat });
        }
    }, [geoError, map, sourceLocation]);

    useEffect(() => {
        if (hasAutoSetSourceRef.current) return;
        if (currentLocation && !sourceLocation) {
            setSourceLocation(currentLocation);
            hasAutoSetSourceRef.current = true;
        }
    }, [currentLocation, sourceLocation]);

    // Update VIIRS layer opacity
    useEffect(() => {
        if (!map || !isLoaded) return;
        if (!map.isStyleLoaded?.() || !map.getStyle?.()) return;

        const layer = map.getLayer?.('viirs-nightlight-layer') ?? null;

        if (layer && map.setPaintProperty) {
            map.setPaintProperty('viirs-nightlight-layer', 'raster-opacity', viirsOpacity);
        }
    }, [map, isLoaded, viirsOpacity]);

    useEffect(() => {
        if (!map || !isLoaded) return;
        if (!map.isStyleLoaded?.() || !map.getStyle?.()) return;

        const layer = map.getLayer?.('viirs-nightlight-layer') ?? null;

        if (layer && map.setLayoutProperty) {
            map.setLayoutProperty('viirs-nightlight-layer', 'visibility', viirsEnabled ? 'visible' : 'none');
        }
    }, [map, isLoaded, viirsEnabled]);

    useEffect(() => {
        if (!isSettingsOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (settingsPanelRef.current?.contains(target)) return;
            if (settingsButtonRef.current?.contains(target)) return;
            setIsSettingsOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSettingsOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSettingsOpen]);

    useEffect(() => {
        if (!isViirsPanelOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (viirsPanelRef.current?.contains(target)) return;
            if (viirsButtonRef.current?.contains(target)) return;
            setIsViirsPanelOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsViirsPanelOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isViirsPanelOpen]);

    useEffect(() => {
        if (scanStep === 'idle') {
            setScanStep('selecting_source');
        }
    }, [scanStep]);

    useEffect(() => {
        const blocked = fanRayResults.filter((r) => r.hit).length;
        const clear = fanRayResults.length - blocked;

        onScanStatusChange({
            scanStep,
            loading,
            error,
            rayResult,
            previewDeltaTheta,
            deltaTheta: fanConfig.deltaTheta,
            fanStats: {
                total: fanRayResults.length,
                blocked,
                clear,
            },
        });
    }, [scanStep, loading, error, rayResult, fanRayResults, onScanStatusChange]);

    useEffect(() => {
        const reset = () => {
            setScanStep('idle');
            setSourceLocation(null);
            setTargetLocation(null);
            setFanRayResults([]);
            setPreviewDeltaTheta(null);
            setRayResult(null);
            setError(null);
            setLoading(false);
            onRayResultChange(null);
            onProfileChange(null);
        };

        onResetReady(() => reset);
    }, [onResetReady]);

    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'selecting_source') return;

        const handleSourceDoubleClick = (e: maplibregl.MapMouseEvent) => {
            e.preventDefault();
            setSourceLocation({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            setScanStep('selecting_target');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.doubleClickZoom.disable();
        map.on('dblclick', handleSourceDoubleClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('dblclick', handleSourceDoubleClick);
            map.doubleClickZoom.enable();
        };
    }, [map, isLoaded, scanStep]);

    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'selecting_target') return;

        setPreviewDeltaTheta(null);

        const handleTargetClick = (e: maplibregl.MapMouseEvent) => {
            setTargetLocation({
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            });
            setScanStep('adjusting_angle');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleTargetClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleTargetClick);
        };
    }, [map, isLoaded, scanStep]);

    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'adjusting_angle' || !sourceLocation || !targetLocation) {
            if (previewDeltaTheta !== null) setPreviewDeltaTheta(null);
            return;
        }

        if (previewDeltaTheta === null) {
            setPreviewDeltaTheta(fanConfig.deltaTheta);
        }

        const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
            const centerAz = calculateAzimuth(sourceLocation, targetLocation);
            const mouseAz = calculateAzimuth(sourceLocation, { lng: e.lngLat.lng, lat: e.lngLat.lat });
            let diff = Math.abs(mouseAz - centerAz);
            if (diff > 180) diff = 360 - diff;

            const newDelta = Math.max(1, Math.min(360, diff * 2));
            setPreviewDeltaTheta(newDelta);
        };

        const handleClick = () => {
            if (previewDeltaTheta !== null) {
                setFanConfig(prev => ({ ...prev, deltaTheta: previewDeltaTheta }));
                executeScan({ deltaTheta: previewDeltaTheta });
            }
        };

        map.on('mousemove', handleMouseMove);
        map.on('click', handleClick);
        map.getCanvas().style.cursor = 'col-resize';

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('click', handleClick);
            map.getCanvas().style.cursor = '';
        };
    }, [map, isLoaded, scanStep, sourceLocation, targetLocation, previewDeltaTheta, fanConfig.deltaTheta]);


    // Execute Scan Logic (Manual Trigger)
    const executeScan = async (configOverride?: Partial<FanConfig>) => {
        if (!sourceLocation) {
            setError("観測点が設定されていません");
            return;
        }
        if (isFanMode && !targetLocation) {
            setError("目標点が設定されていません");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const currentConfig = { ...fanConfig, ...configOverride };

            if (isFanMode && targetLocation) {
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

            setScanStep('selecting_target');
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

    // Double-click is reserved for source selection.

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
                preferPreview={scanStep === 'adjusting_angle'}
                showTargetRing={scanStep === 'adjusting_angle'}
                targetRingState={{
                    previewDeltaTheta,
                    setPreviewDeltaTheta,
                    onCommitDeltaTheta: (value) => {
                        setFanConfig((prev) => ({ ...prev, deltaTheta: value }));
                        executeScan({ deltaTheta: value });
                    },
                }}
            />

            {/* Bottom Right Controls */}
            <div className="absolute bottom-6 right-6 flex items-end gap-4 md:bottom-8 md:right-8 z-50 pointer-events-auto">
                <button
                    ref={settingsButtonRef}
                    type="button"
                    onClick={() => setIsSettingsOpen((prev) => !prev)}
                    className="group bg-black/60 backdrop-blur-md border border-yellow-300/60 text-white rounded-full shadow-lg p-3 hover:bg-white/10 hover:border-yellow-200 active:scale-95 transition-all duration-200 flex items-center justify-center"
                    aria-label="設定"
                    aria-pressed={isSettingsOpen}
                >
                    <span className="text-xl">⚙️</span>
                </button>
                {isSettingsOpen && (
                    <div
                        ref={settingsPanelRef}
                        className="absolute right-20 bottom-0 w-56 rounded-xl border border-white/10 bg-black/70 p-3 shadow-lg backdrop-blur-md"
                    >
                        <div className="text-xs text-white/60">Ray Count</div>
                        <div className="mt-2 flex items-center justify-between text-sm text-white/80">
                            <span>{fanConfig.rayCount}</span>
                            <span className="text-white/60">rays</span>
                        </div>
                        <div className="mt-3 text-xs text-white/60">Ray Spacing</div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs font-semibold">
                            {[
                                { label: '詳細', value: 10 },
                                { label: 'ノーマル', value: 30 },
                                { label: 'あらめ', value: 60 },
                            ].map((preset) => (
                                <button
                                    key={preset.value}
                                    type="button"
                                    onClick={() => {
                                        setFanConfig((prev) => ({
                                            ...prev,
                                            deltaTheta: preset.value,
                                        }));
                                    }}
                                    className={`rounded-full px-2 py-1 transition-colors ${
                                        fanConfig.deltaTheta === preset.value
                                            ? 'bg-yellow-400 text-black'
                                            : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                    }`}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                        <div className="mt-1 text-[11px] text-white/50">
                            {fanConfig.deltaTheta}° 間隔
                        </div>
                    </div>
                )}

                <div className="relative flex flex-col items-end gap-2">
                    <button
                        ref={viirsButtonRef}
                        type="button"
                        onClick={() => setIsViirsPanelOpen((prev) => !prev)}
                        className="group bg-black/60 backdrop-blur-md border border-white/10 text-white rounded-full shadow-lg h-11 w-11 hover:bg-white/10 hover:border-white/20 active:scale-95 transition-all duration-200 flex items-center justify-center"
                        aria-label="VIIRS設定"
                        aria-pressed={isViirsPanelOpen}
                    >
                        <span className="text-lg">🗺️</span>
                    </button>
                    {isViirsPanelOpen && (
                        <div
                            ref={viirsPanelRef}
                            className="absolute right-0 bottom-14 w-56 rounded-xl border border-white/10 bg-black/70 p-3 shadow-lg backdrop-blur-md"
                        >
                            <div className="flex items-center justify-between text-sm text-white/80">
                                <span>VIIRS</span>
                                <label className="flex items-center gap-2 text-xs text-white/60">
                                    <span>{viirsEnabled ? 'ON' : 'OFF'}</span>
                                    <input
                                        type="checkbox"
                                        checked={viirsEnabled}
                                        onChange={(event) => setViirsEnabled(event.target.checked)}
                                        className="h-4 w-4 accent-yellow-400"
                                    />
                                </label>
                            </div>
                            <div className={`mt-3 ${viirsEnabled ? '' : 'opacity-50'}`}>
                                <div className="flex items-center justify-between text-xs text-white/60">
                                    <span>Opacity</span>
                                    <span className="text-white/80">
                                        {Math.round(viirsOpacity * 100)}%
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    value={Math.round(viirsOpacity * 100)}
                                    onChange={(event) => {
                                        setViirsOpacity(Number(event.target.value) / 100);
                                    }}
                                    className="mt-2 w-full accent-yellow-400"
                                    disabled={!viirsEnabled}
                                />
                            </div>
                        </div>
                    )}
                    <CurrentLocationButton
                        onClick={() => {
                            console.log('Location clicked');
                            handleResetLocate();
                        }}
                        isNorthUp={isNorthUp}
                        disabled={isLocating}
                        className="relative bottom-auto right-auto border-none shadow-none cursor-pointer rounded-full"
                    />
                </div>
            </div>
            {locateError && (
                <div className="absolute bottom-24 right-6 md:right-8 bg-red-900/80 text-white text-xs px-2 py-1 rounded backdrop-blur border border-red-500/30 z-20">
                    {locateError}
                </div>
            )}

        </div>
    );
}
