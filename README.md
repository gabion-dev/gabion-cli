# gabion-cli

Thin CLI for the Gabion development framework. Handles authentication,
runtime download from AWS, and delegates all other commands to the full
runtime CLI installed at `~/.gabion/`.

## Requirements

- Node.js 18+
- Git
- Java 21+ (or let `gabion install` download a portable JDK)

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

|           Command         |           Description          |
|---------------------------|--------------------------------|
| `gabion dev`              | Start the development instance |
| `gabion init <name>`      | Create a new project           |
| `gabion stop`             | Stop the running instance      |
| `gabion restart`          | Restart the current instance   |
| `gabion instances`        | List all registered instances  |
| `gabion uninstance <name>`| Force-stop an instance by name |

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

### Starter Management (delegated to full runtime CLI)

|             Command            |          Description       |
|--------------------------------|----------------------------|
| `gabion starter replace <name>`| Replace the visual starter |

### Solution Management (delegated to full runtime CLI)

|              Command             |                    Description                 |
|----------------------------------|------------------------------------------------|
| `gabion solution install <name>` | Install a solution from platform or local path |
| `gabion solution remove <name>`  | Remove a solution and restore replaced modules |
| `gabion solution package <ver>`  | Build a distributable solution archive         |
| `gabion solution export --to <p>`| Export solution files for a public repository  |
| `gabion solution list`           | List installed solutions                       |

## How It Works

1. `gabion auth` verifies your token against `api.gabion.dev` and saves it to `~/.gabion/auth.json`.
2. `gabion install` requests a signed download URL, fetches the runtime archive, verifies its SHA-256 checksum, unpacks it into `~/.gabion/`, installs dependencies, downloads engines, and builds JARs. A project template is cached at `~/.gabion/template/` for `gabion init`.
3. `gabion init` creates a new project from the cached template with all standard modules pre-installed and an initial git commit tagged `gabion/init`.
4. `gabion module` commands manage modules within a project: `install` resolves the module from the vendored template or downloads it from the platform (S3 via signed URL), validates the contract dependency graph, copies files into the six connection points, updates `gabion.manifest.json`, and creates a git baseline tag. `remove` checks that no remaining module depends on the removed module's contracts. `restore` replaces modified files with the original template version. `replace` atomically swaps one module for another, validating the contract graph against the transitive state. `status` compares current files against baseline tags to show accumulated modifications.
5. `gabion starter` manages the visual starter layer. The starter is a separate entity from modules — it provides layout, themes, CSS contract values, and UI fragments. Exactly one starter is always present; it cannot be removed, only replaced. `replace` swaps the current starter for another, updating templates, styles, and contract files.
6. `gabion solution` commands manage multi-module solutions: `install` reads `gabion-solution.json`, plans each module via the Installation Planner (detecting conflicts and determining keep/replace/choose actions), and installs the full set as a unit including an optional starter. `remove` reverses the installation, restoring any replaced modules and the previous starter from the vendored template. `package` and `export` build distributable archives or populate public repository directories.
7. All development commands (`dev`, `stop`, `restart`, `instances`, `uninstance`), module commands, starter commands, and solution commands delegate to the full CLI at `~/.gabion/runtime/cli/gabion.ts`.

## File Layout

```
~/.gabion/
├── auth.json          Access token
├── version.json       Installed runtime version
├── runtime/           Framework sources and dependencies
├── .engines/          Engine binaries and sources
├── template/          Project template for gabion init
├── bin/gabion         Shell shim (add to PATH)
└── node_modules/      Symlink to runtime/node_modules/
```

## License

MIT