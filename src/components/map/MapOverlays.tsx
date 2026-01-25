import { useEffect, useRef, useState, useMemo, type PointerEvent } from 'react';
import type maplibregl from 'maplibre-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { COORDINATE_SYSTEM } from '@deck.gl/core';
import { GL } from '@luma.gl/constants';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';
import type { ViirsPoint } from '../../lib/viirsSampler';
import type { Post } from '../../lib/postsApi';

type TargetRingState = {
    previewDeltaTheta: number | null;
    setPreviewDeltaTheta: (value: number | null) => void;
    onCommitDeltaTheta: (value: number) => void;
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
    previewFanConfig?: {
        deltaTheta: number;
        rayCount: number;
    } | null;
    previewRangeM?: number | null;
    preferPreview?: boolean;
    showTargetRing?: boolean;
    targetRingState?: TargetRingState;
    viirsPoints?: ViirsPoint[];
    posts?: Post[];
    hoveredPostId?: string | null;
    onPostHover?: (id: string | null) => void;
    visiblePosts?: boolean;
};

export function MapOverlays({
    map,
    sourceLocation,
    currentLocation,
    targetLocation,
    rayResult,
    profile,
    hoveredIndex,
    isFanMode,
    fanRayResults,
    previewFanConfig,
    previewRangeM,
    preferPreview,
    showTargetRing,
    targetRingState,
    viirsPoints,
    posts = [],
    hoveredPostId = null,
    onPostHover,
    visiblePosts = false,
}: MapOverlaysProps) {
    const overlayRef = useRef<MapboxOverlay | null>(null);
    const isDraggingRef = useRef(false);
    const pointerIdRef = useRef<number | null>(null);
    const [ringPosition, setRingPosition] = useState<{ x: number; y: number } | null>(null);
    const targetRingStateRef = useRef<TargetRingState | null>(null);

    // フェードイン用の状態
    const [viirsOpacity, setViirsOpacity] = useState(1); // 初期値を1に
    const prevViirsCountRef = useRef(0);
    const fadeAnimationRef = useRef<number | null>(null);

    // VIIRSポイントが更新されたらフェードインアニメーション
    useEffect(() => {
        const currentCount = viirsPoints?.length ?? 0;
        const prevCount = prevViirsCountRef.current;

        // ポイントがある場合は常にopacity=1を保証
        if (currentCount > 0) {
            // 大きく変わった場合のみフェードインアニメーション
            if (prevCount === 0 || Math.abs(currentCount - prevCount) > prevCount * 0.3) {
                setViirsOpacity(0);

                // 既存のアニメーションをキャンセル
                if (fadeAnimationRef.current !== null) {
                    cancelAnimationFrame(fadeAnimationRef.current);
                }

                const startTime = performance.now();
                const duration = 400; // 400ms でフェードイン

                const animate = (now: number) => {
                    const elapsed = now - startTime;
                    const progress = Math.min(1, elapsed / duration);
                    // イージング (ease-out)
                    const eased = 1 - Math.pow(1 - progress, 3);
                    setViirsOpacity(eased);

                    if (progress < 1) {
                        fadeAnimationRef.current = requestAnimationFrame(animate);
                    } else {
                        fadeAnimationRef.current = null;
                    }
                };

                fadeAnimationRef.current = requestAnimationFrame(animate);
            } else {
                // ポイント数があまり変わらない場合は即座にopacity=1
                setViirsOpacity(1);
            }
        }

        prevViirsCountRef.current = currentCount;

        return () => {
            if (fadeAnimationRef.current !== null) {
                cancelAnimationFrame(fadeAnimationRef.current);
            }
        };
    }, [viirsPoints]);

    const glowBlendParams = {
        blend: true,
        blendEquation: GL.FUNC_ADD,
        blendFunc: [GL.SRC_ALPHA, GL.ONE, GL.ONE, GL.ONE] as [number, number, number, number],
        depthTest: false,
    };

    // Initialize Deck.gl Overlay
    useEffect(() => {
        if (!map) return;
        if (overlayRef.current) return;

        const overlay = new MapboxOverlay({
            layers: []
        });

        const add = () => {
            map.addControl(overlay);
            overlayRef.current = overlay;
        };

        if (map.loaded()) {
            add();
        } else {
            map.once('load', add);
        }

        return () => {
            map.off('load', add);
            if (overlayRef.current) {
                map.removeControl(overlayRef.current);
                overlayRef.current = null;
            }
        };
    }, [map]);

    useEffect(() => {
        targetRingStateRef.current = targetRingState ?? null;
    }, [targetRingState]);

    const calculateAzimuth = (start: LngLat, end: LngLat): number => {
        const lat1 = (start.lat * Math.PI) / 180;
        const lat2 = (end.lat * Math.PI) / 180;
        const deltaLng = ((end.lng - start.lng) * Math.PI) / 180;

        const y = Math.sin(deltaLng) * Math.cos(lat2);
        const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

        const bearing = Math.atan2(y, x);
        return ((bearing * 180) / Math.PI + 360) % 360;
    };

    const calculateEndpoint = (start: LngLat, azimuthDeg: number, distanceM: number): LngLat => {
        const R = 6371000;
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
    };

    useEffect(() => {
        if (!map || !showTargetRing || !sourceLocation) {
            setRingPosition(null);
            return;
        }

        const updatePosition = () => {
            const pos = map.project([sourceLocation.lng, sourceLocation.lat]);
            setRingPosition({ x: pos.x, y: pos.y });
        };

        updatePosition();
        map.on('move', updatePosition);
        map.on('zoom', updatePosition);
        map.on('rotate', updatePosition);
        map.on('resize', updatePosition);

        return () => {
            map.off('move', updatePosition);
            map.off('zoom', updatePosition);
            map.off('rotate', updatePosition);
            map.off('resize', updatePosition);
        };
    }, [map, showTargetRing, sourceLocation]);

    // VIIRS Layers
    const viirsLayers = useMemo(() => {
        const particleData = viirsPoints ?? [];
        if (particleData.length === 0) return [];
        return [
            new ScatterplotLayer<ViirsPoint>({
                id: 'night-particles-halo',
                data: particleData,
                pickable: false,
                opacity: 0.9 * viirsOpacity,
                radiusUnits: 'pixels',
                billboard: true,
                stroked: false,
                filled: true,
                getPosition: d => d.position,
                getRadius: d => 2 + d.intensity * 5,
                radiusMinPixels: 1,
                radiusMaxPixels: 8,
                getFillColor: d => {
                    const a = Math.round((10 + d.intensity * 22) * viirsOpacity);
                    return [255, 235, 190, a];
                },
                updateTriggers: {
                    getFillColor: viirsOpacity,
                },
                parameters: glowBlendParams,
            }),
            new ScatterplotLayer<ViirsPoint>({
                id: 'night-particles-core',
                data: particleData,
                pickable: false,
                opacity: viirsOpacity,
                radiusUnits: 'pixels',
                billboard: true,
                stroked: false,
                filled: true,
                getPosition: d => d.position,
                getRadius: d => 0.8 + d.intensity * 1.4,
                radiusMinPixels: 0.6,
                radiusMaxPixels: 3,
                getFillColor: d => {
                    const a = Math.round((70 + d.intensity * 90) * viirsOpacity);
                    return [255, 255, 255, a];
                },
                updateTriggers: {
                    getFillColor: viirsOpacity,
                },
                parameters: glowBlendParams,
            })
        ];
    }, [viirsPoints, viirsOpacity, glowBlendParams]);

    // Posts Layers
    const postsLayers = useMemo(() => {
        if (!visiblePosts || !posts || posts.length === 0) return [];
        return [
            new ScatterplotLayer<Post>({
                id: 'posts-deck-layer',
                data: posts,
                pickable: true,
                stroked: true,
                filled: true,
                radiusUnits: 'pixels',
                radiusMinPixels: 6,
                radiusMaxPixels: 20,
                getPosition: d => [d.location.lng, d.location.lat],
                getFillColor: [245, 158, 11], // #f59e0b
                getLineColor: [17, 24, 39], // #111827
                getLineWidth: 2,
                getRadius: 6,
                parameters: {
                    depthTest: false
                },
                onHover: info => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const id = info.object ? (info.object as any).id : null;
                    if (onPostHover) onPostHover(id ? String(id) : null);
                },
                onClick: info => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const id = info.object ? (info.object as any).id : null;
                    if (onPostHover && id) onPostHover(String(id));
                }
            })
        ];
    }, [posts, hoveredPostId, visiblePosts, onPostHover]);

    // Scan/Line Layers
    const scanLayers = useMemo(() => {
        if (!map) return [];
        
        const rays: any[] = [];
        const hits: any[] = [];
        const anchors: any[] = [];
        const rayEnds: any[] = [];
        let rimSegs: Array<{ source: [number, number, number], target: [number, number, number], color: [number, number, number, number] }> = [];

        const terrainZ = (lng: number, lat: number): number | null => {
            const fn = (map as any).queryTerrainElevation;
            if (typeof fn !== 'function') return null;

            // Mapbox supports {exaggerated: true}
            const zEx = fn.call(map, [lng, lat], { exaggerated: true });
            if (Number.isFinite(zEx)) return zEx;

            const z = fn.call(map, [lng, lat]);
            if (!Number.isFinite(z)) return null;

            // Manual exaggeration fallback
            const terrain = (map as any).getTerrain?.();
            const ex = terrain?.exaggeration;
            if (Number.isFinite(ex)) return z * ex;

            return z;
        };

        const H_EYE = 1.6;
        const EPS = 0.1;

        // ✅ Gradient helpers for radar-style visualization
        const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
        const lerpColor = (a: [number, number, number, number], b: [number, number, number, number], t: number) =>
            [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)] as [number, number, number, number];

        // 赤→黄→緑 (t=0近い=赤, t=1遠い=緑)
        const rampRYG = (t: number): [number, number, number, number] => {
            const u = clamp01(t); // t=0→赤, t=1→緑 (no inversion)
            const RED: [number, number, number, number] = [255, 60, 60, 230];
            const YEL: [number, number, number, number] = [255, 210, 0, 230];
            const GRN: [number, number, number, number] = [0, 255, 170, 230];
            if (u < 0.5) return lerpColor(RED, YEL, u / 0.5);
            return lerpColor(YEL, GRN, (u - 0.5) / 0.5);
        };

        const haversineMeters = (a: { lng: number; lat: number }, b: { lng: number; lat: number }) => {
            const R = 6371000;
            const toRad = (d: number) => (d * Math.PI) / 180;
            const dLat = toRad(b.lat - a.lat);
            const dLng = toRad(b.lng - a.lng);
            const lat1 = toRad(a.lat);
            const lat2 = toRad(b.lat);
            const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
        };

        // Fixed range for gradient normalization (adjustable)
        const RANGE_MIN_M = 100;
        const RANGE_MAX_M = 2000;

        if (isFanMode) {
            if (!sourceLocation) {
                // overlayRef.current.setProps({ layers: [] });
                return [];
            }

            const startLng = sourceLocation.lng;
            const startLat = sourceLocation.lat;

            // DSM-derived Z (from MapView results)
            const zFromResults = fanRayResults.find(
                r => Number.isFinite(r.rayGeometry?.start.z as number)
            )?.rayGeometry?.start.z as number | undefined;

            // Map terrain surface Z
            const terrainStart = terrainZ(startLng, startLat);

            // Raw start Z (DSM preferred, else Terrain + Eye)
            const rawStartZ =
                (zFromResults !== undefined && Number.isFinite(zFromResults))
                    ? zFromResults
                    : ((terrainStart ?? 0) + H_EYE);

            // ✅ Calculate offset to align DSM data with Visual Terrain
            const verticalOffset =
                (terrainStart !== null && zFromResults !== undefined && Number.isFinite(zFromResults))
                    ? (terrainStart - (zFromResults - H_EYE))
                    : 0;

            // ✅ Corrected Start Z
            const startZ = rawStartZ + verticalOffset;

            // Draw Source (Blue) in Deck
            anchors.push({
                position: [startLng, startLat, startZ + 0.3],
                color: [59, 130, 246], // blue
                radius: 12,
            });

            // Draw Target (Red) in Deck if exists
            if (targetLocation) {
                const tZ = terrainZ(targetLocation.lng, targetLocation.lat);
                const targetZ = (tZ ?? (terrainStart ?? 0)) + EPS;
                anchors.push({
                    position: [targetLocation.lng, targetLocation.lat, targetZ],
                    color: [239, 68, 68], // red
                    radius: 10,
                });
            }

            const hasResults = fanRayResults.length > 0;
            const shouldPreview = !!previewFanConfig && preferPreview;

            if (previewRangeM && previewRangeM > 0) {
                const steps = 64;
                const ringPoints: Array<[number, number, number]> = [];
                for (let i = 0; i <= steps; i++) {
                    const az = (i * (360 / steps)) % 360;
                    const point = calculateEndpoint(sourceLocation, az, previewRangeM);
                    const tZ = terrainZ(point.lng, point.lat) ?? 0;
                    ringPoints.push([point.lng, point.lat, tZ + EPS]);
                }

                for (let i = 0; i < ringPoints.length - 1; i++) {
                    rimSegs.push({
                        source: ringPoints[i],
                        target: ringPoints[i + 1],
                        color: [80, 220, 255, 160],
                    });
                }
            }
            // --- MODE: RESULTS (Confirmed results exist) ---
            else if (!shouldPreview && hasResults) {
                const scanMaxRangeM = fanRayResults.reduce((mx, r) => {
                    if (!r.rayGeometry) return mx;
                    const A = { lng: startLng, lat: startLat };
                    const m = r.maxRangePoint
                        ? haversineMeters(A, { lng: r.maxRangePoint.lng, lat: r.maxRangePoint.lat })
                        : haversineMeters(A, { lng: r.rayGeometry.end.lng, lat: r.rayGeometry.end.lat });
                    return Math.max(mx, m);
                }, 0);
                const rangeMin = RANGE_MIN_M;
                const rangeMax = Math.max(RANGE_MAX_M, scanMaxRangeM);

                fanRayResults.forEach((r, i) => {
                    if (!r.rayGeometry) return;

                    const endLng = r.rayGeometry.end.lng;
                    const endLat = r.rayGeometry.end.lat;

                    const endZRaw = r.rayGeometry.end.z;
                    const tzEnd = terrainZ(endLng, endLat);

                    let endZ: number;
                    let zKind: 'raw' | 'terrain' | 'fallback';

                    if (r.hit) {
                        if (Number.isFinite(endZRaw)) {
                            endZ = (endZRaw as number) + verticalOffset;
                            zKind = 'raw';
                        } else if (tzEnd !== null) {
                            endZ = tzEnd + EPS;
                            zKind = 'terrain';
                        } else {
                            endZ = startZ;
                            zKind = 'fallback';
                        }
                    } else {
                        if (tzEnd !== null) {
                            endZ = tzEnd + EPS;
                            zKind = 'terrain';
                        } else {
                            endZ = startZ;
                            zKind = 'fallback';
                        }
                    }

                    const A = { lng: startLng, lat: startLat };
                    const maxRangeM = r.maxRangePoint
                        ? haversineMeters(A, { lng: r.maxRangePoint.lng, lat: r.maxRangePoint.lat })
                        : haversineMeters(A, { lng: endLng, lat: endLat });

                    const visibleM = (r.hit && Number.isFinite(r.distance as number) && (r.distance as number) > 0)
                        ? (r.distance as number)
                        : maxRangeM;

                    const tVis = clamp01((visibleM - rangeMin) / (rangeMax - rangeMin));
                    const rimColor = rampRYG(tVis);

                    rays.push({
                        source: [startLng, startLat, startZ],
                        target: [endLng, endLat, endZ],
                        color: [80, 220, 255, 180], // Cyan
                        zKind,
                    });

                    rayEnds.push({
                        position: [endLng, endLat, endZ + 0.2],
                        color: rimColor,
                        rimColor,
                        radius: 5,
                        i,
                        zKind,
                        endZRaw,
                        tz: tzEnd,
                        tVis,
                    });

                    if (r.hit && r.hitPoint) {
                        const A = { lng: startLng, lat: startLat };
                        const B = { lng: endLng, lat: endLat };
                        const H = { lng: r.hitPoint.lng, lat: r.hitPoint.lat };
                        const AB = haversineMeters(A, B);
                        const AH = haversineMeters(A, H);
                        const t = AB > 0 ? Math.max(0, Math.min(1, AH / AB)) : 0;
                        const hitZ = startZ + t * (endZ - startZ);
                        hits.push({
                            position: [H.lng, H.lat, hitZ + 0.2],
                            color: [245, 158, 11],
                            radius: 8,
                        });
                    }
                });

                // ✅ Create rim segments for rainbow arc visualization
                const sortedEnds = [...rayEnds].sort((a: any, b: any) => a.i - b.i);

                rimSegs = [];
                for (let k = 0; k < sortedEnds.length - 1; k++) {
                    const p0 = sortedEnds[k];
                    const p1 = sortedEnds[k + 1];
                    rimSegs.push({
                        source: p0.position as [number, number, number],
                        target: p1.position as [number, number, number],
                        color: p0.rimColor ?? [255, 255, 255, 200],
                    });
                }

                // ✅ Only close rim for 360° scans
                const isFullCircle =
                    fanRayResults.length > 3 &&
                    Math.abs(((fanRayResults[fanRayResults.length - 1].azimuth - fanRayResults[0].azimuth + 360) % 360) - 360) < 15;

                if (isFullCircle && sortedEnds.length > 2) {
                    const pLast = sortedEnds[sortedEnds.length - 1];
                    const pFirst = sortedEnds[0];
                    rimSegs.push({
                        source: pLast.position as [number, number, number],
                        target: pFirst.position as [number, number, number],
                        color: pLast.rimColor ?? [255, 255, 255, 200],
                    });
                }
            }
            // --- MODE: PREVIEW (No results, interactive adjustment) ---
            else if (previewFanConfig && targetLocation) {
                const { deltaTheta } = previewFanConfig;

                const centerAzimuth = ((): number => {
                    const y = Math.sin((targetLocation.lng - startLng) * Math.PI / 180) * Math.cos(targetLocation.lat * Math.PI / 180);
                    const x = Math.cos(startLat * Math.PI / 180) * Math.sin(targetLocation.lat * Math.PI / 180) -
                        Math.sin(startLat * Math.PI / 180) * Math.cos(targetLocation.lat * Math.PI / 180) * Math.cos((targetLocation.lng - startLng) * Math.PI / 180);
                    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
                })();

                const distM = haversineMeters({ lng: startLng, lat: startLat }, { lng: targetLocation.lng, lat: targetLocation.lat });

                const drawPreviewRay = (azimuth: number, isCenter: boolean) => {
                    const R = 6371000;
                    const br = azimuth * Math.PI / 180;
                    const lat1 = startLat * Math.PI / 180;
                    const lng1 = startLng * Math.PI / 180;
                    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(distM / R) + Math.cos(lat1) * Math.sin(distM / R) * Math.cos(br));
                    const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(distM / R) * Math.cos(lat1), Math.cos(distM / R) - Math.sin(lat1) * Math.sin(lat2));
                    const endLat = lat2 * 180 / Math.PI;
                    const endLng = lng2 * 180 / Math.PI;

                    const tZ = terrainZ(endLng, endLat) ?? 0;
                    const endZ = tZ + EPS;

                    rays.push({
                        source: [startLng, startLat, startZ],
                        target: [endLng, endLat, endZ],
                        color: isCenter ? [255, 255, 255, 100] : [80, 220, 255, 120],
                    });

                    return [endLng, endLat, endZ] as [number, number, number];
                };

                const pLeft = drawPreviewRay(centerAzimuth - deltaTheta / 2, false);
                const pCenter = drawPreviewRay(centerAzimuth, true);
                const pRight = drawPreviewRay(centerAzimuth + deltaTheta / 2, false);

                // Arc along preview radius instead of triangular rim
                const arcSegs: {
                    source: [number, number, number];
                    target: [number, number, number];
                    color: [number, number, number, number];
                }[] = [];
                const steps = 24;
                for (let i = 0; i < steps; i++) {
                    const t0 = i / steps;
                    const t1 = (i + 1) / steps;
                    const az0 = centerAzimuth - deltaTheta / 2 + deltaTheta * t0;
                    const az1 = centerAzimuth - deltaTheta / 2 + deltaTheta * t1;
                    const a0 = drawPreviewRay(az0, false);
                    const a1 = drawPreviewRay(az1, false);
                    arcSegs.push({ source: a0, target: a1, color: [80, 220, 255, 140] });
                }

                rimSegs = arcSegs;

                // Add center anchor red
                anchors.push({ position: pCenter, color: [239, 68, 68], radius: 10 });
            }

        } else if (sourceLocation && targetLocation) {
            // SINGLE RAY (NO FAN)
            const tStart = terrainZ(sourceLocation.lng, sourceLocation.lat);
            const tEnd = terrainZ(targetLocation.lng, targetLocation.lat);

            const startZ = (tStart ?? 0) + H_EYE;
            const endZ = (tEnd ?? 0) + EPS;

            rays.push({
                source: [sourceLocation.lng, sourceLocation.lat, startZ],
                target: [targetLocation.lng, targetLocation.lat, endZ],
                color: rayResult?.hit ? [239, 68, 68] : [16, 185, 129],
            });

            anchors.push({ position: [sourceLocation.lng, sourceLocation.lat, startZ], color: [59, 130, 246], radius: 12 });
            anchors.push({ position: [targetLocation.lng, targetLocation.lat, endZ], color: [239, 68, 68], radius: 10 });

            if (rayResult?.hit && rayResult.hitPoint) {
                const A = { lng: sourceLocation.lng, lat: sourceLocation.lat };
                const B = { lng: targetLocation.lng, lat: targetLocation.lat };
                const H = { lng: rayResult.hitPoint.lng, lat: rayResult.hitPoint.lat };

                const AB = haversineMeters(A, B);
                const AH = haversineMeters(A, H);
                const t = AB > 0 ? Math.max(0, Math.min(1, AH / AB)) : 0;

                const hitZ = startZ + t * (endZ - startZ);

                hits.push({
                    position: [H.lng, H.lat, hitZ + 0.2],
                    color: [245, 158, 11],
                    radius: 8,
                });
            }
        }

        return [
            new LineLayer({
                id: 'fan-rim',
                data: rimSegs,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getSourcePosition: (d: any) => d.source,
                getTargetPosition: (d: any) => d.target,
                getColor: (d: any) => d.color,
                getWidth: 6,
                widthUnits: 'pixels',
                parameters: { depthTest: false },
            }),
            new LineLayer({
                id: 'rays-3d',
                data: rays,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getSourcePosition: (d: any) => d.source,
                getTargetPosition: (d: any) => d.target,
                getColor: (d: any) => d.color,
                getWidth: 2,
                widthUnits: 'pixels',
                parameters: { depthTest: false },
            }),
            new ScatterplotLayer({
                id: 'hits-3d',
                data: hits,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.color,
                getRadius: (d: any) => d.radius ?? 8,
                radiusUnits: 'pixels',
                stroked: true,
                getLineColor: [255, 255, 255],
                getLineWidth: 2,
                parameters: { depthTest: false },
            }),
            new ScatterplotLayer({
                id: 'anchors-3d',
                data: anchors,
                coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
                getPosition: (d: any) => d.position,
                getFillColor: (d: any) => d.color,
                getRadius: (d: any) => d.radius ?? 10,
                radiusUnits: 'pixels',
                stroked: true,
                getLineColor: [255, 255, 255],
                getLineWidth: 3,
                parameters: { depthTest: false },
            }),
        ];
    }, [
        isFanMode,
        fanRayResults,
        rayResult,
        map,
        sourceLocation,
        targetLocation,
        previewFanConfig,
        previewRangeM
    ]);

    // Unified Layer Update
    useEffect(() => {
        if (!overlayRef.current) return;
        
        // 描画順序: VIIRS(背景) -> Posts(中間) -> Scan(最前面)
        // ※ Deck.glは配列の後ろにあるものが手前に描画されますが、
        // 3D空間では深度テスト(depthTest)が有効ならZ座標次第です。
        // Postsは今回 depthTest: false にしたので、間違いなく描画順で手前に来ます。
        overlayRef.current.setProps({
            layers: [
                ...viirsLayers,
                ...postsLayers,
                ...scanLayers
            ]
        });
    }, [viirsLayers, postsLayers, scanLayers]);

    // Update GeoJSON markers (Source, Target, Current, Hover)
    useEffect(() => {
        if (!map) return;

        const features: GeoJSON.Feature[] = [];

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

        if (profile && hoveredIndex !== null) {
            const lng = profile.lngs[hoveredIndex];
            const lat = profile.lats[hoveredIndex];
            const elev = profile.elev_m[hoveredIndex];

            if (elev !== null) {
                features.push({
                    type: 'Feature',
                    geometry: {
                        type: 'Point',
                        coordinates: [lng, lat],
                    },
                    properties: {
                        color: '#ef4444', // Red
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
    }, [map, sourceLocation, currentLocation, targetLocation, profile, hoveredIndex]);

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const ringState = targetRingStateRef.current;
        if (!map || !sourceLocation || !targetLocation || !ringState || !isDraggingRef.current) return;

        const rect = map.getContainer().getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const lngLat = map.unproject([x, y]);

        const centerAz = calculateAzimuth(sourceLocation, targetLocation);
        const mouseAz = calculateAzimuth(sourceLocation, { lng: lngLat.lng, lat: lngLat.lat });
        let diff = Math.abs(mouseAz - centerAz);
        if (diff > 180) diff = 360 - diff;

        const newDelta = Math.max(1, Math.min(360, diff * 2));
        if (ringState.previewDeltaTheta !== newDelta) {
            ringState.setPreviewDeltaTheta(newDelta);
        }
    };

    const handlePointerUp = () => {
        const ringState = targetRingStateRef.current;
        if (!ringState || !isDraggingRef.current) return;

        isDraggingRef.current = false;
        if (ringState.previewDeltaTheta !== null) {
            ringState.onCommitDeltaTheta(ringState.previewDeltaTheta);
        }
    };

    useEffect(() => {
        if (!map || !showTargetRing || !sourceLocation || !targetLocation) return;

        const handleMouseMove = (event: maplibregl.MapMouseEvent) => {
            const ringState = targetRingStateRef.current;
            if (!ringState) return;
            const lngLat = event.lngLat;
            const centerAz = calculateAzimuth(sourceLocation, targetLocation);
            const mouseAz = calculateAzimuth(sourceLocation, { lng: lngLat.lng, lat: lngLat.lat });
            let diff = Math.abs(mouseAz - centerAz);
            if (diff > 180) diff = 360 - diff;

            const newDelta = Math.max(1, Math.min(360, diff * 2));
            if (ringState.previewDeltaTheta !== newDelta) {
                ringState.setPreviewDeltaTheta(newDelta);
            }
        };

        map.on('mousemove', handleMouseMove);

        return () => {
            map.off('mousemove', handleMouseMove);
        };
    }, [map, showTargetRing, sourceLocation, targetLocation]);

    return (
        <div className="absolute inset-0 pointer-events-none z-30" />
    );
}
