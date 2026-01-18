export const SIGHT_ANGLE_PRESETS = {
    HORIZONTAL: 0,
    UP: 2,
    DOWN: -2,
} as const;

export const FAN_PRESETS = {
    DELTA_THETA: {
        NARROW: 20,
        MEDIUM: 40,
        WIDE: 80,
    },
    RAY_COUNT: {
        COARSE: 9,
        MEDIUM: 13,
        FINE: 17,
    },
    MAX_RANGE: 2000,
} as const;
