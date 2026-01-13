import type { LngLat, ProfileResponse } from '../../types/profile';

const API_BASE =
    import.meta.env.VITE_DSM_API_BASE ?? (import.meta.env.DEV ? '/api' : 'http://127.0.0.1:8000');

export async function fetchProfile(
    start: LngLat,
    end: LngLat,
    sampleCount: number = 120
): Promise<ProfileResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒でタイムアウト

    try {
        const response = await fetch(`${API_BASE}/profile`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                start: [start.lng, start.lat],
                end: [end.lng, end.lat],
                sample_count: sampleCount,
            }),
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
            throw new Error(error.detail || `HTTP ${response.status}`);
        }

        return response.json();
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }


}
