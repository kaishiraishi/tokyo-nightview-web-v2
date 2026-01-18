import React from 'react';

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
                text-white rounded-lg shadow-lg
                p-3
                hover:bg-white/10 hover:border-white/20
                active:scale-95
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-200
                flex items-center justify-center
                ${className || 'absolute bottom-6 right-6 md:bottom-8 md:right-8'}
            `}
        >
            {isNorthUp ? (
                // Location Arrow Icon
                <svg
                    className="w-6 h-6 fill-current"
                    viewBox="0 0 24 24"
                >
                    <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm8.94 3c-.46-4.17-3.77-7.48-7.94-7.94V1h-2v2.06C6.83 3.52 3.52 6.83 3.06 11H1v2h2.06c.46 4.17 3.77 7.48 7.94 7.94V23h2v-2.06c4.17-.46 7.48-3.77 7.94-7.94H23v-2h-2.06zM12 19c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7z" />
                </svg>
            ) : (
                // North/Compass Icon (Simple Compass Needle)
                <svg
                    className="w-6 h-6 fill-current text-red-500"
                    viewBox="0 0 24 24"
                >
                    {/* Outer circle */}
                    <path className="text-white" fill="currentColor" opacity="0.9" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8-8z" />
                    {/* Needle (N painted red usually, but icon system might limit colors. Using generic shape) */}
                    <path fill="#EF4444" d="M12 6.5l2.5 5.5h-5l2.5-5.5z" /> {/* North Tip */}
                    <path fill="currentColor" d="M12 17.5l-2.5-5.5h5l-2.5 5.5z" /> {/* South Tip */}
                </svg>
            )}
        </button>
    );
}
