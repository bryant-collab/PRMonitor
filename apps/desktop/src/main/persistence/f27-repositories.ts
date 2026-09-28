import type {
  F27HeadAdvanceInvalidation,
  F27StateRecord,
} from "../../shared/f27-synchronization";
import type { PersistenceRepositories } from "./repositories";

export interface F27PersistencePort {
  readonly getState: (operationId: string) => F27StateRecord | undefined;
  readonly listStates: () => readonly F27StateRecord[];
  readonly putState: (input: {
    readonly state: F27StateRecord;
    readonly expectedVersion?: number;
  }) => F27StateRecord;
  readonly getHeadAdvanceInvalidation: (
    operationId: string,
  ) => F27HeadAdvanceInvalidation | undefined;
  readonly putHeadAdvanceInvalidation: (
    invalidation: F27HeadAdvanceInvalidation,
  ) => F27HeadAdvanceInvalidation;
}

export class F27PersistenceRepositories implements F27PersistencePort {
  public constructor(private readonly repositories: PersistenceRepositories) {}

  public getState(operationId: string): F27StateRecord | undefined {
    return this.repositories.getF27State(operationId);
  }

  public listStates(): readonly F27StateRecord[] {
    return this.repositories.listF27States();
  }

  public putState(input: {
    readonly state: F27StateRecord;
    readonly expectedVersion?: number;
  }): F27StateRecord {
    return this.repositories.putF27State(input);
  }

  public getHeadAdvanceInvalidation(
    operationId: string,
  ): F27HeadAdvanceInvalidation | undefined {
    return this.repositories.getF27HeadAdvanceInvalidation(operationId);
  }

  public putHeadAdvanceInvalidation(
    invalidation: F27HeadAdvanceInvalidation,
  ): F27HeadAdvanceInvalidation {
    return this.repositories.putF27HeadAdvanceInvalidation(invalidation);
  }
}
