import type { ProxyConfiguration } from './action.js';
import type { ZodCheckpoint, ZodMetadata, ZodModel } from './types.js';
import type { UncontrolledFetchOptions } from './uncontrolledFetch.js';
import type { GetPublicConnection, MaybePromise, MergingStrategy, OnEventType } from '@nangohq/types';
import type * as z from 'zod';

type InferZod<T> = T extends z.ZodTypeAny ? z.infer<T> : never;

// Concurrency
declare const concurrencyBrand: unique symbol;
export interface Concurrency {
    readonly [concurrencyBrand]: true;
    readonly value: number | 'max';
}
export const concurrency = {
    max: (): Concurrency => ({ value: 'max' }) as unknown as Concurrency
};

// Debounce
export type DebounceKeySource = { body: string } | { header: string };
export interface DebounceOptions {
    keyBy?: DebounceKeySource | DebounceKeySource[];
    windowMs: number;
    maxWindowMs?: number;
    maxEntities?: number;
    payloadMode?: 'latest' | 'all';
}

// Triggers
export type TriggerDefinition =
    | { kind: 'schedule'; frequency: string; autoStart?: boolean }
    | { kind: 'http'; input?: z.ZodTypeAny; subscriptions?: string[]; debounce?: DebounceOptions }
    | { kind: 'event'; events: OnEventType[] }
    | { kind: 'invoke'; input: z.ZodTypeAny };

export interface HttpRequest {
    path: string;
    headers: Record<string, string>;
    query: Record<string, string>;
    body: unknown;
}
export interface CoalescedInfo {
    count: number;
    firstSeenAt: Date;
    lastSeenAt: Date;
    overflowed: boolean;
}

type TriggerInput<TTrigger> = TTrigger extends { input: infer I extends z.ZodTypeAny } ? I : z.ZodVoid;

export type TriggerDefinitions = TriggerDefinition | readonly TriggerDefinition[];
type TriggerMember<T> = T extends readonly (infer E extends TriggerDefinition)[] ? E : T extends TriggerDefinition ? T : never;

// Single trigger resolves to one shape
// Multiple triggers resolve to a union
type TriggerOf<TT extends TriggerDefinition> = TT extends { kind: 'schedule' }
    ? { kind: 'schedule'; payload: null }
    : TT extends { kind: 'invoke' }
      ? { kind: 'invoke'; payload: z.infer<TriggerInput<TT>> }
      : TT extends { kind: 'http' }
        ? { kind: 'http'; payload: z.infer<TriggerInput<TT>>; request: HttpRequest; subscriptions?: string[]; coalesced: CoalescedInfo }
        : TT extends { kind: 'event' }
          ? { kind: 'event'; payload: { event: OnEventType } }
          : never;
export type Trigger<T extends TriggerDefinitions> = TriggerOf<TriggerMember<T>>;

// Capability-narrowed nango
export interface NangoBase {
    log(message: string, meta?: unknown): Promise<void>;
    getConnection(): Promise<GetPublicConnection['Success']>;
}
export interface ProxyCapability {
    proxy<T = unknown>(config: ProxyConfiguration): Promise<T>;
    get<T = unknown>(config: Omit<ProxyConfiguration, 'method'>): Promise<T>;
    post<T = unknown>(config: Omit<ProxyConfiguration, 'method'>): Promise<T>;
    put<T = unknown>(config: Omit<ProxyConfiguration, 'method'>): Promise<T>;
    patch<T = unknown>(config: Omit<ProxyConfiguration, 'method'>): Promise<T>;
    delete<T = unknown>(config: Omit<ProxyConfiguration, 'method'>): Promise<T>;
    paginate<T = unknown>(config: ProxyConfiguration): AsyncGenerator<T[]>;
    uncontrolledFetch(options: UncontrolledFetchOptions): Promise<Response>;
}
export interface RecordCapability<TModels extends Record<string, ZodModel>> {
    batchSave<K extends keyof TModels>(records: z.infer<TModels[K]>[], model: K): Promise<void>;
    batchUpdate<K extends keyof TModels>(records: z.infer<TModels[K]>[], model: K): Promise<void>;
    batchDelete<K extends keyof TModels>(records: z.infer<TModels[K]>[], model: K): Promise<void>;
    getRecordsByIds<K extends keyof TModels, TKey extends string | number = string>(ids: TKey[], model: K): Promise<Map<TKey, z.infer<TModels[K]>>>;
    listRecords<K extends keyof TModels>(model: K, options?: { cursor?: string }): AsyncGenerator<z.infer<TModels[K]>>;
    setMergingStrategy(merging: MergingStrategy, model: keyof TModels): Promise<void>;
    trackDeletesStart(model: keyof TModels): Promise<void>;
    trackDeletesEnd(model: keyof TModels): Promise<void>;
}
export interface CheckpointCapability<TValue> {
    getCheckpoint(): Promise<TValue | undefined>;
    saveCheckpoint(checkpoint: TValue): Promise<void>;
    clearCheckpoint(): Promise<void>;
}
export interface MetadataCapability<TValue> {
    getMetadata(): Promise<TValue>;
    setMetadata(metadata: TValue): Promise<void>;
    updateMetadata(metadata: Partial<TValue>): Promise<void>;
}
type InferInput<T> =
    T extends CreateFunctionResponse<infer _M, infer _O, infer _Me, infer _Cp, infer Tr, infer _Ac>
        ? Extract<TriggerMember<Tr>, { kind: 'invoke' }> extends { input: infer I extends z.ZodTypeAny }
            ? z.infer<I>
            : never
        : never;
