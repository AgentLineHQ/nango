import { Filter, Search } from 'lucide-react';
import { useState } from 'react';

import { DEFAULT_TOP_N, DIMENSION_LABELS, formatDimensionValue } from '../usageBreakdown';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/InputGroup';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useApiGetBillingUsageTopDimensionValues } from '@/hooks/usePlan';

import type { AnyBreakdownDimension } from '../usageBreakdown';
import type { UsageMetric } from '@nangohq/types';

interface UsageFilterControlProps {
    metric: UsageMetric;
    env: string;
    timeframe: { start: string; end: string };
    /** Dimensions the metric supports — any can be filtered on. */
    dimensions: readonly AnyBreakdownDimension[];
    /** Dimension to default the typeahead to (usually the active breakdown). */
    defaultDimension: AnyBreakdownDimension | null;
    /** Apply a filter: `(dimension, rawValue)`. */
    onApply: (dimension: AnyBreakdownDimension, value: string) => void;
}

/**
 * Standalone "Filter" control — a typeahead over a dimension's values so a panel
 * can be drilled into a value that isn't a visible breakdown slice (the long
 * tail collapsed into "Rest" never appears in the chart). The value list is the
 * top-N by usage from the server; free text + Enter commits anything below that
 * cap (validated server-side). The top-values request fires lazily, only while
 * the popover is open.
 *
 * NOTE (prototype): the value list is a bespoke popover so we can feel the
 * surface (standalone control vs. searchable legend) before committing. If we
 * keep this surface, the list should converge onto a creatable `ComboboxSelect`.
 */
export const UsageFilterControl: React.FC<UsageFilterControlProps> = ({ metric, env, timeframe, dimensions, defaultDimension, onApply }) => {
    const [open, setOpen] = useState(false);
    const [dim, setDim] = useState<AnyBreakdownDimension>(defaultDimension ?? dimensions[0]);
    const [search, setSearch] = useState('');

    // Lazy: only fetch the top values while the popover is open. Each value is
    // `{ id, label }` — `id` is the raw value we filter back on, `label` the
    // display string (server-resolved for environment_id, otherwise equal to id).
    const topQuery = useApiGetBillingUsageTopDimensionValues(env, metric, dim, timeframe, DEFAULT_TOP_N, { enabled: open });
    const values = topQuery.data?.data.values ?? [];

    const trimmed = search.trim();
    const q = trimmed.toLowerCase();
    const filtered = q ? values.filter((v) => v.label.toLowerCase().includes(q) || v.id.toLowerCase().includes(q)) : values;
    // Offer a free-text commit for anything not already an exact value (reaches the long tail hidden in "Rest").
    const showCreate = trimmed.length > 0 && !values.some((v) => v.id === trimmed);

    const apply = (value: string) => {
        onApply(dim, value);
        setSearch('');
        setOpen(false);
    };

    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (next) {
                    // Re-seed to the active breakdown dimension each time it opens.
                    setDim(defaultDimension ?? dimensions[0]);
                } else {
                    setSearch('');
                }
            }}
        >
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="flex items-center gap-1 text-text-muted text-body-small-regular hover:text-text-strong"
                    title="Filter this panel to a single value"
                >
                    <Filter className="size-3.5" />
                    Filter
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-72 flex-col gap-1.5 rounded-[4px] border-[0.5px] border-border-default bg-surface-overlay p-1.5">
                {dimensions.length > 1 && (
                    <Select
                        value={dim}
                        onValueChange={(v) => {
                            setDim(v as AnyBreakdownDimension);
                            setSearch('');
                        }}
                    >
                        <SelectTrigger size="sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {dimensions.map((d) => (
                                <SelectItem key={d} value={d}>
                                    {DIMENSION_LABELS[d]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                <InputGroup className="h-auto rounded-[4px] border-[0.5px] border-border-muted px-2.5 py-1.5">
                    <InputGroupAddon className="p-0 pr-2">
                        <Search className="size-4 text-text-muted" />
                    </InputGroupAddon>
                    <InputGroupInput
                        autoFocus
                        type="text"
                        placeholder={`Search ${DIMENSION_LABELS[dim].toLowerCase()}…`}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                // Enter commits the first visible match, otherwise the typed value.
                                if (filtered.length > 0) apply(filtered[0].id);
                                else if (trimmed) apply(trimmed);
                            }
                        }}
                        className="h-auto p-0 text-body-medium-regular"
                    />
                </InputGroup>

                <div className="max-h-60 overflow-y-auto" role="listbox">
                    {topQuery.isLoading ? (
                        <div className="px-2 py-3 text-center text-text-muted text-body-small-regular">Loading…</div>
                    ) : (
                        <>
                            {filtered.map((v) => (
                                <button
                                    key={v.id}
                                    type="button"
                                    role="option"
                                    onClick={() => apply(v.id)}
                                    className="flex w-full items-center rounded-[4px] px-2 py-1 text-left text-text-secondary hover:bg-state-hover hover:text-text-strong"
                                >
                                    <span className="truncate">{formatDimensionValue(dim, v.label)}</span>
                                </button>
                            ))}
                            {showCreate && (
                                <button
                                    type="button"
                                    onClick={() => apply(trimmed)}
                                    className="flex w-full items-center gap-1 rounded-[4px] px-2 py-1 text-left text-text-secondary hover:bg-state-hover hover:text-text-strong"
                                >
                                    <span className="shrink-0 text-text-muted">Filter to</span>
                                    <span className="truncate text-text-strong">&quot;{trimmed}&quot;</span>
                                </button>
                            )}
                            {filtered.length === 0 && !showCreate && (
                                <div className="px-2 py-3 text-center text-text-muted text-body-small-regular">
                                    {topQuery.isError ? 'Failed to load values' : 'No values'}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
};
