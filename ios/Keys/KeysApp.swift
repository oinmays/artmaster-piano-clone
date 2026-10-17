import AVFoundation
import SwiftUI

@main
struct KeysApp: App {
    init() {
        // Play the web app's audio through the speaker and let the mic listen at the same time.
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .mixWithOthers, .allowBluetoothA2DP])
        try? session.setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            KeysWebView(url: AppConfig.siteURL)
                .ignoresSafeArea()
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .background(Color.black)
        }
    }
}

enum AppConfig {
    /// The live site, so web updates arrive without rebuilding the app.
    static let siteURL = URL(string: "https://oinmays.github.io/artmaster-piano-clone/")!
    /// Only this origin gets the microphone and stays inside the app.
    static let siteHost = "oinmays.github.io"
    static let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
}
