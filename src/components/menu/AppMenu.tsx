import { 
  X, 
  ChevronRight, 
  MapPin, 
  Heart, 
  Image, 
  Settings, 
  BookOpen, 
  History, 
  Mail,
  User,
  ChevronLeft
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { FanConfig } from '../map/types';

type AppMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  displayName: string;
  memberId: string;
  foundCount: number;
  favoriteCount: number;
  postCount: number;
  fanConfig?: FanConfig;
  onFanConfigChange?: (config: FanConfig) => void;
};

export function AppMenu({
  isOpen,
  onClose,
  displayName,
  memberId,
  foundCount,
  favoriteCount,
  postCount,
  fanConfig,
  onFanConfigChange,
}: AppMenuProps) {
  const [activeView, setActiveView] = useState<'main' | 'settings'>('main');

  if (!isOpen) return null;

  const handleClose = () => {
    setActiveView('main');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 pointer-events-auto">
      {/* A. 背景オーバーレイ */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-md" 
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
      />

      {/* B. メニューコンテナ */}
      <div className="relative w-full max-w-md overflow-hidden rounded-[2.5rem] bg-[#1c1c1e]/90 text-white shadow-2xl border border-white/10 backdrop-blur-xl animate-in fade-in zoom-in duration-200">
        <div className="flex max-h-[90vh] flex-col">
          
          {/* C-1. ヘッダー */}
          <div className="relative flex items-center justify-center border-b border-white/5 px-6 py-5">
            {activeView === 'settings' && (
              <button 
                onClick={() => setActiveView('main')}
                className="absolute left-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-all"
              >
                <ChevronLeft size={20} />
              </button>
            )}
            <h2 className="text-lg font-bold tracking-tight">
              {activeView === 'main' ? 'メニュー' : '設定'}
            </h2>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleClose();
              }}
              className="absolute right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-all hover:scale-110 active:scale-90"
            >
              <X size={24} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
            {activeView === 'main' ? (
              <>
                {/* ユーザー情報 (簡易) */}
                <div className="mb-6 flex items-center gap-4 px-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-xl font-bold">
                    {displayName?.charAt(0) || <User size={24} />}
                  </div>
                  <div>
                    <div className="text-base font-semibold">{displayName}</div>
                    <div className="text-xs text-white/40">Member ID: {memberId}</div>
                  </div>
                </div>

                {/* C-2. スタッツカード (明るいカード) */}
                <div className="mb-8 rounded-[2rem] bg-gradient-to-br from-white to-gray-100 p-6 text-black shadow-xl ring-1 ring-white/20">
                  <div className="flex justify-around text-center">
                    <div className="flex flex-col items-center">
                      <div className="text-3xl font-black tabular-nums tracking-tighter">{foundCount}</div>
                      <div className="text-[10px] font-extrabold text-black/40 uppercase tracking-[0.2em]">発見</div>
                    </div>
                    <div className="h-12 w-px bg-black/5 self-center" />
                    <div className="flex flex-col items-center">
                      <div className="text-3xl font-black tabular-nums tracking-tighter">{favoriteCount}</div>
                      <div className="text-[10px] font-extrabold text-black/40 uppercase tracking-[0.2em]">お気に入り</div>
                    </div>
                    <div className="h-12 w-px bg-black/5 self-center" />
                    <div className="flex flex-col items-center">
                      <div className="text-3xl font-black tabular-nums tracking-tighter">{postCount}</div>
                      <div className="text-[10px] font-extrabold text-black/40 uppercase tracking-[0.2em]">投稿</div>
                    </div>
                  </div>
                </div>

                {/* C-3. メニューカード (濃いカード) - グループ1 */}
                <div className="mb-6 overflow-hidden rounded-[1.5rem] bg-white/[0.03] border border-white/5 shadow-inner">
                  <MenuRow 
                    icon={<MapPin size={20} className="text-blue-400" />} 
                    label="最近見つけた夜景" 
                    value={foundCount} 
                  />
                  <MenuRow 
                    icon={<Heart size={20} className="text-red-400" />} 
                    label="お気に入り" 
                    value={favoriteCount} 
                  />
                  <MenuRow 
                    icon={<Image size={20} className="text-purple-400" />} 
                    label="投稿" 
                    value={postCount} 
                    isLast
                  />
                </div>

                {/* グループ2 */}
                <div className="overflow-hidden rounded-[1.5rem] bg-white/[0.03] border border-white/5 shadow-inner">
                  <MenuRow 
                    icon={<Settings size={20} className="text-gray-400" />} 
                    label="設定" 
                    onClick={() => setActiveView('settings')}
                  />
                  <MenuRow 
                    icon={<BookOpen size={20} className="text-green-400" />} 
                    label="はじめてガイド" 
                  />
                  <MenuRow 
                    icon={<History size={20} className="text-orange-400" />} 
                    label="利用履歴" 
                    status="未完了"
                  />
                  <MenuRow 
                    icon={<Mail size={20} className="text-teal-400" />} 
                    label="お問い合わせ" 
                    status="未完了"
                    isLast
                  />
                </div>
              </>
            ) : (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div>
                  <h3 className="text-sm font-semibold text-white/60 mb-3 px-2">スキャン設定</h3>
                  <div className="rounded-[1.5rem] bg-white/[0.03] border border-white/5 p-4 shadow-inner">
                    <div className="text-xs text-white/60 mb-2">Ray Count</div>
                    <div className="flex items-center justify-between text-base font-semibold text-white/90">
                      <span>{fanConfig?.rayCount}</span>
                      <span className="text-xs text-white/40">rays</span>
                    </div>
                    
                    <div className="mt-6 text-xs text-white/60 mb-3">解析密度（Ray Spacing）</div>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { label: '詳細', value: 10 },
                            { label: 'ノーマル', value: 30 },
                            { label: 'あらめ', value: 60 },
                        ].map((preset) => (
                            <button
                                key={preset.value}
                                onClick={() => {
                                  if (onFanConfigChange && fanConfig) {
                                    onFanConfigChange({
                                      ...fanConfig,
                                      deltaTheta: preset.value
                                    });
                                  }
                                }}
                                className={`
                                  flex flex-col items-center justify-center rounded-2xl py-3 px-2 border transition-all
                                  ${fanConfig?.deltaTheta === preset.value
                                    ? 'bg-yellow-400 border-yellow-400 text-black shadow-lg shadow-yellow-400/20'
                                    : 'bg-white/5 border-white/5 text-white/60 hover:bg-white/10 hover:text-white'}
                                `}
                            >
                                <span className="text-xs font-bold">{preset.label}</span>
                                <span className={`text-[10px] mt-0.5 ${fanConfig?.deltaTheta === preset.value ? 'text-black/60' : 'text-white/20'}`}>
                                  {preset.value}°
                                </span>
                            </button>
                        ))}
                    </div>
                    <p className="mt-4 text-[11px] text-white/30 leading-relaxed px-1">
                      Ray Spacingを小さくすると解析が精細になりますが、読み込みに時間がかかる場合があります。
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 text-center text-[10px] text-white/20 uppercase tracking-[0.2em]">
              Tokyo Nightview Web v2
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuRow({ 
  icon, 
  label, 
  value, 
  status, 
  isLast,
  onClick
}: { 
  icon: ReactNode; 
  label: string; 
  value?: number; 
  status?: string;
  isLast?: boolean;
  onClick?: () => void;
}) {
  return (
    <button 
      onClick={onClick}
      className={`flex w-full items-center gap-4 px-5 py-4 transition-colors hover:bg-white/5 ${!isLast ? 'border-b border-white/5' : ''}`}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/5">
        {icon}
      </div>
      <span className="flex-1 text-left text-sm font-medium text-white/90">{label}</span>
      <div className="flex items-center gap-2">
        {value !== undefined && (
          <span className="text-sm font-semibold text-white/40">{value}</span>
        )}
        {status && (
          <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-500">
            {status}
          </span>
        )}
        <ChevronRight size={16} className="text-white/20" />
      </div>
    </button>
  );
}
