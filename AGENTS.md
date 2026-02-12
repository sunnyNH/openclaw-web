# Repository Guidelines

## Project Structure & Module Organization
- `src/main.ts` bootstraps the app and registers Pinia + Router.
- `src/views/**` contains route-level pages; use `*Page.vue` for feature pages.
- `src/components/layout` holds shell components; `src/components/common` holds reusable UI blocks.
- `src/stores` contains Pinia domain stores (auth, websocket, session, channel, config, etc.).
- `src/api` implements WebSocket/RPC integration and shared API types under `src/api/types`.
- `src/composables` and `src/utils` host reusable logic and pure helpers.
- `src/assets/styles/main.css` is global styling; `public/` is for static assets.

## Build, Test, and Development Commands
- `npm install`: install dependencies.
- `npm run dev`: start Vite dev server at `http://localhost:3000`.
- `npm run build`: run `vue-tsc -b` type check and produce production bundle in `dist/`.
- `npm run preview`: serve the built app locally for final verification.

## Coding Style & Naming Conventions
- Use Vue 3 Composition API with `<script setup lang="ts">`.
- Follow existing formatting: 2-space indentation, single quotes, trailing commas, and no semicolons.
- Prefer `@/` import alias for `src` paths.
- Naming conventions:
  - Components: `PascalCase.vue`.
  - Route pages: `*Page.vue` (for example, `SessionsPage.vue`).
  - Stores/composables/utils: concise lowercase or camelCase filenames (for example, `session.ts`, `useTheme.ts`).

## Testing Guidelines
- No automated test framework is configured yet.
- Required pre-merge checks:
  - `npm run build` passes without type or build errors.
  - Manual smoke test of affected flows (login, WebSocket connectivity, relevant pages) against a running Gateway (`ws://127.0.0.1:18789`).
- For non-trivial logic changes, include a test plan in the PR and prefer adding unit tests (Vitest) in subsequent iterations.

## Commit & Pull Request Guidelines
- Prefer Conventional Commit prefixes: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`.
- Keep each commit focused on one concern; avoid placeholder commit messages.
- PRs should include purpose, key changes, linked issue/task, validation steps, and screenshots/GIFs for UI changes.

## Security & Configuration Tips
- Never commit real gateway tokens, credentials, or other secrets.
- Keep runtime configuration in `.env.development` / `.env.production`; document new `VITE_` variables in `README.md`.
