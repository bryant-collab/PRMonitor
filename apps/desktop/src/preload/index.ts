import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  parseIpcOpenTargetEvent,
  type IpcResponse,
  type PrMonitorPreloadApi,
} from "../shared/ipc";

let requestSequence = 0;
const sessionId = `renderer-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;

function requestId(): string {
  requestSequence += 1;
  return `request-${requestSequence}`;
}

function invoke(
  type:
    | "renderer.ready"
    | "app.read-current-state"
    | "lifecycle.status"
    | "lifecycle.shutdown",
  payload:
    | Record<string, never>
    | { readonly sessionId: string }
    | { readonly command: "Shutdown PRMonitor" },
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
