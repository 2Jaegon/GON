import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We will import the exported functions from tools/gen-image.mjs
// Using dynamic import or direct import
let genImageModule: any;

describe("gen-image tool (Antigravity image generation CLI wrapper)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-image-test-"));
    try {
      genImageModule = await import("../../tools/gen-image.mjs");
    } catch {
      genImageModule = null;
    }
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("buildAgyImageArgs generates correct CLI arguments for agy", () => {
    expect(genImageModule).not.toBeNull();
    const { buildAgyImageArgs } = genImageModule;
    const args = buildAgyImageArgs("A candid selfie in a cafe", tmpDir);
    expect(args).toContain("-p");
    expect(args).toContain("A candid selfie in a cafe");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("parseAgyImageResult parses JSON stdout to extract conversationId", () => {
    expect(genImageModule).not.toBeNull();
    const { parseAgyImageResult } = genImageModule;

    // Single JSON object
    const res1 = parseAgyImageResult(JSON.stringify({ conversationId: "conv-abc-123" }));
    expect(res1).toEqual({ conversationId: "conv-abc-123" });

    // Stream-json or multi-line output
    const multiLine = [
      '{"type": "init"}',
      '{"type": "status", "message": "generating"}',
      '{"type": "result", "conversationId": "conv-xyz-789"}'
    ].join("\n");
    const res2 = parseAgyImageResult(multiLine);
    expect(res2).toEqual({ conversationId: "conv-xyz-789" });

    // snake_case support
    const res3 = parseAgyImageResult(JSON.stringify({ conversation_id: "conv-snake" }));
    expect(res3).toEqual({ conversationId: "conv-snake" });

    // Invalid input
    expect(parseAgyImageResult("not json")).toBeNull();
  });

  it("findNewestImage discovers the newest image file in a directory tree", () => {
    expect(genImageModule).not.toBeNull();
    const { findNewestImage } = genImageModule;

    const img1 = path.join(tmpDir, "older.png");
    const sub = path.join(tmpDir, "sub");
    fs.mkdirSync(sub);
    const img2 = path.join(sub, "newer.jpg");
    const txt = path.join(tmpDir, "text.txt");

    fs.writeFileSync(img1, "img1");
    fs.writeFileSync(txt, "txt");
    // set older mtime
    const oldTime = new Date(Date.now() - 60000);
    fs.utimesSync(img1, oldTime, oldTime);

    fs.writeFileSync(img2, "img2");

    const newest = findNewestImage(tmpDir);
    expect(newest).toBe(img2);

    // With sinceMs filter
    const futureTime = Date.now() + 10000;
    expect(findNewestImage(tmpDir, futureTime)).toBeNull();
  });

  it("generateImage calls runner, finds output image, and copies to .gon-images", async () => {
    expect(genImageModule).not.toBeNull();
    const { generateImage } = genImageModule;

    const fakeBrain = path.join(tmpDir, "brain");
    const convDir = path.join(fakeBrain, "conv-42");
    fs.mkdirSync(convDir, { recursive: true });

    const mockRunner = vi.fn().mockImplementation(async () => {
      // simulate agy writing an image to the conversation dir
      const fakeImg = path.join(convDir, "generated.png");
      fs.writeFileSync(fakeImg, "fake image content");
      return {
        stdout: JSON.stringify({ conversationId: "conv-42" }),
        stderr: "",
        exitCode: 0
      };
    });

    const targetOutDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(targetOutDir, { recursive: true });

    const result = await generateImage({
      prompt: "A retro digital camera snapshot",
      outDir: targetOutDir,
      brainBaseDir: fakeBrain,
      runner: mockRunner
    });

    expect(result.via).toBe("agy");
    expect(result.path).toMatch(/^\.gon-images\/\d{8}-\d{6}-1\.png$/);

    const fullDest = path.join(targetOutDir, result.path);
    expect(fs.existsSync(fullDest)).toBe(true);
    expect(fs.readFileSync(fullDest, "utf-8")).toBe("fake image content");
  });

  it("generateImage throws descriptive error if runner fails or no image is produced", async () => {
    expect(genImageModule).not.toBeNull();
    const { generateImage } = genImageModule;

    const mockFailingRunner = vi.fn().mockRejectedValue(new Error("CLI execution failed"));

    await expect(
      generateImage({
        prompt: "test",
        outDir: tmpDir,
        runner: mockFailingRunner
      })
    ).rejects.toThrow("CLI execution failed");
  });

  it("CLI prints error and exits with 1 when no prompt is provided", async () => {
    const { spawnSync } = await import("node:child_process");
    const scriptPath = path.resolve(process.cwd(), "tools/gen-image.mjs");
    const res = spawnSync("node", [scriptPath], { encoding: "utf-8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Usage:");
  });
});
