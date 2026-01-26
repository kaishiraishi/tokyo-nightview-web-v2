import { Layers } from 'lucide-react';

type LayerSettingsProps = {
    viirsEnabled: boolean;
    setViirsEnabled: (enabled: boolean) => void;
    aerialEnabled: boolean;
    setAerialEnabled: (enabled: boolean) => void;
};

export function LayerSettings({
    viirsEnabled,
    setViirsEnabled,
    aerialEnabled,
    setAerialEnabled,
}: LayerSettingsProps) {
    return (
        <div className="p-4 border-b border-white/5 bg-white/[0.02]">
            <div className="flex items-center gap-2 mb-3">
                <Layers className="w-4 h-4 text-white/50" />
                <span className="text-xs font-bold text-white/70 uppercase tracking-wider">表示レイヤー設定</span>
            </div>

            <div className="grid grid-cols-1 gap-4">
                {/* VIIRS Layer */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${viirsEnabled ? 'bg-yellow-400' : 'bg-white/20'}`} />
                            <span className="text-sm text-white/90">夜間光 (VIIRS)</span>
                        </div>
                        <button
                            onClick={() => setViirsEnabled(!viirsEnabled)}
                            className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${viirsEnabled
                                    ? 'bg-yellow-400 text-black'
                                    : 'bg-white/10 text-white/50 hover:bg-white/20'
                                }`}
                        >
                            {viirsEnabled ? 'ON' : 'OFF'}
                        </button>
                    </div>
                </div>

                {/* Aerial Photo Layer */}
                <div className="flex items-center justify-between border-t border-white/5 pt-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${aerialEnabled ? 'bg-blue-400' : 'bg-white/20'}`} />
                        <span className="text-sm text-white/90">航空写真 (国土地理院)</span>
                    </div>
                    <button
                        onClick={() => setAerialEnabled(!aerialEnabled)}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold transition-all ${aerialEnabled
                                ? 'bg-blue-500 text-white'
                                : 'bg-white/10 text-white/50 hover:bg-white/20'
                            }`}
                    >
                        {aerialEnabled ? 'ON' : 'OFF'}
                    </button>
                </div>
            </div>
        </div>
    );
}
