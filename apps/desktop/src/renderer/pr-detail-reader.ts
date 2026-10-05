import type { IpcResponse } from "../shared/ipc";
import type {
  ManagedPrCandidateView,
  ManagedPrReadModel,
} from "../shared/managed-pr";
import type { ManagedPrWork } from "../shared/managed-pr-work";

export interface PrDetailReadState {
  readonly selectedId: string;
  readonly details?: ManagedPrReadModel;
  readonly candidates: readonly ManagedPrCandidateView[];
  readonly work?: ManagedPrWork;
  readonly loading: boolean;
  readonly error: string;
}

/** Delivers one selected PR. Navigation has no authority to mutate or cancel domain work. */
export function createPrDetailReader(
  ports: {
    readonly details: (id: string) => Promise<IpcResponse | undefined>;
    readonly candidates: (id: string) => Promise<IpcResponse | undefined>;
    readonly work: (id: string) => Promise<IpcResponse | undefined>;
  },
  changed: (state: PrDetailReadState) => void,
  timeoutMs = 10000,
) {
  let generation = 0;
  let active = true;
  const bounded = async <T>(promise: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(Error("PR_READ_TIMEOUT")), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  return {
    async load(id: string) {
      const request = ++generation;
      const initial: PrDetailReadState = {
        selectedId: id,
        candidates: [],
        loading: true,
        error: "",
      };
      if (!active) return;
      changed(initial);
      try {
        const response = await bounded(ports.details(id));
        if (!active || request !== generation) return;
        if (
          !response?.ok ||
          response.value.kind !== "managed-pr-details" ||
          response.value.managedPr === null ||
          response.value.managedPr.id !== id
        ) {
          changed({
            ...initial,
            loading: false,
            error:
              "This pull request is unavailable. Refresh the PR inbox to check whether it is still managed.",
          });
          return;
        }
        const details = response.value.managedPr;
        const [candidatesResponse, workResponse] = await Promise.allSettled([
          bounded(ports.candidates(id)),
          bounded(ports.work(id)),
        ]);
        if (!active || request !== generation) return;
        const candidates =
          candidatesResponse.status === "fulfilled"
            ? candidatesResponse.value
            : undefined;
        const work =
          workResponse.status === "fulfilled" ? workResponse.value : undefined;
        const validCandidates =
          candidates?.ok && candidates.value.kind === "managed-pr-candidates";
        const validWork =
          work?.ok &&
          work.value.kind === "managed-pr-work" &&
          work.value.work.managedPrId === id;
        changed({
          ...initial,
          details,
          candidates: validCandidates ? candidates.value.value.candidates : [],
          ...(validWork ? { work: work.value.work } : {}),
          loading: false,
          error: !validWork
            ? "Saved work history could not be read. Retry details to check again."
            : !validCandidates
              ? "Clone candidates could not be read. Retry details to check again."
              : "",
        });
      } catch {
        if (active && request === generation)
          changed({
            ...initial,
            loading: false,
            error:
              "Pull request details could not be read. Retry details to check again.",
          });
      }
    },
    invalidate() {
      ++generation;
    },
    dispose() {
      active = false;
      ++generation;
    },
  };
}
