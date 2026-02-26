# Implementation stack

Summary of what Rocket.Chat documents for app development and the concrete Bun-first stack for this project.

**Project preferences:** **Bun** (package manager, scripts, CLI) and **shadcn/ui** (frontend components) are the preferred choices. Do not use npm for install or build; use `bunx` for CLI tools and add UI components via shadcn.

---

## 1. Rocket.Chat requirements (official docs vs current reality)

Sources:
- [Apps-Engine CLI docs](https://developer.rocket.chat/docs/apps-engine-cli)
- [Create an App docs](https://developer.rocket.chat/docs/create-an-app)
- [Rocket.Chat package.json (develop)](https://github.com/RocketChat/Rocket.Chat/blob/develop/package.json)
- [Apps CLI repository](https://github.com/RocketChat/Rocket.Chat.Apps-cli)

| Requirement | Current interpretation |
|-------------|------------------------|
| **Runtime** | **Node.js**. Some docs still mention older minimum versions, but current Rocket.Chat server `develop` pins Node `22.16.0`. |
| **Language** | **TypeScript** app model using `@rocket.chat/apps-engine`. |
| **CLI contract** | **`rc-apps`** is the official scaffold/package/deploy path. Package is published on npm as `@rocket.chat/apps-cli`. |
| **Server execution** | App code executes inside Rocket.Chat runtime (sandboxed Apps-Engine runtime; Node VM and optional Deno runtime support on server side). |
| **Marketplace artifact** | Packaging/deploy remains `rc-apps package` -> zip artifact contract. |

Conclusion:
- We must stay compatible with Rocket.Chat runtime and `rc-apps` packaging contract.
- We can still run this project Bun-first for package management and scripts.

---

## 2. Project stack (Bun-first + shadcn)

| Layer | Choice | Notes |
|-------|--------|-------|
| **Package manager / scripts** | **Bun** | `bun install`, `bun add`, `bun run ...` |
| **CLI usage** | `bunx @rocket.chat/apps-cli` | Keeps day-to-day workflow npm-free while using official CLI |
| **Backend app code** | TypeScript + `@rocket.chat/apps-engine` | Slash commands, permissions (`view-logs`), app API, persistence |
| **External Component frontend** | React + Vite + Tailwind + **shadcn/ui** | Preferred component stack for logs viewer UI |
| **UI primitives** | Radix UI (via shadcn) + Lucide icons | Accessibility and predictable interactions |
| **Data/query layer** | TanStack Query (+ optional Zod) | React Query is implemented now; Zod is planned for stricter runtime schema validation |
| **Large list rendering** | `@tanstack/react-virtual` (or `react-window`) | Required for performant logs rendering |
| **Build/package** | TypeScript build + `rc-apps package` | Emit valid app structure (`app.json`, class file, compiled output) |
| **Lockfile** | `bun.lock` | Commit lockfile for deterministic installs |

When shadcn is used vs not used:
- Use shadcn for the External Component web UI.
- Do not force shadcn where Rocket.Chat Apps-Engine requires native UI Kit blocks/interactions.

---

## 3. Practical setup

1. Install Node (match Rocket.Chat target where possible; currently Node 22.x on `develop`).
2. Install Bun.
3. Use Bun-first commands:
   - `bun install`
   - `bunx @rocket.chat/apps-cli create` (if scaffolding from scratch)
   - `bun run build`
   - `bunx @rocket.chat/apps-cli package`
   - `bunx @rocket.chat/apps-cli deploy`
4. For frontend UI:
   - `bunx shadcn@latest init`
   - `bunx shadcn@latest add <component>`
   - Keep theme/tokens compatible with Rocket.Chat embedding constraints.

---

## 4. References

- [Apps-Engine CLI docs](https://developer.rocket.chat/docs/apps-engine-cli)
- [Create an App docs](https://developer.rocket.chat/docs/create-an-app)
- [Rocket.Chat package.json (develop)](https://github.com/RocketChat/Rocket.Chat/blob/develop/package.json)
- [Rocket.Chat Apps-Engine](https://github.com/RocketChat/Rocket.Chat.Apps-engine)
- [Rocket.Chat Apps CLI repo](https://github.com/RocketChat/Rocket.Chat.Apps-cli)
- [Rocket.Chat Apps CLI on npm](https://www.npmjs.com/package/@rocket.chat/apps-cli)
