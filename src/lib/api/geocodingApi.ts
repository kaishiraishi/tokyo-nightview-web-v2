// Nominatim (OpenStreetMap) Geocoding API
// Terms: https://operations.osmfoundation.org/policies/nominatim/

export type GeocodingResult = {
    displayName: string;
    lat: number;
    lng: number;
    boundingBox: [number, number, number, number]; // [south, north, west, east]
    type?: string;
    class?: string;
};

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

// Tokyo Bounding Box (approx) for 'bounded=1'
// minLon, minLat, maxLon, maxLat
// 138.9, 35.5, 139.9, 35.9 (Roughly Tokyo 23 wards + some surroundings)
const TOKYO_VIEWBOX = '138.9,35.5,139.9,35.9';

export async function searchLocation(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return [];

    const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: '5',
        // 1. Japan Fixed
        countrycodes: 'jp',
        // 2. Language
        'accept-language': 'ja',
        // 3. Viewbox & Bounded
        viewbox: TOKYO_VIEWBOX,
        bounded: '1',
    });

    try {
        const response = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
            headers: {
                // Required by Nominatim Terms
                'User-Agent': 'TokyoNightviewWeb/1.0',
            },
        });

        if (!response.ok) {
            throw new Error(`Geocoding failed: ${response.status}`);
        }

        const data = await response.json();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return data.map((item: any) => ({
            displayName: item.display_name,
            lat: parseFloat(item.lat),
            lng: parseFloat(item.lon),
            boundingBox: item.boundingbox.map(Number) as [number, number, number, number],
            type: item.type,
            class: item.class,
        }));
    } catch (error) {
        console.error('Nominatim search error:', error);
        return [];
    }
}
