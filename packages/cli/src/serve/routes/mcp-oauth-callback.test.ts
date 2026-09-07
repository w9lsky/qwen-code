/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  registerMcpOAuthCallbackRoutes,
  relayMcpOAuthCallbackToLocalListener,
} from './mcp-oauth-callback.js';

const passThrough: RequestHandler = (_req, _res, next) => next();

function makeApp(
  relay: (payload: {
    code?: string;
    state: string;
    error?: string;
    errorDescription?: string;
  }) => Promise<boolean>,
  mutate = vi.fn(() => passThrough),
) {
  const app = express();
  app.use(express.json());
  registerMcpOAuthCallbackRoutes(app, {
    mutate,
    safeBody: (req) => req.body as Record<string, unknown>,
    relay,
  });
  return { app, mutate };
}

describe('MCP OAuth callback relay', () => {
  it('relays a bounded authorization response without echoing it', async () => {
    const relay = vi.fn(async () => true);
    const { app, mutate } = makeApp(relay);
    const response = await request(app)
      .post('/oauth/callback')
      .send({ code: 'short-code', state: 'opaque-state' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mutate).toHaveBeenCalledWith({ strict: true });
    expect(relay).toHaveBeenCalledWith({
      code: 'short-code',
      state: 'opaque-state',
    });
    expect(JSON.stringify(response.body)).not.toContain('short-code');
  });

  it('relays provider errors so the pending flow can terminate', async () => {
    const relay = vi.fn(async () => true);
    const response = await request(makeApp(relay).app)
      .post('/oauth/callback')
      .send({
        state: 'opaque-state',
        error: 'access_denied',
        errorDescription: 'denied',
      });

    expect(response.status).toBe(200);
    expect(relay).toHaveBeenCalledWith({
      state: 'opaque-state',
      error: 'access_denied',
      errorDescription: 'denied',
    });
  });

  it('rejects missing, ambiguous, and oversized callback values', async () => {
    const relay = vi.fn(async () => true);
    for (const body of [
      { code: 'code' },
      { state: 'state', code: 'code', error: 'access_denied' },
      { state: 'state', code: 'x'.repeat(8_193) },
      { state: 'state', code: 'code', errorDescription: 'without-error' },
      { state: 'state', error: 'access_denied', errorDescription: 'bad\nline' },
    ]) {
      const response = await request(makeApp(relay).app)
        .post('/oauth/callback')
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('invalid_oauth_callback');
    }
    expect(relay).not.toHaveBeenCalled();
  });

  it('maps a missing listener and a rejected state without exposing details', async () => {
    const unavailable = await request(
      makeApp(vi.fn(async () => Promise.reject(new Error('private detail'))))
        .app,
    )
      .post('/oauth/callback')
      .send({ code: 'code', state: 'state' });
    expect(unavailable.status).toBe(409);
    expect(unavailable.body.code).toBe('mcp_oauth_callback_unavailable');
    expect(JSON.stringify(unavailable.body)).not.toContain('private detail');

    const rejected = await request(makeApp(vi.fn(async () => false)).app)
      .post('/oauth/callback')
      .send({ code: 'code', state: 'state' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('mcp_oauth_callback_rejected');
  });

  it('forwards only the local callback URL with encoded parameters', async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response('', { status: 200 }),
    );
    const accepted = await relayMcpOAuthCallbackToLocalListener(
      { code: 'a+b&c', state: 'opaque/state' },
      fetchImpl,
    );

    expect(accepted).toBe(true);
    const target = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(target.origin).toBe('http://127.0.0.1:7777');
    expect(target.pathname).toBe('/oauth/callback');
    expect(target.searchParams.get('code')).toBe('a+b&c');
    expect(target.searchParams.get('state')).toBe('opaque/state');
  });
});
