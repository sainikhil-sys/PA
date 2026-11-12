# Cowork Connect native contract

The JavaScript API the native modules expose, so native and feature work can proceed in parallel. All names are final unless this file changes. Android is built and tested here; iOS code is written to the same contract but cannot be compiled on this machine.

Security rule for everything below: **native code never chooses keys.** JavaScript generates random 32-byte keys, sends them to the other person inside the Noise-encrypted session (`sendToPeer`), and passes them to native as base64. Native only applies ChaCha20-Poly1305 with the given key and a counter nonce. A key is never reused for two files or two audio senders.

Nonce format everywhere: 12 bytes = 4 zero bytes + 8-byte **little-endian** counter starting at 0, as in Noise. Associated data: empty.

## Module `CoworkConnect` (existing, extended) — `apps/mobile/modules/cowork-connect`

Existing (phase C1): `startAdvertising`, `startDiscovery`, `stopAdvertising`, `stopDiscovery`, `stopAll`, `requestConnection`, `acceptConnection`, `rejectConnection`, `sendBytes`, `disconnect`, events `onEndpointFound`, `onEndpointLost`, `onConnectionInitiated`, `onConnectionResult`, `onDisconnected`, `onPayload`.

`stopAdvertising()` and `stopDiscovery()` stop being found and finding others but keep every connected endpoint. JavaScript calls them when the app goes to the background or visibility turns off, so Walkie, calls and chats survive the screen turning off. Only `stopAll()` (an explicit "Disconnect everyone", sign-out or reset) drops endpoints.

Which calls are async: `startAdvertising`, `startDiscovery`, `requestConnection`, `acceptConnection`, `rejectConnection`, `sendBytes`, `sha256File`, `sendFile`, `decryptFile`, `audioStart` (`Promise<void>`), `audioTransmit` (`Promise<boolean>`), `startService` (`Promise<void>`) and `showIncomingCall` (`Promise<boolean>`). Everything else is synchronous and returns nothing.

iOS (`CoworkConnectModule.swift`, Network framework peer-to-peer Wi-Fi, iPhone to iPhone, Bonjour `_coworkp2p._tcp`): one TCP connection per link carries everything, framed as `[u32 big-endian length][u8 type][body]` where length = 1 + body length (at most 256 KiB). Types: 1 hello (JSON `{v, id, name, nonce}`), 2 accept, 3 reject, 4 bytes (a `sendBytes` payload, at most 32 KB), 5 fileStart `[u64 BE payloadId][u64 BE encrypted size]`, 6 fileChunk `[u64 BE payloadId][encrypted bytes]`, 7 fileEnd `[u64 BE payloadId]`, 8 fileCancel `[u64 BE payloadId]`, 9 audio (an audio frame as below). The Swift code is written to this contract but has not been compiled.

### Files (C2)

