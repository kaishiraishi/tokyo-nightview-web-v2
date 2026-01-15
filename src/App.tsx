import { useCallback, useState } from 'react';
import { MapView } from './components/map/MapView';
import { ProfileChart } from './components/profile/ProfileChart';
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
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [clickedIndex, setClickedIndex] = useState<number | null>(null);
    const [rayResult, setRayResult] = useState<RayResult | null>(null);
    const [zoomLevel, setZoomLevel] = useState<number | null>(null);

    const handleProfileChange = useCallback((p: ProfileResponse | null) => {
        setProfile(p);
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
        <div className="w-screen h-screen flex flex-col">
            <div className="flex-1 min-h-0">
                <MapView
                    onProfileChange={handleProfileChange}
                    onRayResultChange={handleRayResultChange}
                    profile={profile}
                    hoveredIndex={hoveredIndex}
                    clickedIndex={clickedIndex}
                    onZoomChange={handleZoomChange}
                />
            </div>

            <div className="h-[40vh] border-t-2 border-gray-300">
                <ProfileChart
                    profile={profile}
                    onHover={handleHover}
                    onClick={handleClick}
                    occlusionDistance={rayResult?.distance || null}
                    zoomLevel={zoomLevel}
                />
            </div>
        </div>
    );
}

export default App;
