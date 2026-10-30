[中文](README.md) · [English](README.en.md)

# Canvas

Standalone canvas frontend extracted from `glanderness/BeefTV` at commit `b3b6e2e380cb13cead3b7eb0d9c479a0f7125fad`, using React 19, TypeScript, Vite, Ant Design and Zustand.

The canvas implementation, built-in nodes, generation controls, assets, assistant, skills, workflows, storyboard, director, timeline, media tools and supporting routes are retained. Desktop updates, Wails bindings, native directory management and unrelated product portals are excluded. No backend runtimes are bundled.

Use Bun 1.3.11 or a compatible newer version:

```sh
bun install --frozen-lockfile
bun run dev
bun run test
bun run build
```

Open `http://127.0.0.1:3000/canvas`. The basic canvas runs without a backend: projects, media and model settings are persisted in browser IndexedDB. `dist/` is a static site; production needs an SPA fallback. `bun run start` previews those static files.

Smoke testing uses Node.js 20+ and installed Google Chrome: build first, then run `bun run test:browser`. It serves only static build files and verifies canvas creation, editing, persistence after reload and direct requests to a separate CORS model fixture, with no real model calls or workspace API fixtures.

Model catalogues and the underlying model transport request the configured provider directly, with no workspace relay. Providers must support browser CORS. The original generation queue, assistant execution and some advanced tools still use service APIs; the complete generation workflow has not yet been converted to browser execution. Optional tool services can be configured separately using `.env.example` or `window.__CANVAS_SERVICES__`. See [backend contracts](docs/backend-contract.md) and [extraction notes](docs/extraction.md).

Core extension points are `src/pages/canvas`, `src/components/canvas`, `src/lib/canvas`, `src/stores/canvas`, `src/services/api` and `src/services/canvas-host.ts`. All advanced media resources remain enabled. Dependency versions and checksums are retained, with registry URLs normalized to the official npm registry. The Vidstack patch is retained.

Original license and attribution files remain in `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md`.
