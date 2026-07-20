import assert from "node:assert/strict";
import test from "node:test";

import {
  pollConversionResult,
  ResultPollingCancelledError,
  type JobResult,
} from "../src/result-polling.ts";

function response(status: number, body: Partial<JobResult>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("continues after RUNNING/202 and returns DONE", async () => {
  const responses = [
    response(202, { status: "RUNNING" }),
    response(200, { jobId: "job-1", status: "DONE", markdownPath: "/out.md", jsonPath: null, error: null, errorDetail: null }),
  ];
  const progress: string[] = [];
  const result = await pollConversionResult("http://server", "job-1", (event) => progress.push(event.label), {
    fetchResult: async () => responses.shift()!,
    sleep: async () => {},
  });

  assert.equal(result.status, "DONE");
  assert.equal(result.markdownPath, "/out.md");
  assert.deepEqual(progress, ["결과 정리 중"]);
});

test("returns the server ERROR result without losing its error shape", async () => {
  const expected: JobResult = {
    jobId: "job-2", status: "ERROR", markdownPath: null, jsonPath: null,
    error: "변환 실패", errorDetail: "worker exited",
  };
  const result = await pollConversionResult("http://server", "job-2", () => {}, {
    fetchResult: async () => response(200, expected),
  });

  assert.deepEqual(result, expected);
});

test("times out using injected time without waiting", async () => {
  let currentTime = 0;
  await assert.rejects(
    pollConversionResult("http://server", "job-3", () => {}, {
      fetchResult: async () => response(202, { status: "RUNNING" }),
      sleep: async () => { currentTime = 11; },
      now: () => currentTime,
      timeoutMs: 10,
      intervalMs: 1,
    }),
    /결과 조회 시간 초과/,
  );
});

test("cancellation stops polling before another fetch or sleep", async () => {
  let fetchCount = 0;
  let sleepCount = 0;
  let cancelled = false;

  await assert.rejects(
    pollConversionResult("http://server", "job-4", () => { cancelled = true; }, {
      fetchResult: async () => {
        fetchCount += 1;
        return response(202, { status: "RUNNING" });
      },
      sleep: async () => { sleepCount += 1; },
      isCancelled: () => cancelled,
    }),
    ResultPollingCancelledError,
  );
  assert.equal(fetchCount, 1);
  assert.equal(sleepCount, 0);
});
