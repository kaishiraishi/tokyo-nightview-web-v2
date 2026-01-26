import { useCallback, useState } from 'react';
import { MapViewExplore } from './components/map/MapViewExplore';
import type { ScanMode } from './components/map/types';
import type { ProfileResponse } from './types/profile';

function App() {
    const [mode, setMode] = useState<'explore' | 'analyze'>('explore');
    const [scanMode, setScanMode] = useState<ScanMode>('fan');
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [clickedIndex, setClickedIndex] = useState<number | null>(null);
    const [searchTarget, setSearchTarget] = useState<{ lat: number; lng: number } | null>(null);

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

    return (
        <div className="relative w-full min-h-screen h-[100dvh] overflow-hidden bg-black">
            {/* Full Screen Map */}
            <div className="absolute inset-0">
                    <MapViewExplore
                        onProfileChange={handleProfileChange}
                        onRayResultChange={() => {}}
                        onScanStatusChange={() => {}}
                        onResetReady={() => {}}
                        mode={mode}
                        scanMode={scanMode}
                        profile={profile}
                        hoveredIndex={hoveredIndex}
                        clickedIndex={clickedIndex}
                        onZoomChange={() => {}}
                        searchTarget={searchTarget}
                        onSearchTargetConsumed={() => setSearchTarget(null)}
                        onModeChange={setMode}
                        onScanModeChange={setScanMode}
                        onProfileHover={handleHover}
                        onProfileClick={handleClick}
                />
            </div>
        </div>
    );
}

export default App;
