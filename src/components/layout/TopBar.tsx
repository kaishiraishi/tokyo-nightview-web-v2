import { Search, Sparkles, User } from 'lucide-react';
import { useState } from 'react';
import type { GeocodingResult } from '../../lib/api/geocodingApi';
import { AppMenu } from '../menu/AppMenu';
import { MOCK_POSTS } from '../../data/mockPosts';
import type { FanConfig } from '../map/types';

// Mock stats for the profile menu
const MOCK_PROFILE_STATS = {
    foundCount: 4,
    favoriteCount: 3,
};

type TopBarProps = {
    mode: 'explore' | 'analyze';
    onModeChange: (mode: 'explore' | 'analyze') => void;
    searchQuery: string;
    onSearchChange: (query: string) => void;
    onSearchSubmit: () => void;
    isSearching: boolean;
    searchResults: GeocodingResult[];
    showResults: boolean;
    onSelectResult: (result: GeocodingResult) => void;
    onCloseResults: () => void;
    onFocusSearch: () => void;
    guidance?: {
        steps: { key: string; label: string }[];
        currentStep: string;
    } | null;
    onStepClick?: (key: string) => void;
    fanConfig?: FanConfig;
    onFanConfigChange?: (config: FanConfig) => void;
};

export function TopBar({
    mode,
    onModeChange,
    searchQuery,
    onSearchChange,
    onSearchSubmit,
    isSearching,
    searchResults,
    showResults,
    onSelectResult,
    onCloseResults,
    onFocusSearch,
    guidance,
    onStepClick,
    fanConfig,
    onFanConfigChange,
}: TopBarProps) {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    return (
        <div className="absolute top-4 left-4 right-4 md:left-auto md:right-4 md:w-[520px] z-[5000] flex flex-col gap-2 pointer-events-none">
            {/* Search & Mode Container - Floating Island */}
            <div className="flex items-center gap-2 pointer-events-auto">
                <button
                    onClick={() => setIsMenuOpen(true)}
                    className={`
                        h-12 w-12 shrink-0 flex items-center justify-center rounded-full border border-white/10 shadow-lg backdrop-blur-md transition-all
                        ${isMenuOpen ? 'bg-white text-black' : 'bg-black/60 text-white/80 hover:bg-black/80 hover:text-white'}
                    `}
                    title="メニュー"
                >
                    <User className="h-5 w-5" />
                </button>

                {/* Search Bar */}
                <div className="relative flex-1 group">
                    <div className="flex h-12 w-full items-center gap-3 rounded-full border border-white/10 bg-black/60 px-4 shadow-lg backdrop-blur-md transition-all group-focus-within:bg-black/80 group-focus-within:border-white/20">
                        <Search className="h-5 w-5 text-white/50" />
                        <input
                            className="h-full w-full bg-transparent text-sm text-white placeholder-white/50 outline-none"
                            placeholder="場所を検索..."
                            type="text"
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && onSearchSubmit()}
                            onFocus={onFocusSearch}
                        />
                        {isSearching && (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                        )}
                    </div>

                    {/* Search Results Dropdown */}
                    {showResults && searchResults.length > 0 && (
                        <div
                            className="absolute left-0 right-0 top-14 overflow-hidden rounded-2xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur-md z-[6000]"
                            onMouseLeave={onCloseResults}
                        >
                            <div className="max-h-[60vh] overflow-y-auto py-2">
                                {searchResults.map((result, index) => {
                                    const parts = result.displayName.split(',');
                                    const name = parts[0];
                                    const address = parts.slice(1).join(', ').trim();

                                    return (
                                        <button
                                            key={index}
                                            type="button"
                                            onClick={() => onSelectResult(result)}
                                            className="w-full px-4 py-3 text-left transition-colors hover:bg-white/10 flex flex-col gap-0.5"
                                        >
                                            <span className="text-sm font-semibold text-white">{name}</span>
                                            {address && (
                                                <span className="text-xs text-white/50 line-clamp-1">{address}</span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Mode Toggle (Capsule) */}
                <div className="flex bg-black/60 backdrop-blur-md rounded-full p-1 border border-white/10 shadow-lg h-12 items-center">
                    <button
                        onClick={() => onModeChange('explore')}
                        className={`
                            h-10 w-10 flex items-center justify-center rounded-full transition-all
                            ${mode === 'explore' ? 'bg-white text-black shadow-sm' : 'text-white/70 hover:text-white'}
                        `}
                        title="探索モード"
                    >
                        <Search className="h-5 w-5" />
                    </button>
                    <button
                        onClick={() => onModeChange('analyze')}
                        className={`
                            h-10 w-10 flex items-center justify-center rounded-full transition-all
                            ${mode === 'analyze' ? 'bg-violet-700 text-white shadow-sm' : 'text-white/70 hover:text-white'}
                        `}
                        title="分析モード"
                    >
                        <Sparkles className="h-5 w-5" />
                    </button>
                </div>
            </div>

            {/* Guidance Stepper - Horizontal ribbon below search */}
            {mode === 'explore' && guidance && (
                <div className="flex w-full bg-black/60 backdrop-blur-md border border-white/10 rounded-full p-1.5 items-center gap-1 pointer-events-auto shadow-xl animate-in slide-in-from-top-1 duration-300">
                    {guidance.steps.map((step, index) => {
                        const isActive = step.key === guidance.currentStep;
                        // Find if current step is past this step (simple heuristic)
                        const currentIndex = guidance.steps.findIndex(s => s.key === guidance.currentStep);
                        const isCompleted = index < currentIndex;

                        return (
                            <div key={step.key} className="flex flex-1 items-center">
                                {index > 0 && (
                                    <div className={`w-2 h-0.5 mx-0.5 rounded-full ${isCompleted ? 'bg-violet-700/50' : 'bg-white/10'}`} />
                                )}
                                <button
                                    onClick={() => onStepClick?.(step.key)}
                                    className={`
                                        flex-1 px-1 py-1.5 rounded-full text-[10px] font-bold transition-all whitespace-nowrap pointer-events-auto
                                        ${isActive 
                                            ? 'bg-violet-700 text-white shadow-sm scale-105' 
                                            : isCompleted 
                                                ? 'bg-violet-700/20 text-violet-300 hover:bg-violet-700/30' 
                                                : 'text-white/40 hover:text-white/60'
                                        }
                                    `}
                                >
                                    {index + 1}. {step.label}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* App Menu Overlay */}
            <AppMenu 
                isOpen={isMenuOpen}
                onClose={() => setIsMenuOpen(false)}
                displayName="KAZUNE"
                memberId="No.0001"
                foundCount={MOCK_PROFILE_STATS.foundCount}
                favoriteCount={MOCK_PROFILE_STATS.favoriteCount}
                postCount={MOCK_POSTS.length}                fanConfig={fanConfig}
                onFanConfigChange={onFanConfigChange}            />
        </div>
    );
}
