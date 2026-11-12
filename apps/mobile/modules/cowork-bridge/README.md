# cowork-bridge

Cowork Connect phase C6: transports that work between Android and iPhone. The Noise session in
`src/features/connect` runs over them unchanged; this module only moves opaque bytes.

| Transport | Android | iPhone | Link ids | Max message |
|---|---|---|---|---|
| Hotspot + LAN | Hosts a LocalOnlyHotspot, TCP server, NSD `_coworkconnect._tcp`; browses any shared Wi-Fi | Joins the hotspot (`joinHotspot`), Bonjour browse and advertise, TCP | `lan:<service>`, `lan:addr:<host>:<port>`, `lan:in:<n>` | 65,535 bytes |
| Bluetooth LE | GATT server + client, service `6f3d0001-7c5e-4a8b-9a0e-6c6f776f726b` | CoreBluetooth central + peripheral, same UUIDs | `ble:<address or UUID>`, `ble:c:<address or UUID>` | 4,096 bytes |

The wire protocol (HELLO / ACCEPT / REJECT / DATA, TCP framing, BLE chunking) is specified and tested in
`protocol.ts`; `android/.../Wire.kt` and `ios/Wire.swift` mirror it. Nothing reaches JavaScript before
both people accept, and payloads are never logged.

Status: the TypeScript (`index.ts`, `protocol.ts`, the transports) is typechecked and unit tested.
The Kotlin has not been compiled yet. **All Swift is UNVERIFIED**: it was written without Xcode and
must be built and tested on a Mac.

## iOS setup (the lead adds these through app.json)

Info.plist keys:

- `NSLocalNetworkUsageDescription`: for example "Cowork finds people near you on the same Wi-Fi or hotspot."
- `NSBonjourServices`: `["_coworkconnect._tcp"]` (without it, NWBrowser and NWListener fail silently on iOS 14+).
- `NSBluetoothAlwaysUsageDescription`: for example "Cowork uses Bluetooth to message people near you without internet."

Entitlement:

- `com.apple.developer.networking.HotspotConfiguration` = `true` (Hotspot Configuration capability on the
  App ID). `joinHotspot` fails without it.

No background modes are needed: Connect only runs in the foreground.

## Android setup

The module manifest declares everything it needs; it matches cowork-connect's entries so the merge is clean.
Runtime permissions to request before calling the module. The existing `nearbyPermissions()` list covers
API 29 and later; on API 24 to 28 it asks for nothing, so hosting and BLE scanning there also need
`ACCESS_FINE_LOCATION`:

- `lanHostStart`: `ACCESS_FINE_LOCATION` on API 26 to 32 (and location turned on), `NEARBY_WIFI_DEVICES` on 33+.
- `lanBrowseStart`: none below API 37; `ACCESS_LOCAL_NETWORK` on 37+.
- `bleStart`: `BLUETOOTH_SCAN`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` on 31+; `ACCESS_FINE_LOCATION` on 24 to 30.

Notes: phones without Wi-Fi STA + AP concurrency drop their own Wi-Fi while hosting. Android 8 to 9 only
allow one LocalOnlyHotspot app at a time. Some vendors do not advertise NSD on the hotspot interface, so
`lanHostStart` also returns a best-effort `host` for `lanConnectAddress` (put it in the QR code).

## Errors

Rejections carry `ERR_BRIDGE_*` codes with messages the connect store's `readable()` already maps:
`BLUETOOTH_OFF`, `BLUETOOTH_UNSUPPORTED`, `MISSING_PERMISSION`, `WIFI_*`, `TIMEOUT`, `NOT_CONNECTED`,
`ENDPOINT_IO_ERROR`. Failed connection attempts arrive as `onLanConnected` / `onBleConnected` with
`ok: false` and `status` one of `REJECTED`, `TIMEOUT`, `CONNECTION_LOST`, `PROTOCOL_ERROR`, `NOT_COWORK`.
