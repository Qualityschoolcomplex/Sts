# Workspace

## Overview

pnpm workspace monorepo using TypeScript. The primary web artifact is `artifacts/school-sis`, a Quality School Complex Student Information System.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM available, though the SIS currently persists data in browser storage for the copied standalone workflow
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## School SIS Features

- Admin and staff login with editable usernames/passwords stored consistently so updated credentials work at login.
- Admin dashboard supports report template upload, report generation, report preview, report draft/submission, and user creation/editing.
- Staff dashboard supports saving student names, score sheet creation, score sheet A4 preview/print, report creation, report preview, drafts, and submissions.
- Student names saved by staff and names appearing on score sheets automatically populate the Student Name selector in report creation.
- Staff report access is locked until admin uploads a report template.
- Report tables omit Grade and use Position where requested; score sheets retain grade calculations while also showing Position.
- Key form/table areas include `data-selector` attributes for stable selectors.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `pnpm --filter @workspace/school-sis run dev` — run the SIS frontend locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
