# MCP OAuth browser relay test plan

## Before

Start authentication for a remote HTTP MCP server from the session MCP panel. Confirm that the authorization URL contains a localhost redirect and that the browser cannot return the code to the sandbox.

## After

1. Start authentication for the same server through a trusted workspace runtime and supply the console HTTPS callback URI.
2. Confirm the authorization URL contains that exact callback URI and no callback response parameters were present before authorization.
3. Complete authorization in the browser and confirm the callback page reports success.
4. Confirm the daemon reports `authenticationState=succeeded`, reconnects the server, and stores credentials only in the sandbox token storage.
5. Repeat with user denial, an invalid state, an expired flow, an HTTP redirect URI, and a redirect URI containing credentials. Confirm each fails without exposing the code, state, or token in responses or logs.
