# gabion-cli

Thin CLI for the Gabion development framework. Handles authentication,
runtime download from AWS, and delegates all other commands to the full
runtime CLI installed at `~/.gabion/`.

## Platforms

Linux, macOS, and Windows through WSL 2 (Windows Subsystem for Linux). Gabion
does not run on Windows itself: on Windows the CLI prepares WSL 2 and installs
Gabion inside a Linux distribution (see below).

## Requirements

- Node.js 18+ to run this CLI (the runtime brings its own Node.js release)
- Java 25+ (or let `gabion install` download a portable JDK)
- Git (optional — enables module modification tracking; projects work without it). Git must know your name and email (`git config --global user.name` / `user.email`); `gabion install` asks for them once when they are not set

## Quick Start

```bash
npm install -g gabion
gabion auth            # asks for your access token; what you paste shows masked
gabion install
gabion init my-project
cd my-project
gabion dev
```

### Windows

Install Node.js for Windows: on https://nodejs.org/en/download take
**Windows Installer (.msi)** and run it. Then open a new PowerShell window:

```powershell
npm install -g gabion
gabion auth
gabion install
```

`gabion auth` asks for the access token and does not show what you paste. It
never takes the token on the command line: there the token would stay on the
screen, in the shell's history file and in the process list. Scripts pipe it
in: `<command printing the token> | gabion auth --stdin`.

The token waits in Windows only until the first `gabion install` carries it
into the distribution; from then on it is kept there alone. `gabion auth`,
`gabion auth --status`, `--remove` and `--revoke` typed in PowerShell act on
that copy — the same file `gabion auth` changes when typed inside the
distribution — and `gabion install` run again takes the token from there.

`gabion install` reads the state of the machine and takes it the rest of the
way: it installs WSL 2 when it is absent (Windows asks for administrator
approval once, then needs a restart — run `gabion install` again after it),
installs Ubuntu when no distribution is registered, lets Ubuntu ask for your
Linux user name and password, and installs Gabion inside the distribution —
with a Node.js for your projects and the `gabion` command. Then open Ubuntu
from the Start menu and work there:

```bash
cd ~
gabion init my-project
```

Keep projects in your Linux home, not on a Windows drive (`/mnt/c/…`):
changes that Windows programs make there never reach the file watcher, so the
checks would silently stop running. `gabion init` and `gabion dev` refuse a
project on a Windows drive and print the commands that put it in your Linux
home instead.

If you already work inside WSL with your own Node.js (nvm), install the CLI
there as on Linux: `npm install -g gabion` in the distribution. Windows's npm
is also visible inside WSL through interop and installs into Windows — make
sure `node` resolves to a Linux binary first.

Windows PowerShell 5.1 with the `Restricted` execution policy (the default on
client editions) refuses the `npm` and `gabion` script shims (`npm.ps1`,
`gabion.ps1`); call `npm.cmd` and `gabion.cmd` instead, or run the commands in
`cmd`. WSL 1 is not supported: `wsl --set-version <distribution> 2` moves a
distribution to WSL 2.

## Commands

### General

|       Command     |           Description        |
|-------------------|------------------------------|
| `gabion --version`| Show CLI and runtime version |
| `gabion --help`   | Show available commands      |

### Setup (handled by thin CLI)

|         Command       |                   Description               |
|-----------------------|---------------------------------------------|
| `gabion auth`         | Ask for an access token (shown masked), verify and save it |
| `gabion auth --stdin` | The same, reading the token from standard input |
| `gabion auth --status`| Ask the platform whether the saved token is accepted now (exit 0 valid, 1 rejected, 2 the platform could not be reached) |
| `gabion auth --remove`| Remove the token from this machine; it stays valid elsewhere |
| `gabion auth --revoke`| Revoke the token on the platform for every machine (a leak, a lost machine); asks you to type its first 8 characters; final — a new token comes from the project author |
| `gabion install`      | Download and install the Gabion runtime; on Windows, prepare WSL 2 and install inside |
| `gabion uninstall`    | Remove the Gabion runtime from this machine |
| `gabion self-update`  | Check for and install runtime updates       |
| `gabion doctor`       | Check prerequisites and installation        |
| `gabion <cmd> --help` | Describe one of the commands above          |

