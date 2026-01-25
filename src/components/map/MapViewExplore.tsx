import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { useMapLibre } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import { buildViirsPoints, clearViirsCache, type ViirsPoint } from '../../lib/viirsSampler';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';
import { CurrentLocationButton } from '../ui/CurrentLocationButton';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { FanConfig, ScanMode, ScanStep } from './types';
import { MOCK_POSTS } from '../../data/mockPosts';
import { listPosts, createPost, uploadPhoto, type Post } from '../../lib/postsApi';
import { isSupabaseConfigured } from '../../lib/supabaseClient';

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
const RANGE_MIN_M = 3000;
const RANGE_MAX_M = 200000;
const VIIRS_SAMPLE_Z = 10;

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
    mode: 'explore' | 'analyze';
    scanMode: ScanMode;
    profile: ProfileResponse | null;
    hoveredIndex: number | null;
    clickedIndex: number | null;
    onZoomChange: (zoom: number) => void;
    searchTarget?: { lat: number; lng: number } | null;
    onSearchTargetConsumed?: () => void;
};

export function MapViewExplore({
    onProfileChange,
    onRayResultChange,
    onScanStatusChange,
    onResetReady,
    mode,
    scanMode,
    profile,
    hoveredIndex,
    clickedIndex,
    onZoomChange,
    searchTarget,
    onSearchTargetConsumed,
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
    const [scanRangeM, setScanRangeM] = useState<number>(RANGE_MIN_M);
    const [previewRangeM, setPreviewRangeM] = useState<number | null>(null);
    const [viirsPoints, setViirsPoints] = useState<ViirsPoint[]>([]);

    // Interactive Fan Adjustment State
    const [previewDeltaTheta, setPreviewDeltaTheta] = useState<number | null>(null);

    // Smart Location / North Reset State
    const [mapBearing, setMapBearing] = useState<number>(0);
    const [northResetTrigger, setNorthResetTrigger] = useState<number>(0);
    const [isLocating, setIsLocating] = useState(false);
    const [locateError, setLocateError] = useState<string | null>(null);
    const hasAutoSetSourceRef = useRef(false);
    const hasInitialFlyRef = useRef(false);

    const isNorthUp = Math.abs(mapBearing) <= NORTH_THRESHOLD_DEG;
    // const [isCollapsed, setIsCollapsed] = useState(false); // Lifted to App.tsx

    // Sight angle state
    const [sightAngle] = useState<number>(SIGHT_ANGLE_PRESETS.HORIZONTAL);

    // Ray result state (replaces rayEndPoint and isLineClear)
    const [rayResult, setRayResult] = useState<RayResult | null>(null);

    // Fan mode state
    const isFanMode = true;
    const fanDeltaThetaRef = useRef(FAN_PRESETS.DELTA_THETA.MEDIUM);
    const [fanConfig, setFanConfig] = useState<FanConfig>({
        deltaTheta: FAN_PRESETS.DELTA_THETA.MEDIUM,
        rayCount: 36,
        maxRange: FAN_PRESETS.MAX_RANGE,
    });
    const [fanRayResults, setFanRayResults] = useState<FanRayResult[]>([]);
    const postsPopupCloseTimerRef = useRef<number | null>(null);
    const [hoveredPostId, setHoveredPostId] = useState<string | null>(null);
    const hoveredPostIdRef = useRef<string | number | null>(null);
    const postPopupsRef = useRef<Map<string, maplibregl.Popup>>(new Map());
    
    // Handler for Deck.gl Post Hover
    const handlePostHover = useCallback((id: string | null) => {
        if (mode !== 'analyze' || !map) return;
        
        if (postsPopupCloseTimerRef.current != null) {
            window.clearTimeout(postsPopupCloseTimerRef.current);
            postsPopupCloseTimerRef.current = null;
        }

        if (id) {
            map.getCanvas().style.cursor = 'pointer';
            setHoveredPostId(id);
            hoveredPostIdRef.current = id;
        } else {
            map.getCanvas().style.cursor = '';
            postsPopupCloseTimerRef.current = window.setTimeout(() => {
                setHoveredPostId(null);
                hoveredPostIdRef.current = null;
            }, 180);
        }
    }, [map, mode]);

    const postPopupExpandedRef = useRef<Map<string, boolean>>(new Map());
    const isZoomExpandedRef = useRef<boolean | null>(null);
    const POSTS_IMAGE_ZOOM_THRESHOLD = 13;

    // Posts state (Supabase + MOCK_POSTS)
    const [posts, setPosts] = useState<Post[]>([]);
    const [isPostModalOpen, setIsPostModalOpen] = useState(false);
    const [postMessage, setPostMessage] = useState('');
    const [postPhotoUrl, setPostPhotoUrl] = useState('');
    const [postPhotoFile, setPostPhotoFile] = useState<File | null>(null);
    const [isPosting, setIsPosting] = useState(false);
    const [postLocationMode, setPostLocationMode] = useState<'center' | 'current' | 'pin'>('center');
    const [postPinLocation, setPostPinLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [isPinSelecting, setIsPinSelecting] = useState(false);
    const postModalRef = useRef<HTMLDivElement | null>(null);
    const postButtonRef = useRef<HTMLButtonElement | null>(null);

    // VIIRS controls
    const [viirsEnabled, setViirsEnabled] = useState(true);
    const [viirsOpacity, setViirsOpacity] = useState<number>(0.2);
    const [isViirsPanelOpen, setIsViirsPanelOpen] = useState(false);
    const viirsPanelRef = useRef<HTMLDivElement | null>(null);
    const viirsButtonRef = useRef<HTMLButtonElement | null>(null);
    const viirsUpdateTimerRef = useRef<number | null>(null);
    const viirsRequestIdRef = useRef(0);

    // Aerial Photo controls
    const [aerialEnabled, setAerialEnabled] = useState(false);

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

    function escapeHtml(s: string) {
        return s
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#039;');
    }

    function buildPostPopupHtml(post: Post, expanded: boolean) {
        const caption = escapeHtml(post.caption ?? '');
        const placeName = escapeHtml(post.location.placeName ?? '');
        const areaText = post.location.area ? `・${escapeHtml(post.location.area)}` : '';
        const authorName = post.author?.name ? `<div class="night-popup-author">@${escapeHtml(post.author.name)}</div>` : '';
        const photoUrl = post.photos?.[0]?.url ?? '';
        
        // 簡易表示（ズーム前）: テキストのみ
        if (!expanded) {
             return `
              <div class="night-popup-card night-popup-simple">
                <div class="night-popup-caption" style="font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px;">${caption}</div>
              </div>
            `;
        }

        // 詳細表示（ズーム後）
        return `
      <div class="night-popup-card">
        ${photoUrl
                ? `<img class="night-popup-img" src="${photoUrl}" alt="" loading="lazy" decoding="async" width="240" height="132" />`
                : ''
            }
        <div class="night-popup-caption">${caption}</div>
        <div class="night-popup-meta">${placeName}${areaText}</div>
        ${authorName}
      </div>
    `;
    }

    // Posts取得（Supabase + MOCK_POSTSをマージ）
    const loadPosts = useCallback(async () => {
        // MOCK_POSTSを既存のPost型に変換
        const mockPostsConverted: Post[] = MOCK_POSTS.map((p) => ({
            id: p.id,
            location: p.location,
            caption: p.caption,
            photos: p.photos,
            author: p.author,
            createdAt: p.createdAt,
            source: 'mock' as const,
        }));

        if (!isSupabaseConfigured) {
            // Supabase未設定ならMOCK_POSTSのみ
            setPosts(mockPostsConverted);
            return;
        }

        try {
            const supabasePosts = await listPosts();
            // Supabaseの投稿を先頭、その後にMOCK_POSTS
            setPosts([...supabasePosts, ...mockPostsConverted]);
        } catch (err) {
            console.error('[loadPosts] エラー:', err);
            setPosts(mockPostsConverted);
        }
    }, []);

    // 投稿送信
    const handleSubmitPost = useCallback(async () => {
        if (!postMessage.trim()) return;
        if (!map) return;

        setIsPosting(true);
        try {
            // 投稿場所を決定
            let postLat: number;
            let postLng: number;

            if (postLocationMode === 'pin' && postPinLocation) {
                postLat = postPinLocation.lat;
                postLng = postPinLocation.lng;
            } else if (postLocationMode === 'current' && currentLocation) {
                postLat = currentLocation.lat;
                postLng = currentLocation.lng;
            } else {
                const center = map.getCenter();
                postLat = center.lat;
                postLng = center.lng;
            }

            let finalPhotoUrl = postPhotoUrl.trim();

            // 画像ファイルが選択されている場合はアップロード
            if (postPhotoFile) {
                const uploadedUrl = await uploadPhoto(postPhotoFile);
                if (uploadedUrl) {
                    finalPhotoUrl = uploadedUrl;
                }
            }

            const newPost = await createPost({
                message: postMessage.trim(),
                photoUrl: finalPhotoUrl || undefined,
                lat: postLat,
                lng: postLng,
            });

            if (newPost) {
                // 成功したら一覧を再取得
                await loadPosts();
                // フォームリセット
                setPostMessage('');
                setPostPhotoUrl('');
                setPostPhotoFile(null);
                setPostLocationMode('center');
                setPostPinLocation(null);
                setIsPostModalOpen(false);
            }
        } catch (err) {
            console.error('[handleSubmitPost] エラー:', err);
        } finally {
            setIsPosting(false);
        }
    }, [postMessage, postPhotoUrl, postPhotoFile, postLocationMode, postPinLocation, currentLocation, map, loadPosts]);

    // 初回マウント時にposts取得
    useEffect(() => {
        void loadPosts();
    }, [loadPosts]);

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

    useEffect(() => {
        if (!map || !isLoaded) return;
        if (hasInitialFlyRef.current) return;
        hasInitialFlyRef.current = true;

        map.flyTo({
            center: [139.77, 35.68],
            zoom: 14,
            pitch: 60,
            bearing: -20,
            duration: 1200,
        });
    }, [map, isLoaded]);

    // Handle search target flyTo
    useEffect(() => {
        if (!map || !isLoaded || !searchTarget) return;
        map.flyTo({
            center: [searchTarget.lng, searchTarget.lat],
            zoom: 15,
            pitch: 60,
            duration: 1500,
        });
        onSearchTargetConsumed?.();
    }, [map, isLoaded, searchTarget, onSearchTargetConsumed]);

    // Update VIIRS layer opacity
    // （ラスタ自体は非表示にするが、UI連動を残す場合はコメントアウト、完全に消す場合は削除）
    /*
    useEffect(() => {
        if (!map || !isLoaded) return;
        // ... (以下、ラスタ表示に関わるuseEffectを無効化・削除)
    */

    useEffect(() => {
        if (!map || !isLoaded) return;
        if (!viirsEnabled) {
            setViirsPoints([]);
            return;
        }

        let isActive = true;
        let prevStride: number | null = null;

        const update = async () => {
            const requestId = ++viirsRequestIdRef.current;
            const bounds = map.getBounds();
            const currentZoom = map.getZoom();

            // ズームレベルに応じてサンプリングパラメータを調整
            // ズームアウトするほど stride を大きく、maxPoints を小さくして間引く
            let stride: number;
            let maxPoints: number;
            let maxPointsPerTile: number;
            let emit: number;

            if (currentZoom >= 14) {
                // 高ズーム: 高密度
                stride = 1;
                maxPoints = 300000;
                maxPointsPerTile = 15000;
                emit = 8;
            } else if (currentZoom >= 12) {
                // 中ズーム: 標準密度
                stride = 2;
                maxPoints = 200000;
                maxPointsPerTile = 12000;
                emit = 6;
            } else if (currentZoom >= 10) {
                // 低ズーム: 低密度
                stride = 4;
                maxPoints = 150000;
                maxPointsPerTile = 6000;
                emit = 4;
            } else {
                // 超低ズーム: 最低密度
                stride = 8;
                maxPoints = 80000;
                maxPointsPerTile = 3000;
                emit = 3;
            }

            // strideが変わった場合はキャッシュをクリア
            if (prevStride !== null && prevStride !== stride) {
                console.log('[VIIRS] stride changed, clearing cache:', prevStride, '->', stride);
                clearViirsCache();
            }
            prevStride = stride;

            console.log('[VIIRS update] zoom:', currentZoom.toFixed(1), { stride, maxPoints, maxPointsPerTile, emit });

            const points = await buildViirsPoints(bounds, VIIRS_SAMPLE_Z, {
                stride,
                threshold: 0.1,  // 閾値を大幅に上げて、ノイズを完全に消す
                emit,
                gamma: 2.2,      // ガンマを上げて、明るい所だけを強調（メリハリ）
                logK: 2,         // 圧縮を弱くして、都市部と山の差をそのまま出す
                maxPoints,
                maxPointsPerTile,
                heightScale: 80,
            });
            if (!isActive) return;
            if (requestId !== viirsRequestIdRef.current) return;
            setViirsPoints(points);
        };

        const scheduleUpdate = () => {
            if (viirsUpdateTimerRef.current !== null) {
                window.clearTimeout(viirsUpdateTimerRef.current);
            }
            viirsUpdateTimerRef.current = window.setTimeout(() => {
                void update();
            }, 150);
        };

        scheduleUpdate();
        map.on('moveend', scheduleUpdate);
        map.on('zoomend', scheduleUpdate);

        return () => {
            isActive = false;
            map.off('moveend', scheduleUpdate);
            map.off('zoomend', scheduleUpdate);
            if (viirsUpdateTimerRef.current !== null) {
                window.clearTimeout(viirsUpdateTimerRef.current);
                viirsUpdateTimerRef.current = null;
            }
        };
    }, [map, isLoaded, viirsEnabled]);

    // Update Aerial Photo layer visibility
    useEffect(() => {
        if (!map || !isLoaded) return;
        const layerId = 'aerial-photo-layer';
        if (map.getLayer(layerId)) {
            map.setLayoutProperty(
                layerId,
                'visibility',
                aerialEnabled ? 'visible' : 'none'
            );
        }
    }, [map, isLoaded, aerialEnabled]);

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
        if (!map || !isLoaded) return;
        // Previously managed 'posts-layer' here.
        // Now posts are rendered via MapOverlays (Deck.gl)
    }, [map, isLoaded, mode, posts]); // Leaving minimal deps or removing entirely


    useEffect(() => {
        if (!map || !isLoaded) return;
        // previously checked posts-layer

        const setPostPopupExpanded = (id: string | number, expanded: boolean) => {
            const popup = postPopupsRef.current.get(String(id));
            if (!popup) return;

            const prev = postPopupExpandedRef.current.get(String(id));
            if (prev === expanded) return;

            const post = posts.find((item) => item.id === String(id));
            if (!post) return;

            popup.setHTML(buildPostPopupHtml(post, expanded));
            postPopupExpandedRef.current.set(String(id), expanded);
        };

        const shouldShowImage = () => (map.getZoom?.() ?? 0) >= POSTS_IMAGE_ZOOM_THRESHOLD;

        if (mode === 'analyze') {
            isZoomExpandedRef.current = shouldShowImage();
            for (const post of posts) {
                let popup = postPopupsRef.current.get(post.id);
                if (!popup) {
                    const expanded = shouldShowImage();
                    popup = new maplibregl.Popup({
                        closeButton: false,
                        closeOnClick: false,
                        closeOnMove: false,
                        offset: 12,
                        anchor: 'bottom',
                        className: 'night-popup',
                    })
                        .setLngLat([post.location.lng, post.location.lat])
                        .setHTML(buildPostPopupHtml(post, expanded))
                        .addTo(map);

                    postPopupsRef.current.set(post.id, popup);
                    postPopupExpandedRef.current.set(post.id, expanded);

                    const el = popup.getElement();
                    el.addEventListener('mouseenter', () => handlePostHover(post.id));
                    el.addEventListener('mouseleave', () => handlePostHover(null));
                    el.addEventListener(
                        'wheel',
                        (event) => {
                            event.preventDefault();
                            const canvas = map.getCanvas();
                            canvas.dispatchEvent(new WheelEvent('wheel', event));
                        },
                        { passive: false }
                    );
                } else {
                    popup.setLngLat([post.location.lng, post.location.lat]);
                    if (!popup.isOpen?.()) {
                        popup.addTo(map);
                    }
                }
            }
        } else {
            if (hoveredPostIdRef.current != null) {
                handlePostHover(null);
            }
            for (const popup of postPopupsRef.current.values()) {
                popup.remove();
            }
            postPopupExpandedRef.current.clear();
            hoveredPostIdRef.current = null;
        }

        const handleZoom = () => {
            const expanded = shouldShowImage();
            if (isZoomExpandedRef.current === expanded) return;
            isZoomExpandedRef.current = expanded;

            for (const [postId, isExpanded] of postPopupExpandedRef.current.entries()) {
                if (isExpanded !== expanded) {
                    setPostPopupExpanded(postId, expanded);
                }
            }
        };

        map.on('zoom', handleZoom);

        return () => {
            map.off('zoom', handleZoom);

            if (postsPopupCloseTimerRef.current != null) {
                window.clearTimeout(postsPopupCloseTimerRef.current);
                postsPopupCloseTimerRef.current = null;
            }
            for (const popup of postPopupsRef.current.values()) {
                popup.remove();
            }
            postPopupsRef.current.clear();
            postPopupExpandedRef.current.clear();
        };
    }, [map, isLoaded, mode, posts, handlePostHover]);

    useEffect(() => {
        if (scanMode === '360') {
            fanDeltaThetaRef.current = fanConfig.deltaTheta;
            if (fanConfig.deltaTheta !== 360) {
                setFanConfig((prev) => ({ ...prev, deltaTheta: 360 }));
            }
            return;
        }

        if (scanMode === 'fan') {
            const restore = fanDeltaThetaRef.current;
            if (fanConfig.deltaTheta !== restore) {
                setFanConfig((prev) => ({ ...prev, deltaTheta: restore }));
            }
        }
    }, [scanMode, fanConfig.deltaTheta]);

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

    // 投稿モーダル外クリックで閉じる
    useEffect(() => {
        if (!isPostModalOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (postModalRef.current?.contains(target)) return;
            if (postButtonRef.current?.contains(target)) return;
            setIsPostModalOpen(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsPostModalOpen(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isPostModalOpen]);

    // ピン選択モードでの地図クリックハンドラ
    useEffect(() => {
        if (!map || !isPinSelecting) return;

        const handleMapClick = (e: maplibregl.MapMouseEvent) => {
            const { lng, lat } = e.lngLat;
            setPostPinLocation({ lat, lng });
            setIsPinSelecting(false);
            setIsPostModalOpen(true);
        };

        map.on('click', handleMapClick);

        // カーソルをcrosshairに変更
        map.getCanvas().style.cursor = 'crosshair';

        return () => {
            map.off('click', handleMapClick);
            map.getCanvas().style.cursor = '';
        };
    }, [map, isPinSelecting]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (scanStep === 'idle') {
            setScanStep('selecting_source');
        }
    }, [scanStep, mode]);

    useEffect(() => {
        if (mode !== 'explore') return;
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
    }, [scanStep, loading, error, rayResult, fanRayResults, onScanStatusChange, mode]);

    useEffect(() => {
        const reset = () => {
            setScanStep('idle');
            setSourceLocation(null);
            setTargetLocation(null);
            setFanRayResults([]);
            setPreviewDeltaTheta(null);
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
        if (mode !== 'analyze') return;
        setScanStep('idle');
        setSourceLocation(null);
        setTargetLocation(null);
        setFanRayResults([]);
        setPreviewDeltaTheta(null);
        setPreviewRangeM(null);
        setRayResult(null);
        setError(null);
        setLoading(false);
        onRayResultChange(null);
        onProfileChange(null);
    }, [mode, onProfileChange, onRayResultChange]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'selecting_source') return;

        const handleSourceDoubleClick = (e: maplibregl.MapMouseEvent) => {
            e.preventDefault();
            const nextSource = {
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            };
            setSourceLocation(nextSource);
            if (scanMode === '360') {
                setTargetLocation(null);
                setPreviewRangeM(scanRangeM);
                setFanRayResults([]);
                setRayResult(null);
                setScanStep('adjusting_range');
                return;
            }
            setScanStep(scanMode === '360' ? 'complete' : 'selecting_target');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.doubleClickZoom.disable();
        map.on('dblclick', handleSourceDoubleClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('dblclick', handleSourceDoubleClick);
            map.doubleClickZoom.enable();
        };
    }, [map, isLoaded, scanStep, scanMode, scanRangeM, mode]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'adjusting_range' || !sourceLocation || scanMode !== '360') return;

        const clampRange = (value: number) =>
            Math.max(RANGE_MIN_M, Math.min(RANGE_MAX_M, value));

        const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
            const distance = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
                .distanceTo(new maplibregl.LngLat(e.lngLat.lng, e.lngLat.lat));
            setPreviewRangeM(clampRange(distance));
        };

        const handleClick = () => {
            const nextRange = clampRange(previewRangeM ?? scanRangeM);
            setScanRangeM(nextRange);
            setPreviewRangeM(null);
            setScanStep('scanning');
            const northTarget = calculateEndpoint(sourceLocation, 0, nextRange);
            setTargetLocation(northTarget);
            executeScan({ deltaTheta: 360 }, northTarget);
        };

        map.on('mousemove', handleMouseMove);
        map.on('click', handleClick);
        map.getCanvas().style.cursor = 'col-resize';

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('click', handleClick);
            map.getCanvas().style.cursor = '';
        };
    }, [map, isLoaded, scanStep, sourceLocation, previewRangeM, scanRangeM, scanMode, mode]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'selecting_target') return;

        setPreviewDeltaTheta(null);

        const handleTargetClick = (e: maplibregl.MapMouseEvent) => {
            const nextTarget = {
                lng: e.lngLat.lng,
                lat: e.lngLat.lat,
            };
            setTargetLocation(nextTarget);
            if (scanMode === '360') {
                setScanStep('scanning');
                executeScan({ deltaTheta: 360 }, nextTarget);
                return;
            }
            setScanStep('adjusting_angle');
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleTargetClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleTargetClick);
        };
    }, [map, isLoaded, scanStep, scanMode, mode]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'adjusting_angle' || !sourceLocation || !targetLocation || scanMode !== 'fan') {
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
                fanDeltaThetaRef.current = previewDeltaTheta;
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
    }, [map, isLoaded, scanStep, sourceLocation, targetLocation, previewDeltaTheta, fanConfig.deltaTheta, scanMode, mode]);


    // Execute Scan Logic (Manual Trigger)
    const executeScan = async (configOverride?: Partial<FanConfig>, targetOverride?: LngLat) => {
        if (!sourceLocation) {
            setError("観測点が設定されていません");
            return;
        }
        const activeTarget = targetOverride ?? targetLocation;
        if (isFanMode && !activeTarget) {
            setError("目標点が設定されていません");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const currentConfig = { ...fanConfig, ...configOverride };

            if (isFanMode && activeTarget) {
                // Fan Scan
                const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                const end = new maplibregl.LngLat(activeTarget.lng, activeTarget.lat);
                const distanceM = start.distanceTo(end);
                const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                const centerProfile = await fetchProfile(sourceLocation, activeTarget, sampleCount);
                onProfileChange(centerProfile);

                const elevA = centerProfile.elev_m[0];
                const sourceZ0 = (typeof elevA === 'number' && Number.isFinite(elevA)) ? elevA + 1.6 : 1.6;

                const results = await generateFanRays(sourceLocation, activeTarget, currentConfig, sightAngle, sourceZ0);
                setFanRayResults(results);

                const centerIndex = Math.floor(currentConfig.rayCount / 2);
                const centerResult = results[centerIndex];
                setRayResult(centerResult);
                onRayResultChange(centerResult);
            } else if (activeTarget) {
                // Single Ray
                const start = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat);
                const end = new maplibregl.LngLat(activeTarget.lng, activeTarget.lat);
                const distanceM = start.distanceTo(end);
                const sampleCount = Math.min(500, Math.max(120, Math.ceil(distanceM / 10)));

                const profile = await fetchProfile(sourceLocation, activeTarget, sampleCount);
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
                previewRangeM={scanMode === '360' && scanStep === 'adjusting_range' ? previewRangeM : null}
                preferPreview={scanStep === 'adjusting_angle'}
                showTargetRing={scanStep === 'adjusting_angle'}
                viirsPoints={viirsPoints}
                posts={posts}
                hoveredPostId={hoveredPostId}
                onPostHover={handlePostHover}
                visiblePosts={mode === 'analyze'}
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
                                        fanDeltaThetaRef.current = preset.value;
                                        setFanConfig((prev) => ({
                                            ...prev,
                                            deltaTheta: preset.value,
                                        }));
                                    }}
                                    className={`rounded-full px-2 py-1 transition-colors ${fanConfig.deltaTheta === preset.value
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
                    {/* 投稿ボタン */}
                    <button
                        ref={postButtonRef}
                        type="button"
                        onClick={() => setIsPostModalOpen((prev) => !prev)}
                        className="group bg-black/60 backdrop-blur-md border border-yellow-400/60 text-white rounded-full shadow-lg h-11 w-11 hover:bg-yellow-400/20 hover:border-yellow-300 active:scale-95 transition-all duration-200 flex items-center justify-center"
                        aria-label="投稿する"
                        aria-pressed={isPostModalOpen}
                        disabled={!isSupabaseConfigured}
                        title={isSupabaseConfigured ? '投稿する' : 'Supabase未設定'}
                    >
                        <span className="text-lg">📸</span>
                    </button>
                    {isPostModalOpen && (
                        <div
                            ref={postModalRef}
                                    className="absolute right-0 bottom-14 w-72 rounded-xl border border-white/10 bg-black/80 p-4 shadow-lg backdrop-blur-md"
                                >
                                    <div className="text-sm text-white/90 font-medium mb-3">夜景を投稿</div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1">
                                                メッセージ <span className="text-red-400">*</span>
                                            </label>
                                            <textarea
                                                value={postMessage}
                                                onChange={(e) => setPostMessage(e.target.value)}
                                                placeholder="夜景の感想を書いてください"
                                                maxLength={280}
                                                rows={3}
                                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-yellow-400/50 focus:outline-none resize-none"
                                            />
                                            <div className="text-right text-[10px] text-white/40 mt-1">
                                                {postMessage.length}/280
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-1">
                                                写真をアップロード または URL（任意）
                                            </label>
                                            <div className="space-y-2">
                                                <input
                                                    type="file"
                                                    accept="image/*"
                                                    id="photo-upload"
                                                    className="hidden"
                                                    onChange={(e) => {
                                                        const file = e.target.files?.[0];
                                                        if (file) setPostPhotoFile(file);
                                                    }}
                                                />
                                                <label
                                                    htmlFor="photo-upload"
                                                    className="flex items-center justify-center w-full rounded-lg border border-dashed border-white/20 bg-white/5 px-3 py-4 text-xs text-white/60 hover:bg-white/10 hover:border-yellow-400/50 cursor-pointer transition-all"
                                                >
                                                    {postPhotoFile ? (
                                                        <span className="text-yellow-400 flex items-center gap-2">
                                                            <span>🖼️</span>
                                                            <span className="truncate max-w-[200px]">{postPhotoFile.name}</span>
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.preventDefault();
                                                                    setPostPhotoFile(null);
                                                                }}
                                                                className="text-white/40 hover:text-white"
                                                            >
                                                                ✕
                                                            </button>
                                                        </span>
                                                    ) : (
                                                        <span>画像を選択してください</span>
                                                    )}
                                                </label>

                                                <input
                                                    type="url"
                                                    value={postPhotoUrl}
                                                    onChange={(e) => setPostPhotoUrl(e.target.value)}
                                                    placeholder="または画像のURLを入力"
                                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-yellow-400/50 focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-2">
                                                📍 投稿場所
                                            </label>
                                            <div className="flex flex-col gap-2">
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPostLocationMode('center')}
                                                        className={`flex-1 rounded-lg border py-2 text-xs transition-all ${
                                                            postLocationMode === 'center'
                                                                ? 'border-yellow-400 bg-yellow-400/20 text-yellow-400'
                                                                : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                                                        }`}
                                                    >
                                                        🗺️ 地図中心
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setPostLocationMode('current')}
                                                        disabled={!currentLocation}
                                                        className={`flex-1 rounded-lg border py-2 text-xs transition-all ${
                                                            postLocationMode === 'current'
                                                                ? 'border-yellow-400 bg-yellow-400/20 text-yellow-400'
                                                                : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed'
                                                        }`}
                                                    >
                                                        📍 現在位置
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setPostLocationMode('pin');
                                                        setIsPinSelecting(true);
                                                        setIsPostModalOpen(false);
                                                    }}
                                                    className={`w-full rounded-lg border py-2 text-xs transition-all ${
                                                        postLocationMode === 'pin' && postPinLocation
                                                            ? 'border-yellow-400 bg-yellow-400/20 text-yellow-400'
                                                            : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                                                    }`}
                                                >
                                                    {postLocationMode === 'pin' && postPinLocation
                                                        ? `📌 ピン設定済み (${postPinLocation.lat.toFixed(4)}, ${postPinLocation.lng.toFixed(4)})`
                                                        : '📌 地図をタップしてピンを刺す'}
                                                </button>
                                            </div>
                                            {!currentLocation && postLocationMode !== 'current' && (
                                                <div className="text-[10px] text-white/30 mt-1">
                                                    現在位置は位置情報を許可すると使用できます
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex gap-2 pt-2">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setIsPostModalOpen(false);
                                                    setPostMessage('');
                                                    setPostPhotoUrl('');
                                                    setPostPhotoFile(null);
                                                    setPostLocationMode('center');
                                                    setPostPinLocation(null);
                                                }}
                                                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-white/70 hover:bg-white/10"
                                            >
                                                キャンセル
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSubmitPost}
                                                disabled={!postMessage.trim() || isPosting}
                                                className="flex-1 rounded-lg bg-yellow-400 py-2 text-sm font-medium text-black hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isPosting ? '投稿中...' : '投稿する'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
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

                            <div className="flex items-center justify-between text-sm text-white/80 mt-3 pt-3 border-t border-white/10">
                                <span>航空写真</span>
                                <label className="flex items-center gap-2 text-xs text-white/60">
                                    <span>{aerialEnabled ? 'ON' : 'OFF'}</span>
                                    <input
                                        type="checkbox"
                                        checked={aerialEnabled}
                                        onChange={(event) => setAerialEnabled(event.target.checked)}
                                        className="h-4 w-4 accent-yellow-400"
                                    />
                                </label>
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

            {/* ピン選択モード時のバナー */}
            {isPinSelecting && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50">
                    <div className="bg-yellow-400 text-black px-4 py-2 rounded-xl shadow-lg flex items-center gap-3 text-sm font-medium">
                        <span>📌 地図をタップして投稿場所を選択</span>
                        <button
                            type="button"
                            onClick={() => {
                                setIsPinSelecting(false);
                                setIsPostModalOpen(true);
                            }}
                            className="bg-black/20 hover:bg-black/30 px-2 py-1 rounded text-xs"
                        >
                            キャンセル
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
