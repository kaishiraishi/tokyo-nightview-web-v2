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
        <div className="relative w-screen h-screen overflow-hidden bg-gray-900">
            {/* Full Screen Map */}
            <div className="absolute inset-0">
                <MapView
                    onProfileChange={handleProfileChange}
                    onRayResultChange={handleRayResultChange}
                    profile={profile}
                    hoveredIndex={hoveredIndex}
                    clickedIndex={clickedIndex}
                    onZoomChange={handleZoomChange}
                />
            </div>

            {/* Floating Profile Overlay */}
            {/* Positioned at bottom center with some margin */}
            <div className="absolute bottom-6 left-4 right-4 h-64 z-20 pointer-events-none flex justify-center">
                <div className="w-full max-w-5xl pointer-events-auto h-full">
                    <ProfileChart
                        profile={profile}
                        onHover={handleHover}
                        onClick={handleClick}
                        occlusionDistance={rayResult?.distance || null}
                        zoomLevel={zoomLevel}
                    />
                </div>
            </div>
        </div>
    );
}

export default App;
