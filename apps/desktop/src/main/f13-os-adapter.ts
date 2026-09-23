import { shell } from "electron";
import type { F13OsPathAdapter } from "./f13-service";

/** Main-process-only OS handoff. The renderer never receives a shell command. */
export class ElectronF13OsPathAdapter implements F13OsPathAdapter {
  public async openDirectory(
    path: string,
  ): Promise<{ readonly ok: boolean; readonly reasonCode?: string }> {
    try {
      const error = await shell.openPath(path);
      return error.length === 0
        ? { ok: true }
        : { ok: false, reasonCode: "OPEN_DIRECTORY_FAILED" };
    } catch {
      return { ok: false, reasonCode: "OPEN_DIRECTORY_FAILED" };
    }
  }

  public async openFile(
    path: string,
  ): Promise<{ readonly ok: boolean; readonly reasonCode?: string }> {
    try {
      const error = await shell.openPath(path);
      return error.length === 0
        ? { ok: true }
        : { ok: false, reasonCode: "OPEN_FILE_FAILED" };
    } catch {
      return { ok: false, reasonCode: "OPEN_FILE_FAILED" };
    }
  }

  public async revealFile(
    path: string,
  ): Promise<{ readonly ok: boolean; readonly reasonCode?: string }> {
    try {
      shell.showItemInFolder(path);
      return { ok: true };
    } catch {
      return { ok: false, reasonCode: "REVEAL_FILE_FAILED" };
    }
  }
}
