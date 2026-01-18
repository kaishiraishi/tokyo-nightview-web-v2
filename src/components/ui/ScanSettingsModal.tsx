import React from 'react';
import { SIGHT_ANGLE_PRESETS, FAN_PRESETS } from '../../config/scanConstants';

type FanConfig = {
    deltaTheta: number;
    rayCount: number;
    maxRange: number;
    fullScan: boolean;
};

type ScanSettingsModalProps = {
    isOpen: boolean;
    onClose: () => void;
    sightAngle: number;
    setSightAngle: (angle: number) => void;
    viirsOpacity: number;
    setViirsOpacity: (opacity: number) => void;
    fanConfig: FanConfig;
    setFanConfig: (config: FanConfig) => void;
    rayResult?: { hit: boolean; distance: number | null } | null;
};

export function ScanSettingsModal({
    isOpen,
    onClose,
    sightAngle,
    setSightAngle,
    viirsOpacity,
    setViirsOpacity,
    fanConfig,
    setFanConfig,
    rayResult,
}: ScanSettingsModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={onClose} // specific click to close, bubble supported inside
        >
            <div
                className="bg-gray-900/90 border border-white/20 rounded-xl p-6 w-full max-w-sm shadow-2xl space-y-6"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center bg-transparent border-b border-white/10 pb-4">
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span>⚙️</span> スキャン設定
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        ✕
                    </button>
                </div>

                {/* 1. Sight Angle */}
                <div>
                    <div className="text-sm font-semibold text-gray-300 mb-2">
                        視線角度 (α)
                    </div>
                    <div className="flex gap-2 mb-2">
                        <button
                            onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.DOWN)}
                            className={`flex-1 py-2 text-xs rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.DOWN
                                ? 'bg-orange-600 text-white font-bold shadow-lg'
                                : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                }`}
                        >
                            下向き -2°
                        </button>
                        <button
                            onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.HORIZONTAL)}
                            className={`flex-1 py-2 text-xs rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.HORIZONTAL
                                ? 'bg-blue-600 text-white font-bold shadow-lg'
                                : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                }`}
                        >
                            水平 0°
                        </button>
                        <button
                            onClick={() => setSightAngle(SIGHT_ANGLE_PRESETS.UP)}
                            className={`flex-1 py-2 text-xs rounded transition-colors ${sightAngle === SIGHT_ANGLE_PRESETS.UP
                                ? 'bg-green-600 text-white font-bold shadow-lg'
                                : 'bg-white/10 text-gray-300 hover:bg-white/20'
                                }`}
                        >
                            上向き +2°
                        </button>
                    </div>
                    <div className="text-xs text-gray-400 text-right">
                        現在: {sightAngle > 0 ? '+' : ''}{sightAngle}°
                        {rayResult?.hit && rayResult.distance && ` (遮蔽: ${rayResult.distance.toFixed(0)}m)`}
                    </div>
                </div>

                {/* 2. Ray Density / Count */}
                <div>
                    <div className="text-sm font-semibold text-gray-300 mb-2">レイ密度 (スキャン本数)</div>
                    {fanConfig.fullScan ? (
                        <div className="flex gap-2">
                            <button
                                onClick={() => setFanConfig({ ...fanConfig, rayCount: 36 })}
                                className={`flex-1 py-2 text-xs rounded transition-colors ${fanConfig.rayCount === 36 ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                            >
                                標準 (36本)
                            </button>
                            <button
                                onClick={() => setFanConfig({ ...fanConfig, rayCount: 72 })}
                                className={`flex-1 py-2 text-xs rounded transition-colors ${fanConfig.rayCount === 72 ? 'bg-purple-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                            >
                                高密度 (72本)
                            </button>
                        </div>
                    ) : (
                        <div className="flex gap-2">
                            {[
                                { label: '粗 (9本)', val: FAN_PRESETS.RAY_COUNT.COARSE },
                                { label: '中 (13本)', val: FAN_PRESETS.RAY_COUNT.MEDIUM },
                                { label: '細 (17本)', val: FAN_PRESETS.RAY_COUNT.FINE },
                            ].map((opt) => (
                                <button
                                    key={opt.val}
                                    onClick={() => setFanConfig({ ...fanConfig, rayCount: opt.val })}
                                    className={`flex-1 py-2 text-xs rounded transition-colors ${fanConfig.rayCount === opt.val ? 'bg-green-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* 3. Max Range */}
                <div>
                    <div className="flex justify-between text-sm font-semibold text-gray-300 mb-2">
                        <span>最大距離</span>
                        <span className="font-mono text-blue-300">{fanConfig.maxRange}m</span>
                    </div>
                    <input
                        type="range"
                        min="500"
                        max="10000"
                        step="500"
                        value={fanConfig.maxRange}
                        onChange={(e) => setFanConfig({ ...fanConfig, maxRange: parseInt(e.target.value) })}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                </div>

                {/* 4. VIIRS Opacity */}
                <div>
                    <div className="flex justify-between text-sm font-semibold text-gray-300 mb-2">
                        <span>ナイトライト透明度</span>
                        <span className="font-mono text-yellow-300">{Math.round(viirsOpacity * 100)}%</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={viirsOpacity}
                        onChange={(e) => setViirsOpacity(parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                    />
                </div>

            </div>
        </div>
    );
}
