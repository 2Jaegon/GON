import { execFile } from "node:child_process";

export type PickFolderResult =
  | { path: string }
  | { cancelled: true }
  | { unsupported: true };

export type FolderPickerCliRunner = (
  cmd: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export const defaultFolderPickerCliRunner: FolderPickerCliRunner = (cmd, args) => {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf8" }, (err, stdout, stderr) => {
      const code = typeof err?.code === "number" ? err.code : (err ? 1 : 0);
      resolve({ stdout: stdout || "", stderr: stderr || "", exitCode: code });
    });
  });
};

const POWERSHELL_FOLDER_PICKER_SCRIPT = [
  "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
  "Add-Type -AssemblyName System.Windows.Forms;",
  "$f = New-Object System.Windows.Forms.FolderBrowserDialog;",
  "$f.ShowNewFolderButton = $true;",
  "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
  "  Write-Output $f.SelectedPath",
  "}"
].join(" ");

export async function pickFolder(
  run: FolderPickerCliRunner = defaultFolderPickerCliRunner,
  platform: string = process.platform
): Promise<PickFolderResult> {
  if (platform !== "win32") {
    return { unsupported: true };
  }

  const res = await run("powershell", [
    "-NoProfile",
    "-STA",
    "-Command",
    POWERSHELL_FOLDER_PICKER_SCRIPT
  ]);

  const out = (res.stdout || "").trim();
  if (!out) {
    return { cancelled: true };
  }

  return { path: out };
}

