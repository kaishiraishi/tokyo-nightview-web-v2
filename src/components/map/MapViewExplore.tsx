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
const FAN_SCAN_RANGE_MIN_M = 3000;
const FAN_SCAN_RANGE_MAX_M = 200000;
const FAN_RAY_COUNT = 36;

type MapViewProps = {
    onProfileChange: (profile: ProfileResponse | null) => void;
    onRayResultChange: (result: RayResult | null) => void;
    onScanStatusChange: (status: {
        scanStep: ScanStep;
        loading: boolean;
        error: string | null;
        rayResult: RayResult | null;
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
    const [scanStep, setScanStep] = useState<ScanStep>('idle');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [scanRangeM, setScanRangeM] = useState<number>(FAN_SCAN_RANGE_MIN_M);
    const [previewRangeM, setPreviewRangeM] = useState<number | null>(null);
    const previewRangeRef = useRef<number | null>(null);

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
    const isFanMode = true;
    const fanConfig: FanConfig = {
        rayCount: FAN_RAY_COUNT,
        maxRange: scanRangeM,
    };
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

    const fitMapToRange = (center: LngLat, rangeM: number) => {
        if (!map) return;
        const bounds = new maplibregl.LngLatBounds();
        const north = calculateEndpoint(center, 0, rangeM);
        const east = calculateEndpoint(center, 90, rangeM);
        const south = calculateEndpoint(center, 180, rangeM);
        const west = calculateEndpoint(center, 270, rangeM);
        bounds.extend([north.lng, north.lat]);
        bounds.extend([east.lng, east.lat]);
        bounds.extend([south.lng, south.lat]);
        bounds.extend([west.lng, west.lat]);

        const padding = { top: 80, bottom: 80, left: 420, right: 80 };
        map.fitBounds(bounds, {
            padding,
            pitch: 0,
            bearing: 0,
            duration: 250,
            maxZoom: 16,
        });
    };

    // Generate fan of rays and calculate occlusion for each
    async function generateFanRays(
        sourceLocation: LngLat,
        fanConfig: FanConfig,
        sightAngle: number,
        sourceZ0: number,
        northProfile?: ProfileResponse
    ): Promise<FanRayResult[]> {
        const { rayCount, maxRange } = fanConfig;
        const rayAzimuths: number[] = [];
        for (let j = 0; j < rayCount; j++) {
            const theta_j = (j * (360 / rayCount)) % 360;
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
                const profile = (azimuth === 0 && northProfile)
                    ? northProfile
                    : await fetchProfile(sourceLocation, endpoint, sampleCount);

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
            setFanRayResults([]);
            setPreviewRangeM(null);
            setRayResult(null);
            setError(null);
            setLoading(false);
            onRayResultChange(null);
            onProfileChange(null);
        };

        onResetReady(() => reset);
    }, [onResetReady]);

    useEffect(() => {
        if (!map || !isLoaded) return;
        if (scanStep !== 'selecting_source' && scanStep !== 'complete') return;

        const handleSourceClick = (e: maplibregl.MapMouseEvent) => {
            const nextSource = {
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            };
            setSourceLocation(nextSource);
            setPreviewRangeM(scanRangeM);
            previewRangeRef.current = scanRangeM;
            setFanRayResults([]);
            setRayResult(null);
            setScanStep('north_preview');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleSourceClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleSourceClick);
        };
    }, [map, isLoaded, scanStep, scanRangeM]);

    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'north_preview' || !sourceLocation) return;

        const handleMoveEnd = () => {
            setScanStep('adjusting_range');
        };

        map.once('moveend', handleMoveEnd);
        map.easeTo({
            center: [sourceLocation.lng, sourceLocation.lat],
            bearing: 0,
            pitch: 0,
            duration: 600,
        });

        return () => {
            map.off('moveend', handleMoveEnd);
        };
    }, [map, isLoaded, scanStep, sourceLocation]);

    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'adjusting_range' || !sourceLocation) return;

        const clampRange = (value: number) =>
            Math.max(FAN_SCAN_RANGE_MIN_M, Math.min(FAN_SCAN_RANGE_MAX_M, value));

        const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
            const distance = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
                .distanceTo(new maplibregl.LngLat(e.lngLat.lng, e.lngLat.lat));
            const nextRange = clampRange(distance);
            setPreviewRangeM(nextRange);
            previewRangeRef.current = nextRange;
        };

        const handleClick = () => {
            const nextRange = clampRange(previewRangeRef.current ?? scanRangeM);
            setScanRangeM(nextRange);
            setPreviewRangeM(null);
            setScanStep('scanning');
            executeScan({ source: sourceLocation, maxRange: nextRange });
        };

        map.on('mousemove', handleMouseMove);
        map.on('click', handleClick);
        map.getCanvas().style.cursor = 'col-resize';

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('click', handleClick);
            map.getCanvas().style.cursor = '';
        };
    }, [map, isLoaded, scanStep, sourceLocation, scanRangeM]);

    useEffect(() => {
        if (!map || !isLoaded || scanStep !== 'adjusting_range' || !sourceLocation) return;
        if (!previewRangeM || previewRangeM <= 0) return;
        fitMapToRange(sourceLocation, previewRangeM);
    }, [map, isLoaded, scanStep, sourceLocation, previewRangeM]);


    // Execute Scan Logic (Manual Trigger)
    const executeScan = async (options?: { source?: LngLat; maxRange?: number }) => {
        const scanSource = options?.source ?? sourceLocation;
        if (!scanSource) {
            setError("観測点が設定されていません");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const currentConfig = { ...fanConfig, maxRange: options?.maxRange ?? fanConfig.maxRange };
            const northEndpoint = calculateEndpoint(scanSource, 0, currentConfig.maxRange);
            const distanceM = new maplibregl.LngLat(scanSource.lng, scanSource.lat)
                .distanceTo(new maplibregl.LngLat(northEndpoint.lng, northEndpoint.lat));
            const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

            const northProfile = await fetchProfile(scanSource, northEndpoint, sampleCount);
            onProfileChange(northProfile);

            const elevA = northProfile.elev_m[0];
            const sourceZ0 = (typeof elevA === 'number' && Number.isFinite(elevA)) ? elevA + 1.6 : 1.6;

            const results = await generateFanRays(scanSource, currentConfig, sightAngle, sourceZ0, northProfile);
            setFanRayResults(results);

            const northResult = results.find((r) => r.azimuth === 0) ?? results[0] ?? null;
            setRayResult(northResult);
            onRayResultChange(northResult);
            setScanStep('complete');
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to execute scan';
            setError(message);
            setScanStep('complete');
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
                profile={profile}
                hoveredIndex={hoveredIndex}
                isFanMode={isFanMode}
                fanRayResults={fanRayResults}
                previewRangeM={scanStep === 'adjusting_range' ? previewRangeM : null}
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
                        <div className="mt-3 text-xs text-white/60">Scan Range</div>
                        <div className="mt-2 text-sm text-white/80">
                            {scanRangeM}m
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
