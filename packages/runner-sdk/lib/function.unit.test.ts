/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';

import { concurrency, createFunction } from './function.js';

import type { OnEventType } from '@nangohq/types';

type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;

describe('createFunction', () => {
    describe('schedule (sync)', () => {
        it('computes capabilities and exposes records + checkpoint + metadata + proxy', () => {
            const fn = createFunction({
                description: 'Fetch issues from GitHub',
                version: '1.0.0',
                data: {
                    models: { GithubIssue: z.object({ id: z.string(), title: z.string() }) },
                    checkpoint: z.object({ lastId: z.string() }),
                    metadata: z.object({ org: z.string() })
                },
                trigger: { kind: 'schedule', frequency: 'every 2h', autoStart: true },
                maxConcurrency: 1,
                exec: async (nango, trigger) => {
                    await nango.batchSave([{ id: '1', title: 't' }], 'GithubIssue');
                    await nango.batchUpdate([{ id: '1', title: 't' }], 'GithubIssue');
                    await nango.batchDelete([{ id: '1', title: 't' }], 'GithubIssue');
                    await nango.trackDeletesStart('GithubIssue');
                    await nango.trackDeletesEnd('GithubIssue');
                    const cp = await nango.getCheckpoint();
                    await nango.saveCheckpoint({ lastId: '1' });
                    await nango.getMetadata();

                    expectTypeOf<Has<typeof nango, 'proxy'>>().toEqualTypeOf<true>();
                    expectTypeOf(nango.batchSave).parameter(1).toEqualTypeOf<'GithubIssue'>();
                    expectTypeOf(cp).toEqualTypeOf<{ lastId: string } | undefined>();
                    expectTypeOf(nango.getMetadata()).toEqualTypeOf<Promise<{ org: string }>>();
                    expectTypeOf(trigger.kind).toEqualTypeOf<'schedule'>();
                    expectTypeOf(trigger.payload).toEqualTypeOf<null>();
                }
            });

            expect(fn.type).toBe('function');
            expect(fn.capabilities).toStrictEqual({
                useRecords: true,
                useCheckpoints: true,
                useMetadata: true,
                useProxy: true,
                useInvoke: false
            });
        });
    });

    describe('http with models (webhook)', () => {
        it('exposes record capability and types the http payload from the trigger input', () => {
            const fn = createFunction({
                description: 'Handle GitHub issue webhooks',
                data: { models: { GithubIssue: z.object({ id: z.string() }) } },
                trigger: { kind: 'http', input: z.object({ action: z.string() }), subscriptions: ['issues.opened'] },
                exec: async (nango, trigger) => {
                    await nango.batchSave([{ id: '1' }], 'GithubIssue');

                    expectTypeOf<Has<typeof nango, 'batchSave'>>().toEqualTypeOf<true>();
                    expectTypeOf(trigger.kind).toEqualTypeOf<'http'>();
                    expectTypeOf(trigger.payload).toEqualTypeOf<{ action: string }>();
                    expectTypeOf(trigger.request.headers).toEqualTypeOf<Record<string, string>>();
                }
            });

            expect(fn.capabilities).toStrictEqual({
                useRecords: true,
                useCheckpoints: false,
                useMetadata: false,
                useProxy: true,
                useInvoke: false
            });
        });
    });

    describe('http without models (action)', () => {
        it('has no record methods, types trigger input and output', () => {
            const fn = createFunction({
                description: 'Create a GitHub issue',
                output: z.object({ issueId: z.string() }),
                trigger: { kind: 'http', input: z.object({ title: z.string() }) },
                maxConcurrency: concurrency.max(),
                exec: (_nango, trigger) => {
                    expectTypeOf<Has<typeof _nango, 'proxy'>>().toEqualTypeOf<true>();
                    expectTypeOf<Has<typeof _nango, 'batchSave'>>().toEqualTypeOf<false>();
                    expectTypeOf(trigger.payload).toEqualTypeOf<{ title: string }>();
                    return { issueId: '123' };
                }
            });

            expect(fn.capabilities.useRecords).toBe(false);
            expect(fn.capabilities.useProxy).toBe(true);
        });
    });

    describe('event', () => {
        it('exposes the lifecycle event payload', () => {
            const fn = createFunction({
                description: 'Run before a connection is deleted',
                trigger: { kind: 'event', events: ['pre-connection-deletion'] },
                exec: async (nango, trigger) => {
                    await nango.log('executed');
                    expectTypeOf(trigger.kind).toEqualTypeOf<'event'>();
                    expectTypeOf(trigger.payload).toEqualTypeOf<{ event: OnEventType }>();
                }
            });

            expect(fn.capabilities.useRecords).toBe(false);
        });
    });

    describe('access', () => {
        it('exposes invoke and removes proxy when access disables it', () => {
            const child = createFunction({
                description: 'child',
                output: z.object({ n: z.number() }),
                trigger: { kind: 'invoke', input: z.object({ q: z.string() }) },
                exec: (_nango, trigger) => {
                    expectTypeOf(trigger.payload).toEqualTypeOf<{ q: string }>();
                    return { n: 1 };
                }
            });

            const fn = createFunction({
                description: 'dispatcher',
                access: { proxy: false, invoke: true },
                trigger: { kind: 'schedule', frequency: 'every hour' },
                exec: async (nango) => {
                    expectTypeOf<Has<typeof nango, 'invoke'>>().toEqualTypeOf<true>();
                    expectTypeOf<Has<typeof nango, 'proxy'>>().toEqualTypeOf<false>();
                    const res = await nango.invoke(child, { q: 'x' });
                    expectTypeOf(res).toEqualTypeOf<{ n: number }>();
                }
            });

            expect(fn.capabilities).toStrictEqual({
                useRecords: false,
                useCheckpoints: false,
                useMetadata: false,
                useProxy: false,
                useInvoke: true
            });
        });
    });

    describe('scheduled and invoked (multi-trigger)', () => {
        it('a single function can be both scheduled and invoked with a typed input', () => {
            const syncContacts = createFunction({
                description: 'Scheduled, or invoked with a contact id',
                output: z.object({ saved: z.boolean() }),
                data: { models: { Contact: z.object({ id: z.string() }) } },
                trigger: [
                    { kind: 'schedule', frequency: 'every hour' },
                    { kind: 'invoke', input: z.object({ contactId: z.string() }) }
                ],
                maxConcurrency: 1,
                exec: async (nango, trigger) => {
                    expectTypeOf(trigger.kind).toEqualTypeOf<'schedule' | 'invoke'>();
                    if (trigger.kind === 'invoke') {
                        expectTypeOf(trigger.payload).toEqualTypeOf<{ contactId: string }>();
                    }
                    if (trigger.kind === 'schedule') {
                        expectTypeOf(trigger.payload).toEqualTypeOf<null>();
                    }
                    await nango.batchSave([{ id: '1' }], 'Contact');
                    return { saved: true };
                }
            });

            const dispatcher = createFunction({
                description: 'Invoke the sync',
                access: { invoke: true },
                trigger: { kind: 'schedule', frequency: 'every hour' },
                exec: async (nango) => {
                    const res = await nango.invoke(syncContacts, { contactId: 'c1' });
                    expectTypeOf(res).toEqualTypeOf<{ saved: boolean }>();
                }
            });

            expect(syncContacts.capabilities.useRecords).toBe(true);
            expect(dispatcher.capabilities.useInvoke).toBe(true);
        });
    });

    describe('no models', () => {
        it('does not expose record/checkpoint/metadata methods', () => {
            createFunction({
                description: 'no models',
                trigger: { kind: 'schedule', frequency: 'every hour' },
                exec: (_nango) => {
                    expectTypeOf<Has<typeof _nango, 'batchSave'>>().toEqualTypeOf<false>();
                    expectTypeOf<Has<typeof _nango, 'getCheckpoint'>>().toEqualTypeOf<false>();
                    expectTypeOf<Has<typeof _nango, 'getMetadata'>>().toEqualTypeOf<false>();
                }
            });
        });
    });

    describe('maxConcurrency', () => {
        it('is fixed to 1 for record-writing functions and a Concurrency value otherwise', () => {
            createFunction({
                description: 'writes records',
                data: { models: { M: z.object({ id: z.string() }) } },
                trigger: { kind: 'schedule', frequency: 'every hour' },
                maxConcurrency: 1,
                exec: async (nango) => {
                    await nango.batchSave([{ id: '1' }], 'M');
                }
            });

            createFunction({
                description: 'no records',
                trigger: { kind: 'http', input: z.object({}) },
                maxConcurrency: concurrency.max(),
                exec: () => {}
            });

            createFunction({
                description: 'record function cannot exceed 1',
                data: { models: { M: z.object({ id: z.string() }) } },
                trigger: { kind: 'schedule', frequency: 'every hour' },
                // @ts-expect-error record-writing functions are pinned to maxConcurrency: 1
                maxConcurrency: concurrency.max(),
                exec: () => {}
            });
        });
    });

    describe('concurrency', () => {
        it('builds a max value', () => {
            expect(concurrency.max()).toStrictEqual({ value: 'max' });
        });
    });
});
