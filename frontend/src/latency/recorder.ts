export interface VoiceSession {
  model: string;
  startedAt: string;
  reports: Record<string, number>[];
  functionCalls: { name: string; at: number }[];
}

export class LatencyRecorder {
  private session: VoiceSession;

  constructor(model: string) {
    this.session = { model, startedAt: new Date().toISOString(), reports: [], functionCalls: [] };
  }

  record(event: { type: string; [k: string]: unknown }): void {
    if (event.type !== "LatencyReport") return;
    const row: Record<string, number> = {};
    for (const [k, v] of Object.entries(event)) {
      if (!k.endsWith("_latency")) continue;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (Number.isFinite(n)) row[k] = n;
    }
    this.session.reports.push(row);
  }

  functionCall(name: string): void {
    this.session.functionCalls.push({ name, at: Date.now() });
  }

  export(): VoiceSession {
    return structuredClone(this.session);
  }
}
