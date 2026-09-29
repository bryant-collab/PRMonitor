# PRMonitor

PRMonitor is currently a specification-first project. The repository includes a
standalone TypeScript specification linter under `tools/spec-linter` that uses
TypeSafe Jev to check whether each explicitly identified PRD requirement is
addressed by a plan and whether a feature PRD covers applicable application-level
acceptance criteria.

The Electron/React application foundation lives in `apps/desktop`; the linter
remains a separate workspace because it is developer tooling used when
specifications change. F01 provides the production startup shell, typed
main/preload/renderer/shared boundaries, an unpacked Electron artifact, and
deterministic test fixtures. Product services and persistent application state
belong to later features.

## Foundation workspace

The supported local/CI toolchain is Node.js `24.19.0`, npm `11.17.0`, and Git
`2.55.0` (a platform suffix is permitted). From a clean checkout:

```powershell
npm ci
npm run check
```

The root check verifies runtime versions, typechecks/lints/formats/builds and
smoke-launches the desktop artifact, verifies the read-only F00 schema,
executes F00 tests, and builds/tests the standalone spec-linter. It does not
require product-service credentials or run the credentialed semantic linters.
The unpacked artifact is written to ignored `release/`. F30 also defines the
Windows 11 x64 internal-preview installer workflow. From a clean checkout,
package the unsigned, manually distributed NSIS installer and its release
manifest with:

```powershell
npm run f30:package
```

See [docs/windows-release.md](docs/windows-release.md) for the clean-machine,
upgrade, uninstall, support-diagnostics, and release-evidence procedure. The
installer is intentionally unsigned and has no updater; it is not a public
distribution artifact.

The standalone semantic linters remain explicit commands and accept repository-
relative or absolute paths. Their credential is resolved by the linter only
when a semantic lint is intentionally invoked:

```powershell
npm run lint:prd-plan -- Specs/<feature>_PRD.md Specs/<feature>_PLAN.md
npm run lint:application-coverage -- Specs/application_overview.md Specs/<feature>_PRD.md
```

## PRD/plan linter

The linter recognizes leaf requirement list items with these IDs:

- `AC-01`
- `FR-01.1`
- `NFR-01`
- `INV-01`

Run the PRD/plan linter with:

```powershell
npm install
npm run lint:prd-plan -- path/to/feature_PRD.md path/to/feature_PLAN.md
```

The default thresholds are exported from `tools/spec-linter/src/thresholds.ts` and are also
overridable for a run:

```powershell
npm run lint:prd-plan -- feature_PRD.md feature_PLAN.md `
  --covered-threshold 0.85 `
  --missing-threshold 0.85 `
  --format json
```

The command exits `1` when any requirement is classified as `missing`, `0` when
there are no definite missing requirements (including `needs-review` results),
and `2` for usage, file, or TypeSafe API errors.

The production Jev adapter batches one independent Noul question per PRD
requirement in one System One request. The application owns extraction,
thresholding, reporting, and exit behavior; Jev supplies only the semantic
adequacy probabilities.

## Application overview coverage linter

The application overview's MVP acceptance criteria use stable IDs such as
`APP-AC-01` through `APP-AC-77`. A feature PRD can reference applicable overview
criteria in its `Application Requirements Covered` table.

Run the coverage linter with:

```powershell
npm run lint:application-coverage -- `
  Specs/application_overview.md `
  path/to/feature_PRD.md
```

This linter asks one independent Jev Choice question per application criterion,
classifying each as `covered`, `not-applicable`, or `missing`. Low-confidence
choices become `needs-review`. The full probability distribution and confidence
are preserved in the report. It exits `1` for missing criteria, `0` when there
are no definite missing criteria, and `2` for invalid mappings or other errors.

The decision threshold and review-confidence threshold are exported from
`tools/spec-linter/src/thresholds.ts` and can also be overridden with
`--decision-threshold`, `--review-confidence`, and `--format json`.

Run the checks with:

```powershell
npm run check
```
