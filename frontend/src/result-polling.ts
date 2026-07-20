export interface ProgressEvent {
  step: number;
  label: string;
  percent: number;
  eta: number | null;
}

export interface JobResult {
  jobId: string;
  status: "PENDING" | "RUNNING" | "DONE" | "ERROR";
  markdownPath: string | null;
  jsonPath: string | null;
  error: string | null;
  errorDetail: string | null;
  qualityWarnings?: string[];
  emptyPages?: number[];
}

interface PollResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface ResultPollingOptions {
  fetchResult?: (url: string) => Promise<PollResponse>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  isCancelled?: () => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

export class ResultPollingCancelledError extends Error {
  constructor() {
    super("변환이 취소되었습니다.");
    this.name = "ResultPollingCancelledError";
  }
}

const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/** Polls until the server exposes a terminal conversion result. */
export async function pollConversionResult(
  base: string,
  jobId: string,
  onProgress: (event: ProgressEvent) => void,
  options: ResultPollingOptions = {},
): Promise<JobResult> {
  const fetchResult = options.fetchResult ?? ((url) => fetch(url));
  const wait = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const isCancelled = options.isCancelled ?? (() => false);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const startedAt = now();
  let notifiedWaiting = false;

  while (!isCancelled()) {
    const res = await fetchResult(`${base}/result/${jobId}`);
    if (!res.ok && res.status !== 202) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as Partial<JobResult>;
    if (data.status === "DONE" || data.status === "ERROR") {
      return data as JobResult;
    }

    if (!notifiedWaiting) {
      notifiedWaiting = true;
      onProgress({ step: 4, label: "결과 정리 중", percent: 95, eta: null });
    }

    if (now() - startedAt > timeoutMs) {
      throw new Error("결과 조회 시간 초과");
    }
    if (isCancelled()) break;
    await wait(intervalMs);
  }

  throw new ResultPollingCancelledError();
}