| Call | Returns | Notes |
|---|---|---|
| `sha256File(uri: string)` | `Promise<string>` hex | SHA-256 of a local file (file:// or content://), streamed |
| `sendFile(endpointId, uri, keyB64)` | `Promise<string>` payloadId | Reads the file in 64 KiB chunks. Each chunk is sealed with the key and counter nonce, written as `[u32 big-endian length][ciphertext]` to an encrypted temp file, then sent as a Nearby FILE payload |
| `cancelPayload(payloadId)` | `void` | Cancels a send or a receive |
| `decryptFile(path, keyB64, fileName)` | `Promise<{ uri, size, sha256 }>` | Decrypts a received file into app storage (`files/connect/<safe name>`), deletes the encrypted copy, returns the plaintext SHA-256. Rejects on any failed tag (tampered file) |
| `deleteFile(uri)` | `void` | Deletes a Connect file (disappearing media, delete transfer) |

Truncation: chunks are sealed independently with a counter nonce, so a file cut off exactly at a chunk boundary still decrypts without a failed tag, only shorter. `decryptFile` cannot detect that on its own: JavaScript must compare the returned `sha256` **and** `size` with the sender's `file.offer` before showing the file, and delete it on a mismatch.

Events:
- `onTransferUpdate { endpointId, payloadId, incoming: boolean, bytesTransferred, totalBytes, status: "in_progress" | "success" | "failure" | "canceled" }`
- `onFileReceived { endpointId, payloadId, path }` once an incoming FILE payload completes (path in app cache)

### Audio (C3 Walkie, C4 calls)

PCM 16-bit mono 16 kHz, 20 ms frames (640 bytes). Each sender seals frames with its own key; stream frames are `[u16 big-endian length][u64 counter little-endian][ciphertext + 16-byte tag]`, where the length counts the ciphertext and the tag (656 for a full frame) but not the counter. They are sent on one Nearby STREAM payload per listener (on iOS, as a type 9 link frame). Receivers keep one AudioTrack per sender and drop frames whose counter is not greater than the last one (replay and reorder protection).

| Call | Notes |
|---|---|
| `audioStart({ sendKey: string, peers: { endpointId: string, recvKey: string }[], mode: "walkie" \| "call" })` | Opens the audio session. Mic stays off until `audioTransmit(true)` |
| `audioAddPeer(endpointId, recvKey)` / `audioRemovePeer(endpointId)` | Group changes |
| `audioTransmit(on: boolean)` | Push to talk (Walkie) or mic on (call). Resolves `false` when the microphone permission is off (an `onAudioState` error follows); rejects when audio is not active |
| `audioSetMuted(muted: boolean)` | Call mute |
| `audioSetSpeaker(on: boolean)` | Loudspeaker or earpiece |
| `audioStop()` | Ends the session, releases mic and tracks |

Events: `onAudioLevel { endpointId: string /* "self" for the mic */, level: number /* 0..1 */ }` about 10 times a second while active; `onAudioState { state: "idle" | "active" | "error", message?: string }`.

### Foreground service (C3, C4)

| Call | Notes |
|---|---|
| `startService({ kind: "walkie" \| "call", title: string, body: string })` | Foreground service (types `connectedDevice` and, for audio, `microphone`) with an ongoing notification, so audio continues with the screen off. Requires RECORD_AUDIO already granted |
| `stopService()` | |
| `showIncomingCall({ callId, name })` / `clearIncomingCall(callId)` | High-priority notification with Accept and Decline actions (no full-screen intent: Google Play limits that to calling apps). `showIncomingCall` resolves `false` when the notification could not be shown (show the call in the app instead); iOS always resolves `false` |

Event: `onCallAction { callId, action: "accept" | "decline" }`.

## Module `CoworkBridge` (new) — `apps/mobile/modules/cowork-bridge` (C6)

Cross-platform transports. Link ids are prefixed: `lan:` and `ble:`. The same Noise session runs over them.

### Hotspot and LAN (Android hosts; iPhone joins)

| Call | Notes |
|---|---|
| `lanHostStart(name)` | Android: LocalOnlyHotspot plus a TCP server advertised over NSD as `_coworkconnect._tcp`. Resolves `{ ssid, passphrase, port, host }` for a QR code (`host` is a best-effort IPv4 address, or null) |
| `lanHostStop()` | |
| `lanBrowseStart(name)` / `lanBrowseStop()` | Browse `_coworkconnect._tcp` on the current Wi-Fi (works on any shared network, not only the hotspot). `lanBrowseStart` also opens the TCP server and **advertises** this phone under `name`, so it is found as well as finding others. `lanBrowseStop` closes the server and every LAN link unless a hotspot is hosted |
| `lanBrowsePause()` | Stops browsing and advertising but keeps the server, every link and a hosted hotspot (app in the background). `lanBrowseStart` resumes |
| `lanConnectAddress(host, port)` | Connects straight to an address from a QR code when Bonjour/NSD cannot see the host. Resolves the new link id |
| `lanConnect(linkId)` / `lanAccept(linkId)` / `lanReject(linkId)` / `lanSend(linkId, base64)` / `lanDisconnect(linkId)` | Same semantics as Nearby; frames are `[u32 big-endian length][body]`, body `[u8 kind][payload]` (`modules/cowork-bridge/protocol.ts`) |
| iOS only: `joinHotspot(ssid, passphrase)` | NEHotspotConfiguration join prompt |

Events mirror Nearby with an `onLan` prefix: `onLanFound { linkId, name }`, `onLanLost { linkId }`, `onLanRequest { linkId, name, incoming }`, `onLanConnected { linkId, ok, status }` (`ok` false means the link failed and `status` says why), `onLanDisconnected { linkId }`, `onLanPayload { linkId, data }`, and on Android `onLanHostStopped { reason }` when the system stops the LocalOnlyHotspot (another app, tethering, Wi-Fi off).

### Bluetooth LE (text fallback)

`bleStart(name)`, `bleStop()`, `blePause()`, `bleConnect`, `bleAccept`, `bleReject`, `bleSend(linkId, base64)` (max 4 KB, chunked inside), `bleDisconnect`; events `onBleFound`, `onBleLost`, `onBleRequest`, `onBleConnected { linkId, ok, status }`, `onBleDisconnected`, `onBlePayload`. Service UUID `6f3d0001-7c5e-4a8b-9a0e-6c6f776f726b`. `bleStop` closes every link; `blePause` stops scanning and advertising but keeps the GATT server and every link (app in the background), and `bleStart` resumes. Bluetooth LE carries text only: files and audio never go over `ble:` links, and every Noise frame must fit in 4 KB.

The async bridge calls (`lanHostStart`, `lanBrowseStart`, `lanConnect`, `lanConnectAddress`, `lanAccept`, `lanReject`, `lanSend`, `joinHotspot`, `bleStart`, `bleConnect`, `bleAccept`, `bleReject`, `bleSend`) return promises; the stop, pause and disconnect calls are synchronous.

JavaScript combines the three transports in `src/features/connect/multi-transport.ts`: links starting `lan:` go to the bridge LAN calls, `ble:` to the bridge BLE calls, anything else to Nearby. A phone found on several radios under the same name is listed once, on the fastest.

## JavaScript bus (exists) — `src/features/connect/connect-store.ts`

`onConnectMessage(type, handler)`, `sendToPeer(peerKey, message)`, `securePeers()`, `peerForLink(link)`, `linkForPeer(state, peerKey)`. Message types used by features:

| Feature | Types |
|---|---|
| Files, SnapShare, voice messages | `file.offer`, `file.accept`, `file.decline`, `file.sent`, `file.cancel`, `file.viewed` |
| Groups | `group.invite`, `group.msg`, `group.leave` |
| Walkie | `walkie.channel`, `walkie.join`, `walkie.leave`, `walkie.key`, `walkie.ping`, `walkie.pong` |
| Calls | `call.invite`, `call.accept`, `call.decline`, `call.end`, `call.key` |
| Social (offline parts) | `card.share`, `poll.*`, `room.*`, `focus.*`, `note.*` |
