# Cowork Connect: technical feasibility audit and native architecture proposal

Date: 2026-11-12. Status: **proposal for review**. No application file was changed for this document.

Scope: the Cowork Connect brief (offline messaging, SnapShare, Walkie, offline calls, social features), measured against the real Cowork codebase and against what Android and iOS actually allow. Platform facts below were checked against the official documentation on this date; anything the documentation does not state is marked **unverified** and must be proven on real devices before we rely on it.

---

## 1. Summary

1. **Android to Android offline works well** through Google's Nearby Connections (Bluetooth, BLE and Wi-Fi, fully offline, files of any size, streams). This is the right first target.
2. **iPhone to iPhone offline works** through Apple's Network framework with peer-to-peer Wi-Fi. Multipeer Connectivity, which the brief names, is now **deprecated** by Apple.
3. **Android to iPhone offline is the hard part.** No single system framework connects them. Three realistic paths exist (section 4); the most capable one needs one phone to host a local Wi-Fi hotspot.
4. **iOS cannot keep offline sessions alive in the background.** Apple's peer-to-peer stops when the app leaves the screen, and Apple's Push to Talk framework wakes the app only through Apple's push service, which needs the internet. Offline Walkie and offline incoming calls on iPhone work **only while Cowork is open**.
5. **Most of section E (Social Ecosystem) is online by nature**: circles, communities, events, AI planning and meme creation need the server and the AI provider. They are normal server features, not offline ones, and should be planned separately.
6. **We cannot build or test iOS on this machine.** iOS builds need a Mac with Xcode (or Expo's cloud builds with a paid Apple Developer account), and testing needs iPhones.
7. **We cannot test offline features with the hardware on hand.** One Android phone (OPPO CPH2763) is available. Emulators have no real Bluetooth or Wi-Fi Direct. Each feature needs at least two real phones in airplane mode with Bluetooth and Wi-Fi turned on.

---

## 2. Where Cowork stands today

| Area | Today | What it means for Connect |
|---|---|---|
| App framework | Expo SDK 58, React Native 0.88, Expo Router, a custom development build (not Expo Go) | Native peer-to-peer is possible through our own native modules. Expo Go can never run it. |
| Native code | One local Expo module (`apps/mobile/modules/phone-link`, Kotlin notification listener) builds and runs | The pattern for adding Kotlin (and later Swift) modules is proven in this repo. |
| Platforms | Android builds only. No iOS project has ever been built. | Every iOS item in this plan is new work and needs a Mac or cloud builds. |
| Identity | Email code sign-in, server sessions, Bearer token in SecureStore | Device identity keys are new. Server accounts can vouch for which keys belong to which person when online. |
| Storage | Server Postgres. On the phone: SecureStore and a query cache, no local database | Offline messages need a local database (for example `expo-sqlite`). |
| Real-time | None. No sockets, no WebRTC | All transport, session and media code is new. |
| Design | Dark theme, orange accent; the V2 work is adding a light theme and new navigation | Connect screens must use the V2 design system once it lands (see decision D6). |

---

## 3. Platform capabilities (verified against official documentation)

### Android

| Technology | Facts from the docs | Use in Connect |
|---|---|---|
| **Nearby Connections** (Google Play services) | "Fully-offline peer-to-peer" over "a combination of Bluetooth, BLE, and Wi-Fi". Payloads: bytes (up to 32 KB each), files of any size, streams. Setup documented for Android only. | Primary Android to Android transport: discovery, messages, files, voice streams |
| **Wi-Fi Aware** | Android 8.0 (API 26) and later. Gives a real IPv6 network between peers. Hardware dependent and can be unavailable while Wi-Fi Direct, hotspot or tethering is on; apps must watch for state changes. Discovery messages about 255 bytes. | Optional high-bandwidth path; possible bridge to iOS 26 (unverified) |
| **Wi-Fi Direct** | `discoverPeers()` and `connect()` need `NEARBY_WIFI_DEVICES` when targeting Android 13+; Location Mode must be on for discovery. The docs do not cover iOS. | Covered by Nearby Connections internally; not needed directly |
| **Local-only hotspot** | Android can create a hotspot without internet sharing | Cross-platform bridge (section 4, path B) |
| **Bluetooth LE** | Both central and peripheral roles | Cross-platform discovery and small messages (section 4, path A) |

Android permissions (from the Nearby Connections setup page), all requested at runtime:

- Android 12 and later: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`
- Android 13 and later: `NEARBY_WIFI_DEVICES`, marked "never for location"
- Android 10 to 12L: `ACCESS_FINE_LOCATION`. This must be disclosed: Cowork never stores or sends location, but older Android versions require the permission for scanning.
- Android 17 when targeting SDK 37 (Cowork already compiles against SDK 37): `ACCESS_LOCAL_NETWORK` for Wi-Fi LAN.

### iOS

| Technology | Facts from the docs | Use in Connect |
|---|---|---|
| **Multipeer Connectivity** | **Deprecated**: Apple says to migrate to the Network framework. Uses infrastructure Wi-Fi, peer-to-peer Wi-Fi and Bluetooth. When the app goes to the background it stops advertising and browsing and disconnects sessions. | Do not use |
| **Network framework, peer-to-peer** | Apple's recommended replacement (Bonjour discovery with peer-to-peer Wi-Fi). Needs `NSLocalNetworkUsageDescription` and `NSBonjourServices`. | Primary iPhone to iPhone transport |
| **Wi-Fi Aware** | iOS 26 and later, iPhone 12 and later. Needs the `com.apple.developer.wifi-aware` entitlement and pairing through DeviceDiscoveryUI or AccessorySetupKit. Works with no internet, in foreground and background once paired. Apple documents connections to "Wi-Fi Aware certified accessories"; **interoperability with Android phones is not stated (unverified)**. | Possible future Android to iPhone path, only if proven on devices |
| **Push to Talk framework** | iOS 16 and later. Wakes the app for incoming audio using an Apple push token. | Online Walkie only. It cannot wake an iPhone for offline audio. |
| **Bluetooth LE** | Central and peripheral roles. Background advertising is heavily limited by iOS. | Cross-platform discovery and small messages |

---

## 4. The Android to iPhone problem

| Path | How | Bandwidth | Works for | Limits |
|---|---|---|---|---|
| **A. Bluetooth LE** | Both phones run the same BLE service (one advertises, one scans), exchange keys and small encrypted messages | Low (kilobytes per second) | Discovery, text, small images | Too slow for video and voice; limited in iOS background |
| **B. Hotspot bridge** | The Android phone opens a local-only hotspot. The iPhone joins it (QR code with the network name and password, then a system join prompt). Both talk over normal IP: discovery with Bonjour, data over encrypted TCP, voice with WebRTC host candidates. | High | Everything: messages, files, Walkie, calls | Needs an Android phone in the group to host. The iPhone loses its normal Wi-Fi while joined. iPhones cannot host for Android without a cellular plan. |
| **C. Wi-Fi Aware on both** | iOS 26 Wi-Fi Aware and Android Wi-Fi Aware | High | Everything | **Unverified** for phone to phone. Needs iPhone 12+ with iOS 26, an Android phone with Wi-Fi Aware hardware, and Apple's entitlement. Research spike only. |
| **D. Same Wi-Fi network** | Both phones on one router (campus or home) with no internet | High | Everything | Needs a shared network. Many campus networks block device-to-device traffic. |

Recommendation: ship Android to Android first, then iPhone to iPhone, then path B for mixed groups. Keep path A for discovery and text when no hotspot is available. Treat path C as a research spike.

---

## 5. Proposed architecture

```
 Screens: Nearby, Chats, SnapShare, Walkie, Calls, Circles
 (Expo Router, V2 design system, light and dark)
        |
 Connect service (TypeScript, apps/mobile/src/features/connect)
   presence and consent | conversations | transfers | voice | sync queue
        |
 Session layer (TypeScript + native crypto)
   identity keys | Noise XX handshake | per-peer encryption | framing | integrity (SHA-256)
        |
 Transport interface  <- the only thing the layers above know
   discover() | advertise() | connect(peer) | send(bytes) | sendFile(stream) | openMedia(peer)
        |
 Native transports (one local Expo module, "cowork-connect")
   Android (Kotlin):  NearbyConnectionsTransport | HotspotLanTransport | BleTransport
   iOS (Swift):       NetworkP2PTransport        | LanTransport        | BleTransport
        |
 Local store: expo-sqlite (messages, transfers, peers, keys metadata); files in app storage
 Sync: when online, Cowork server relays queued messages and backs up history (only if the person opts in)
```

### Key design points

- **One transport interface.** Screens and services never call Bluetooth or Wi-Fi APIs directly. A transport only moves encrypted bytes and reports peers, so Android-only and iOS-only technologies can be swapped without touching the UI.
- **Encryption above the transport.** Nearby Connections and Wi-Fi Aware encrypt their own links, but Cowork cannot rely on that across every transport. Each install creates an identity key pair stored in the Android Keystore or the iOS Secure Enclave. Peers run a Noise XX handshake (mutual authentication, forward secrecy) and then encrypt every frame with ChaCha20-Poly1305. People confirm a new contact by scanning a QR code or comparing a short safety code. When online, the server can vouch that a key belongs to a Cowork account.
- **Media on IP links only.** Walkie and calls use Opus audio. On IP transports (hotspot, LAN, Wi-Fi Aware, iPhone peer-to-peer) the plan is WebRTC with host candidates, with signaling over the encrypted Connect session. On Nearby Connections, audio uses Nearby stream payloads with Opus frames. There is no voice over Bluetooth LE.
- **Files.** Chunked transfer with progress, cancel and resume, a SHA-256 check before a file is shown, and the receiver's approval with a preview before anything is downloaded. "Disappearing" media is deleted from Cowork's storage after viewing. The doc and UI must say plainly that a screenshot or another app can still keep a copy.
- **Background.** On Android, a foreground service with the `connectedDevice` and `microphone` types, with a visible notification, keeps Walkie and calls alive. On iOS, Connect works only while the app is open. The UI says so.

---

## 6. Feature feasibility

Legend: **Yes** = feasible with the stated transport; **Open** = only while the app is open; **Online** = needs internet and the Cowork server; **No** = not feasible as specified.

| Feature | Android to Android | iPhone to iPhone | Android to iPhone | Notes |
|---|---|---|---|---|
| Nearby discovery (with consent) | Yes | Yes (Open) | Yes via BLE or hotspot | Off by default, a visible switch, and a timer that turns it off |
| 1:1 and group messages | Yes | Yes (Open) | Yes (BLE: text only; hotspot: full) | Group size limited by transport (to be measured) |
| Images, video, documents | Yes | Yes (Open) | Hotspot or LAN only | Bluetooth LE too slow for video |
| Voice messages | Yes | Yes (Open) | Hotspot or LAN for large files | Recorded clips, sent like files |
| Transfer progress, cancel, approval, preview, integrity | Yes | Yes | Yes | Session layer feature |
| Device authentication, encryption | Yes | Yes | Yes | Section 5 |
| Local persistence, sync when online | Yes | Yes | Yes | Sync relays through the Cowork server; opt in |
| SnapShare (camera, multi-device, history) | Yes | Yes (Open) | Hotspot or LAN | `expo-camera` needed |
| Walkie (push to talk, channels, voice activity) | Yes, also in background with a foreground service | Open only | Hotspot or LAN | "Channels" are software groups, not radio frequencies |
| Offline 1:1 and group calls | Yes | Open only, no incoming call while closed | Hotspot or LAN | Group calls need a mesh or one phone mixing; small groups first (2 to 4) |
| Incoming call screen while the app is closed (offline) | Yes, with a full-screen notification permission | **No** | **No** on the iPhone side | iOS needs Apple's push service to ring a closed app |
| Private circles, communities, events | Online | Online | Online | Server features |
| Nearby friend discovery, live presence | Yes, consent based | Yes (Open) | Partly | Shows "nearby", never a location |
| Business cards | Yes | Yes | Yes | Exchanged as a signed card over any transport or QR |
| Temporary rooms, study rooms, Focus Together | Offline with the transports above, or Online | same | same | |
| Collaborative notes | Offline merge is complex (CRDT) | same | same | Recommend online first |
| Quick polls | Yes | Yes | Yes | Small messages |
| AI group planning, AI memes | Online | Online | Online | Needs the AI provider. AI image generation is not configured on the server today. |
| Shared music sessions | Online, and licensing limits apply | | | Spotify playback needs Premium and the internet. Streaming local files to others raises licensing problems. Recommend dropping or narrowing. |

---

## 7. Privacy and safety

- Nearby discovery is **off by default**, needs an explicit choice, shows an on-screen indicator while active, and turns itself off after a set time.
- Peers see a chosen display name and an avatar, never an email, phone number, location or hardware identifier. The advertised identifier rotates.
- Every incoming connection, transfer and call needs approval. A local block list and "report" are always available. Reports are queued and sent to the server when online.
- Rate limits are enforced locally (connection attempts, messages per minute) and on the server when syncing.
- Keys stay in the Keystore or Secure Enclave. Message databases are stored in app-private storage, and Android backup is already disabled for Cowork.
- Store requirements:
  - Google Play needs the nearby-devices permission rationale, foreground service type declarations, and Data safety answers (messages, files, voice).
  - Apple needs the local network and Bluetooth usage strings and a background mode justification.
  - Minors are a review risk for "Gen Z" social discovery features. The audience rating and safety tooling need a product decision.

---

## 8. Test requirements

| Need | Status |
|---|---|
| 2 or more Android phones with Bluetooth and Wi-Fi (ideally different brands, Android 12 to 17) | 1 available (OPPO CPH2763) |
| 2 or more iPhones (iPhone 12+ with iOS 26 for the Wi-Fi Aware spike) | None known |
| Mac with Xcode, or Expo cloud builds plus an Apple Developer account ($99 per year) | None |
| Test protocol | Airplane mode on, Bluetooth and Wi-Fi turned back on, no router nearby; measure discovery time, throughput, voice latency and battery; repeat across brands |

No offline feature will be called working until it has passed this protocol on real devices.

---

## 9. Proposed phases (each ends with a device test and your review)

| Phase | Deliverable | Needs |
|---|---|---|
| C0 | This document approved; decisions D1 to D7 answered | You |
| C1 | Transport interface, Android Nearby Connections transport, consent flow, encrypted 1:1 text between two Android phones, local message store | 2 Android phones |
| C2 | Files, images, voice messages, SnapShare (preview, approve, integrity, history) on Android | C1 |
| C3 | Walkie on Android (channels, push to talk, foreground service) | C1 |
| C4 | Offline 1:1 calls on Android, then small group calls | C3 |
| C5 | iOS build, Network framework transport, iPhone to iPhone for C1 to C4 (foreground) | Mac or cloud builds, iPhones |
| C6 | Mixed groups: hotspot bridge (path B) plus Bluetooth LE text fallback (path A) | C5 |
| C7 | Online social features: circles, events, communities, polls, business cards, AI planning | Server work; scope per decision D5 |
| C8 | Security review (handshake, key handling, abuse), performance and battery testing | All of the above |

---

## 10. Decisions needed before any code

| # | Decision |
|---|---|
| D1 | Start with **Android only** (C1 to C4) and add iOS later? Recommended. |
| D2 | How will we test: buy or borrow a second Android phone now; which iPhones and Mac for C5? |
| D3 | Is Android-to-iPhone through a hotspot (path B) acceptable for mixed groups, given the iPhone must join the Android phone's Wi-Fi? |
| D4 | Should offline messages sync to the Cowork server when online (backup and multi-device), or stay on the phones only? |
| D5 | Which social features (section 6, E) are in scope, and which are online-only? Shared music sessions: drop or narrow? |
| D6 | Connect screens follow the V2 design system and navigation being built in the V2 session: confirm where Connect sits in the new tabs (proposed: one "Connect" tab with Nearby, Chats, SnapShare, Walkie, Calls and Circles inside). |
| D7 | Audience: is Connect for adults only (18+), matching Cowork's current rating, or should it target younger users? This changes safety and review requirements. |

## Sources

- Google Nearby Connections: developers.google.com/nearby/connections/overview and /android/get-started
- Android Wi-Fi Aware: developer.android.com/develop/connectivity/wifi/wifi-aware
- Android Wi-Fi Direct: developer.android.com/develop/connectivity/wifi/wifip2p
- Apple Wi-Fi Aware, Multipeer Connectivity, Push to Talk: developer.apple.com/documentation/wifiaware, /multipeerconnectivity, /pushtotalk
