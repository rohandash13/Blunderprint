export const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const KEEPALIVE_IDLE_MS = 7000;

export type AgentEvent = { type: string; [k: string]: unknown };

export interface AgentCallbacks {
  onEvent(e: AgentEvent): void;
  onAudio(chunk: ArrayBuffer): void;
  onClose(reason: string): void;
}

export class AgentSocket {
  private ws?: WebSocket;
  private ready = false;
  private lastSend = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(private settings: Record<string, unknown>, private cb: AgentCallbacks) {}

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(AGENT_URL, ["bearer", token]);
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.onmessage = (m: MessageEvent) => {
        if (typeof m.data !== "string") {
          this.cb.onAudio(m.data as ArrayBuffer);
          return;
        }
        const e = JSON.parse(m.data) as AgentEvent;
        if (e.type === "Welcome") this.sendJson(this.settings);
        if (e.type === "SettingsApplied") {
          this.ready = true;
          this.timer = setInterval(() => {
            if (Date.now() - this.lastSend > KEEPALIVE_IDLE_MS) this.sendJson({ type: "KeepAlive" });
          }, 1000);
          resolve();
        }
        this.cb.onEvent(e);
      };
      ws.onerror = () => reject(new Error("Could not connect to Deepgram"));
      ws.onclose = (ev: CloseEvent) => {
        this.ready = false;
        if (this.timer) clearInterval(this.timer);
        this.cb.onClose(ev.reason || `connection closed (${ev.code})`);
        reject(new Error(ev.reason || `connection closed (${ev.code})`));
      };
    });
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(pcm);
    this.lastSend = Date.now();
  }

  respond(id: string, name: string, content: string): void {
    this.sendJson({ type: "FunctionCallResponse", id, name, content });
  }

  injectUserMessage(content: string): void {
    this.sendJson({ type: "InjectUserMessage", content });
  }

  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.ws?.close();
  }

  private sendJson(o: Record<string, unknown>): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(o));
    this.lastSend = Date.now();
  }
}
