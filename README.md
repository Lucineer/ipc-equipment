# IPC Equipment

Inter-Vessel Communication via pipe-style messaging. Replaces HTTP polling event bus with inbox-based async messaging.

## How It Works
- Each vessel has an **inbox** — no polling needed
- Messages are **fire-and-forget** (like Unix pipes)
- Supports **direct**, **broadcast**, and **typed** delivery
- **Cursor-based consumption** — no missed messages
- **TTL expiration** — old messages auto-pruned
- **Priority levels** — critical messages first

## Event Types (Emergence Bus)
```
goal.submitted, goal.decomposed, workflow.created,
step.done, step.failed, loop.closed, loop.retrying,
threat.detected, threat.vaccinated, skill.proposed,
skill.accepted, insight.found, rule.evolved, priority.set
```

## Integration
```typescript
import { IpcBus } from "./ipc-equipment";

const bus = new IpcBus();
bus.send("skill-evolver", "emergence-bus", "skill.proposed", { name: "code-reviewer" });
bus.consume("emergence-bus", { type: "skill.proposed" }); // [{ id, from, type, payload, ... }]
```

## Persistence
Export/import inboxes as JSON for KV storage. Zero dependencies.

Superinstance & Lucineer (DiGennaro et al.)