### Development (delegated to full runtime CLI)

|           Command         |                     Description                    |
|---------------------------|----------------------------------------------------|
| `gabion dev`              | Start the development instance                     |
| `gabion build`            | Build the production JAR between two gates (below) |
| `gabion clean`            | Remove the build outputs (refused while the stand runs) |
| `gabion check`            | Gate before a production build (see below)         |
| `gabion verify-jar`       | Start the built JAR as a server would (see below)  |
| `gabion java-home`        | Print the home of the Java this machine resolves to|
| `gabion init <name>`      | Create a new project                               |
| `gabion stop`             | Stop the running instance                          |
| `gabion restart`          | Restart the current instance                       |
| `gabion instances`        | List all registered instances                      |
| `gabion uninstance <name>`| Force-stop an instance by name                     |
| `gabion gateway status`   | Show gateway health, name resolution and instances |
| `gabion gateway start`    | Start the machine-global gateway                   |
| `gabion gateway stop`     | Stop the machine-global gateway                    |
| `gabion license status`   | Show the license on this machine                   |
| `gabion license activate` | Take the token's seat for this machine             |
| `gabion license release`  | Give the seat up from this machine                 |

`gabion build` produces the project's production JAR on the developer's
machine in three steps: `gabion check`, then `./gradlew bootJar` in
`backend/` on the Java the runtime resolves, then `gabion verify-jar`. A
project has no Makefile — `make` is not installed on a fresh WSL
distribution, and the runtime never installs it. Exit codes: `0` — built,
`1` — a gate or Gradle refused the state, `2` — the build could not be
performed. A server or CI without the runtime builds with `./gradlew
bootJar` alone and gets no gates.

`gabion check` asks the running development instance whether its verdict
covers the current state of the tree and whether anything blocks. It never
re-computes a verdict — the checker network lives on the instance. Exit
codes: `0` — clean, `1` — blocking findings exist, `2` — the check could
not be performed (no project, no running instance, a confirmed hole in the
checker network, or checks still running). `gabion build` runs it before
packaging the production JAR.

`gabion verify-jar` runs after packaging: it starts the built JAR from an
empty directory in the production profile, without the developer's
`GABION_*` and `SPRING_*` variables, against a throwaway database, and
waits for its health endpoint. Exit codes: `0` — healthy, `1` — the JAR
refused to start, `2` — the check could not be performed. `gabion build`
runs it after the JAR is built.

`gabion clean` removes what the builds produced — the backend build
(`./gradlew clean`), the generated API types and the frontend bundles —
and refuses while the project's development instance is running, because
the instance owns those files at that moment.

A token has one active machine: `gabion license activate` moves the seat to
this machine, and the machine that held it stops.

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

