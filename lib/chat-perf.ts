import type { PerfLogger } from "./chat-runtime";

export function createPerfLogger(startTime: number): PerfLogger {
  return {
    elapsed() {
      return Date.now() - startTime;
    },
    mark(stage: string) {
      console.info("[messages.route][perf]", {
        stage,
        elapsed: Date.now() - startTime,
      });
    },
  };
}
