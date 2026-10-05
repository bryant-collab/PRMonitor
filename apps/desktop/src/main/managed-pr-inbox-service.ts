import {
  projectManagedPrInbox,
  type ManagedPrInboxReadModel,
  type ManagedPrInboxSynchronizationSource,
} from "../shared/inbox";
import {
  buildManagedPrTarget,
  type ManagedPrNavigationDestination,
  type OpenTarget,
} from "../shared/routing";
import type { F07PersistenceRepositories } from "./persistence/f07-repositories";
import type {
  PersistenceRepositories,
  SynchronizationResultRecord,
} from "./persistence/repositories";

export interface ManagedPrInboxServiceOptions {
  readonly managedPrs: Pick<
    F07PersistenceRepositories,
    "listManagedPrs" | "getManagedPr"
  >;
  readonly persistence: Pick<
    PersistenceRepositories,
    "listSynchronizationResults"
  >;
  readonly now?: () => string;
}

export class ManagedPrInboxService {
  private readonly now: () => string;
  private version = 0;
  private facts = "";
  private readonly listeners = new Set<
    (snapshot: ManagedPrInboxReadModel) => void
  >();

  public constructor(private readonly options: ManagedPrInboxServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public read(): ManagedPrInboxReadModel {
    const candidate = projectManagedPrInbox({
      managedPrs: this.options.managedPrs.listManagedPrs(),
      synchronizationResults: this.synchronizationSources(),
      version: this.version + 1,
      generatedAt: this.now(),
    });
    const {
      version: _version,
      generatedAt: _generatedAt,
      ...facts
    } = candidate;
    const signature = JSON.stringify(facts);
    if (signature !== this.facts) {
      this.facts = signature;
      this.version += 1;
    }
    return { ...candidate, version: this.version };
  }

  public refresh(): ManagedPrInboxReadModel {
    const snapshot = this.read();
    for (const listener of this.listeners) listener(snapshot);
    return snapshot;
  }

  public subscribe(
    listener: (snapshot: ManagedPrInboxReadModel) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public target(
    managedPrId: string,
    destination: ManagedPrNavigationDestination,
  ): OpenTarget {
    if (this.options.managedPrs.getManagedPr(managedPrId) === undefined)
      throw new Error("MANAGED_PR_NOT_FOUND");
    return buildManagedPrTarget(managedPrId, destination);
  }

  private synchronizationSources(): readonly ManagedPrInboxSynchronizationSource[] {
    return this.options.persistence
      .listSynchronizationResults()
      .map(
        (
          result: SynchronizationResultRecord,
        ): ManagedPrInboxSynchronizationSource => ({
          id: result.id,
          managedPrId: result.managedPrId,
          status: result.status,
          version: result.version,
          updatedAt: result.updatedAt,
        }),
      );
  }
}

export function createManagedPrInboxService(
  options: ManagedPrInboxServiceOptions,
): ManagedPrInboxService {
  return new ManagedPrInboxService(options);
}
