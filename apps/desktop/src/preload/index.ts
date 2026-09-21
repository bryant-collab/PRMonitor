import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type IpcRequestType,
  parseIpcOpenTargetEvent,
  type IpcResponse,
  type PrMonitorPreloadApi,
} from "../shared/ipc";
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
    | GithubServerProfileInput
    | { readonly serverId: string; readonly token: string }
    | { readonly serverId: string }
    | { readonly operationId: string }
    | ManagedPrAddInput
    | ManagedPrCloneInput
    | ManagedPrConfigurationInput
    | { readonly managedPrId: string }
    | { readonly attemptId: string }
    | { readonly managedPrId: string; readonly expectedVersion: number },
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
  onOpenTarget: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
      if (!parseIpcOpenTargetEvent(payload)) return;
      listener(payload.target);
    };
    ipcRenderer.on(IPC_CHANNELS.event, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.event, handler);
  },
};

contextBridge.exposeInMainWorld("prmonitor", api);
