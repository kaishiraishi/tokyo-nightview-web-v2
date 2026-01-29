import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import { Camera, MapPin, Image as ImageIcon, Pin, Send, AlertCircle, Zap } from 'lucide-react';
import { LayerMenu } from '../layout/LayerMenu';
import { TopBar } from '../layout/TopBar';
import { ScanControlPanel } from '../hud/ScanControlPanel';
import { PostListPanel } from '../hud/PostListPanel';
import { useMapLibre, POTENTIAL_LAYER_ID } from '../../hooks/useMapLibre';
import { useGeolocation } from '../../hooks/useGeolocation';
import { MapOverlays } from './MapOverlays';
import { fetchProfile } from '../../lib/api/dsmApi';
import { searchLocation, type GeocodingResult } from '../../lib/api/geocodingApi';
import { buildViirsPoints, clearViirsCache, type ViirsPoint } from '../../lib/viirsSampler';
import type { LngLat, ProfileResponse, RayResult, FanRayResult } from '../../types/profile';
import { CurrentLocationButton } from '../ui/CurrentLocationButton';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { FanConfig, ScanMode, ScanStep } from './types';
import { MOCK_POSTS } from '../../data/mockPosts';
import { listPosts, createPost, uploadPhoto, type Post } from '../../lib/postsApi';
import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { unifiedBtn } from '../../styles/ui';

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
    onModeChange: (mode: 'explore' | 'analyze') => void;
    onScanModeChange: (mode: ScanMode) => void;
    onProfileHover: (index: number | null) => void;
    onProfileClick: (index: number) => void;
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
    onModeChange,
    onScanModeChange,
    onProfileHover,
    onProfileClick,
}: MapViewProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { map, isLoaded } = useMapLibre(containerRef);
    const { location: currentLocation, error: geoError } = useGeolocation();

    // Modal State

    const [sourceLocation, setSourceLocation] = useState<LngLat | null>(null);
    const [targetLocation, setTargetLocation] = useState<LngLat | null>(null);
    const [scanStep, setScanStep] = useState<ScanStep>('idle');
    const lastStepChangeTimeRef = useRef<number>(0);

    const handleSetScanStep = useCallback((step: ScanStep) => {
        setScanStep(step);
        lastStepChangeTimeRef.current = Date.now();
    }, []);

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

    // Auto-clear locate error after 1 second
    useEffect(() => {
        if (locateError) {
            const timer = setTimeout(() => {
                setLocateError(null);
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [locateError]);

    const hasAutoSetSourceRef = useRef(false);
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

    const isNorthUp = Math.abs(mapBearing) <= NORTH_THRESHOLD_DEG;
    const [isLayerMenuOpen, setIsLayerMenuOpen] = useState(true);

    // Search State
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [showResults, setShowResults] = useState(false);

    // Posts State
    const [posts, setPosts] = useState<Post[]>(MOCK_POSTS);

    // Sight angle state
    const [sightAngle] = useState<number>(SIGHT_ANGLE_PRESETS.HORIZONTAL);

    // Ray result state (replaces rayEndPoint and isLineClear)
    const [rayResult, setRayResult] = useState<RayResult | null>(null);

    // Fan mode state
    const isFanMode = scanMode === 'fan' || scanMode === '360';
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

    // --- Core Analytics Logic ---

    // Execute Scan Logic (Manual Trigger)
    const executeScan = useCallback(async (configOverride?: Partial<FanConfig>, targetOverride?: LngLat) => {
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

            // スキャン完了後の遷移
            if (scanMode === '360') {
                handleSetScanStep('complete');
            } else {
                handleSetScanStep('selecting_target');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to execute scan';
            setError(message);
        } finally {
            setLoading(false);
        }
    }, [
        sourceLocation,
        targetLocation,
        isFanMode,
        fanConfig,
        sightAngle,
        scanMode,
        onProfileChange,
        onRayResultChange,
        handleSetScanStep
    ]);
    
    // --- UI Handlers (New) ---
    const handleScanModeChange = useCallback((newMode: ScanMode) => {
        onScanModeChange(newMode);
        handleSetScanStep('idle');
    }, [onScanModeChange, handleSetScanStep]);

    // --- Action Button Handler ---
    const handleCommitStep = useCallback(() => {
        if (scanStep === 'adjusting_range' && sourceLocation) {
            const nextRange = Math.max(RANGE_MIN_M, Math.min(RANGE_MAX_M, previewRangeM ?? scanRangeM));
            setScanRangeM(nextRange);
            setPreviewRangeM(null);
            handleSetScanStep('scanning');
            const northTarget = calculateEndpoint(sourceLocation, 0, nextRange);
            setTargetLocation(northTarget);
            executeScan({ deltaTheta: 360 }, northTarget);
        } else if (scanStep === 'adjusting_angle') {
            if (previewDeltaTheta !== null) {
                fanDeltaThetaRef.current = previewDeltaTheta;
                setFanConfig(prev => ({ ...prev, deltaTheta: previewDeltaTheta }));
                executeScan({ deltaTheta: previewDeltaTheta });
            }
        }
    }, [scanStep, sourceLocation, previewRangeM, scanRangeM, previewDeltaTheta, executeScan, handleSetScanStep]);

    // Guidance for TopBar
    const currentGuidance = useMemo(() => {
        if (mode !== 'explore') return null;

        const fanSteps = [
            { key: 'source', label: '観測点の決定', triggerSteps: ['idle', 'selecting_source'] },
            { key: 'target', label: '目標点の決定', triggerSteps: ['selecting_target'] },
            { key: 'angle', label: '視界の設定', triggerSteps: ['adjusting_angle', 'scanning', 'complete'] },
        ];

        const p360Steps = [
            { key: 'source', label: '観測点の決定', triggerSteps: ['idle', 'selecting_source'] },
            { key: 'range', label: '範囲の設定', triggerSteps: ['adjusting_range'] },
            { key: 'scanning', label: '解析の実行', triggerSteps: ['scanning', 'complete'] },
        ];

        const steps = scanMode === 'fan' ? fanSteps : p360Steps;
        const activeStep = steps.find(s => s.triggerSteps.includes(scanStep)) || steps[0];

        return {
            steps: steps.map(s => ({ key: s.key, label: s.label })),
            currentStep: activeStep.key,
        };
    }, [mode, scanMode, scanStep]);

    const handleSearch = useCallback(async (query: string) => {
        if (!query.trim()) return;
        setIsSearching(true);
        try {
            const results = await searchLocation(query);
            setSearchResults(results);
            setShowResults(true);
        } catch (error) {
            console.error('Search failed:', error);
        } finally {
            setIsSearching(false);
        }
    }, []);

    const handleStepClick = useCallback((stepKey: string) => {
        if (mode !== 'explore') return;
        
        if (stepKey === 'source') {
            handleSetScanStep('selecting_source');
            setSourceLocation(null);
            setTargetLocation(null);
            setRayResult(null);
            setFanRayResults([]);
        } else if (stepKey === 'target' || stepKey === 'range') {
            if (!sourceLocation) return;
            handleSetScanStep(scanMode === 'fan' ? 'selecting_target' : 'adjusting_range');
            setTargetLocation(null);
            setRayResult(null);
            setFanRayResults([]);
        }
    }, [mode, scanMode, sourceLocation, handleSetScanStep]);

    const handleSelectResult = useCallback((result: GeocodingResult) => {
        if (!map) return;
        
        map.flyTo({
            center: [result.lng, result.lat],
            zoom: 15,
            duration: 2000
        });
        
        setSearchQuery(result.displayName);
        setShowResults(false);
        setSearchResults([]);
    }, [map]);

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
    const [isPostModalOpen, setIsPostModalOpen] = useState(false);
    const [postMessage, setPostMessage] = useState('');
    const [postPhotoUrl, setPostPhotoUrl] = useState('');
    const [postPhotoFile, setPostPhotoFile] = useState<File | null>(null);
    const [postPhotoPreview, setPostPhotoPreview] = useState<string | null>(null);
    const [isPosting, setIsPosting] = useState(false);
    const [postLocationMode, setPostLocationMode] = useState<'current' | 'pin'>('current');
    const [postPinLocation, setPostPinLocation] = useState<{ lat: number; lng: number } | null>(null);
    const [isPinSelecting, setIsPinSelecting] = useState(false);
    const postModalRef = useRef<HTMLDivElement | null>(null);
    const postButtonRef = useRef<HTMLButtonElement | null>(null);

    // 画像プレビューの生成
    useEffect(() => {
        if (!postPhotoFile) {
            setPostPhotoPreview(null);
            return;
        }
        const url = URL.createObjectURL(postPhotoFile);
        setPostPhotoPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [postPhotoFile]);

    // VIIRS controls
    const [viirsEnabled, setViirsEnabled] = useState(true);
    const viirsUpdateTimerRef = useRef<number | null>(null);
    const viirsRequestIdRef = useRef(0);

    // Night View Potential controls
    const [potentialEnabled, setPotentialEnabled] = useState(false);

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
                finalPhotoUrl = await uploadPhoto(postPhotoFile);
            }

            await createPost({
                message: postMessage.trim(),
                photoUrl: finalPhotoUrl || undefined,
                lat: postLat,
                lng: postLng,
            });

            // 成功したら一覧を再取得
            await loadPosts();

            // フォームリセット
            setPostMessage('');
            setPostPhotoUrl('');
            setPostPhotoFile(null);
            setPostLocationMode('current');
            setPostPinLocation(null);
            setIsPostModalOpen(false);
        } catch (err) {
            console.error('[handleSubmitPost] エラー:', err);
            const message = err instanceof Error ? err.message : '予期せぬエラーが発生しました';
            alert(message);
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

    // Update Night View Potential layer visibility
    useEffect(() => {
        if (!map || !isLoaded) return;
        if (map.getLayer(POTENTIAL_LAYER_ID)) {
            map.setLayoutProperty(
                POTENTIAL_LAYER_ID,
                'visibility',
                potentialEnabled ? 'visible' : 'none'
            );
        }
    }, [map, isLoaded, potentialEnabled]);

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
            handleSetScanStep('selecting_source');
        }
    }, [scanStep, mode, handleSetScanStep]);

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

    const reset = useCallback(() => {
        handleSetScanStep('idle');
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
    }, [onRayResultChange, onProfileChange, handleSetScanStep]);

    useEffect(() => {
        onResetReady(reset);
    }, [onResetReady, reset]);

    useEffect(() => {
        if (mode !== 'analyze') return;
        handleSetScanStep('idle');
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
    }, [mode, onProfileChange, onRayResultChange, handleSetScanStep]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'selecting_source') return;

        const handleSourceClick = (e: maplibregl.MapMouseEvent) => {
            if (Date.now() - lastStepChangeTimeRef.current < 200) return;
            
            // デスクトップではクリックで地点を決定
            if (!isMobile) {
                const pos = { lng: e.lngLat.lng, lat: e.lngLat.lat };
                setSourceLocation(pos);
                if (scanMode === '360') {
                    setTargetLocation(null);
                    setPreviewRangeM(scanRangeM);
                    setFanRayResults([]);
                    setRayResult(null);
                    handleSetScanStep('adjusting_range');
                } else {
                    handleSetScanStep('selecting_target');
                }
            }
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.doubleClickZoom.disable();
        map.on('click', handleSourceClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleSourceClick);
            map.doubleClickZoom.enable();
        };
    }, [map, isLoaded, scanStep, scanMode, scanRangeM, mode, handleSetScanStep]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'adjusting_range' || !sourceLocation || scanMode !== '360') return;

        const clampRange = (value: number) =>
            Math.max(RANGE_MIN_M, Math.min(RANGE_MAX_M, value));

        const handleMouseMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            // マルチタッチ（ピンチ操作など）の場合は、距離の調整をスキップして地図操作を優先させる
            if (e.originalEvent && 'touches' in e.originalEvent && e.originalEvent.touches.length > 1) {
                return;
            }
            if (!e.lngLat) return;
            const distance = new maplibregl.LngLat(sourceLocation.lng, sourceLocation.lat)
                .distanceTo(e.lngLat);
            setPreviewRangeM(clampRange(distance));
        };

        const handleClick = () => {
            if (Date.now() - lastStepChangeTimeRef.current < 200) return;
            const nextRange = clampRange(previewRangeM ?? scanRangeM);
            setScanRangeM(nextRange);
            setPreviewRangeM(null);
            handleSetScanStep('scanning');
            const northTarget = calculateEndpoint(sourceLocation, 0, nextRange);
            setTargetLocation(northTarget);
            executeScan({ deltaTheta: 360 }, northTarget);
        };

        map.on('mousemove', handleMouseMove);
        map.on('touchmove', handleMouseMove);
        map.on('click', handleClick);
        map.getCanvas().style.cursor = 'col-resize';
        
        // Disable map movement while adjusting on mobile
        map.dragPan.disable();

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('touchmove', handleMouseMove);
            map.off('click', handleClick);
            map.getCanvas().style.cursor = '';
            map.dragPan.enable();
        };
    }, [map, isLoaded, scanStep, sourceLocation, previewRangeM, scanRangeM, scanMode, mode, handleSetScanStep]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'selecting_target') return;

        setPreviewDeltaTheta(null);

        const handleTargetClick = (e: maplibregl.MapMouseEvent) => {
            if (Date.now() - lastStepChangeTimeRef.current < 200) return;
            // デスクトップではクリックで地点を決定
            if (!isMobile) {
                const pos = { lng: e.lngLat.lng, lat: e.lngLat.lat };
                setTargetLocation(pos);
                if (scanMode === '360') {
                    handleSetScanStep('scanning');
                    executeScan({ deltaTheta: 360 }, pos);
                } else {
                    handleSetScanStep('adjusting_angle');
                }
            }
        };

        map.getCanvas().style.cursor = 'crosshair';
        map.on('click', handleTargetClick);

        return () => {
            map.getCanvas().style.cursor = '';
            map.off('click', handleTargetClick);
        };
    }, [map, isLoaded, scanStep, scanMode, mode, handleSetScanStep]);

    useEffect(() => {
        if (mode !== 'explore') return;
        if (!map || !isLoaded || scanStep !== 'adjusting_angle' || !sourceLocation || !targetLocation || scanMode !== 'fan') {
            if (previewDeltaTheta !== null) setPreviewDeltaTheta(null);
            return;
        }

        if (previewDeltaTheta === null) {
            setPreviewDeltaTheta(fanConfig.deltaTheta);
        }

        const handleMouseMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
            // マルチタッチ（ピンチ操作など）の場合は、扇の調整をスキップして地図操作を優先させる
            if (e.originalEvent && 'touches' in e.originalEvent && e.originalEvent.touches.length > 1) {
                return;
            }
            if (!e.lngLat) return;
            const centerAz = calculateAzimuth(sourceLocation, targetLocation);
            const mouseAz = calculateAzimuth(sourceLocation, { lng: e.lngLat.lng, lat: e.lngLat.lat });
            let diff = Math.abs(mouseAz - centerAz);
            if (diff > 180) diff = 360 - diff;

            const newDelta = Math.max(1, Math.min(360, diff * 2));
            setPreviewDeltaTheta(newDelta);
        };

        const handleClick = () => {
            if (Date.now() - lastStepChangeTimeRef.current < 200) return;
            if (previewDeltaTheta !== null) {
                fanDeltaThetaRef.current = previewDeltaTheta;
                setFanConfig(prev => ({ ...prev, deltaTheta: previewDeltaTheta }));
                executeScan({ deltaTheta: previewDeltaTheta });
            }
        };

        map.on('mousemove', handleMouseMove);
        map.on('touchmove', handleMouseMove);
        map.on('click', handleClick);
        map.getCanvas().style.cursor = 'col-resize';
        
        // Disable map movement while adjusting on mobile
        map.dragPan.disable();

        return () => {
            map.off('mousemove', handleMouseMove);
            map.off('touchmove', handleMouseMove);
            map.off('click', handleClick);
            map.getCanvas().style.cursor = '';
            map.dragPan.enable();
        };
    }, [map, isLoaded, scanStep, sourceLocation, targetLocation, previewDeltaTheta, fanConfig.deltaTheta, scanMode, mode, handleSetScanStep]);

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


    // NOTE: Removed automatic flyTo on currentLocation change per user request.
    // FlyTo is now only triggered manually via the CurrentLocationButton.

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
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
    };

    // Double-click is reserved for source selection.

    return (
        <div className="relative w-full h-full text-white">
            <div 
                ref={containerRef} 
                className="w-full h-full transition-opacity duration-300 touch-none" 
            />

            {/* Center Crosshair for Location selection - Simple, Small & Thick */}
            {(isMobile && (scanStep === 'idle' || scanStep === 'selecting_source' || scanStep === 'selecting_target')) && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none z-[3500]">
                    <div className="relative w-8 h-8 flex items-center justify-center">
                        <div className="absolute w-full h-[2px] bg-white/90 shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
                        <div className="absolute h-full w-[2px] bg-white/90 shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
                    </div>
                </div>
            )}

            {/* Location Selection Confirmation Button */}
            {isMobile && (scanStep === 'selecting_source' || scanStep === 'selecting_target') && (
                <div className={`absolute left-1/2 -translate-x-1/2 z-[8000] transition-all duration-300 ${
                    isLayerMenuOpen ? 'bottom-[-100px] opacity-0 pointer-events-none' : 'bottom-[calc(80px+env(safe-area-inset-bottom))]'
                }`}>
                    <button
                        onClick={() => {
                            if (!map) return;
                            const center = map.getCenter();
                            const pos = { lng: center.lng, lat: center.lat };
                            if (scanStep === 'selecting_source') {
                                setSourceLocation(pos);
                                if (scanMode === '360') {
                                    setTargetLocation(null);
                                    setPreviewRangeM(scanRangeM);
                                    setFanRayResults([]);
                                    setRayResult(null);
                                    handleSetScanStep('adjusting_range');
                                } else {
                                    handleSetScanStep('selecting_target');
                                }
                            } else {
                                setTargetLocation(pos);
                                if (scanMode === '360') {
                                    handleSetScanStep('scanning');
                                    executeScan({ deltaTheta: 360 }, pos);
                                } else {
                                    handleSetScanStep('adjusting_angle');
                                }
                            }
                        }}
                        className={`${unifiedBtn} pointer-events-auto bg-violet-700 text-white hover:bg-violet-600`}
                    >
                        <MapPin className="w-4 h-4 shrink-0" />
                        <span>{scanStep === 'selecting_source' ? '観測地点を確定' : '目標地点を確定'}</span>
                    </button>
                </div>
            )}

            {/* --- New UI Layout Structure --- */}

            {/* 1. Top Bar (Search & Mode Toggle) */}
            <TopBar
                mode={mode}
                onModeChange={onModeChange}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onSearchSubmit={() => handleSearch(searchQuery)}
                isSearching={isSearching}
                searchResults={searchResults}
                showResults={showResults}
                onSelectResult={handleSelectResult}
                onCloseResults={() => setShowResults(false)}
                onFocusSearch={() => searchResults.length > 0 && setShowResults(true)}
                guidance={currentGuidance}
                onStepClick={handleStepClick}
                fanConfig={fanConfig}
                onFanConfigChange={setFanConfig}
                onViewPosts={() => onModeChange('analyze')}
                postCount={posts.length}
            />

            {/* Error Notifications - Align with TopBar on Desktop */}
            <div className="absolute top-36 left-4 right-4 md:left-auto md:right-4 md:w-[520px] flex flex-col gap-2 z-[7000] pointer-events-none">
                {locateError && (
                    <div className="bg-red-500/95 text-white px-4 py-2 rounded-full shadow-lg text-xs font-bold flex items-center justify-between gap-2 animate-in fade-in slide-in-from-top-4 pointer-events-auto border border-white/20">
                        <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4" />
                            <span>{locateError}</span>
                        </div>
                        <button 
                            onClick={() => setLocateError(null)}
                            className="ml-2 p-1 hover:bg-white/20 rounded-full transition-colors"
                        >
                            ✕
                        </button>
                    </div>
                )}
                {error && (
                    <div className="bg-red-500/95 text-white px-4 py-3 rounded-xl shadow-lg text-xs font-bold flex flex-col gap-1 border border-white/20 animate-in fade-in slide-in-from-top-4 pointer-events-auto">
                        <div className="flex items-center gap-2">
                            <AlertCircle className="w-4 h-4" />
                            <span>分析エラー</span>
                        </div>
                        <div className="text-[10px] font-normal opacity-90 leading-tight">
                            {error}
                        </div>
                    </div>
                )}
            </div>

            {/* 2. Side Panel / Bottom Sheet (Contextual Details) */}
            <LayerMenu 
                isOpen={isLayerMenuOpen} 
                onToggle={() => setIsLayerMenuOpen(prev => !prev)}
            >
                {mode === 'explore' ? (
                    <ScanControlPanel
                        scanMode={scanMode}
                        onScanModeChange={handleScanModeChange}
                        viirsEnabled={viirsEnabled}
                        setViirsEnabled={setViirsEnabled}
                        potentialEnabled={potentialEnabled}
                        setPotentialEnabled={setPotentialEnabled}
                        aerialEnabled={aerialEnabled}
                        setAerialEnabled={setAerialEnabled}
                        scanStatus={{
                            scanStep,
                            loading,
                            error,
                            rayResult,
                            previewDeltaTheta,
                            deltaTheta: fanConfig.deltaTheta
                        }}
                        onResetScan={reset}
                        profile={profile}
                        onProfileHover={onProfileHover}
                        onProfileClick={onProfileClick}
                    />
                ) : (
                    <PostListPanel
                        posts={posts}
                        // isLoading={isPostsLoading} // TODO: Add loading state to postsApi
                        viirsEnabled={viirsEnabled}
                        setViirsEnabled={setViirsEnabled}
                        potentialEnabled={potentialEnabled}
                        setPotentialEnabled={setPotentialEnabled}
                        aerialEnabled={aerialEnabled}
                        setAerialEnabled={setAerialEnabled}
                        onPostClick={(post) => {
                           map?.flyTo({
                               center: [post.location.lng, post.location.lat],
                               zoom: 16,
                               duration: 1200
                           });
                           if (isLayerMenuOpen && window.innerWidth < 768) {
                               setIsLayerMenuOpen(false); // Mobile: close sheet to see map
                           }
                        }}
                    />
                )}
            </LayerMenu>

            {/* Map Visuals */}
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

            {/* Mobile Action Button - Analysis Trigger */}
            {isMobile && (scanStep === 'adjusting_range' || scanStep === 'adjusting_angle') && (
                <div className={`absolute left-1/2 -translate-x-1/2 z-[8000] transition-all duration-300 ${
                    isLayerMenuOpen ? 'bottom-[-100px] opacity-0 pointer-events-none' : 'bottom-[calc(80px+env(safe-area-inset-bottom))]'
                }`}>
                    <button
                        onClick={handleCommitStep}
                        className={`${unifiedBtn} pointer-events-auto bg-violet-700 text-white hover:bg-violet-600`}
                    >
                        <Zap className="w-4 h-4 shrink-0" />
                        <span>分析を開始</span>
                    </button>
                </div>
            )}

            {/* Bottom Right Controls */}
            <div className={`absolute right-6 flex items-end gap-4 md:right-8 z-[7000] pointer-events-auto transition-all duration-300 ${
                isMobile 
                    ? (isLayerMenuOpen ? 'bottom-[-100px] opacity-0 pointer-events-none' : 'bottom-[calc(80px+env(safe-area-inset-bottom))]') 
                    : 'bottom-6 md:bottom-8'
            }`}>
                <div className="relative flex flex-col items-end gap-2">
                    {/* 投稿ボタン */}
                    <button
                        ref={postButtonRef}
                        type="button"
                        onClick={() => setIsPostModalOpen((prev) => !prev)}
                        className="group bg-black/60 backdrop-blur-md border border-violet-700/60 text-white rounded-full shadow-lg h-[var(--btn-h)] w-[var(--btn-h)] hover:bg-violet-700/20 hover:border-violet-600 active:scale-95 transition-all duration-200 flex items-center justify-center"
                        aria-label="投稿する"
                        aria-pressed={isPostModalOpen}
                        title="投稿する"
                    >
                        <Camera className="w-5 h-5 text-violet-300 group-hover:scale-110 transition-transform" />
                    </button>
                    {isPostModalOpen && (
                        <div
                            ref={postModalRef}
                                    className="absolute right-0 bottom-14 w-72 rounded-xl border border-white/10 bg-black/80 p-4 shadow-lg backdrop-blur-md"
                                >
                                    <div className="text-sm text-white/90 font-medium mb-3">夜景を投稿</div>
                                    {!isSupabaseConfigured && (
                                        <div className="mb-3 p-2 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-200 flex items-start gap-2">
                                            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                            <span>Supabaseが設定されていないため、実際の投稿はできません。</span>
                                        </div>
                                    )}
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
                                                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-violet-700/50 focus:outline-none resize-none"
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
                                                    className="flex flex-col items-center justify-center w-full rounded-lg border border-dashed border-white/20 bg-white/5 py-4 text-xs text-white/60 hover:bg-white/10 hover:border-violet-700/50 cursor-pointer transition-all overflow-hidden"
                                                >
                                                    {postPhotoPreview || postPhotoUrl ? (
                                                        <div className="relative w-full aspect-video rounded-md overflow-hidden bg-black/40">
                                                            <img src={postPhotoPreview || postPhotoUrl} alt="Preview" className="w-full h-full object-cover" />
                                                            {(postPhotoPreview || postPhotoUrl) && (
                                                                <button
                                                                    type="button"
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        setPostPhotoFile(null);
                                                                        setPostPhotoUrl('');
                                                                    }}
                                                                    className="absolute top-1 right-1 bg-black/60 rounded-full p-1 text-white hover:bg-black/80"
                                                                >
                                                                    ✕
                                                                </button>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col items-center gap-2">
                                                            <ImageIcon className="w-6 h-6 opacity-30" />
                                                            <span>画像を選択してください</span>
                                                        </div>
                                                    )}
                                                </label>

                                                <input
                                                    type="url"
                                                    value={postPhotoUrl}
                                                    onChange={(e) => setPostPhotoUrl(e.target.value)}
                                                    placeholder="または画像のURLを入力"
                                                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-violet-700/50 focus:outline-none"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="block text-xs text-white/60 mb-2">
                                                <MapPin className="w-3 h-3 inline mr-1" /> 投稿場所
                                            </label>
                                            <div className="flex flex-col gap-2">
                                                <div className="flex gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setPostLocationMode('current')}
                                                        disabled={!currentLocation}
                                                        className={`flex-1 rounded-lg border py-2 text-xs transition-all flex items-center justify-center gap-1.5 ${
                                                            postLocationMode === 'current'
                                                                ? 'border-violet-700 bg-violet-700/20 text-violet-300'
                                                                : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed'
                                                        }`}
                                                    >
                                                        <MapPin className="w-3.5 h-3.5" /> 現在位置
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setPostLocationMode('pin');
                                                        setIsPinSelecting(true);
                                                        setIsPostModalOpen(false);
                                                    }}
                                                    className={`w-full rounded-lg border py-2 text-xs transition-all flex items-center justify-center gap-1.5 ${
                                                        postLocationMode === 'pin' && postPinLocation
                                                            ? 'border-violet-700 bg-violet-700/20 text-violet-300'
                                                            : 'border-white/10 bg-white/5 text-white/60 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <Pin className="w-3.5 h-3.5" />
                                                    {postLocationMode === 'pin' && postPinLocation
                                                        ? `ピン設定済み (${postPinLocation.lat.toFixed(4)}, ${postPinLocation.lng.toFixed(4)})`
                                                        : '地図をタップしてピンを刺す'}
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
                                                    setPostLocationMode('current');
                                                    setPostPinLocation(null);
                                                }}
                                                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm text-white/70 hover:bg-white/10"
                                            >
                                                キャンセル
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSubmitPost}
                                                disabled={!postMessage.trim() || isPosting || !isSupabaseConfigured}
                                                className="flex-1 rounded-lg bg-violet-700 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                {isPosting ? '投稿中...' : <><Send className="w-4 h-4" /> 投稿する</>}
                                            </button>
                                        </div>
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

            {/* ピン選択モード時のバナー */}
            {isPinSelecting && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50">
                    <div className="bg-violet-700 text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-3 text-sm font-medium">
                        <Pin className="w-4 h-4" />
                        <span>地図をタップして投稿場所を選択</span>
                        <button
                            type="button"
                            onClick={() => {
                                setIsPinSelecting(false);
                                setIsPostModalOpen(true);
                            }}
                            className="bg-white/20 hover:bg-white/30 px-2 py-1 rounded text-xs"
                        >
                            キャンセル
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
}
