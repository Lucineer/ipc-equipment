// ipc-equipment.ts — Inter-Vessel Communication via Pipe-Style Messaging
// Extracted from nexus IPC concept, adapted for Cocapn fleet
// Zero deps, ~200 lines

export interface PipeMessage {
  id: string;
  from: string;      // vessel name
  to: string;        // vessel name or "broadcast"
  type: string;      // event type (e.g., "goal.submitted", "threat.detected")
  payload: unknown;
  timestamp: string;
  ttl: number;       // seconds before expiry
  priority: number;  // 0=low, 1=normal, 2=high, 3=critical
}

export interface Inbox {
  vessel: string;
  messages: PipeMessage[];
  cursor: string;    // last consumed message id
}

const TTL_DEFAULT = 3600; // 1 hour

export class IpcBus {
  private inboxes: Map<string, Inbox> = new Map();
  private msgIdCounter = 0;

  private nextId(): string {
    return `msg_${Date.now()}_${++this.msgIdCounter}`;
  }

  private getInbox(vessel: string): Inbox {
    if (!this.inboxes.has(vessel)) {
      this.inboxes.set(vessel, { vessel, messages: [], cursor: "" });
    }
    return this.inboxes.get(vessel)!;
  }

  // Send a message
  send(from: string, to: string, type: string, payload: unknown, opts?: { ttl?: number; priority?: number }): PipeMessage {
    const msg: PipeMessage = {
      id: this.nextId(),
      from,
      to,
      type,
      payload,
      timestamp: new Date().toISOString(),
      ttl: opts?.ttl ?? TTL_DEFAULT,
      priority: opts?.priority ?? 1,
    };

    // Direct delivery
    if (to !== "broadcast") {
      this.getInbox(to).messages.push(msg);
    }

    // Broadcast goes to all inboxes
    if (to === "broadcast") {
      for (const [, inbox] of this.inboxes) {
        if (inbox.vessel !== from) {
          inbox.messages.push({ ...msg });
        }
      }
    }

    // Also store in sender's outbox for audit
    this.getInbox(from).messages.push({ ...msg, to: `sent:${to}` });

    return msg;
  }

  // Consume messages from inbox
  consume(vessel: string, opts?: { since?: string; limit?: number; type?: string }): PipeMessage[] {
    const inbox = this.getInbox(vessel);
    const since = opts?.since || inbox.cursor;
    const limit = opts?.limit || 50;
    const filterType = opts?.type;

    // Find start index
    let startIdx = 0;
    if (since) {
      startIdx = inbox.messages.findIndex(m => m.id === since);
      if (startIdx >= 0) startIdx++;
    }

    // Collect and filter
    const now = Date.now();
    const results: PipeMessage[] = [];
    for (let i = startIdx; i < inbox.messages.length && results.length < limit; i++) {
      const msg = inbox.messages[i];
      // Skip expired, sent:, and non-matching type
      if (msg.to.startsWith("sent:")) continue;
      const msgTime = new Date(msg.timestamp).getTime();
      if (now - msgTime > msg.ttl * 1000) continue;
      if (filterType && msg.type !== filterType) continue;
      // Only messages TO this vessel (or broadcast)
      if (msg.to !== vessel && msg.to !== "broadcast") continue;
      results.push(msg);
    }

    // Update cursor
    if (results.length > 0) {
      inbox.cursor = results[results.length - 1].id;
    }

    return results;
  }

  // Peek without consuming
  peek(vessel: string, opts?: { type?: string; limit?: number }): PipeMessage[] {
    return this.consume(vessel, { ...opts, since: undefined });
  }

  // Get unread count
  unreadCount(vessel: string): number {
    const inbox = this.getInbox(vessel);
    const now = Date.now();
    let count = 0;
    let started = false;
    for (const msg of inbox.messages) {
      if (msg.id === inbox.cursor) { started = true; continue; }
      if (!started && inbox.cursor) continue;
      if (msg.to.startsWith("sent:")) continue;
      if (now - new Date(msg.timestamp).getTime() > msg.ttl * 1000) continue;
      if (msg.to !== vessel && msg.to !== "broadcast") continue;
      count++;
    }
    return count;
  }

  // Acknowledge a message (mark as processed)
  ack(vessel: string, messageId: string): boolean {
    const inbox = this.getInbox(vessel);
    const idx = inbox.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return false;
    // Move to "sent:ack" to remove from unread
    inbox.messages[idx].to = `sent:ack:${inbox.messages[idx].to}`;
    return true;
  }

  // Prune expired messages
  prune(vessel?: string): number {
    const now = Date.now();
    let pruned = 0;
    const targets = vessel ? [vessel] : Array.from(this.inboxes.keys());
    for (const v of targets) {
      const inbox = this.getInbox(v);
      const before = inbox.messages.length;
      inbox.messages = inbox.messages.filter(m => {
        if (m.to.startsWith("sent:")) return true; // Keep audit trail
        return now - new Date(m.timestamp).getTime() <= m.ttl * 1000;
      });
      pruned += before - inbox.messages.length;
    }
    return pruned;
  }

  // Fleet-wide event types in use
  activeEventTypes(): string[] {
    const types = new Set<string>();
    for (const [, inbox] of this.inboxes) {
      for (const msg of inbox.messages) {
        if (!msg.to.startsWith("sent:")) types.add(msg.type);
      }
    }
    return Array.from(types).sort();
  }

  // Export state for KV persistence
  exportState(): string {
    const obj: Record<string, Inbox> = {};
    for (const [v, inbox] of this.inboxes) {
      obj[v] = inbox;
    }
    return JSON.stringify(obj);
  }

  // Import state from KV
  importState(json: string): void {
    const obj = JSON.parse(json);
    for (const [v, inbox] of Object.entries(obj)) {
      this.inboxes.set(v, inbox as Inbox);
    }
  }

  // Summary
  summary(): Record<string, { unread: number; total: number }> {
    const result: Record<string, { unread: number; total: number }> = {};
    for (const [v] of this.inboxes) {
      result[v] = {
        unread: this.unreadCount(v),
        total: this.getInbox(v).messages.filter(m => !m.to.startsWith("sent:")).length,
      };
    }
    return result;
  }
}
