import type maplibregl from 'maplibre-gl';

export type ViirsPoint = {
    position: [number, number, number];
    intensity: number;
};

const VIIRS_TILE_URL = `${import.meta.env.BASE_URL}viirs_heat_tiles/tiles/{z}/{x}/{y}.png`;
const TILE_SIZE = 256;
const DITHER = 6;

// VIIRSタイルの存在範囲 (z=10)
const VIIRS_TILE_BOUNDS = {
    minX: 899,
    maxX: 949,
    minY: 402,
    maxY: 452,
};

// タイルごとのポイントキャッシュ
const tileCache = new Map<string, ViirsPoint[]>();

// キャッシュをクリアする（パラメータ変更時に呼び出す）
export function clearViirsCache(): void {
    tileCache.clear();
    console.log('[VIIRS] cache cleared');
}

function decodeVIIRS01(r: number, g: number, b: number, a: number) {
    if (a === 0) return 0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return luma / 255;
}

const lngLatToTile = (lng: number, lat: number, z: number) => {
    const n = 2 ** z;
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(
        ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
    );
    return { x, y };
};

const tileXYToLngLat = (
    tileX: number,
    tileY: number,
    z: number,
    px: number,
    py: number,
    width: number,
    height: number
) => {
    const tiles = 2 ** z;
    const fx = (tileX + px / width) / tiles;
    const fy = (tileY + py / height) / tiles;
    const lng = fx * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * fy)));
    const lat = (latRad * 180) / Math.PI;
    return { lng, lat };
};

const urlForTile = (z: number, x: number, y: number) =>
    VIIRS_TILE_URL.replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));

function tileKey(z: number, x: number, y: number, stride: number, emit: number): string {
    return `${z}/${x}/${y}@s${stride}e${emit}`;
}

async function sampleViirsTile(
    z: number,
    x: number,
    y: number,
    opts: {
        stride: number;
        threshold: number;
        emit: number;
        gamma: number;
        logK: number;
        maxPointsPerTile: number;
        heightScale: number;
    }
): Promise<ViirsPoint[]> {
    const url = urlForTile(z, x, y);
    let res: Response;
    try {
        res = await fetch(url);
        if (!res.ok) return [];
    } catch {
        return [];
    }

    let bmp: ImageBitmap;
    try {
        const blob = await res.blob();
        bmp = await createImageBitmap(blob);
    } catch {
        return [];
    }

    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return [];

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bmp, 0, 0, TILE_SIZE, TILE_SIZE);
    const img = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;

    const points: ViirsPoint[] = [];
    const { stride, threshold, emit, gamma, logK, maxPointsPerTile, heightScale } = opts;
    const width = TILE_SIZE;
    const height = TILE_SIZE;

    // 固定シードでグリッド開始位置を決定（同じタイル・strideなら同じ結果）
    const seed = (x * 1000 + y) % 1000;
    const startOffsetX = seed % stride;
    const startOffsetY = Math.floor(seed / stride) % stride;

    for (let iy = startOffsetY; iy < height; iy += stride) {
        for (let ix = startOffsetX; ix < width; ix += stride) {
            const i = (iy * width + ix) * 4;
            const r = img[i];
            const g = img[i + 1];
            const b = img[i + 2];
            const a = img[i + 3];

            const value01 = decodeVIIRS01(r, g, b, a);
            // 固定シードでジッターを決定
            const pixelSeed = ((x * 10000 + y * 100 + iy * width + ix) % 10000) / 10000;
            const jittered = Math.max(0, Math.min(1, value01 + ((pixelSeed - 0.5) * DITHER) / 255));
            if (jittered <= 0) continue;
            if (jittered < threshold) continue;

            // 閾値以上の部分を0-1に正規化
            const norm = Math.max(0, (jittered - threshold) / (1 - threshold));

            // log圧縮: v' = log(1 + k*v) / log(1 + k)
            // これにより暗い部分が持ち上がり、明るい部分の飽和が抑えられる
            const logCompressed = logK > 0
                ? Math.log(1 + logK * norm) / Math.log(1 + logK)
                : norm;

            // gamma補正でメリハリ調整
            const adjusted = Math.pow(logCompressed, gamma);

            const mean = emit * adjusted;
            const nParticles = Math.floor(mean + pixelSeed);
            if (nParticles <= 0) continue;

            for (let k = 0; k < nParticles; k++) {
                // 簡易ハッシュ関数で決定論的だが分散したランダム値を生成
                const hash1 = ((x * 73856093) ^ (y * 19349663) ^ (iy * 83492791) ^ (ix * 45989) ^ (k * 12345)) >>> 0;
                const hash2 = ((x * 19349663) ^ (y * 83492791) ^ (iy * 45989) ^ (ix * 73856093) ^ (k * 67891)) >>> 0;
                const jitterX = (hash1 % 10000) / 10000 * stride;
                const jitterY = (hash2 % 10000) / 10000 * stride;
                const subPx = ix + jitterX;
                const subPy = iy + jitterY;
                const { lng, lat } = tileXYToLngLat(x, y, z, subPx, subPy, width, height);
                if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
                points.push({
                    position: [lng, lat, adjusted * heightScale],
                    intensity: adjusted,
                });
            }
        }
    }

    // 上限を超えた場合は、全体から均一にサンプリング
    // intensity が高いものを優先しつつ、空間的に偏らないようにする
    if (points.length > maxPointsPerTile) {
        // intensity でソートして上位70%は確保、残りはシャッフルして選択
        points.sort((a, b) => b.intensity - a.intensity);
        const keepTop = Math.floor(maxPointsPerTile * 0.6);
        const topPoints = points.slice(0, keepTop);
        const remaining = points.slice(keepTop);

        // 決定論的シャッフル（Fisher-Yates with seed）
        for (let i = remaining.length - 1; i > 0; i--) {
            const hash = ((x * 73856093) ^ (y * 19349663) ^ (i * 83492791)) >>> 0;
            const j = hash % (i + 1);
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }

        const needMore = maxPointsPerTile - keepTop;
        return [...topPoints, ...remaining.slice(0, needMore)];
    }

    return points;
}

