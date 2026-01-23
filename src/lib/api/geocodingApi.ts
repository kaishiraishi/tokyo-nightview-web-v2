// Nominatim (OpenStreetMap) ジオコーディングAPI
// 利用規約: https://operations.osmfoundation.org/policies/nominatim/

export type GeocodingResult = {
    displayName: string;
    lat: number;
    lng: number;
    boundingBox: [number, number, number, number]; // [south, north, west, east]
};

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export async function searchLocation(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return [];

    const params = new URLSearchParams({
        q: query,
        format: 'json',
        addressdetails: '1',
        limit: '5',
        // 日本中心で検索（必要に応じて調整）
        viewbox: '122.93,24.04,153.99,45.55',
        bounded: '0',
    });

    const response = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
        headers: {
            // Nominatim利用規約: User-Agentを明示
            'User-Agent': 'TokyoNightviewWeb/1.0',
        },
    });

    if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
    }

    const data = await response.json();

    return data.map((item: {
        display_name: string;
        lat: string;
        lon: string;
        boundingbox: [string, string, string, string];
    }) => ({
        displayName: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        boundingBox: item.boundingbox.map(Number) as [number, number, number, number],
    }));
}
