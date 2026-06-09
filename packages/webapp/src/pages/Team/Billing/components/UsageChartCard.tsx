import { X } from 'lucide-react';
import { parseAsString, useQueryState } from 'nuqs';
import { useMemo } from 'react';

import { BreakdownControls } from './BreakdownControls';
import { UsageFilterControl } from './UsageFilterControl';
import { BREAKDOWN_DIMENSIONS, DEFAULT_TOP_N, DIMENSION_LABELS, formatDimensionValue, metricsSupportingDimension } from '../usageBreakdown';
import { toChartSeries } from '../usageChartSeries';
import { useBreakdownEnabled } from '../useBreakdownEnabled';
import { ChartCard } from '@/components/patterns/chart';
import { KeyValueBadge } from '@/components/ui/KeyValueBadge';
import { useApiGetBillingUsageDetail } from '@/hooks/usePlan';

import type { AnyBreakdownDimension } from '../usageBreakdown';
import type { GlobalBreakdownSelection } from '../useGlobalBreakdown';
import type { ChartSeries } from '@/components/patterns/chart';
import type { ApiBillingUsageMetric, UsageMetric } from '@nangohq/types';

const NONE = 'none';

interface UsageChartCardProps {
    metric: UsageMetric;
    data?: ApiBillingUsageMetric;
    isLoading: boolean;
    env: string;
    timeframe: { start: string; end: string };
    /** Returns true if applying this panel's selection would change at least one other applicable panel. */
    isDivergingFromGlobal: (metric: UsageMetric, dimension: GlobalBreakdownSelection) => boolean;
    /** Apply this panel's selection to every applicable metric. */
    onApplyToAll: (dimension: GlobalBreakdownSelection) => void;
}

/**
 * Parse a `${metric}.filter` param value (`<dim>:<value>`) into its parts.
 * Splits on the FIRST ':' to mirror the backend so values containing ':' (e.g.
 * URLs) survive intact. Returns null for malformed input or a dim the metric
 * doesn't support (e.g. a stale deep-link after the dimension list changed).
 */
function parseFilterParam(raw: string, allowed: readonly AnyBreakdownDimension[]): { dimension: AnyBreakdownDimension; value: string } | null {
    const colon = raw.indexOf(':');
    if (colon < 1 || colon === raw.length - 1) return null;
    const dimension = raw.slice(0, colon) as AnyBreakdownDimension;
    const value = raw.slice(colon + 1);
    if (!allowed.includes(dimension)) return null;
    return { dimension, value };
}

/**
 * One billing usage panel: the base single-series chart, plus — when the breakdown
 * view is enabled — drill-in. Break a metric down by a dimension, click a slice (its
 * band, legend funnel, or the Filter typeahead) to filter the panel to that value,
 * then optionally re-break the filtered slice down by another dimension. Filter +
 * breakdown live in the URL (`${metric}.breakdown`, `${metric}.filter`) so the state
 * is deep-linkable and survives month changes. One filter + one breakdown per panel.
 */
