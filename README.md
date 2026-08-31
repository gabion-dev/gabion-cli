# gabion-cli

Thin CLI for the Gabion development framework. Handles authentication,
runtime download from AWS, and delegates all other commands to the full
runtime CLI installed at `~/.gabion/`.

## Requirements

- Node.js 18+
- Java 21+ (or let `gabion install` download a portable JDK)
- Git (optional — enables module modification tracking; projects work without it)

## Quick Start

```bash
npm install -g gabion
gabion auth <token>
gabion install
gabion init my-project
cd my-project
gabion dev
```

## Commands

### General

|       Command     |           Description        |
|-------------------|------------------------------|
| `gabion --version`| Show CLI and runtime version |
| `gabion --help`   | Show available commands      |

### Setup (handled by thin CLI)

|         Command       |                   Description               |
|-----------------------|---------------------------------------------|
| `gabion auth <token>` | Save and verify an access token             |
| `gabion auth --status`| Show current authentication status          |
| `gabion auth --revoke`| Remove saved token                          |
| `gabion install`      | Download and install the Gabion runtime     |
| `gabion uninstall`    | Remove the Gabion runtime from this machine |
| `gabion self-update`  | Check for and install runtime updates       |
| `gabion doctor`       | Check prerequisites and installation        |

### Development (delegated to full runtime CLI)

|           Command         |                     Description                    |
|---------------------------|----------------------------------------------------|
| `gabion dev`              | Start the development instance                     |
| `gabion check`            | Gate before a production build (see below)         |
| `gabion init <name>`      | Create a new project                               |
| `gabion stop`             | Stop the running instance                          |
| `gabion restart`          | Restart the current instance                       |
| `gabion instances`        | List all registered instances                      |
| `gabion uninstance <name>`| Force-stop an instance by name                     |
| `gabion gateway status`   | Show gateway health, name resolution and instances |
| `gabion gateway start`    | Start the machine-global gateway                   |
| `gabion gateway stop`     | Stop the machine-global gateway                    |

`gabion check` asks the running development instance whether its verdict
covers the current state of the tree and whether anything blocks. It never
re-computes a verdict — the checker network lives on the instance. Exit
codes: `0` — clean, `1` — blocking findings exist, `2` — the check could
not be performed (no project, no running instance, a confirmed hole in the
checker network, or checks still running). A project's `make build` runs
it before packaging the production JAR.

### Module Management (delegated to full runtime CLI)

|                 Command              |                    Description                |
|--------------------------------------|-----------------------------------------------|
| `gabion module install <name>`       | Install a module from template or platform    |
| `gabion module remove <name>`        | Remove an installed module                    |
| `gabion module restore <name>`       | Restore a standard module from template       |
| `gabion module replace <old> <new>`  | Atomically replace one module with another    |
| `gabion module export <mod> --to <p>`| Export module files for a public repository   |
| `gabion module status`               | Show modification status of installed modules |
| `gabion module package <mod> <ver>`  | Build a distributable module archive          |
| `gabion module list`                 | List installed modules and contracts          |

### Checker Rules (delegated to full runtime CLI)

Rule bundles extend the framework's checker network with organization
policies: custom ESLint rules, Gitleaks patterns, Stylelint rules, and
other checker layers, distributed as verified bundles and pinned per
project.

|             Command          |                       Description                     |
|------------------------------|-------------------------------------------------------|
| `gabion rules init [dir]`    | Create a rule bundle authoring directory              |
| `gabion rules export <dir>`  | Build a distributable `.gabion-rules` bundle          |
| `gabion rules import <file>` | Install a bundle into the machine pool                |
| `gabion rules list`          | List installed bundles                                |
| `gabion rules remove <id>`   | Remove a bundle from the machine pool (`id[@version]`)|
| `gabion rules require <file>`| Pin a bundle in `gabion.manifest.json`                |
| `gabion rules unrequire <id>`| Remove a bundle pin from the manifest                 |

### Starter Management (delegated to full runtime CLI)

|               Command             |                 Description           |
|-----------------------------------|---------------------------------------|
| `gabion starter replace <name>`   | Replace the visual starter            |
| `gabion starter package <version>`| Build a distributable starter archive |

### Solution Management (delegated to full runtime CLI)

