import { useCallback, useEffect, useState } from 'react';
import { MapViewAnalyze } from './components/map/MapViewAnalyze';
import { MapViewExplore } from './components/map/MapViewExplore';
import type { ProfileResponse } from './types/profile';

// Ray collision result type
type RayResult = {
    hit: boolean;
    distance: number | null;
    hitPoint: { lng: number; lat: number } | null;
    elevation: number | null;
    reason: 'clear' | 'building' | 'terrain';
};

function App() {
    const [mode, setMode] = useState<'explore' | 'analyze'>('explore');
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [clickedIndex, setClickedIndex] = useState<number | null>(null);
    const [rayResult, setRayResult] = useState<RayResult | null>(null);
    const [zoomLevel, setZoomLevel] = useState<number | null>(null);
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    useEffect(() => {
        if (mode === 'explore') {
            setIsSidebarOpen(true);
        }
    }, [mode]);

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
                        profile={profile}
                        hoveredIndex={hoveredIndex}
                        clickedIndex={clickedIndex}
                        onZoomChange={handleZoomChange}
                        isSidebarOpen={isSidebarOpen}
                        setIsSidebarOpen={setIsSidebarOpen}
                    />
                ) : (
                    <MapViewAnalyze />
                )}
            </div>

            {/* Mode Toggle (Center) */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-auto">
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-black/70 p-1 shadow-lg backdrop-blur-md">
                    <button
                        type="button"
                        aria-pressed={mode === 'explore'}
                        onClick={() => setMode('explore')}
                        className={`px-4 py-1 text-sm font-semibold rounded-full transition-colors ${mode === 'explore'
                            ? 'bg-white/20 text-white'
                            : 'text-gray-300 hover:text-white'
                            }`}
                    >
                        探索
                    </button>
                    <button
                        type="button"
                        aria-pressed={mode === 'analyze'}
                        onClick={() => setMode('analyze')}
                        className={`px-4 py-1 text-sm font-semibold rounded-full transition-colors ${mode === 'analyze'
                            ? 'bg-white/20 text-white'
                            : 'text-gray-300 hover:text-white'
                            }`}
                    >
                        解析
                    </button>
                </div>
            </div>
        </div>
    );
}

export default App;
