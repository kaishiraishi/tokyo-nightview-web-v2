import { ProfileChart } from '../../components/profile/ProfileChart';
import type { ScanMode, ScanStep } from '../map/types';
import type { RayResult, ProfileResponse } from '../../types/profile';
import { LayerSettings } from '../layout/LayerSettings';

type ScanControlPanelProps = {
    scanMode: ScanMode;
    onScanModeChange: (mode: ScanMode) => void;
    // Layer settings props
    viirsEnabled: boolean;
    setViirsEnabled: (enabled: boolean) => void;
    aerialEnabled: boolean;
    setAerialEnabled: (enabled: boolean) => void;
    // scanStatus is kept but many fields might be less valid if we remove the wizard view.
    // However, if we need loading state, we can keep using it.
    scanStatus: {
        scanStep: ScanStep;
        loading: boolean;
        error: string | null;
        rayResult: RayResult | null;
        previewDeltaTheta: number | null;
        deltaTheta: number;
    };
    onResetScan: () => void;
    profile: ProfileResponse | null;
    onProfileHover: (index: number | null) => void;
    onProfileClick: (index: number) => void;
};

export function ScanControlPanel({
    scanMode,
    onScanModeChange,
    viirsEnabled,
    setViirsEnabled,
    aerialEnabled,
    setAerialEnabled,
    scanStatus,
    onResetScan,
    profile,
    onProfileHover,
    onProfileClick,
}: ScanControlPanelProps) {
    
    // We only use the loading part of scanStatus or check for error
    const isLoading = scanStatus.loading;

    return (
        <div className="flex flex-col h-full bg-transparent text-white">
            {/* Header / Tabs */}
            <div className="px-4 pt-4 border-b border-white/10 shrink-0">
                <div className="text-xs text-white/50 mb-3 font-medium tracking-wider">SCAN SETTINGS</div>
                <div className="flex bg-black/40 rounded-lg p-1 border border-white/10 mb-4">
                    {[
                        { key: '360', label: '360° Panorama' },
                        { key: 'fan', label: 'View Fan' },
                    ].map((mode) => (
                        <button
                            key={mode.key}
                            onClick={() => onScanModeChange(mode.key as ScanMode)}
                            className={`
                                flex-1 py-1.5 text-[10px] font-bold rounded-md transition-all
                                ${scanMode === mode.key 
                                    ? 'bg-yellow-400 text-black shadow-sm' 
                                    : 'text-white/60 hover:text-white hover:bg-white/5'}
                            `}
                        >
                            {mode.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Layer Settings Section (Moved here) */}
            <LayerSettings
                viirsEnabled={viirsEnabled}
                setViirsEnabled={setViirsEnabled}
                aerialEnabled={aerialEnabled}
                setAerialEnabled={setAerialEnabled}
            />

            {/* Main Content: Profile Chart */}
            <div className="flex-1 overflow-hidden relative">
                <div className="w-full h-full p-2 flex flex-col">
                    <div className="flex-1 min-h-0">
                        {/* Render ProfileChart. If no profile, it shows placeholder text internally. */}
                        <ProfileChart
                            profile={profile}
                            onHover={onProfileHover}
                            onClick={onProfileClick}
                            occlusionDistance={scanStatus.rayResult?.distance ?? null}
                        />
                    </div>
                    
                    {/* Error Message within card */}
                    {scanStatus.error && (
                        <div className="px-3 py-2 bg-red-400/20 border border-red-400/50 rounded-lg mx-2 mb-2 animate-in fade-in slide-in-from-bottom-2">
                            <div className="text-[10px] font-bold text-red-400 flex items-center gap-1.5">
                                <span>⚠️ Error:</span>
                                <span>{scanStatus.error}</span>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Loading Overlay */}
                {isLoading && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10">
                        <div className="flex flex-col items-center gap-2">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-yellow-400" />
                            <span className="text-xs font-bold text-yellow-400">Loading...</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer: Reset Button */}
            <div className="p-4 border-t border-white/10 shrink-0">
                 <button
                    onClick={onResetScan}
                    className="w-full py-2.5 rounded-lg border border-white/20 hover:bg-white/10 text-xs text-white/70 transition-colors flex items-center justify-center gap-2"
                >
                    <span>↺</span> 最初からやり直す
                </button>
            </div>
        </div>
    );
}