async function getOrLoadTile(
    z: number,
    x: number,
    y: number,
    opts: {
        stride: number;
        threshold: number;
        emit: number;
        gamma: number;
        logK: number;
        maxPointsPerTile: number;
        heightScale: number;
    }
): Promise<ViirsPoint[]> {
    const key = tileKey(z, x, y, opts.stride, opts.emit);

    // キャッシュにあれば返す
    if (tileCache.has(key)) {
        console.log('[VIIRS] cache hit:', key);
        return tileCache.get(key)!;
    }

    console.log('[VIIRS] cache miss, loading:', key);
    // なければロードしてキャッシュ
    const points = await sampleViirsTile(z, x, y, opts);
    console.log('[VIIRS] loaded tile:', key, 'points:', points.length);
    tileCache.set(key, points);
    return points;
}

export async function buildViirsPoints(
    bounds: maplibregl.LngLatBounds,
    z: number,
    opts: {
        stride?: number;
        threshold?: number;
        emit?: number;
        gamma?: number;
        logK?: number;
        maxPoints?: number;
        maxPointsPerTile?: number;
        heightScale?: number;
    }
): Promise<ViirsPoint[]> {
    const stride = opts.stride ?? 1;
    const threshold = opts.threshold ?? 1.0;
    const emit = opts.emit ?? 6;
    const gamma = opts.gamma ?? 0.8;
    const logK = opts.logK ?? 10;
    const maxPoints = opts.maxPoints ?? 60000;
    const maxPointsPerTile = opts.maxPointsPerTile ?? 4000;
    const heightScale = opts.heightScale ?? 80;

    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    const t0 = lngLatToTile(sw.lng, ne.lat, z); // west, north
    const t1 = lngLatToTile(ne.lng, sw.lat, z); // east, south

    const minX = Math.min(t0.x, t1.x);
    const maxX = Math.max(t0.x, t1.x);
    const minY = Math.min(t0.y, t1.y);
    const maxY = Math.max(t0.y, t1.y);

    console.log('[VIIRS] bounds:', { sw: { lng: sw.lng.toFixed(3), lat: sw.lat.toFixed(3) }, ne: { lng: ne.lng.toFixed(3), lat: ne.lat.toFixed(3) } });
    console.log('[VIIRS] tile range before clamp:', { minX, maxX, minY, maxY });

    // 存在範囲との交差を取る
    const clampedMinX = Math.max(minX, VIIRS_TILE_BOUNDS.minX);
    const clampedMaxX = Math.min(maxX, VIIRS_TILE_BOUNDS.maxX);
    const clampedMinY = Math.max(minY, VIIRS_TILE_BOUNDS.minY);
    const clampedMaxY = Math.min(maxY, VIIRS_TILE_BOUNDS.maxY);

    console.log('[VIIRS] tile range after clamp:', { clampedMinX, clampedMaxX, clampedMinY, clampedMaxY });

    // 範囲外の場合は空配列を返す
    if (clampedMinX > clampedMaxX || clampedMinY > clampedMaxY) {
        return [];
    }

    // 必要なタイル座標のリストを作成
    const neededTiles: Array<{ x: number; y: number }> = [];
    for (let tileX = clampedMinX; tileX <= clampedMaxX; tileX++) {
        for (let tileY = clampedMinY; tileY <= clampedMaxY; tileY++) {
            neededTiles.push({ x: tileX, y: tileY });
        }
    }

    // 並列でタイルを処理（キャッシュがあればスキップ）
    const CONCURRENCY = 8;
    const tileOpts = { stride, threshold, emit, gamma, logK, maxPointsPerTile, heightScale };

    for (let i = 0; i < neededTiles.length; i += CONCURRENCY) {
        const batch = neededTiles.slice(i, i + CONCURRENCY);
        await Promise.all(
            batch.map(({ x, y }) => getOrLoadTile(z, x, y, tileOpts))
        );
    }

    // 必要なタイルのポイントを集める
    const allPoints: ViirsPoint[] = [];
    for (const { x, y } of neededTiles) {
        const key = tileKey(z, x, y, stride, emit);
        const pts = tileCache.get(key);
        if (pts) {
            allPoints.push(...pts);
        } else {
            console.warn('[VIIRS] Missing cache for key:', key);
        }
    }

    console.log('[VIIRS buildViirsPoints] tiles:', neededTiles.length, 'points:', allPoints.length, { stride, emit });

    // maxPoints を超えていたら、intensity で優先度付けしてサンプリング
    if (allPoints.length > maxPoints) {
        // intensity が高いものを優先的に残す
        allPoints.sort((a, b) => b.intensity - a.intensity);

        // 上位をそのまま残し、下位をランダムサンプリング
        const keepTop = Math.floor(maxPoints * 0.7); // 上位70%は確保
        const topPoints = allPoints.slice(0, keepTop);
        const remaining = allPoints.slice(keepTop);

        // 残りからランダムに選択
        const needMore = maxPoints - keepTop;
        for (let i = remaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        }
        const selected = remaining.slice(0, needMore);

        return [...topPoints, ...selected];
    }

    return allPoints;
}
