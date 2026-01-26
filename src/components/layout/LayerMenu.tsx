import { useRef, useState, useEffect, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type LayerMenuProps = {
    isOpen: boolean;
    onToggle: () => void;
    children: ReactNode;
};

export function LayerMenu({ isOpen, onToggle, children }: LayerMenuProps) {
    const [isMobile, setIsMobile] = useState(false);
    const panelRef = useRef<HTMLDivElement>(null);

    // デバイス判定（簡易）
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // // ドラッグ処理 (Mobile Only)
    // const handlePointerDown = (e: React.PointerEvent) => {
    //     if (!isMobile) return;
    //     // ハンドル部分のみドラッグ可能にする等の判定を入れると良い
    //     dragStartRef.current = { y: e.clientY, startY: dragTranslateY };
    //     (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // };

    // const handlePointerMove = (e: React.PointerEvent) => {
    //     if (!isMobile || !dragStartRef.current) return;
    //     const deltaY = e.clientY - dragStartRef.current.y;
    //     const newTranslate = Math.max(0, dragStartRef.current.startY + deltaY); // 上には行かせない
    //     setDragTranslateY(newTranslate);
    // };

    // const handlePointerUp = (e: React.PointerEvent) => {
    //     if (!isMobile || !dragStartRef.current) return;
    //     const threshold = 100; // ある程度動かしたら状態を反転
    //     const deltaY = e.clientY - dragStartRef.current.y;

    //     if (Math.abs(deltaY) > threshold) {
    //         if (deltaY > 0 && isOpen) onToggle(); // 下に大きく動かしたら閉じる
    //         if (deltaY < 0 && !isOpen) onToggle(); // 上に大きく動かしたら開く
    //     } 
        
    //     setDragTranslateY(0); // ドラッグ終了時はリセット（isOpenステートに任せる）
    //     dragStartRef.current = null;
    //     (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    // };

    // Tailwindの transform クラスと style の translateY を組み合わせる
    // Mobile: fixed bottom-0, translate-y で出し入れ
    // Desktop: absolute top-4 left-4, translate-x で出し入れ

    return (
        <div
            ref={panelRef}
            className={`
                z-[4000] transition-transform duration-300 ease-out
                ${isMobile 
                    ? 'fixed bottom-0 left-0 right-0 bg-black/80 backdrop-blur-md rounded-t-2xl border-t border-white/10 shadow-[0_-8px_30px_rgba(0,0,0,0.5)] pb-[env(safe-area-inset-bottom)]' 
                    : 'absolute top-4 left-4 bottom-4 w-80 bg-black/60 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl'
                }
                ${isOpen
                    ? (isMobile ? 'translate-y-0' : 'translate-x-0')
                    : (isMobile ? 'translate-y-[calc(100%-55px-env(safe-area-inset-bottom))]' : '-translate-x-[calc(100%+20px)]')
                }
            `}
            // style={isMobile && dragStartRef.current ? { transform: `translateY(${dragTranslateY}px)` } : undefined}
            // onPointerDown={handlePointerDown}
            // onPointerMove={handlePointerMove}
            // onPointerUp={handlePointerUp}
        >
            {/* Handle / Toggle Button */}
            {isMobile ? (
                // Mobile Handle
                <div 
                    onClick={onToggle}
                    className="h-[55px] w-full flex items-center justify-center cursor-pointer active:bg-white/5 rounded-t-2xl"
                >
                    <div className="w-12 h-1.5 bg-white/20 rounded-full" />
                </div>
            ) : (
                // Desktop Toggle Button (Vertically Centered Tab - Larger & More Visible)
                <button
                    onClick={onToggle}
                    className="absolute -right-10 top-1/2 -translate-y-1/2 w-10 h-24 bg-black/80 backdrop-blur-xl border border-l-0 border-white/20 rounded-r-2xl flex items-center justify-center text-white/50 hover:text-white hover:bg-black/90 transition-all duration-300 group shadow-[10px_0_30px_rgba(0,0,0,0.5)]"
                >
                    <div className="flex flex-col items-center gap-2 group-hover:scale-110 transition-transform">
                        {isOpen ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
                        <div className="w-1 h-10 bg-white/10 rounded-full group-hover:bg-violet-500/50 transition-colors" />
                    </div>
                </button>
            )}

            {/* Content Container */}
            <div className={`
                ${isMobile ? 'h-[60vh]' : 'h-full'} 
                overflow-hidden flex flex-col
            `}>
                {children}
            </div>
        </div>
    );
}
