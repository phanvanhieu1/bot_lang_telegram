const { randomUUID } = require('node:crypto');

const TTL_MS = 5 * 60_000;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TRACE_BYTES = 160 * 1024;
const MAX_ENTRIES = 200;

function createTraceStore(now = Date.now) {
  const traces = new Map();
  let bytes = 0;
  function drop(id) {
    bytes -= traces.get(id).bytes;
    traces.delete(id);
  }
  function prune() {
    const time = now();
    for (const [id, entry] of traces) {
      if (entry.expiresAt <= time) drop(id);
    }
  }
  return {
    prune,
    save(owner, trace) {
      if (!owner) return null;
      prune();
      const serialized = JSON.stringify(trace);
      const size = Buffer.byteLength(serialized);
      if (size > MAX_TRACE_BYTES) return null;
      while (traces.size >= MAX_ENTRIES || bytes + size > MAX_BYTES) {
        drop(traces.keys().next().value);
      }
      const id = randomUUID();
      traces.set(id, {
        owner: String(owner),
        serialized,
        bytes: size,
        expiresAt: now() + TTL_MS
      });
      bytes += size;
      return id;
    },
    read(owner, id) {
      prune();
      const entry = traces.get(id);
      return entry && entry.owner === String(owner)
        ? JSON.parse(entry.serialized)
        : null;
    }
  };
}

const traceStore = createTraceStore();
setInterval(() => traceStore.prune(), 15_000).unref();
module.exports = { traceStore, createTraceStore };
