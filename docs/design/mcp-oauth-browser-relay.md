# MCP OAuth browser callback relay

## Problem

The MCP OAuth provider historically uses `http://localhost:7777/oauth/callback`. In a remote sandbox, the authorization page opens in the user's browser, so that loopback address points at the user's computer instead of the sandbox.

## Contract

An authenticated daemon client may provide one HTTPS `redirectUri` when it starts a workspace MCP authentication. The URI is used only for that in-memory OAuth attempt and is not persisted to MCP settings.

The browser callback page sends the bounded authorization response through the existing authenticated WebShell transport to `POST /oauth/callback`. This process-global route relays the values to the existing loopback listener in the same sandbox. The listener remains the owner of state validation, PKCE exchange, token storage, reconnect, and the five-minute timeout.

The relay accepts exactly one of `code` or `error`, requires `state`, never returns those values, and has no configurable network target. The supplied redirect URI must be HTTPS, must not contain credentials or a fragment, and must not pre-populate OAuth response parameters.

## Ownership and failure behavior

The callback relay is process-global because the existing loopback listener and its port are process-global. Workspace selection remains enforced when authentication starts. A missing or expired listener returns a conflict; an invalid state is rejected by the loopback listener. Neither case mutates MCP configuration or token storage.

Rollback removes the remote override and relay route. Existing CLI OAuth continues to use the loopback default.
