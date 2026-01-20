import { useState } from 'react';
import type { ProfileResponse } from '../../types/profile';

type ProfileChartProps = {
    profile: ProfileResponse | null;
    onHover: (index: number | null) => void;
    onClick: (index: number) => void;
    occlusionDistance: number | null;
};

export function ProfileChart({ profile, onHover, onClick, occlusionDistance }: ProfileChartProps) {
    const [localHoveredIndex, setLocalHoveredIndex] = useState<number | null>(null);

    const handleHover = (index: number | null) => {
        setLocalHoveredIndex(index);
        onHover(index);
    };
    if (!profile) {
        return (
            <div className="w-full h-full bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-lg flex items-center justify-center">
                <p className="text-gray-300 font-medium text-sm">地図をクリックしてターゲット地点を選択</p>
            </div>
        );
    }

    const { distances_m, elev_m } = profile;

    // Filter out null values for calculations
    const validElevations = elev_m.filter((e): e is number => e !== null);

    if (validElevations.length === 0) {
        return (
            <div className="w-full h-full bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-lg flex items-center justify-center">
                <p className="text-red-400 font-semibold text-sm">データなし</p>
            </div>
        );
    }

    const minElev = Math.min(...validElevations);
    const maxElev = Math.max(...validElevations);
    const totalDistance = distances_m[distances_m.length - 1];

    // Chart dimensions
    const width = 800;
    const height = 260;
    const padding = { top: 20, right: 40, bottom: 40, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Scale functions
    const xScale = (distance: number) => (distance / totalDistance) * chartWidth;
    const yScale = (elevation: number) =>
        chartHeight - ((elevation - minElev) / (maxElev - minElev)) * chartHeight;

    // Generate path
    const pathSegments: string[] = [];
    let currentPath = '';

    for (let i = 0; i < distances_m.length; i++) {
        const elev = elev_m[i];
        if (elev === null) {
            if (currentPath) {
                pathSegments.push(currentPath);
                currentPath = '';
            }
            continue;
        }

        const x = xScale(distances_m[i]);
        const y = yScale(elev);

        if (!currentPath) {
            currentPath = `M ${x} ${y}`;
        } else {
            currentPath += ` L ${x} ${y}`;
        }
    }

    if (currentPath) {
        pathSegments.push(currentPath);
    }

    return (
        <div className="w-full h-full bg-black/60 backdrop-blur-md border border-white/10 rounded-xl shadow-lg p-3">
            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full h-full"
                preserveAspectRatio="xMidYMid meet"
            >
                    {/* Grid lines */}
                    <g className="grid" stroke="rgba(255,255,255,0.1)" strokeWidth="1">
                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                            <line
                                key={`grid-y-${ratio}`}
                                x1={padding.left}
                                y1={padding.top + chartHeight * ratio}
                                x2={padding.left + chartWidth}
                                y2={padding.top + chartHeight * ratio}
                            />
                        ))}
                    </g>

                    {/* Axes */}
                    <g className="axes" stroke="rgba(255,255,255,0.3)" strokeWidth="2" fill="none">
                        <line
                            x1={padding.left}
                            y1={padding.top}
                            x2={padding.left}
                            y2={padding.top + chartHeight}
                        />
                        <line
                            x1={padding.left}
                            y1={padding.top + chartHeight}
                            x2={padding.left + chartWidth}
                            y2={padding.top + chartHeight}
                        />
                    </g>

                    {/* Y-axis labels */}
                    <g className="y-labels" fill="rgba(255,255,255,0.7)" fontSize="12">
                        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                            const elev = minElev + (maxElev - minElev) * (1 - ratio);
                            return (
                                <text
                                    key={`y-label-${ratio}`}
                                    x={padding.left - 10}
                                    y={padding.top + chartHeight * ratio}
                                    textAnchor="end"
                                    dominantBaseline="middle"
                                >
                                    {elev.toFixed(0)}m
                                </text>
                            );
                        })}
                    </g>

                    {/* X-axis labels */}
                    <g className="x-labels" fill="rgba(255,255,255,0.7)" fontSize="12">
                        {[0, 0.5, 1].map((ratio) => {
                            const dist = (totalDistance / 1000) * ratio;
                            return (
                                <text
                                    key={`x-label-${ratio}`}
                                    x={padding.left + chartWidth * ratio}
                                    y={padding.top + chartHeight + 25}
                                    textAnchor="middle"
                                >
                                    {dist.toFixed(1)}km
                                </text>
                            );
                        })}
                    </g>

                    {/* Profile line */}
                    <g transform={`translate(${padding.left}, ${padding.top})`}>
                        {pathSegments.map((path, i) => (
                            <path
                                key={i}
                                d={path}
                                fill="none"
                                stroke="#60a5fa" // blue-400
                                strokeWidth="2"
                            />
                        ))}

                        {/* Full-width interaction layer - tracks mouse across entire chart */}
                        <rect
                            x={0}
                            y={0}
                            width={chartWidth}
                            height={chartHeight}
                            fill="transparent"
                            cursor="crosshair"
                            onMouseMove={(e) => {
                                const svg = e.currentTarget.ownerSVGElement;
                                if (!svg) return;

                                const rect = svg.getBoundingClientRect();

                                // ✅ CSS px -> viewBox units conversion
                                const scaleX = width / rect.width;
                                const svgX = (e.clientX - rect.left) * scaleX;

                                // Group coordinate system (inside translate(padding.left, padding.top))
                                const mouseX = svgX - padding.left;

                                const clampedMouseX = Math.max(0, Math.min(mouseX, chartWidth));

                                // Find the data point whose x position is closest to the mouse X
                                let nearestIndex = 0;
                                let minDiff = Math.abs(xScale(distances_m[0]) - clampedMouseX);

                                for (let i = 1; i < distances_m.length; i++) {
                                    const dataPointX = xScale(distances_m[i]);
                                    const diff = Math.abs(dataPointX - clampedMouseX);
                                    if (diff < minDiff) {
                                        minDiff = diff;
                                        nearestIndex = i;
                                    }
                                }

                                // ✅ Clear hover when over null region
                                if (elev_m[nearestIndex] !== null) {
                                    handleHover(nearestIndex);
                                } else {
                                    handleHover(null);
                                }
                            }}
                            onMouseLeave={() => handleHover(null)}
                            onClick={() => {
                                if (localHoveredIndex !== null) {
                                    onClick(localHoveredIndex);
                                }
                            }}
                        />

                        {/* Hover visualization - vertical line, dot, and tooltip */}
                        {localHoveredIndex !== null && elev_m[localHoveredIndex] !== null && (
                            <>
                                {/* Vertical line */}
                                <line
                                    x1={xScale(distances_m[localHoveredIndex])}
                                    y1={-padding.top}
                                    x2={xScale(distances_m[localHoveredIndex])}
                                    y2={chartHeight + padding.bottom}
                                    stroke="#ef4444"
                                    strokeWidth="1"
                                    strokeDasharray="4 2"
                                    pointerEvents="none"
                                />
                                {/* Highlight dot */}
                                <circle
                                    cx={xScale(distances_m[localHoveredIndex])}
                                    cy={yScale(elev_m[localHoveredIndex]!)}
                                    r={5}
                                    fill="#ef4444"
                                    stroke="white"
                                    strokeWidth="2"
                                    pointerEvents="none"
                                />
                                {/* Tooltip with elevation and distance */}
                                {(() => {
                                    const hx = xScale(distances_m[localHoveredIndex]);
                                    const hy = yScale(elev_m[localHoveredIndex]!);

                                    const tooltipW = 80;
                                    const tooltipH = 30;

                                    // ✅ Clamp tooltip position to prevent cutoff at edges
                                    const tooltipX = Math.max(0, Math.min(hx - tooltipW / 2, chartWidth - tooltipW));
                                    const tooltipY = Math.max(0, Math.min(hy - 40, chartHeight - tooltipH));

                                    return (
                                        <g pointerEvents="none">
                                            <rect
                                                x={tooltipX}
                                                y={tooltipY}
                                                width={tooltipW}
                                                height={tooltipH}
                                                fill="rgba(30,30,30,0.9)"
                                                stroke="rgba(255,255,255,0.2)"
                                                strokeWidth="1"
                                                rx="4"
                                                opacity="1"
                                            />
                                            <text
                                                x={tooltipX + tooltipW / 2}
                                                y={tooltipY + 12}
                                                textAnchor="middle"
                                                fontSize="11"
                                                fill="white"
                                                fontWeight="600"
                                            >
                                                {elev_m[localHoveredIndex]!.toFixed(1)}m
                                            </text>
                                            <text
                                                x={tooltipX + tooltipW / 2}
                                                y={tooltipY + 24}
                                                textAnchor="middle"
                                                fontSize="9"
                                                fill="#9ca3af" // gray-400
                                            >
                                                {(distances_m[localHoveredIndex] / 1000).toFixed(2)}km
                                            </text>
                                        </g>
                                    );
                                })()}
                            </>
                        )}

                        {/* Occlusion point marker (amber/orange) */}
                        {occlusionDistance !== null && profile && (() => {
                            // Find the index closest to the occlusion distance
                            let nearestIndex = 0;
                            let minDiff = Math.abs(distances_m[0] - occlusionDistance);

                            for (let i = 1; i < distances_m.length; i++) {
                                const diff = Math.abs(distances_m[i] - occlusionDistance);
                                if (diff < minDiff) {
                                    minDiff = diff;
                                    nearestIndex = i;
                                }
                            }

                            const occlusionElev = elev_m[nearestIndex];
                            if (occlusionElev === null) return null;

                            return (
                                <>
                                    {/* Vertical line at occlusion point */}
                                    <line
                                        x1={xScale(occlusionDistance)}
                                        y1={-padding.top}
                                        x2={xScale(occlusionDistance)}
                                        y2={chartHeight + padding.bottom}
                                        stroke="#f59e0b"
                                        strokeWidth="2"
                                        strokeDasharray="4 2"
                                        pointerEvents="none"
                                    />
                                    {/* Large occlusion marker */}
                                    <circle
                                        cx={xScale(occlusionDistance)}
                                        cy={yScale(occlusionElev)}
                                        r={7}
                                        fill="#f59e0b"
                                        stroke="white"
                                        strokeWidth="2"
                                        pointerEvents="none"
                                    />
                                    {/* Label for occlusion point */}
                                    <g pointerEvents="none">
                                        <rect
                                            x={xScale(occlusionDistance) - 50}
                                            y={yScale(occlusionElev) - 50}
                                            width="100"
                                            height="35"
                                            fill="#f59e0b"
                                            stroke="white"
                                            strokeWidth="2"
                                            rx="4"
                                            opacity="0.95"
                                        />
                                        <text
                                            x={xScale(occlusionDistance)}
                                            y={yScale(occlusionElev) - 34}
                                            textAnchor="middle"
                                            fontSize="10"
                                            fill="white"
                                            fontWeight="700"
                                        >
                                            ⚠ OCCLUSION
                                        </text>
                                        <text
                                            x={xScale(occlusionDistance)}
                                            y={yScale(occlusionElev) - 22}
                                            textAnchor="middle"
                                            fontSize="11"
                                            fill="white"
                                            fontWeight="600"
                                        >
                                            {occlusionElev.toFixed(1)}m
                                        </text>
                                    </g>
                                </>
                            );
                        })()}
                    </g>
            </svg>
        </div>
    );
}
