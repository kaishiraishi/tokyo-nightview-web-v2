import type { ProfileResponse } from '../../types/profile';

type ProfileChartProps = {
    profile: ProfileResponse | null;
};

export function ProfileChart({ profile }: ProfileChartProps) {
    if (!profile) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <p className="text-gray-500">Click on the map to select a target point</p>
            </div>
        );
    }

    const { distances_m, elev_m } = profile;

    // Filter out null values for calculations
    const validElevations = elev_m.filter((e): e is number => e !== null);

    if (validElevations.length === 0) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
                <p className="text-red-500">No elevation data available for this route</p>
            </div>
        );
    }

    const minElev = Math.min(...validElevations);
    const maxElev = Math.max(...validElevations);
    const totalDistance = distances_m[distances_m.length - 1];

    // Chart dimensions
    const width = 800;
    const height = 200;
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
        <div className="w-full h-full bg-white p-4">
            <div className="mb-2">
                <h3 className="text-lg font-semibold">Elevation Profile</h3>
                <div className="text-sm text-gray-600">
                    Distance: {(totalDistance / 1000).toFixed(2)} km |
                    Max Elevation: {maxElev.toFixed(1)} m |
                    Min Elevation: {minElev.toFixed(1)} m
                </div>
            </div>

            <svg
                viewBox={`0 0 ${width} ${height}`}
                className="w-full"
                style={{ maxHeight: '300px' }}
            >
                {/* Grid lines */}
                <g className="grid" stroke="#e5e7eb" strokeWidth="1">
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
                <g className="axes" stroke="#374151" strokeWidth="2" fill="none">
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
                <g className="y-labels" fill="#374151" fontSize="12">
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
                <g className="x-labels" fill="#374151" fontSize="12">
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
                            stroke="#3b82f6"
                            strokeWidth="2"
                        />
                    ))}
                </g>
            </svg>
        </div>
    );
}