type InferOutput<T> = T extends CreateFunctionResponse<infer _M, infer O extends z.ZodTypeAny, infer _Me, infer _Cp, infer _Tr, infer _Ac> ? z.infer<O> : never;
export interface InvokeCapability {
    invoke<T extends { type: 'function' }>(fn: T, input: InferInput<T>): Promise<InferOutput<T>>;
}

export type Nango<
    TModels extends Record<string, ZodModel>,
    TMetadata extends ZodMetadata,
    TCheckpoint extends ZodCheckpoint,
    TAccess extends AccessOptions
> = NangoBase &
    (TAccess extends { proxy: false } ? unknown : ProxyCapability) &
    (TAccess extends { invoke: true } ? InvokeCapability : unknown) &
    ([keyof TModels] extends [never] ? unknown : RecordCapability<TModels>) &
    (TCheckpoint extends undefined ? unknown : CheckpointCapability<InferZod<TCheckpoint>>) &
    (TMetadata extends undefined ? unknown : MetadataCapability<InferZod<TMetadata>>);

// Function
export interface AccessOptions {
    proxy?: boolean;
    invoke?: boolean;
}
export interface FunctionCapabilities {
    useRecords: boolean;
    useCheckpoints: boolean;
    useMetadata: boolean;
    useProxy: boolean;
    useInvoke: boolean;
}
export interface CreateFunctionProps<
    TModels extends Record<string, ZodModel> = Record<never, ZodModel>,
    TOutput extends z.ZodTypeAny = z.ZodVoid,
    TMetadata extends ZodMetadata = undefined,
    TCheckpoint extends ZodCheckpoint = undefined,
    TTrigger extends TriggerDefinitions = TriggerDefinition,
    TAccess extends AccessOptions = { proxy: true }
> {
    description: string;
    version?: string;
    scopes?: string[];
    output?: TOutput;
    data?: {
        models?: TModels;
        metadata?: TMetadata;
        checkpoint?: TCheckpoint;
    };
    trigger: TTrigger;
    access?: TAccess;
    maxConcurrency?: [keyof TModels] extends [never] ? Concurrency : 1;
    exec: (nango: Nango<TModels, TMetadata, TCheckpoint, TAccess>, trigger: Trigger<TTrigger>) => MaybePromise<z.infer<TOutput>>;
}
export interface CreateFunctionResponse<
    TModels extends Record<string, ZodModel> = Record<never, ZodModel>,
    TOutput extends z.ZodTypeAny = z.ZodVoid,
    TMetadata extends ZodMetadata = undefined,
    TCheckpoint extends ZodCheckpoint = undefined,
    TTrigger extends TriggerDefinitions = TriggerDefinition,
    TAccess extends AccessOptions = { proxy: true }
> extends CreateFunctionProps<TModels, TOutput, TMetadata, TCheckpoint, TTrigger, TAccess> {
    type: 'function';
    capabilities: FunctionCapabilities;
}

export function createFunction<
    TModels extends Record<string, ZodModel> = Record<never, ZodModel>,
    TOutput extends z.ZodTypeAny = z.ZodVoid,
    TMetadata extends ZodMetadata = undefined,
    TCheckpoint extends ZodCheckpoint = undefined,
    TTrigger extends TriggerDefinitions = TriggerDefinition,
    TAccess extends AccessOptions = { proxy: true }
>(
    params: CreateFunctionProps<TModels, TOutput, TMetadata, TCheckpoint, TTrigger, TAccess>
): CreateFunctionResponse<TModels, TOutput, TMetadata, TCheckpoint, TTrigger, TAccess> {
    const models = params.data?.models;
    const capabilities: FunctionCapabilities = {
        useRecords: !!models && Object.keys(models).length > 0,
        useCheckpoints: !!params.data?.checkpoint,
        useMetadata: !!params.data?.metadata,
        useProxy: params.access?.proxy !== false,
        useInvoke: params.access?.invoke === true
    };
    return { type: 'function', ...params, capabilities };
}
