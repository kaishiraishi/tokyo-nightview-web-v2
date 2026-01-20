export type MapMode = 'explore' | 'analyze';

export type FanConfig = {
    rayCount: number;
    maxRange: number;
};

export type ScanStep =
    | 'idle'
    | 'selecting_source'
    | 'north_preview'
    | 'adjusting_range'
    | 'scanning'
    | 'complete';
