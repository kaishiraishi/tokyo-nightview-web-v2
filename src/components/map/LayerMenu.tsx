import { useEffect, useRef, useState, type ReactNode } from 'react';

type LayerMenuProps = {
    isOpen: boolean;
    onToggle: () => void;
    children: ReactNode;
};

export function LayerMenu({ isOpen, onToggle, children }: LayerMenuProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const [dragTranslate, setDragTranslate] = useState<number | null>(null);
    const dragStartRef = useRef<{ y: number; start: number } | null>(null);

    const handleHeight = 55;

    useEffect(() => {
        setDragTranslate(null);
    }, [isOpen]);

    return (
        <div
            ref={panelRef}
            className={`
                fixed bottom-0 left-0 right-0 z-40
                bg-black/80 backdrop-blur-md border-t border-white/10
                transition-transform duration-300 pointer-events-auto
                md:absolute md:top-4 md:left-4 md:bottom-4 md:right-auto md:w-80 md:rounded-2xl md:border md:border-white/10 md:shadow-2xl
                ${isOpen ? 'translate-y-0 md:translate-x-0' : 'translate-y-[calc(100%-55px)] md:-translate-x-[calc(100%+16px)]'}
            `}
            style={dragTranslate !== null ? { transform: `translateY(${dragTranslate}px)` } : undefined}
        >
            <button
                type="button"
                onClick={onToggle}
                className="w-full h-[55px] flex items-center justify-center md:absolute md:-right-12 md:top-0 md:w-10 md:h-16 md:bg-black/70 md:border md:border-white/10 md:rounded-r-xl"
                onPointerDown={(event) => {
                    if (!panelRef.current) return;
                    const rect = panelRef.current.getBoundingClientRect();
                    const startTranslate = isOpen ? 0 : Math.max(0, rect.height - handleHeight);
                    dragStartRef.current = { y: event.clientY, start: startTranslate };
                    event.currentTarget.setPointerCapture(event.pointerId);
                    event.preventDefault();
                }}
                onPointerMove={(event) => {
                    if (!panelRef.current || !dragStartRef.current) return;
                    const rect = panelRef.current.getBoundingClientRect();
                    const maxTranslate = Math.max(0, rect.height - handleHeight);
                    const delta = event.clientY - dragStartRef.current.y;
                    const next = Math.min(maxTranslate, Math.max(0, dragStartRef.current.start + delta));
                    setDragTranslate(next);
                    event.preventDefault();
                }}
                onPointerUp={(event) => {
                    if (!panelRef.current || !dragStartRef.current) return;
                    const rect = panelRef.current.getBoundingClientRect();
                    const maxTranslate = Math.max(0, rect.height - handleHeight);
                    const threshold = maxTranslate * 0.5;
                    const current = dragTranslate ?? dragStartRef.current.start;
                    if (current > threshold) {
                        if (isOpen) onToggle();
                    } else {
                        if (!isOpen) onToggle();
                    }
                    dragStartRef.current = null;
                    setDragTranslate(null);
                    event.preventDefault();
                }}
            >
                <div className="w-10 h-1 bg-white/30 rounded-full md:hidden" />
                <span className="hidden md:block text-white/80 text-sm">{isOpen ? '←' : '→'}</span>
            </button>

            <div className="p-4 h-full overflow-y-auto">
                {children}
            </div>
        </div>
    );
}
