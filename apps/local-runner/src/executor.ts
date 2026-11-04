import { spawn } from "node:child_process";
import { SignedJobContract, RunnerTaskResult } from "@aso/contracts";
import { verifyJobContract } from "@aso/execution-protocol";
import { isPathInside, assessCommandRisk, redactSecrets } from "@aso/security";

export class JobExecutor {
  constructor(
    private secretKey: string,
    private allowedPaths: string[]
  ) {}

  public async executeContract(
    contract: SignedJobContract,
    onProgress?: (chunk: string, stream: "stdout" | "stderr") => void
  ): Promise<RunnerTaskResult> {
    const startTime = Date.now();

    // 1. Verify contract signature
    const sigCheck = verifyJobContract(contract, this.secretKey);
    if (!sigCheck.valid) {
      return {
        jobId: contract.jobId,
        exitCode: 1,
        stdout: "",
        stderr: `Security Rejected: ${sigCheck.reason}`,
        durationMs: Date.now() - startTime,
        filesChanged: [],
        error: sigCheck.reason
      };
    }

    // 2. Check if targetDir is inside allowed paths
    const isAllowed = this.allowedPaths.some((parent) => isPathInside(parent, contract.targetDir));
    if (!isAllowed) {
      const err = `Security Rejected: targetDir '${contract.targetDir}' is not in allowed paths list`;
      return {
        jobId: contract.jobId,
        exitCode: 1,
        stdout: "",
        stderr: err,
        durationMs: Date.now() - startTime,
        filesChanged: [],
        error: err
      };
    }

    // 3. Assess command risk
    const fullCmd = [contract.command, ...(contract.args || [])].join(" ");
    const risk = assessCommandRisk(fullCmd);
    if (risk.risk === "forbidden") {
      const err = `Security Rejected: Command '${contract.command}' is forbidden by policy`;
      return {
        jobId: contract.jobId,
        exitCode: 1,
        stdout: "",
        stderr: err,
        durationMs: Date.now() - startTime,
        filesChanged: [],
        error: err
      };
    }

    // 4. Execute safely
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(contract.command, contract.args || [], {
        cwd: contract.targetDir,
        env: { ...process.env, ...contract.env },
        shell: false
      });

      child.stdout?.on("data", (data) => {
        const text = redactSecrets(data.toString());
        stdout += text;
        onProgress?.(text, "stdout");
      });

      child.stderr?.on("data", (data) => {
        const text = redactSecrets(data.toString());
        stderr += text;
        onProgress?.(text, "stderr");
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        stderr += "\n[Execution Timed Out]";
      }, contract.timeoutMs || 60000);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          jobId: contract.jobId,
          exitCode: code ?? 0,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          filesChanged: []
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          jobId: contract.jobId,
          exitCode: 1,
          stdout,
          stderr: err.message,
          durationMs: Date.now() - startTime,
          filesChanged: [],
          error: err.message
        });
      });
    });
  }
}

