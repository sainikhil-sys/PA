# CoworkConnect for iOS (phase C5)

**Status: UNVERIFIED.** Everything in this folder was written on Windows. It has never been compiled, linked or run. Treat the first Mac build as the real start of iOS work.

## What it is

The iOS side of the local `CoworkConnect` Expo module, with the same JavaScript functions and events as Android (`docs/connect/NATIVE_CONTRACT.md`).

| File | What it does |
|---|---|
| `CoworkConnectModule.swift` | Expo module definition: functions and events |
| `ConnectCore.swift` | Discovery, connection requests, accept and reject, byte payloads. Network framework (`NWListener`, `NWBrowser`, `NWConnection`) with `includePeerToPeer = true`, Bonjour type `_coworkp2p._tcp` |
| `FileTransfers.swift` | `sha256File`, `sendFile`, `cancelPayload`, `decryptFile`, `deleteFile` |
| `VoiceSession.swift` | `audioStart` and the other audio calls: AVAudioEngine, 16 kHz mono PCM, 20 ms frames |
| `Wire.swift` | Frame layouts, ChaCha20-Poly1305 helpers (CryptoKit `ChaChaPoly`) |
| `CoworkConnect.podspec` | Pod for autolinking (iOS 16.4+, Swift 5 language mode) |

Multipeer Connectivity is not used: Apple has deprecated it in favor of the Network framework.

## What works with what

- **iPhone to iPhone only.** iOS cannot use Google Nearby Connections, so an iPhone and an Android phone do not see each other through this module. Mixed groups need the CoworkBridge module (hotspot or BLE, phase C6).
- The encrypted file format and the audio frame format are byte-identical to Android, so a later bridge can carry them unchanged.
- The connection frames on iOS are `[u32 big-endian length][u8 type][body]`, because one TCP connection carries hellos, bytes, file chunks and audio. Byte payloads (type 4) keep Android's 32 KB limit.

## Required Info.plist keys

Add these through `app.json` (`expo.ios.infoPlist`) so `expo prebuild` writes them. Without `NSBonjourServices` the browser finds nothing; without the usage strings iOS stops the app when it asks.

```json
"ios": {
  "infoPlist": {
    "NSLocalNetworkUsageDescription": "Cowork finds and connects to nearby phones on the local network for offline Connect messages, files and voice.",
    "NSBonjourServices": ["_coworkp2p._tcp"],
    "NSMicrophoneUsageDescription": "Cowork uses the microphone for Walkie and Connect calls."
  }
}
```

No entitlement is needed for peer-to-peer Wi-Fi with the Network framework. Do not add `UIBackgroundModes` `audio` for Connect: it would not keep peer-to-peer links alive and App Review may question it.

## Background limits

- iOS has no foreground service. `startService` resolves without doing anything and `stopService` does nothing, so the same JS runs on both platforms.
- **Connect works only while the app is open.** Soon after the app leaves the screen iOS stops Bonjour advertising and browsing and drops peer-to-peer connections. When the app returns, the module restarts advertising and discovery that JS had asked for; links must be requested again.
- `showIncomingCall` returns `false` (not shown) and `onCallAction` never fires. An offline iPhone cannot be woken for a call: CallKit and Push to Talk need an Apple push from a server. Show incoming calls in the app.
- The UI must say this plainly on iOS.

## Behavior notes for the JS side

- Endpoint ids are random 16-hex Bonjour instance names, new after every `stopAll`. The TXT record holds only the display name (key `n`).
- `onConnectionInitiated.authDigits` is 4 digits from SHA-256 over both phones' random nonces and ids. Both phones show the same digits, but unlike Nearby's digits they are not tied to a key exchange. The Noise XX session and safety code above this layer remain the real identity check.
- If two iPhones request each other at the same moment, the one with the larger endpoint id drops its own request and receives the other as incoming (`incoming: true`), so exactly one side starts the Noise handshake.
- `sendFile` resolves once the encrypted temp file is built and the first frame is queued. Sender `success` means every byte went to TCP; the receiver's SHA-256 check above this layer confirms delivery.
- `audioTransmit` is async on both platforms and resolves `false` when microphone permission is off. On iOS the first call may show the permission prompt.
- `decryptFile` writes to `Documents/connect/` (excluded from iCloud backup) and only accepts files in `Caches/connect/incoming/`. `deleteFile` only deletes inside `Documents/connect/` and `Caches/connect/`.

