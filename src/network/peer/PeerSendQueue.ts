import { PEER_FAST_BUFFER_LIMIT_BYTES } from '../../config';
import { compressPeerPayload, encodePeerBytes, makePeerPacket, PEER_COMPRESSION_THRESHOLD_BYTES,
  PEER_MESSAGE_LIMIT_BYTES, PEER_PACKET_BYTES, PEER_PACKET_HEADER_BYTES,
  type EncodedPeerPayload } from './PeerPacketCodec';
import { encodePeerMessage, type BatchMessage, type PeerMessage } from './protocol';

export interface PeerSendItem {
  message: PeerMessage;
  textLength: number;
  payload: EncodedPeerPayload;
  /** Keep handshake and small messages readable before protocol negotiation. */
  text?: string;
  sent: (wireBytes: number, item: PeerSendItem) => void;
}

interface ActiveSend { item: PeerSendItem; id: number; offset: number; wireBytes: number; ready: boolean }

/** Per-channel ownership of compression and native SCTP backpressure. The current message
 * always finishes (large snapshots must not starve); fast keeps at most one waiting update.
 * Reliable keeps FIFO order including asynchronous compression and retries. */
export class PeerSendQueue {
  private readonly waiting: PeerSendItem[] = [];
  private waitingBytes = 0;
  private active: ActiveSend | null = null;
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private retryPacketLimit = PEER_PACKET_BYTES;
  private pumping = false;

  constructor(private readonly options: {
    fast: boolean;
    channel: () => RTCDataChannel | null | undefined;
    maxMessageSize: () => number | undefined;
    compress: () => boolean;
    dropped: () => void;
    failed: (reason: 'closed' | 'overload', error?: unknown) => void;
  }) {}

  enqueue(item: PeerSendItem): void {
    if (this.closed) return;
    if (this.options.fast && this.waiting.length) {
      const previous = this.waiting.pop()!;
      this.waitingBytes -= previous.payload.rawBytes;
      if (previous.message.t === 'b' && item.message.t === 'b') {
        // Fast batches contain independent store keys. A newer input/ping batch must not
        // erase a queued game snapshot just because it doesn't contain that key.
        const message = mergeFastBatches(previous.message, item.message);
        const text = encodePeerMessage(message), payload = encodePeerBytes(text);
        item = { ...item, message, payload, textLength: text.length,
          text: payload.rawBytes < PEER_COMPRESSION_THRESHOLD_BYTES ? text : undefined };
      }
      this.options.dropped();
    }
    if (this.waitingBytes + item.payload.rawBytes > PEER_MESSAGE_LIMIT_BYTES * 2) {
      // A reliable consumer this far behind cannot preserve an unbounded command log.
      // Report a specific local overload, never silently omit reliable data.
      this.options.failed('overload', new Error('Reliable send queue capacity exhausted'));
      return;
    }
    this.waiting.push(item); this.waitingBytes += item.payload.rawBytes;
    this.pump();
  }

  resume = (): void => { this.pump(); };

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null; this.waiting.length = 0; this.waitingBytes = 0; this.active = null;
  }

  private pump(): void {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    try {
      const channel = this.options.channel();
      if (!channel || channel.readyState !== 'open') {
        this.options.failed('closed'); return;
      }
      let sentThisTurn = 0;
      for (;;) {
        if (!this.active) {
          const item = this.waiting.shift();
          if (!item) return;
          this.waitingBytes -= item.payload.rawBytes;
          const active: ActiveSend = { item, id: this.nextId++, offset: 0, wireBytes: 0, ready: true };
          this.active = active;
          if (this.options.compress() && item.payload.rawBytes >= PEER_COMPRESSION_THRESHOLD_BYTES) {
            active.ready = false;
            void compressPeerPayload(item.payload).then(payload => {
              if (this.closed || this.active !== active) return;
              item.payload = payload; item.text = undefined; active.ready = true; this.pump();
            });
          }
        }
        const active = this.active;
        if (!active.ready) return;
        const negotiated = this.options.maxMessageSize();
        const limit = Math.min(this.retryPacketLimit, negotiated && negotiated > 0 ? negotiated : PEER_PACKET_BYTES);
        if (limit <= PEER_PACKET_HEADER_BYTES) {
          this.options.failed('overload', new Error('SCTP message limit cannot carry a transport header')); return;
        }
        const item = active.item;
        const useText = item.text !== undefined && item.payload.rawBytes <= limit;
        const length = useText ? item.payload.rawBytes : Math.min(limit, item.payload.bytes.length - active.offset + PEER_PACKET_HEADER_BYTES);
        const budget = this.options.fast ? PEER_FAST_BUFFER_LIMIT_BYTES / 2 : PEER_FAST_BUFFER_LIMIT_BYTES;
        if (channel.bufferedAmount + length > budget || sentThisTurn + length > budget) {
          this.schedule(); return;
        }
        const packet = useText ? item.text! : makePeerPacket(item.payload, active.id, active.offset, limit);
        try {
          if (typeof packet === 'string') channel.send(packet);
          else channel.send(packet.buffer as ArrayBuffer);
        }
        catch (error) {
          if (channel.readyState !== 'open') { this.options.failed('closed', error); return; }
          const name = error instanceof Error ? error.name : '';
          const message = error instanceof Error ? error.message : String(error);
          if (name === 'TypeError' || /max.message.size|message.*(large|big)/i.test(message)) {
            // The negotiated limit may be unavailable/stale. Retry these very same bytes
            // in smaller frames. Existing offsets remain valid at the receiver.
            if (limit <= PEER_PACKET_HEADER_BYTES + 1) {
              this.options.failed('overload', error); return;
            }
            this.retryPacketLimit = Math.max(PEER_PACKET_HEADER_BYTES + 1, Math.floor(limit / 2));
            item.text = undefined;
          } else if (name !== 'OperationError') {
            // Unknown local send faults do not prove a dead connection. Native channel /
            // connection state and the existing heartbeat remain the liveness authority.
            console.warn('[PeerLink] Lokaler Sendefehler; Nachricht bleibt zum Wiederholen vorgemerkt.', error);
          }
          this.schedule(); return;
        }
        sentThisTurn += length; active.wireBytes += length;
        active.offset += useText ? item.payload.bytes.length : length - PEER_PACKET_HEADER_BYTES;
        if (active.offset === item.payload.bytes.length) {
          this.active = null; item.sent(active.wireBytes, item);
        }
      }
    } finally { this.pumping = false; }
  }

  private schedule(): void {
    if (this.timer !== null || this.closed) return;
    // bufferedamountlow is primary; retry timer covers OperationError and browsers which
    // don't emit another low event when a send fails below the threshold.
    this.timer = setTimeout(() => { this.timer = null; this.pump(); }, 25);
  }
}

function mergeFastBatches(previous: BatchMessage, next: BatchMessage): BatchMessage {
  const globals = new Map(previous.g);
  for (const [key, value] of next.g ?? []) globals.set(key, value);
  const players = new Map<string, Map<string, [string, string, unknown]>>();
  for (const entry of [...previous.p ?? [], ...next.p ?? []]) {
    let states = players.get(entry[0]);
    if (!states) { states = new Map(); players.set(entry[0], states); }
    states.set(entry[1], entry);
  }
  const p = [...players.values()].flatMap(states => [...states.values()]);
  return { t: 'b', q: next.q, ...(globals.size ? { g: [...globals] } : {}), ...(p.length ? { p } : {}) };
}
