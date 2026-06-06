# Agent Notes

This repository contains the standalone Voxvey provider plugin for OpenClaw.

## Commands

- Install dependencies: `npm install`
- Run tests: `npm test`
- Build: `npm run build`
- Inspect after linking: `npx openclaw plugins inspect voxvey --runtime --json`

## Development

- Source lives in `src/`.
- Tests live in `test/`.
- Build output is generated in `dist/`.
- Keep OAuth and device-code behavior covered by mocked unit tests.
- Run `npm test` and `npm run build` before handing off changes.

## OpenClaw Integration

The plugin id and provider id are both `voxvey`. It registers a text-inference provider using OpenAI-compatible chat completions against:

```text
https://api.voxvey.com/v1
```

Supported auth methods:

- `oauth`: browser login with PKCE and pasted redirect URL
- `device-code`: browser device pairing using the issuer's standard OAuth device endpoint