## Build and test on a Mac

Needs: a Mac with Xcode 26 or later and CocoaPods, two iPhones on iOS 16.4 or later (iPhone 12 or later preferred), an Apple developer account for signing.

1. Pull the branch and install: `cd apps/mobile && npm install`.
2. Add the Info.plist keys above to `app.json`.
3. Generate the native project: `npx expo prebuild -p ios --clean`.
4. Install pods: `cd ios && pod install && cd ..`. Check the output lists `CoworkConnect`.
5. Open `ios/<App>.xcworkspace` in Xcode. Select the app target, Signing & Capabilities, choose your team.
6. Build once for "Any iOS Device" and fix compile errors first. This code has never been compiled; expect a few.
7. Run on iPhone A, then on iPhone B (or `npx expo run:ios --device` for each).
8. Put both phones in airplane mode, then turn Wi-Fi back on (Bluetooth can stay on). Do not join any network. This forces peer-to-peer Wi-Fi.
9. Open Connect on both. Allow Local Network when iOS asks.

Test plan (each step on both phones, with Xcode's console open):

| # | Do | Expect |
|---|---|---|
| 1 | Make both visible | Each lists the other within a few seconds (`onEndpointFound` with the right name) |
| 2 | Deny Local Network on B (Settings > Privacy & Security > Local Network), then make B visible | `startDiscovery` rejects with `ERR_CONNECT_LOCAL_NETWORK_DENIED`; turn it back on |
| 3 | A requests B | Both show the same 4 digits; B shows an approval prompt |
| 4 | B declines | Both get `onConnectionResult` with `STATUS_CONNECTION_REJECTED` |
| 5 | A requests again, B approves | Both get `onConnectionResult ok`, the Noise session reaches "secure", safety codes match |
| 6 | Tap connect on both at the same moment | One link forms; one side shows an approval prompt; no duplicate links |
| 7 | Send messages both ways, include one near 30 KB | Delivered; a payload over 32 KB rejects with `ERR_CONNECT_PAYLOAD` |
| 8 | Send a 1 MB photo and a 200 MB video | Progress events on both; `onFileReceived`, then `decryptFile` succeeds and the SHA-256 matches the sender's |
| 9 | Cancel a large transfer midway, from each side in turn | Both get `canceled`; no files left in `Caches/connect/` |
| 10 | Flip one byte in a received `.enc` file (debug build) before `decryptFile` | Rejects with `ERR_CONNECT_DECRYPT`; nothing in `Documents/connect/` |
| 11 | Walkie: hold to talk on A | B hears A within about 300 ms; level meters move; mic indicator on A shows only while holding |
| 12 | Call: start a call, talk both ways on earpiece, then speaker, then mute | Clear audio, no echo with speaker on, mute stops sending |
| 13 | Deny microphone, then hold to talk | `audioTransmit` resolves `false`, `onAudioState` error |
| 14 | During a call, receive a real phone call or trigger Siri | `onAudioState` error, then `active` after it ends |
| 15 | Walk apart until the link drops | `onDisconnected` (connected) or `onConnectionResult` fail (pending) within about 15 seconds |
| 16 | Send A to the background for 30 seconds, then return | Links drop (expected); A is visible again without restarting Connect |
| 17 | Lock B during a call | Call ends within seconds (expected on iOS); the UI explains it |
| 18 | Instruments (Leaks, Allocations) over a 10-minute call and a 1 GB transfer | No leak growth; memory stays flat |

Record the results and any compile fixes before calling C5 done.
