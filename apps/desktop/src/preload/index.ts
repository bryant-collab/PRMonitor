import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  parseIpcActivityUpdateEvent,
  type IpcRequestType,
  parseIpcInboxUpdateEvent,
  parseIpcOpenTargetEvent,
  type IpcResponse,
  type PrMonitorPreloadApi,
} from "../shared/ipc";
import type { ActivityEventView, ActivityQuery } from "../shared/activity";
import type { F12SchedulerConfigurationInput } from "../shared/control-plane";
import type { GithubServerProfileInput } from "../shared/github-server";
import type {
  ManagedPrAddInput,
  ManagedPrCloneInput,
  ManagedPrConfigurationInput,
} from "../shared/managed-pr";

let requestSequence = 0;
const sessionId = `renderer-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;

function requestId(): string {
  requestSequence += 1;
  return `request-${requestSequence}`;
}

function invoke(
  type: IpcRequestType,
  payload:
    | Record<string, never>
    | { readonly sessionId: string }
    | { readonly command: "Shutdown PRMonitor" }
    | { readonly managedPrId?: string }
    | { readonly expectedRevision?: number }
    | (F12SchedulerConfigurationInput & { readonly expectedRevision?: number })
    | GithubServerProfileInput
    | { readonly serverId: string; readonly token: string }
    | { readonly serverId: string }
    | { readonly operationId: string }
    | ManagedPrAddInput
    | ManagedPrCloneInput
    | ManagedPrConfigurationInput
    | { readonly managedPrId: string }
    | { readonly attemptId: string }
    | { readonly managedPrId: string; readonly destination: "details" | "settings" }
    | { readonly managedPrId: string; readonly expectedVersion: number }
    | ActivityQuery
    | { readonly eventId: string }
): Promise<IpcResponse> {
  return ipcRenderer.invoke(IPC_CHANNELS.request, {
    schemaVersion: 1,
    requestId: requestId(),
    type,
    payload,
  }) as Promise<IpcResponse>;
}

const api: PrMonitorPreloadApi = {
  ready: () => invoke("renderer.ready", { sessionId }),
  readCurrentState: () => invoke("app.read-current-state", {}),
  getLifecycleStatus: () => invoke("lifecycle.status", {}),
  requestShutdown: () =>
    invoke("lifecycle.shutdown", { command: "Shutdown PRMonitor" }),
  readScheduler: () => invoke("scheduler.read", {}),
  saveSchedulerConfiguration: (input) =>
    invoke("scheduler.configuration.save", input),
  checkSchedulerNow: (managedPrId) =>
    invoke("scheduler.check-now", managedPrId === undefined ? {} : { managedPrId }),
  pauseWatching: (expectedRevision) =>
    invoke("scheduler.pause", expectedRevision === undefined ? {} : { expectedRevision }),
  resumeWatching: (expectedRevision) =>
    invoke("scheduler.resume", expectedRevision === undefined ? {} : { expectedRevision }),
  readGithubSettings: () => invoke("github.settings.read", {}),
  upsertGithubProfile: (input) => invoke("github.profile.upsert", input),
  submitGithubCredential: (serverId, token) =>
    invoke("github.credential.submit", { serverId, token }),
  testGithubConnection: (serverId) =>
    invoke("github.connection.test", { serverId }),
  retryGithubOperation: (operationId) =>
    invoke("github.operation.retry", { operationId }),
  cleanupGithubOperation: (operationId) =>
    invoke("github.operation.cleanup", { operationId }),
  removeGithubProfile: (serverId) =>
    invoke("github.profile.remove", { serverId }),
  readManagedPrs: () => invoke("managed-pr.list", {}),
  readManagedPr: (managedPrId) => invoke("managed-pr.read", { managedPrId }),
  addManagedPr: (input) => invoke("managed-pr.add", input),
  retryManagedPrAdd: (attemptId) => invoke("managed-pr.retry", { attemptId }),
  readManagedPrCandidates: (managedPrId) => invoke("managed-pr.candidates", { managedPrId }),
  pickManagedPrFolder: () => invoke("managed-pr.clone.pick", {}),
  attachManagedPrClone: (input) => invoke("managed-pr.clone.attach", input),
  clearManagedPrClone: (managedPrId, expectedVersion) => invoke("managed-pr.clone.clear", { managedPrId, expectedVersion }),
  saveManagedPrConfiguration: (input) => invoke("managed-pr.configuration.save", input),
  readInbox: () => invoke("inbox.read", {}),
  subscribeInbox: () => invoke("inbox.subscribe", {}),
  readActivity: (query = {}) => invoke("activity.query", query),
  subscribeActivity: (query = {}) => invoke("activity.subscribe", query),
  navigateActivity: (eventId) => invoke("activity.navigate", { eventId }),
  navigateManagedPr: (managedPrId, destination) =>
    invoke("inbox.navigate", { managedPrId, destination }),
  onOpenTarget: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcOpenTargetEvent(payload)) return;
      listener(payload.target);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
  onInboxUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcInboxUpdateEvent(payload)) return;
      listener(payload.snapshot);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
  onActivityUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcActivityUpdateEvent(payload)) return;
      listener(payload.event as ActivityEventView);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
};

contextBridge.exposeInMainWorld("prmonitor", api);
