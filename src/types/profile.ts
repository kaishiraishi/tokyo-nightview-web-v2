export type LngLat = {
    lng: number;
    lat: number;
    z?: number; // Elevation in meters
};

export type ProfileResponse = {
    distances_m: number[];
    elev_m: Array<number | null>;
    lngs: number[];
    lats: number[];
};

// Ray collision result with detailed information
export type RayResult = {
    hit: boolean;
    distance: number | null;
    hitPoint: LngLat | null; // Point of collision (if hit) or max range point (if clear)
    elevation: number | null; // Elevation at the hit point
    reason: 'clear' | 'building' | 'terrain';

    // For 3D visualization
    sourcePoint?: LngLat; // Starting point (Eye level)
    rayGeometry?: {       // Full 3D line segment
        start: LngLat;
        end: LngLat;
    };
};

// Fan ray result extending RayResult with azimuth information
export type FanRayResult = RayResult & {
    azimuth: number;        // Azimuth angle of this ray in degrees
    rayIndex: number;       // Index in the fan
    maxRangePoint: LngLat;  // Endpoint at maxRange
};