export const UsageChartCard: React.FC<UsageChartCardProps> = ({ metric, data, isLoading, env, timeframe, isDivergingFromGlobal, onApplyToAll }) => {
    const showControls = useBreakdownEnabled();

    const dimensions = BREAKDOWN_DIMENSIONS[metric] as readonly AnyBreakdownDimension[];

    // Each panel owns its breakdown + filter explicitly via URL params.
    const [dimParam, setDimParam] = useQueryState(`${metric}.breakdown`, parseAsString.withDefault(NONE).withOptions({ history: 'replace' }));
    const [filterParam, setFilterParam] = useQueryState(`${metric}.filter`, parseAsString.withDefault('').withOptions({ history: 'replace' }));

    const rawDimension: AnyBreakdownDimension | null = dimensions.includes(dimParam as AnyBreakdownDimension) ? (dimParam as AnyBreakdownDimension) : null;
    const filter = showControls ? parseFilterParam(filterParam, dimensions) : null;

    // Filter and breakdown can't target the same dimension (the backend rejects it as a
    // degenerate single-value split). Defensive against a stale deep-link / an "Apply to
    // all" that lands the breakdown on the filtered dim: drop the breakdown on collision.
    const dimension = rawDimension && filter && rawDimension === filter.dimension ? null : rawDimension;

    const inBreakdownMode = showControls && dimension !== null;
    const inFilterMode = showControls && filter !== null;
    const isDetail = inBreakdownMode || inFilterMode;

    // One request covers every detail state (filtered and/or broken down). Fetched lazily.
    const detailQuery = useApiGetBillingUsageDetail(env, timeframe, metric, { dimension, filter }, DEFAULT_TOP_N, { enabled: isDetail });
    const detailMetric = detailQuery.data?.data.usage[metric];

    const breakdownEntries = detailMetric?.breakdown;
    const breakdownSeries = useMemo<ChartSeries[] | undefined>(() => {
        if (!inBreakdownMode || dimension === null) return undefined;
        return breakdownEntries ? toChartSeries(breakdownEntries, dimension) : [];
    }, [inBreakdownMode, dimension, breakdownEntries]);

    // Drill in: clicking a non-'rest' series filters the panel to that value and drops the
    // breakdown (one filter + one breakdown per panel — a second click replaces the filter).
    const onSeriesClick = (series: ChartSeries) => {
        if (series.isRest || series.value === undefined || dimension === null) return;
        void setFilterParam(`${dimension}:${series.value}`);
        void setDimParam(null);
    };

    // Clearing the filter "returns to the breakdown": keep the current breakdown if one is
    // active, otherwise restore it to the filter's dimension (the lens drilled in from).
    const clearFilter = () => {
        if (!filter) return;
        if (dimension === null) {
            void setDimParam(filter.dimension);
        }
        void setFilterParam(null);
    };

    // Apply a filter from the typeahead. Filtering by the dimension currently broken down is
    // the "drill into a Rest value" case — clear the breakdown to avoid the same-dim combo.
    const applyFilter = (dim: AnyBreakdownDimension, value: string) => {
        void setFilterParam(`${dim}:${value}`);
        if (rawDimension === dim) void setDimParam(null);
    };

    // The filtered dimension is excluded from the breakdown options (the backend rejects
    // filtering and breaking down by the same dim).
    const availableDimensions = filter ? dimensions.filter((d) => d !== filter.dimension) : dimensions;

    // "Apply to all" shows when at least one other applicable panel has a different selection.
    const canApplyToAll = (dimension === null || metricsSupportingDimension(dimension).length > 1) && isDivergingFromGlobal(metric, dimension);

    // Headline + chart source per state:
    // - filtered-only → swap in the filtered metric (single series + filtered total straight from the response).
    // - filter+breakdown → keep the base metric for label/view_mode but override the headline with the filtered total.
    const chartData: ApiBillingUsageMetric | undefined = inFilterMode && !inBreakdownMode ? (detailMetric ?? data) : data;
    const totalOverride = inBreakdownMode && inFilterMode ? detailMetric?.total : undefined;

    const headerActions = showControls ? (
        <>
            {filter && (
                <KeyValueBadge label={DIMENSION_LABELS[filter.dimension]} variant="lighter" className="flex items-center gap-1">
                    <span className="max-w-[160px] truncate">{formatDimensionValue(filter.dimension, filter.value)}</span>
                    <button
                        type="button"
                        onClick={clearFilter}
                        className="text-text-muted hover:text-text-strong"
                        aria-label="Clear filter"
                        title="Clear filter"
                    >
                        <X className="size-3" />
                    </button>
                </KeyValueBadge>
            )}
            <UsageFilterControl metric={metric} env={env} timeframe={timeframe} dimensions={dimensions} defaultDimension={dimension} onApply={applyFilter} />
            <BreakdownControls
                dimensions={availableDimensions}
                dimension={dimension}
                onChange={(d) => void setDimParam(d)}
                canApplyToAll={canApplyToAll}
                onApplyToAll={() => onApplyToAll(dimension)}
            />
        </>
    ) : undefined;

    return (
        <ChartCard
            data={chartData}
            isLoading={isLoading}
            timeframe={timeframe}
            headerActions={headerActions}
            breakdownSeries={breakdownSeries}
            detailLoading={isDetail ? detailQuery.isLoading : false}
            detailError={isDetail ? detailQuery.isError : false}
            totalOverride={totalOverride}
            onSeriesClick={showControls ? onSeriesClick : undefined}
            filtered={inFilterMode}
        />
    );
};