|              Command             |                    Description                 |
|----------------------------------|------------------------------------------------|
| `gabion solution install <name>` | Install a solution from platform or local path |
| `gabion solution remove <name>`  | Remove a solution and restore replaced modules |
| `gabion solution package <ver>`  | Build a distributable solution archive         |
| `gabion solution export --to <p>`| Export solution files for a public repository  |
| `gabion solution list`           | List installed solutions                       |

### Documentation Layer (delegated to full runtime CLI)

Every project carries a two-layer documentation structure: `AGENTS.md`
(entry point), `ai-context/` (the project's principles and reasons),
`work-context/` (the active spec and session records). The runtime
generates the structure and enforces its structural integrity — every
reference resolves or is declared absent in place; content and
completeness are never judged.

|         Command       |                        Description                    |
|-----------------------|-------------------------------------------------------|
| `gabion context init` | Create the documentation layer in an existing project |
| `gabion context check`| Verify every documentation reference resolves         |

## How It Works

1. `gabion auth` verifies your token against `api.gabion.dev` and saves it to `~/.gabion/auth.json`.
2. `gabion install` requests a signed download URL, fetches the runtime archive, verifies its SHA-256 checksum, unpacks it into `~/.gabion/`, installs dependencies, downloads engines, and builds JARs. A project template is cached at `~/.gabion/template/` for `gabion init`.
3. `gabion init` creates a new project from the cached template with all standard modules pre-installed and an initial git commit tagged `gabion/init` (skipped with a hint when Git is not installed). It also generates the project documentation layer (`AGENTS.md`, `ai-context/`, `work-context/`) and verifies it with the documentation checker before the initial commit.
4. `gabion module` commands manage modules within a project: `install` resolves the module from the vendored template or downloads it from the platform (S3 via signed URL), validates the contract dependency graph, copies files into the six connection points, updates `gabion.manifest.json`, and creates a git baseline tag. `remove` checks that no remaining module depends on the removed module's contracts. `restore` replaces modified files with the original template version. `replace` atomically swaps one module for another, validating the contract graph against the transitive state. `status` compares current files against baseline tags to show accumulated modifications.
5. `gabion rules` commands manage checker rule bundles. Authoring happens in a working directory created by `rules init`; `rules export` packages it into a hash-verified `.gabion-rules` file. On a consuming machine, `rules import` installs a bundle file into the machine pool at `~/.gabion/rules/`; `rules require` does the import and additionally pins the bundle in the project's `gabion.manifest.json` — a bundle in the pool does nothing until a project pins it. The running dev instance picks up pin changes live. The pool is content-verified on every resolve — bundles are never edited in place.
6. `gabion starter` manages the visual starter layer. The starter is a separate entity from modules — it provides layout, themes, CSS contract values, and UI fragments. Exactly one starter is always present; it cannot be removed, only replaced. `replace` swaps the current starter for another from the vendored template or the platform, updating templates, styles, and contract files. `package` builds a distributable starter archive from the active starter in the current project.
7. `gabion solution` commands manage multi-module solutions: `install` reads `gabion-solution.json`, plans each module via the Installation Planner (detecting conflicts and determining keep/replace/choose actions), and installs the full set as a unit including an optional starter. `remove` reverses the installation, restoring any replaced modules and the previous starter from the vendored template. `package` and `export` build distributable archives or populate public repository directories.
8. `gabion context` commands manage the project documentation layer. `context init` generates the two-layer structure for projects created before the layer existed (new projects get it from `gabion init`) and immediately verifies the result; creation is all-or-nothing and never overwrites existing files. `context check` enforces structural integrity: every reference resolves, references run one way (`work-context/` may point into `ai-context/`, never the reverse), and a reference to a deliberately absent document carries an in-place `<!-- absent: reason -->` declaration with a reason. Exit codes separate the outcomes: 0 clean, 1 problems found, 2 the check could not run.
9. All development commands (`dev`, `stop`, `restart`, `instances`, `uninstance`, `gateway`), module commands, rules commands, starter commands, solution commands, and context commands delegate to the full CLI at `~/.gabion/runtime/cli/gabion.ts`.

## File Layout

```
~/.gabion/
├── auth.json          Access token
├── version.json       Installed runtime version
├── runtime/           Framework sources and dependencies
├── .engines/          Engine binaries and sources
├── template/          Project template for gabion init
├── rules/             Machine pool of checker rule bundles
├── bin/gabion         Shell shim (add to PATH)
└── node_modules/      Symlink to runtime/node_modules/
```

## License

MIT