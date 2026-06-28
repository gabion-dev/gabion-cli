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

|              Command                  |                  Description               |
|---------------------------------------|--------------------------------------------|
| `gabion module install <name>`        | Install a module from template or platform |
| `gabion module remove <name>`         | Remove an installed module                 |
| `gabion module restore <name>`        | Restore a standard module from template    |
| `gabion module replace-starter <name>`| Replace the visual starter                 |
| `gabion module list`                  | List installed modules and contracts       |

## How It Works

1. `gabion auth` verifies your token against `api.gabion.dev` and saves it to `~/.gabion/auth.json`.
2. `gabion install` requests a signed download URL, fetches the runtime archive, verifies its SHA-256 checksum, unpacks it into `~/.gabion/`, installs dependencies, downloads engines, and builds JARs. A project template is cached at `~/.gabion/template/` for `gabion init`.
3. `gabion init` creates a new project from the cached template with all standard modules pre-installed.
4. `gabion module` commands manage modules within a project: `install` resolves the module from the vendored template or downloads it from the platform (S3 via signed URL), validates the contract dependency graph, copies files into the six connection points, and updates `gabion.manifest.json`. `remove` checks that no remaining module depends on the removed module's contracts. `restore` replaces modified files with the original template version.
5. All development commands (`dev`, `stop`, `restart`, `instances`, `uninstance`) and module commands delegate to the full CLI at `~/.gabion/runtime/cli/gabion.ts`.

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