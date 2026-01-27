import { LocateFixed, Compass } from 'lucide-react';

type CurrentLocationButtonProps = {
    onClick: () => void;
    isNorthUp: boolean;
    disabled?: boolean;
    className?: string; // Allow custom positioning if needed
};

export function CurrentLocationButton({ onClick, isNorthUp, disabled, className }: CurrentLocationButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={isNorthUp ? "現在地へ移動" : "北へ戻す"}
            className={`
                group
                bg-black/60 backdrop-blur-md border border-white/10
                text-white rounded-full shadow-lg
                h-[var(--btn-h)] w-[var(--btn-h)]
                hover:bg-white/10 hover:border-white/20
                active:scale-95
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
                flex items-center justify-center
                ${className || `absolute bottom-[calc(24px+env(safe-area-inset-bottom))] right-6 md:bottom-8 md:right-8`}
            `}
        >
            {isNorthUp ? (
                // Location Arrow Icon
                <LocateFixed className="w-5 h-5 text-white/90 group-hover:scale-110 transition-transform" />
            ) : (
                // North/Compass Icon
                <Compass className="w-5 h-5 text-red-400 group-hover:scale-110 group-hover:rotate-45 transition-transform" />
            )}
        </button>
    );
}
