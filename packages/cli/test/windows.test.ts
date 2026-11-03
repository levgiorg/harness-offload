// D5: every path the installer and offload itself use, as they come out on Windows (path.win32),
// next to the macOS/Linux answer — checked on any machine.
import { describe, expect, test } from "bun:test";
import { locations } from "../src/hosts/install.ts";
import { configHomeFor, stateHomeFor } from "../src/paths.ts";

const H = "C:\\Users\\ana";
const ENV = { APPDATA: "C:\\Users\\ana\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\ana\\AppData\\Local" };
const none = () => false;

describe("Windows paths (D5)", () => {
  test("agents' install locations", () => {
    const w = locations("win32", ENV, H, none);
    expect(w.cursorDir).toBe("C:\\Users\\ana\\.cursor");
    expect(w.cursorPlugin).toBe("C:\\Users\\ana\\.cursor\\plugins\\local\\harness-offload");
    expect(w.geminiExtension).toBe("C:\\Users\\ana\\.gemini\\extensions\\harness-offload");
    // OpenCode and Kilo use ~/.config on Windows too (XDG-style)
    expect(w.opencodePlugin(1)).toBe("C:\\Users\\ana\\.config\\opencode\\plugin\\harness-offload.js");
    expect(w.opencodePlugin(2)).toBe("C:\\Users\\ana\\.config\\opencode\\plugins\\harness-offload.js");
    expect(w.kiloPlugin).toBe("C:\\Users\\ana\\.config\\kilo\\plugin\\harness-offload.js");
    expect(w.ampPlugin).toBe("C:\\Users\\ana\\.config\\amp\\plugins\\harness-offload.ts");
    expect(w.crushConfig).toBe("C:\\Users\\ana\\.config\\crush\\crush.json");
  });
  test("Crush: an older release's %LOCALAPPDATA% config is used when it is the only one", () => {
    const legacy = "C:\\Users\\ana\\AppData\\Local\\crush\\crush.json";
    expect(locations("win32", ENV, H, (p) => p === legacy).crushConfig).toBe(legacy);
    // both present: the current location wins
    expect(locations("win32", ENV, H, () => true).crushConfig).toBe("C:\\Users\\ana\\.config\\crush\\crush.json");
    // no LOCALAPPDATA: its usual place under the home folder
    expect(locations("win32", {}, H, (p) => p === legacy).crushConfig).toBe(legacy);
    // CRUSH_GLOBAL_CONFIG always wins
    expect(locations("win32", { ...ENV, CRUSH_GLOBAL_CONFIG: "D:\\cfg\\crush" }, H, () => true).crushConfig).toBe("D:\\cfg\\crush\\crush.json");
  });
  test("offload's own config and state folders", () => {
    expect(configHomeFor("win32", ENV, H)).toBe("C:\\Users\\ana\\AppData\\Roaming");
    expect(stateHomeFor("win32", ENV, H)).toBe("C:\\Users\\ana\\AppData\\Local");
    expect(configHomeFor("win32", {}, H)).toBe("C:\\Users\\ana\\.config");
    expect(stateHomeFor("win32", {}, H)).toBe("C:\\Users\\ana\\.local\\state");
    expect(configHomeFor("win32", { ...ENV, XDG_CONFIG_HOME: "D:\\xdg" }, H)).toBe("D:\\xdg");
  });
  test("the same on macOS/Linux", () => {
    const p = locations("linux", {}, "/home/ana", none);
    expect(p.cursorPlugin).toBe("/home/ana/.cursor/plugins/local/harness-offload");
    expect(p.opencodePlugin(2)).toBe("/home/ana/.config/opencode/plugins/harness-offload.js");
    expect(p.crushConfig).toBe("/home/ana/.config/crush/crush.json");
    expect(locations("darwin", { XDG_CONFIG_HOME: "/x" }, "/Users/ana", none).crushConfig).toBe("/x/crush/crush.json");
    expect(configHomeFor("linux", {}, "/home/ana")).toBe("/home/ana/.config");
    expect(stateHomeFor("darwin", {}, "/Users/ana")).toBe("/Users/ana/.local/state");
  });
});
