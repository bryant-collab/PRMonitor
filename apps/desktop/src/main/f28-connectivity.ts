import { net } from "electron";

export function readOnlineState(): boolean {
  return net.isOnline();
}
