import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(sourceDirectory, "..");
const repositoryRoot = resolve(sourceDirectory, "..", "..", "..");

/**
 * npm runs a workspace script with the workspace as cwd. Resolve repository
 * documents from the checkout root first, while retaining direct workspace
 * invocation support for paths such as ../../Specs/example.md.
 */
export function resolveDocumentPath(input: string): string {
  if (isAbsolute(input)) return resolve(input);

  const repositoryCandidate = resolve(repositoryRoot, input);
  if (existsSync(repositoryCandidate)) return repositoryCandidate;

  return resolve(workspaceRoot, input);
}

export function repositoryRootPath(): string {
  return repositoryRoot;
}
