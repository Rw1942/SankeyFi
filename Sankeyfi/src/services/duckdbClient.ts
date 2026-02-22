import type { WorkerMethod, WorkerMethodMap, WorkerRequest, WorkerResponse } from "../worker/protocol";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

export class DuckDBWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<string, PendingRequest>();

  constructor() {
    this.worker = new Worker(new URL("../worker/duckdbWorker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = this.handleMessage;
    this.worker.onerror = this.handleWorkerError;
    this.worker.onmessageerror = this.handleWorkerMessageError;
  }

  terminate() {
    this.worker.terminate();
    this.pending.forEach((request) => request.reject(new Error("Worker terminated.")));
    this.pending.clear();
  }

  call<M extends WorkerMethod>(
    method: M,
    params: WorkerMethodMap[M]["params"]
  ): Promise<WorkerMethodMap[M]["result"]> {
    const id = crypto.randomUUID();
    const payload: WorkerRequest<M> = { id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as WorkerMethodMap[M]["result"]),
        reject,
      });
      if (method === "importFile") {
        const transfer = (params as WorkerMethodMap["importFile"]["params"]).bytes;
        this.worker.postMessage(payload, [transfer]);
      } else {
        this.worker.postMessage(payload);
      }
    }) as Promise<WorkerMethodMap[M]["result"]>;
  }

  private handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    pending.reject(new Error(response.error));
  };

  private rejectAllPending(message: string) {
    const error = new Error(message);
    this.pending.forEach((request) => request.reject(error));
    this.pending.clear();
  }

  private handleWorkerError = () => {
    this.rejectAllPending("Data engine worker failed to start.");
  };

  private handleWorkerMessageError = () => {
    this.rejectAllPending("Data engine worker sent an unreadable response.");
  };
}
