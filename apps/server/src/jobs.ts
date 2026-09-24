import { randomUUID } from "node:crypto";
import type { Job } from "../../../packages/shared/types.js";
import { HttpError } from "./paths.js";
export class Jobs {
  private jobs = new Map<string, { job: Job; controller: AbortController }>();
  list() {
    return [...this.jobs.values()].map((v) => v.job);
  }
  start(type: string, total: number, fn: (job: Job, signal: AbortSignal) => Promise<void>) {
    if (this.list().filter((j) => j.status === "running").length >= 2)
      throw new HttpError(429, "Two operations are already running. Please wait.");
    if (this.jobs.size >= 100) {
      const done = this.list().find((j) => j.status !== "running");
      if (done) this.jobs.delete(done.id);
    }
    const job: Job = {
      id: randomUUID(),
      type,
      status: "running",
      completed: 0,
      total,
      bytes: 0,
      message: "Starting…",
    };
    const controller = new AbortController();
    this.jobs.set(job.id, { job, controller });
    void fn(job, controller.signal)
      .then(() => {
        job.status = "done";
        job.message = "Complete";
      })
      .catch((e: Error) => {
        job.status = controller.signal.aborted ? "cancelled" : "error";
        job.error = e.message;
        job.message = controller.signal.aborted ? "Cancelled; completed items were kept." : e.message;
      });
    return job;
  }
  cancel(id: string) {
    const item = this.jobs.get(id);
    if (!item) throw new HttpError(404, "Operation not found.");
    item.controller.abort();
  }
}
