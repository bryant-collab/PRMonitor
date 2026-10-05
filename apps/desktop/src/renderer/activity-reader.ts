import {
  isActivityQuerySnapshot,
  matchesActivityQuery,
  type ActivityEventView,
  type ActivityQuery,
  type ActivityQuerySnapshot,
} from "../shared/activity";
import type { IpcResponse } from "../shared/ipc";

export interface ActivityReadState {
  readonly snapshot?: ActivityQuerySnapshot;
  readonly loading: boolean;
  readonly lastKnown: boolean;
  readonly error?: string;
}

export function mergeActivity(
  current: ActivityQuerySnapshot,
  next: ActivityQuerySnapshot,
): ActivityQuerySnapshot {
  const events = new Map(current.events.map((event) => [event.eventId, event]));
  for (const event of next.events) events.set(event.eventId, event);
  const ascending = next.query.direction === "asc";
  return {
    ...next,
    events: [...events.values()]
      .sort((a, b) => {
        const order =
          a.recordedAt.localeCompare(b.recordedAt) ||
          a.eventId.localeCompare(b.eventId);
        return ascending ? order : -order;
      })
      .slice(0, 200),
  };
}

/** Owns only read delivery. A query change immediately discards unrelated snapshots. */
export function createActivityReader(
  read: (
    query: ActivityQuery,
    subscribe: boolean,
  ) => Promise<IpcResponse | undefined>,
  changed: (state: ActivityReadState) => void,
  timeoutMs = 10000,
) {
  let active = true;
  let generation = 0;
  let query: ActivityQuery = {};
  let state: ActivityReadState = { loading: false, lastKnown: false };
  let pendingEvents: ActivityEventView[] = [];
  const publish = (next: ActivityReadState) => {
    state = next;
    changed(state);
  };
  const updated = (event: ActivityEventView) => {
    if (!active || !matchesActivityQuery(event, query)) return;
    if (state.loading)
      pendingEvents = [
        ...pendingEvents.filter((item) => item.eventId !== event.eventId),
        event,
      ].slice(-200);
    if (state.snapshot !== undefined)
      publish({
        ...state,
        snapshot: mergeActivity(state.snapshot, {
          ...state.snapshot,
          events: [event],
        }),
      });
  };
  const load = async (
    nextQuery: ActivityQuery,
    mode: "replace" | "refresh" | "older" = "refresh",
  ) => {
    query = mode === "older" ? { ...nextQuery, cursor: undefined } : nextQuery;
    const request = ++generation;
    pendingEvents = [];
    publish({
      ...(mode === "replace" ? {} : { snapshot: state.snapshot }),
      loading: true,
      lastKnown: false,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        read(nextQuery, mode === "replace"),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(Error("ACTIVITY_READ_TIMEOUT")),
            timeoutMs,
          );
        }),
      ]);
      if (!active || request !== generation) return;
      if (
        response?.ok &&
        response.value.kind === "activity-query" &&
        isActivityQuerySnapshot(response.value.snapshot)
      ) {
        let snapshot: ActivityQuerySnapshot = {
          ...response.value.snapshot,
          events: response.value.snapshot.events.filter((event) =>
            matchesActivityQuery(event, query),
          ),
        };
        if (mode === "older" && state.snapshot !== undefined)
          snapshot = mergeActivity(state.snapshot, snapshot);
        if (pendingEvents.length > 0)
          snapshot = mergeActivity(snapshot, {
            ...snapshot,
            events: pendingEvents,
          });
        publish({ snapshot, loading: false, lastKnown: false });
      } else
        publish({
          snapshot: state.snapshot,
          loading: false,
          lastKnown: state.snapshot !== undefined,
          error:
            "PRMonitor could not read activity. Select Refresh activity to try again.",
        });
    } catch {
      if (active && request === generation)
        publish({
          snapshot: state.snapshot,
          loading: false,
          lastKnown: state.snapshot !== undefined,
          error:
            "PRMonitor could not read activity. Select Refresh activity to try again.",
        });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  return {
    load,
    updated,
    dispose: () => {
      active = false;
      ++generation;
    },
  };
}
