/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  OAUTH_REDIRECT_PATH,
  OAUTH_REDIRECT_PORT,
} from '@qwen-code/qwen-code-core';
import type { Application, Request, RequestHandler } from 'express';

const CALLBACK_TIMEOUT_MS = 5_000;
const CALLBACK_LIMITS = {
  code: 8_192,
  state: 4_096,
  error: 512,
  errorDescription: 2_048,
} as const;
const CONTROL_CHARACTERS = /[\0\r\n]/u;

export interface McpOAuthCallbackPayload {
  code?: string;
  state: string;
  error?: string;
  errorDescription?: string;
}

interface RegisterMcpOAuthCallbackRoutesDeps {
  mutate: (opts?: { strict?: boolean }) => RequestHandler;
  safeBody: (req: Request) => Record<string, unknown>;
  relay?: (payload: McpOAuthCallbackPayload) => Promise<boolean>;
}

function boundedValue(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARACTERS.test(value)
    ? value
    : undefined;
}

function parsePayload(
  body: Record<string, unknown>,
): McpOAuthCallbackPayload | undefined {
  const state = boundedValue(body['state'], CALLBACK_LIMITS.state);
  const code = boundedValue(body['code'], CALLBACK_LIMITS.code);
  const error = boundedValue(body['error'], CALLBACK_LIMITS.error);
  const errorDescription = boundedValue(
    body['errorDescription'],
    CALLBACK_LIMITS.errorDescription,
  );
  if (!state || Boolean(code) === Boolean(error)) return undefined;
  if (body['errorDescription'] !== undefined && !errorDescription) {
    return undefined;
  }
  if (errorDescription && !error) return undefined;
  return {
    state,
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
    ...(errorDescription ? { errorDescription } : {}),
  };
}

export async function relayMcpOAuthCallbackToLocalListener(
  payload: McpOAuthCallbackPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const callback = new URL(
    OAUTH_REDIRECT_PATH,
    `http://127.0.0.1:${OAUTH_REDIRECT_PORT}`,
  );
  callback.searchParams.set('state', payload.state);
  if (payload.code) callback.searchParams.set('code', payload.code);
  if (payload.error) callback.searchParams.set('error', payload.error);
  if (payload.errorDescription) {
    callback.searchParams.set('error_description', payload.errorDescription);
  }
  const response = await fetchImpl(callback, {
    redirect: 'manual',
    signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
  });
  await response.arrayBuffer();
  return response.ok;
}

export function registerMcpOAuthCallbackRoutes(
  app: Application,
  deps: RegisterMcpOAuthCallbackRoutesDeps,
): void {
  const relay = deps.relay ?? relayMcpOAuthCallbackToLocalListener;
  app.post(
    '/oauth/callback',
    deps.mutate({ strict: true }),
    async (req, res) => {
      const payload = parsePayload(deps.safeBody(req));
      if (!payload) {
        res.status(400).json({
          error: 'Invalid OAuth callback parameters',
          code: 'invalid_oauth_callback',
        });
        return;
      }
      try {
        if (!(await relay(payload))) {
          res.status(400).json({
            error: 'OAuth callback was rejected',
            code: 'mcp_oauth_callback_rejected',
          });
          return;
        }
        res.status(200).json({ ok: true });
      } catch {
        res.status(409).json({
          error: 'No pending MCP OAuth callback is available',
          code: 'mcp_oauth_callback_unavailable',
        });
      }
    },
  );
}
