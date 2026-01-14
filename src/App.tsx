import { useCallback, useState } from 'react';
import { MapView } from './components/map/MapView';
import { ProfileChart } from './components/profile/ProfileChart';
import type { ProfileResponse } from './types/profile';

function App() {
    const [profile, setProfile] = useState<ProfileResponse | null>(null);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
    const [clickedIndex, setClickedIndex] = useState<number | null>(null);

    const handleProfileChange = useCallback((p: ProfileResponse | null) => {
        setProfile(p);
    }, []);

    const handleHover = useCallback((index: number | null) => {
        setHoveredIndex(index);
    }, []);

    const handleClick = useCallback((index: number) => {
        setClickedIndex(index);
    }, []);

    return (
        <div className="w-screen h-screen flex flex-col">
            <div className="flex-1 min-h-0">
                <MapView
                    onProfileChange={handleProfileChange}
                    profile={profile}
                    hoveredIndex={hoveredIndex}
                    clickedIndex={clickedIndex}
                />
            </div>

            <div className="h-[40vh] border-t-2 border-gray-300">
                <ProfileChart
                    profile={profile}
                    onHover={handleHover}
                    onClick={handleClick}
                />
            </div>
        </div>
    );
}

export default App;
