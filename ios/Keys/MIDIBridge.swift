import CoreMIDI
import Foundation
import WebKit

/// Bridges CoreMIDI into the page, implementing the contract in src/listen/platform.ts:
/// - document start: `window.keysNative = { platform: 'ios', midi: true, devices, version }`
/// - each channel voice message: `keysnative:midi` CustomEvent with `{ data: [status, d1, d2], device }`
/// - device changes: update `keysNative.devices`, then `keysnative:devices` with `{ names }`
///
/// All CoreMIDI sources are connected (USB, network, virtual). Bluetooth MIDI needs pairing via
/// CABTMIDICentralViewController first, which this app doesn't offer yet.
@MainActor
final class MIDIBridge {
    private weak var webView: WKWebView?
    private var client = MIDIClientRef()
    private var inputPort = MIDIPortRef()
    private var connected: [MIDIEndpointRef] = []
    /// Endpoint → display name. Main thread only.
    private var names: [MIDIEndpointRef: String] = [:]
    private(set) var deviceNames: [String] = []

    func attach(_ webView: WKWebView) {
        self.webView = webView
        startMIDI()
        refreshSources()
        installUserScript()
    }

    // MARK: CoreMIDI

    private func startMIDI() {
        let status = MIDIClientCreateWithBlock("Keys" as CFString, &client, MIDIBridge.makeNotifyBlock(self))
        guard status == noErr else {
            NSLog("Keys: MIDIClientCreate failed (\(status))")
            return
        }
        let portStatus = MIDIInputPortCreateWithProtocol(client, "Keys Input" as CFString, ._1_0, &inputPort,
                                                         MIDIBridge.makeReceiveBlock(self))
        if portStatus != noErr {
            NSLog("Keys: MIDIInputPortCreate failed (\(portStatus))")
        }
    }

    // The CoreMIDI blocks run on CoreMIDI's own threads, so they're built in nonisolated
    // functions (they must not inherit main-actor isolation) and hop to main themselves.

    nonisolated private static func makeNotifyBlock(_ bridge: MIDIBridge) -> MIDINotifyBlock {
        return { [weak bridge] notification in
            switch notification.pointee.messageID {
            case .msgSetupChanged, .msgObjectAdded, .msgObjectRemoved, .msgPropertyChanged:
                DispatchQueue.main.async { MainActor.assumeIsolated { bridge?.refreshSources() } }
            default:
                break
            }
        }
    }

    nonisolated private static func makeReceiveBlock(_ bridge: MIDIBridge) -> MIDIReceiveBlock {
        return { [weak bridge] eventList, srcRefCon in
            // Parse on the MIDI thread; hop straight to main (no batching) to call into WebKit.
            let source = MIDIEndpointRef(truncatingIfNeeded: UInt(bitPattern: srcRefCon))
            let messages = MIDIBridge.channelVoiceMessages(eventList)
            guard !messages.isEmpty else { return }
            DispatchQueue.main.async { MainActor.assumeIsolated { bridge?.forward(messages, from: source) } }
        }
    }

    /// Reconnects every source and publishes the (possibly changed) device names. Main thread.
    func refreshSources() {
        guard inputPort != 0 else { return }
        for source in connected { MIDIPortDisconnectSource(inputPort, source) }
        connected.removeAll()
        names.removeAll()

        var list: [String] = []
        for i in 0..<MIDIGetNumberOfSources() {
            let source = MIDIGetSource(i)
            guard source != 0 else { continue }
            // The endpoint ref travels as the connection refCon so events know their device.
            let refCon = UnsafeMutableRawPointer(bitPattern: UInt(source))
            if MIDIPortConnectSource(inputPort, source, refCon) == noErr {
                connected.append(source)
                let name = MIDIBridge.displayName(of: source)
                names[source] = name
                list.append(name)
            }
        }

        if list != deviceNames {
            deviceNames = list
            installUserScript()
            sendDevices()
        }
    }

    nonisolated private static func displayName(of endpoint: MIDIEndpointRef) -> String {
        for key in [kMIDIPropertyDisplayName, kMIDIPropertyName] {
            var value: Unmanaged<CFString>?
            if MIDIObjectGetStringProperty(endpoint, key, &value) == noErr, let s = value?.takeRetainedValue() {
                let name = s as String
                if !name.isEmpty { return name }
            }
        }
        return "MIDI device"
    }

    /// Extracts MIDI 1.0 channel voice messages (UMP type 0x2) as [status, d1, d2].
    nonisolated static func channelVoiceMessages(_ list: UnsafePointer<MIDIEventList>) -> [[UInt8]] {
        var out: [[UInt8]] = []
        let wordsOffset = MemoryLayout<MIDIEventPacket>.offset(of: \MIDIEventPacket.words)!
        for packet in list.unsafeSequence() {
            let count = Int(packet.pointee.wordCount)
            let words = (UnsafeRawPointer(packet) + wordsOffset).assumingMemoryBound(to: UInt32.self)
            var i = 0
            while i < count {
                let word = words[i]
                let type = UInt8(word >> 28)
                if type == 0x2 {
                    let status = UInt8((word >> 16) & 0xFF)
                    let d1 = UInt8((word >> 8) & 0x7F)
                    let d2 = UInt8(word & 0x7F)
                    if status >= 0x80 && status < 0xF0 {
                        out.append([status, d1, d2])
                    }
                }
                i += umpWordCount(type)
            }
        }
        return out
    }

    /// Words per Universal MIDI Packet by message type (UMP spec table).
    nonisolated private static func umpWordCount(_ type: UInt8) -> Int {
        switch type {
        case 0x0, 0x1, 0x2, 0x6, 0x7: return 1
        case 0x3, 0x4, 0x8, 0x9, 0xA: return 2
        case 0xB, 0xC: return 3
        default: return 4 // 0x5, 0xD, 0xE, 0xF
        }
    }

    // MARK: Web bridge

    private func forward(_ messages: [[UInt8]], from source: MIDIEndpointRef) {
        guard let webView else { return }
        let device = json(names[source] ?? MIDIBridge.displayName(of: source))
        var js = ""
        for m in messages {
            js += "window.dispatchEvent(new CustomEvent('keysnative:midi',{detail:{data:[\(m[0]),\(m[1]),\(m[2])],device:\(device)}}));"
        }
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Sends the current device list to the loaded page.
    func sendDevices() {
        guard let webView else { return }
        let list = json(deviceNames)
        let js = """
        (function(){var n=\(list);window.keysNative=window.keysNative||{platform:'ios',midi:true,version:\(json(AppConfig.version))};\
        window.keysNative.devices=n.slice();\
        window.dispatchEvent(new CustomEvent('keysnative:devices',{detail:{names:n}}));})();
        """
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Document-start script; re-installed when devices change so reloads see the current list.
    private func installUserScript() {
        guard let controller = webView?.configuration.userContentController else { return }
        let source = "window.keysNative={platform:'ios',midi:true,devices:\(json(deviceNames)),version:\(json(AppConfig.version))};"
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    private func json(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject([value]),
              let data = try? JSONSerialization.data(withJSONObject: [value]),
              var s = String(data: data, encoding: .utf8) else { return "null" }
        // Unwrap the [value] array used to allow top-level strings.
        s.removeFirst(); s.removeLast()
        return s
    }
}
