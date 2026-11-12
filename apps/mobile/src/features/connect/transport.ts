/**
 * The only thing Connect's session layer knows about radios. Each transport (Nearby Connections,
 * hotspot/LAN and Bluetooth LE, combined by multi-transport.ts) moves opaque, already-encrypted
 * bytes between "links" and reports what happens to them.
 */
export type LinkId = string;

export type TransportEvent =
  | { type: "found"; link: LinkId; name: string }
  | { type: "lost"; link: LinkId }
  /** Someone wants to connect (incoming) or our request reached them (outgoing). Nothing is accepted yet. */
  | { type: "request"; link: LinkId; name: string; incoming: boolean; verifier: string }
  | { type: "connected"; link: LinkId }
  | { type: "failed"; link: LinkId; reason: string }
  | { type: "disconnected"; link: LinkId }
  | { type: "data"; link: LinkId; bytes: Uint8Array };

export interface Transport {
  readonly name: string;
  /** False where the platform or build cannot run this transport. */
  available(): boolean;
  /** Make this phone visible and look for others. `displayName` is the only thing advertised. */
  start(displayName: string): Promise<void>;
  /**
   * Stop advertising and discovery but keep every link and its traffic (the app went to the
   * background, or the person turned visibility off). `start` resumes.
   */
  pause(): void;
  /** Stop advertising and discovery and drop every link. */
  stop(): void;
  connect(link: LinkId, displayName: string): Promise<void>;
  accept(link: LinkId): Promise<void>;
  reject(link: LinkId): Promise<void>;
  send(link: LinkId, bytes: Uint8Array): Promise<void>;
  disconnect(link: LinkId): void;
  /** Largest single send, in bytes. */
  readonly maxBytes: number;
  subscribe(listener: (e: TransportEvent) => void): () => void;
}
