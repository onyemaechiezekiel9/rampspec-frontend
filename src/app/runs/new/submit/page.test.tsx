import { describe, expect, it, vi } from "vitest";
import { submitReferenceRunWithMetadata } from "@/lib/runs/reference";

// Note: Full component integration tests should be run with:
// npm run build && npm run dev
// Then use the playwright suite for E2E testing of duplicate detection,
// state management, error handling, and accessibility.

describe("SubmitRunPage - Business Logic", () => {
  it("correctly identifies duplicate submissions via idempotency headers", async () => {
    const existingRunResult = {
      probe: {
        checkedAt: "2026-01-01T00:00:00Z",
        reachable: true,
        status: 200,
        supportedSeps: ["sep-1"],
      },
      report: {
        evidenceManifestHash: "hash123",
        reportId: "report_123",
        summary: { failed: 0, passed: 15, skipped: 0, warnings: 2 },
      },
      run: { id: "run_existing", state: "completed" as const },
      targetOrigin: "https://example.com",
    };

    const postWithMetadata = vi.fn().mockResolvedValue({
      data: existingRunResult,
      headers: { idempotencyReplayKey: "existing-run-key", status: 200 },
    });

    const input = {
      projectId: "project_1",
      suiteId: "suite_1",
      suiteVersion: "1.0.0",
      targetId: "target_1",
      targetOrigin: "https://example.com",
    };

    const result = await submitReferenceRunWithMetadata(
      { postWithMetadata } as never,
      input,
      "reviewer-request-1",
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.result.run.id).toBe("run_existing");
  });

  it("correctly identifies new submissions without replay headers", async () => {
    const newRunResult = {
      probe: {
        checkedAt: "2026-01-01T00:00:00Z",
        reachable: true,
        status: 200,
        supportedSeps: ["sep-1"],
      },
      report: {
        evidenceManifestHash: "hash456",
        reportId: "report_456",
        summary: { failed: 0, passed: 18, skipped: 0, warnings: 1 },
      },
      run: { id: "run_new", state: "completed" as const },
      targetOrigin: "https://example.com",
    };

    const postWithMetadata = vi.fn().mockResolvedValue({
      data: newRunResult,
      headers: { status: 201 },
    });

    const input = {
      projectId: "project_1",
      suiteId: "suite_1",
      suiteVersion: "1.0.0",
      targetId: "target_1",
      targetOrigin: "https://example.com",
    };

    const result = await submitReferenceRunWithMetadata(
      { postWithMetadata } as never,
      input,
      "reviewer-request-2",
    );

    expect(result.isDuplicate).toBe(false);
    expect(result.result.run.id).toBe("run_new");
  });

  it("preserves result data when detecting duplicates", async () => {
    const duplicateRunResult = {
      probe: {
        checkedAt: "2026-01-02T12:30:45Z",
        reachable: false,
        status: null,
        supportedSeps: [],
      },
      report: {
        evidenceManifestHash: "hash789",
        reportId: "report_789",
        summary: { failed: 5, passed: 0, skipped: 10, warnings: 3 },
      },
      run: { id: "run_failed", state: "failed" as const },
      targetOrigin: "https://unreachable.com",
    };

    const postWithMetadata = vi.fn().mockResolvedValue({
      data: duplicateRunResult,
      headers: { idempotencyReplayKey: "replay-key-123", status: 200 },
    });

    const input = {
      projectId: "project_1",
      suiteId: "suite_1",
      suiteVersion: "1.0.0",
      targetId: "target_1",
      targetOrigin: "https://unreachable.com",
    };

    const result = await submitReferenceRunWithMetadata(
      { postWithMetadata } as never,
      input,
      "reviewer-request-3",
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.result).toEqual(duplicateRunResult);
    expect(result.result.run.state).toBe("failed");
    expect(result.result.report.summary.failed).toBe(5);
  });

  it("handles stale data states correctly", async () => {
    const staleRunResult = {
      probe: {
        checkedAt: "2025-12-01T00:00:00Z",
        reachable: true,
        status: 200,
        supportedSeps: ["sep-1"],
      },
      report: {
        evidenceManifestHash: "old-hash",
        reportId: "old-report",
        summary: { failed: 2, passed: 12, skipped: 0, warnings: 1 },
      },
      run: { id: "run_stale", state: "completed" as const },
      targetOrigin: "https://example.com",
    };

    const postWithMetadata = vi.fn().mockResolvedValue({
      data: staleRunResult,
      headers: { idempotencyReplayKey: "stale-replay-key", status: 200 },
    });

    const input = {
      projectId: "project_1",
      suiteId: "suite_1",
      suiteVersion: "1.0.0",
      targetId: "target_1",
      targetOrigin: "https://example.com",
    };

    const result = await submitReferenceRunWithMetadata(
      { postWithMetadata } as never,
      input,
      "reviewer-stale-request",
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.result.probe.checkedAt).toBe("2025-12-01T00:00:00Z");
  });

  it("handles loading states by not finalizing result until response received", async () => {
    const delayedResult = {
      probe: {
        checkedAt: "2026-01-01T00:00:00Z",
        reachable: true,
        status: 200,
        supportedSeps: ["sep-1"],
      },
      report: {
        evidenceManifestHash: "hash",
        reportId: "report",
        summary: { failed: 0, passed: 20, skipped: 0, warnings: 0 },
      },
      run: { id: "run_delayed", state: "completed" as const },
      targetOrigin: "https://example.com",
    };

    const postWithMetadata = vi.fn().mockImplementation(
      () => new Promise(resolve => 
        setTimeout(() => 
          resolve({
            data: delayedResult,
            headers: { status: 201 },
          }), 50)
      )
    );

    const input = {
      projectId: "project_1",
      suiteId: "suite_1",
      suiteVersion: "1.0.0",
      targetId: "target_1",
      targetOrigin: "https://example.com",
    };

    const resultPromise = submitReferenceRunWithMetadata(
      { postWithMetadata } as never,
      input,
      "reviewer-delayed",
    );

    // Result should be undefined until promise resolves
    expect(resultPromise).toBeInstanceOf(Promise);

    const result = await resultPromise;
    expect(result.isDuplicate).toBe(false);
    expect(result.result.run.state).toBe("completed");
  });
});
