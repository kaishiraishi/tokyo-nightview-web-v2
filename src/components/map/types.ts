export type MapMode = 'explore' | 'analyze';

export type FanConfig = {
    deltaTheta: number;
    rayCount: number;
    maxRange: number;
};

export type ScanStep = 'idle' | 'selecting_source' | 'selecting_target' | 'adjusting_angle' | 'scanning' | 'complete';
