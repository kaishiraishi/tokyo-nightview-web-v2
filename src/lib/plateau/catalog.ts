// src/lib/plateau/catalog.ts
// PLATEAU Data Catalog API client for fetching 3D Tiles dataset URLs

export type PlateauDataset = {
    id: string;
    name: string;
    pref_code: string;
    city_code: string;
    type_en: string;           // e.g. "bldg"
    format: '3D Tiles' | 'MVT';
    lod: string | null;        // e.g. "1","2"
    url: string;               // 3D Tiles: tileset.json
};

const DATASETS_API = 'https://api.plateauview.mlit.go.jp/datacatalog/plateau-datasets';

let _cache: PlateauDataset[] | null = null;

/**
 * Fetch all PLATEAU datasets from the official catalog API.
 * Results are cached to avoid redundant requests.
 */
export async function fetchPlateauDatasets(): Promise<PlateauDataset[]> {
    if (_cache) return _cache;

    const res = await fetch(DATASETS_API);
    if (!res.ok) {
        throw new Error(`plateau-datasets failed: ${res.status} ${res.statusText}`);
    }

    const json = await res.json();
    // Handle both { datasets: [...] } and direct array format
    const datasets = (json.datasets ?? json) as PlateauDataset[];
    _cache = datasets;
    return datasets;
}

/**
 * Resolve 3D Tiles tileset.json URL for building data.
 * @param params.cityCode - JIS city code (e.g., '13101' for Chiyoda-ku)
 * @param params.lod - Level of Detail ('1' or '2')
 * @returns tileset.json URL
 */
export async function resolveBldgTilesetUrl(params: {
    cityCode: string;
    lod: '1' | '2'
}): Promise<string> {
    const datasets = await fetchPlateauDatasets();

    const ds = datasets.find(d =>
        d.format === '3D Tiles' &&
        d.type_en === 'bldg' &&
        d.city_code === params.cityCode &&
        d.lod === params.lod
    );

    if (!ds) {
        throw new Error(
            `bldg 3D Tiles not found: city=${params.cityCode} lod=${params.lod}`
        );
    }

    return ds.url;
}

/**
 * Clear the cached datasets (useful for testing or forced refresh)
 */
export function clearDatasetCache(): void {
    _cache = null;
}