1. `gabion auth` verifies your token against `api.gabion.dev` and saves it to `~/.gabion/auth.json` (on Windows, once Gabion is installed, to that file inside the WSL distribution).
2. `gabion install` first makes sure Git knows who you are — it asks for your name and email once when they are not set, and writes them to your global Git configuration — then requests a signed download URL, fetches the runtime archive, verifies its SHA-256 checksum, unpacks it into `~/.gabion/`, installs the Node.js release the runtime is built for (named by the archive; verified against the release's published checksums) and the runtime's dependencies — phase 1, printed by this CLI — then hands over to the runtime's own installer, which downloads engines, builds JARs, verifies the installation and obtains the license for this machine — phase 2, printed by the runtime with its own step counter. The runtime ships as V8 bytecode and runs on that pinned Node.js, never on the one this CLI runs on. A project template is cached at `~/.gabion/template/` for `gabion init`. On Windows the same command runs the installation inside a WSL 2 distribution, preparing WSL, the distribution and its Linux user first.
3. `gabion init` creates a new project from the cached template with all standard modules pre-installed and an initial git commit tagged `gabion/init` (skipped with a hint when Git is not installed; refused before anything is written when Git does not know your name and email). It also generates the project documentation layer (`AGENTS.md`, `ai-context/`, `work-context/`) and verifies it with the documentation checker before the initial commit.
4. `gabion module` commands manage modules within a project: `install` resolves the module from the vendored template or downloads it from the platform (S3 via signed URL), validates the contract dependency graph, copies files into the six connection points, updates `gabion.manifest.json`, and creates a git baseline tag. `remove` checks that no remaining module depends on the removed module's contracts. `restore` replaces modified files with the original template version. `replace` atomically swaps one module for another, validating the contract graph against the transitive state. `status` compares current files against baseline tags to show accumulated modifications.
5. `gabion rules` commands manage checker rule bundles. Authoring happens in a working directory created by `rules init`; `rules export` packages it into a hash-verified `.gabion-rules` file. On a consuming machine, `rules import` installs a bundle file into the machine pool at `~/.gabion/rules/`; `rules require` does the import and additionally pins the bundle in the project's `gabion.manifest.json` — a bundle in the pool does nothing until a project pins it. The running dev instance picks up pin changes live. The pool is content-verified on every resolve — bundles are never edited in place.
6. `gabion starter` manages the visual starter layer. The starter is a separate entity from modules — it provides layout, themes, CSS contract values, and UI fragments. Exactly one starter is always present; it cannot be removed, only replaced. `replace` swaps the current starter for another from the vendored template or the platform, updating templates, styles, and contract files. `package` builds a distributable starter archive from the active starter in the current project.
7. `gabion solution` commands manage multi-module solutions: `install` reads `gabion-solution.json`, plans each module via the Installation Planner (detecting conflicts and determining keep/replace/choose actions), and installs the full set as a unit including an optional starter. `remove` reverses the installation, restoring any replaced modules and the previous starter from the vendored template. `package` and `export` build distributable archives or populate public repository directories.
8. `gabion context` commands manage the project documentation layer. `context init` generates the two-layer structure for projects created before the layer existed (new projects get it from `gabion init`) and immediately verifies the result; creation is all-or-nothing and never overwrites existing files. `context check` enforces structural integrity: every reference resolves, references run one way (`work-context/` may point into `ai-context/`, never the reverse), and a reference to a deliberately absent document carries an in-place `<!-- absent: reason -->` declaration with a reason. Exit codes separate the outcomes: 0 clean, 1 problems found, 2 the check could not run.
9. All development commands (`init`, `dev`, `build`, `clean`, `check`, `verify-jar`, `java-home`, `stop`, `restart`, `instances`, `uninstance`, `gateway`, `license`), module commands, rules commands, starter commands, solution commands, and context commands delegate to the full CLI at `~/.gabion/runtime/cli/gabion.cjs`, run on the runtime's pinned Node.js.

## File Layout

```
~/.gabion/
├── auth.json          Access token
├── license.json       Runtime license for this machine
├── version.json       Installed runtime version (written last, once an installation completed)
├── runtime.new/       Only while installing: the new runtime, prepared before it replaces runtime/
├── instances.json     Registry of the development instances on this machine
├── gateway.json       Process, port and version of the running gateway
├── gateway.log        Log of the gateway
├── runtime/           Framework (V8 bytecode) and dependencies
├── .engines/          Engine binaries and sources, incl. the runtime's Node.js
├── template/          Project template for gabion init
├── rules/             Machine pool of checker rule bundles
├── bin/gabion         Launcher of the runtime CLI (not for PATH: the npm-installed
│                      `gabion` already reaches the runtime)
└── node_modules/      Symlink to runtime/node_modules/
```

Inside a WSL distribution set up by `gabion install` from Windows, two more
entries survive `gabion uninstall`, like the npm-installed CLI and your own
Node.js would on Linux: `thin-cli/` (the copy of this CLI) and `nodejs/` (the
Node.js for the CLI and your projects, linked as `node`, `npm` and `npx` in
`~/.local/bin` beside the `gabion` command).

On the Windows side `~/.gabion` (`%UserProfile%\.gabion`) holds
`wsl-home.json` — the distribution and the Linux user `gabion install`
installed for, so later commands go there even if another distribution
becomes the default — and, only before the first installation, `auth.json`.

## License

MIT