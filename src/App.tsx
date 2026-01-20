import { useCallback, useState } from 'react';
import { TopRightHud } from './components/hud/TopRightHud';
import { MapViewAnalyze } from './components/map/MapViewAnalyze';
import { MapViewExplore } from './components/map/MapViewExplore';
import type { ScanStep } from './components/map/types';
import type { ProfileResponse } from './types/profile';

// Ray collision result type
type RayResult = {
    hit: boolean;
    distance: number | null;
    hitPoint: { lng: number; lat: number } | null;
    elevation: number | null;
    reason: 'clear' | 'building' | 'terrain';
};

type ScanStatus = {
    scanStep: ScanStep;
    loading: boolean;
    error: string | null;
    rayResult: RayResult | null;
    fanStats: {
        total: number;
        blocked: number;
        clear: number;
    };
};

function App() {
    const [mode, setMode] = useState<'explore' | 'analyze'>('explore');
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [clickedIndex, setClickedIndex] = useState<number | null>(null);
    const [rayResult, setRayResult] = useState<RayResult | null>(null);
    const [zoomLevel, setZoomLevel] = useState<number | null>(null);
    const [resetScan, setResetScan] = useState<() => void>(() => {});
    const [scanStatus, setScanStatus] = useState<ScanStatus>({
        scanStep: 'idle',
        loading: false,
        error: null,
        rayResult: null,
        fanStats: { total: 0, blocked: 0, clear: 0 },
    });

    const handleProfileChange = useCallback((p: ProfileResponse | null) => {
        setProfile(p);
        setClickedIndex(null); // Reset clicked index when profile changes (prevents stale index crashes)
    }, []);

    const handleHover = useCallback((index: number | null) => {
        setHoveredIndex(index);
    }, []);

    const handleClick = useCallback((index: number) => {
        setClickedIndex(index);
    }, []);

    const handleRayResultChange = useCallback((result: RayResult | null) => {
        setRayResult(result);
    }, []);

    const handleZoomChange = useCallback((zoom: number) => {
        setZoomLevel(zoom);
    }, []);

    return (
        <div className="relative w-screen h-screen overflow-hidden bg-gray-900">
            {/* Full Screen Map */}
            <div className="absolute inset-0">
                {mode === 'explore' ? (
                    <MapViewExplore
                        onProfileChange={handleProfileChange}
                        onRayResultChange={handleRayResultChange}
                        onScanStatusChange={setScanStatus}
                        onResetReady={setResetScan}
                        profile={profile}
                        hoveredIndex={hoveredIndex}
                        clickedIndex={clickedIndex}
                        onZoomChange={handleZoomChange}
                    />
                ) : (
                    <MapViewAnalyze />
                )}
            </div>

            <div className="absolute top-4 left-4 z-50 pointer-events-auto">
                <TopRightHud
                    mode={mode}
                    onModeChange={setMode}
                    profile={profile}
                    onProfileHover={handleHover}
                    onProfileClick={handleClick}
                    occlusionDistance={rayResult?.distance ?? null}
                    scanStatus={scanStatus}
                    onResetScan={resetScan}
                />
            </div>
        </div>
    );
}

export default App;
