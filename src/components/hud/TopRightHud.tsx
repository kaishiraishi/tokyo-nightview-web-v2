import { ProfileChart } from '../profile/ProfileChart';
import type { ScanStep } from '../map/types';
import type { ProfileResponse, RayResult } from '../../types/profile';

type TopRightHudProps = {
    mode: 'explore' | 'analyze';
    onModeChange: (mode: 'explore' | 'analyze') => void;
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
    profile,
    onProfileHover,
    onProfileClick,
    occlusionDistance,
    scanStatus,
    onResetScan,
}: TopRightHudProps) {
    return (
        <div className="flex w-[360px] flex-col gap-3 text-white">
            <div className="flex items-center gap-3">
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
                <button
                    className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/60 text-lg shadow-lg backdrop-blur-md"
                    type="button"
                    aria-label="User menu"
                >
                    ●
                </button>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/70 p-4 shadow-lg backdrop-blur-md">
                <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 p-1">
                    <button
                        type="button"
                        aria-pressed={mode === 'explore'}
                        onClick={() => onModeChange('explore')}
                        className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${
                            mode === 'explore'
                                ? 'bg-yellow-400 text-black'
                                : 'text-white/70 hover:text-white'
                        }`}
                    >
                        EXPLORE
                    </button>
                    <button
                        type="button"
                        aria-pressed={mode === 'analyze'}
                        onClick={() => onModeChange('analyze')}
                        className={`flex-1 rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${
                            mode === 'analyze'
                                ? 'bg-white/20 text-white'
                                : 'text-white/60 hover:text-white'
                        }`}
                    >
                        ANALYZE <span className="ml-1 text-[11px]">🔒</span>
                    </button>
                </div>

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

                    <div className="mt-3 space-y-2 text-xs">
                        {[
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
                        ].map((step, index) => {
                            const isActive = scanStatus.scanStep === step.key;
                            const isDone =
                                scanStatus.scanStep !== 'idle' &&
                                !isActive &&
                                index <
                                    [
                                        'selecting_source',
                                        'selecting_target',
                                        'adjusting_angle',
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
            </div>
        </div>
    );
}
