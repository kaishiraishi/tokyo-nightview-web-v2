export type LngLat = {
    lng: number;
    lat: number;
};

export type ProfileResponse = {
    distances_m: number[];
    elev_m: Array<number | null>;
};
