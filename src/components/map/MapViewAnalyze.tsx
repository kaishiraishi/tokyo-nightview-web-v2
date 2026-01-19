import { useRef } from 'react';
import { useMapLibre } from '../../hooks/useMapLibre';
import 'maplibre-gl/dist/maplibre-gl.css';

export function MapViewAnalyze() {
    const containerRef = useRef<HTMLDivElement>(null);
    useMapLibre(containerRef);

    return (
        <div className="relative w-full h-full">
            <div ref={containerRef} className="w-full h-full" />
        </div>
    );
}
