import { useState } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { ProfileChart } from '../profile/ProfileChart';
import { UserProfileCard } from '../profile/UserProfileCard';
import { MOCK_POSTS } from '../../data/mockPosts';
import type { ScanMode, ScanStep } from '../map/types';
import type { ProfileResponse, RayResult } from '../../types/profile';

type TopRightHudProps = {
    mode: 'explore' | 'analyze';
    onModeChange: (mode: 'explore' | 'analyze') => void;
    scanMode: ScanMode;
    onScanModeChange: (mode: ScanMode) => void;
    profile: ProfileResponse | null;
    onProfileHover: (index: number | null) => void;
    onProfileClick: (index: number) => void;
    occlusionDistance: number | null;
    scanStatus: {
        scanStep: ScanStep;
        loading: boolean;
        error: string | null;
        rayResult: RayResult | null;
        previewDeltaTheta: number | null;
        deltaTheta: number;
        fanStats: {
            total: number;
            blocked: number;
            clear: number;
        };
    };
    onResetScan: () => void;
};

export function TopRightHud({
    mode,
    onModeChange,
    scanMode,
    onScanModeChange,
    profile,
    onProfileHover,
    onProfileClick,
    occlusionDistance,
    scanStatus,
    onResetScan,
}: TopRightHudProps) {
    const [cardView, setCardView] = useState<'status' | 'profile'>('status');

    return (
        <div className="flex w-[360px] flex-col gap-3 text-white">
            <div className="flex items-center gap-3">
                <button
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/60 text-lg shadow-lg backdrop-blur-md"
                    type="button"
                    aria-label="プロフィール"
                    title="プロフィール"
                    aria-pressed={cardView === 'profile'}
                    onClick={() => {
                        setCardView((prev) => (prev === 'profile' ? 'status' : 'profile'));
                    }}
                >
                    P
                </button>
                <div className="flex h-11 flex-1 items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 shadow-lg backdrop-blur-md">
                    <span className="text-white/70" aria-hidden="true">
                        🔍
                    </span>
                    <input
                        className="w-full bg-transparent text-sm text-white placeholder-white/50 outline-none"
                        placeholder="Search location"
                        type="text"
                    />
                </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/70 p-4 shadow-lg backdrop-blur-md">
                <div className="flex items-center rounded-full border border-white/10 bg-black/80 p-1 shadow-inner">
                    <button
                        type="button"
                        aria-pressed={mode === 'explore'}
                        onClick={() => onModeChange('explore')}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-colors ${
                            mode === 'explore'
                                ? 'bg-white text-black'
                                : 'text-white/70 hover:text-white'
                        }`}
                    >
                        <Search className="h-4 w-4" aria-hidden="true" />
                        さがす
                    </button>

                    <button
                        type="button"
                        aria-pressed={mode === 'analyze'}
                        onClick={() => onModeChange('analyze')}
                        className={`flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-xs font-semibold tracking-wide transition-colors ${
                            mode === 'analyze'
                                ? 'bg-white text-black'
                                : 'text-white/70 hover:text-white'
                        }`}
                    >
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                        みつける
                    </button>
                </div>

                <div className="mt-2 text-[11px] text-white/55">
                    {mode === 'explore'
                        ? '地図で夜景スポットを探す'
                        : 'みんなの投稿を見る / 自分も投稿する'}
                </div>

                {cardView === 'profile' ? (
                    <div className="mt-4">
                        <UserProfileCard
                            displayName="KAZUNE"
                            memberId="No.0001"
                            foundSpots={[
                                { name: '晴海ふ頭公園', area: '中央区', date: '2024.05.18' },
                                { name: '世界貿易センタービル', area: '港区', date: '2024.04.27' },
                                { name: '豊洲ぐるり公園', area: '江東区', date: '2024.04.10' },
                                { name: 'お台場海浜公園', area: '港区', date: '2024.03.22' },
                            ]}
                            favoriteSpots={[
                                { name: '東京タワー展望台', area: '港区', date: '2024.02.14' },
                                { name: '渋谷スカイ', area: '渋谷区', date: '2024.01.30' },
                                { name: 'サンシャイン60展望台', area: '豊島区', date: '2023.12.05' },
                            ]}
                        />
                    </div>
                ) : mode === 'analyze' ? (
                    <div className="mt-4 rounded-xl border border-white/10 bg-black/50 p-3">
                        <div className="text-xs text-white/70">投稿一覧</div>
                        <div className="mt-3 space-y-2">
                            {MOCK_POSTS.map((post) => (
                                <div
                                    key={post.id}
                                    className="rounded-lg border border-white/10 bg-black/40 px-3 py-2"
                                >
                                    <div className="truncate text-xs text-white/90">
                                        {post.caption}
                                    </div>
                                    <div className="mt-1 text-[11px] text-white/50">
                                        {(post.location.placeName ?? '不明')}・{(post.location.area ?? '不明')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="mt-4 h-64">
                            <ProfileChart
                                profile={profile}
                                onHover={onProfileHover}
                                onClick={onProfileClick}
                                occlusionDistance={occlusionDistance}
                            />
                        </div>

                        <div className="mt-4 rounded-xl border border-white/10 bg-black/50 p-3">
                            <div className="flex justify-between items-center text-xs text-white/70">
                                <span>STATUS</span>
                                <button
                                    type="button"
                                    onClick={() => onResetScan()}
                                    className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/70 hover:bg-white/10 hover:text-white"
                                >
                                    Reset
                                </button>
                            </div>

                            <div className="mt-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/40 p-1 text-[11px]">
                                {[
                                    { key: '360', label: '360Ray' },
                                    { key: 'fan', label: 'FanRay' },
                                ].map((tab) => (
                                    <button
                                        key={tab.key}
                                        type="button"
                                        onClick={() => onScanModeChange(tab.key as ScanMode)}
                                        aria-pressed={scanMode === tab.key}
                                        className={`flex-1 rounded-full px-3 py-1 font-semibold tracking-wide transition-colors ${
                                            scanMode === tab.key
                                                ? 'bg-yellow-400 text-black'
                                                : 'text-white/70 hover:text-white'
                                        }`}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            <div className="mt-3 space-y-2 text-xs">
                                {(scanMode === 'fan'
                                    ? [
                                    {
                                        key: 'selecting_source',
                                        label: '観測点を決定',
                                        help: 'ダブルクリックで観測点',
                                    },
                                    {
                                        key: 'selecting_target',
                                        label: '目標点を決定',
                                        help: 'シングルクリックで目標点',
                                    },
                                    {
                                        key: 'adjusting_angle',
                                        label: '角度を調整',
                                        help: 'マウス移動で角度調整 → クリックで確定',
                                    },
                                ]
                                    : [
                                    {
                                        key: 'selecting_source',
                                        label: '観測点を決定',
                                        help: 'ダブルクリックで観測点',
                                    },
                                    {
                                        key: 'adjusting_range',
                                        label: '半径を調整',
                                        help: 'マウス移動で半径調整 → クリックで確定',
                                    },
                                    {
                                        key: 'scanning',
                                        label: '360°スキャン',
                                        help: 'スキャンを実行中',
                                    },
                                    {
                                        key: 'complete',
                                        label: '完了',
                                        help: '結果を表示中',
                                    },
                                ]).map((step, index) => {
                                    const isActive = scanStatus.scanStep === step.key;
                                    const isDone =
                                        scanStatus.scanStep !== 'idle' &&
                                        !isActive &&
                                        index <
                                            [
                                                'selecting_source',
                                                ...(scanMode === 'fan'
                                                    ? ['selecting_target', 'adjusting_angle']
                                                    : ['adjusting_range', 'scanning', 'complete']),
                                            ].indexOf(scanStatus.scanStep);

                                    return (
                                        <div
                                            key={step.key}
                                            className={`flex items-start gap-2 rounded-lg border px-2 py-2 ${
                                                isActive
                                                    ? 'border-yellow-400/60 bg-yellow-400/10'
                                                    : isDone
                                                        ? 'border-white/10 bg-white/5'
                                                        : 'border-white/10 bg-black/30'
                                            }`}
                                        >
                                            <div
                                                className={`mt-0.5 h-2.5 w-2.5 rounded-full ${
                                                    isActive ? 'bg-yellow-400' : isDone ? 'bg-emerald-400/70' : 'bg-white/20'
                                                }`}
                                            />
                                            <div className="flex-1">
                                                <div className="text-white/90">{step.label}</div>
                                                <div className="text-[11px] text-white/50">{step.help}</div>
                                                {step.key === 'adjusting_angle' && isActive && (
                                                    <div className="mt-1 text-[11px] text-white/70">
                                                        Angle: {Math.round(scanStatus.previewDeltaTheta ?? scanStatus.deltaTheta)}°
                                                    </div>
                                                )}
                                                {scanStatus.error && isActive && (
                                                    <div className="mt-1 text-[11px] text-red-400">
                                                        Error: {scanStatus.error}
                                                    </div>
                                                )}
                                                {scanStatus.loading && isActive && (
                                                    <div className="mt-1 text-[11px] text-blue-400 animate-pulse">
                                                        Scanning...
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
