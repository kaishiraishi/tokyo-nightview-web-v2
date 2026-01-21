export type MapMode = 'explore' | 'analyze';

export type FanConfig = {
    deltaTheta: number;
    rayCount: number;
    maxRange: number;
};

export type ScanMode = '360' | 'fan';

export type ScanStep =
    | 'idle'
    | 'selecting_source'
    | 'selecting_target'
    | 'adjusting_angle'
    | 'adjusting_range'
    | 'scanning'
    | 'complete';
