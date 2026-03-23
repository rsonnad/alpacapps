import Foundation
import AVFoundation

// MARK: - AudioManager — Microphone recording (M4A, max 60s)

class AudioManager: NSObject, AVAudioRecorderDelegate {
    private var audioRecorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var completion: ((Data?) -> Void)?
    private var maxDurationTimer: Timer?

    func startRecording() {
        // Check microphone permission
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            beginRecording()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.beginRecording()
                    } else {
                        print("[Audio] Microphone access denied")
                    }
                }
            }
        default:
            print("[Audio] Microphone access denied")
        }
    }

    private func beginRecording() {
        let tempDir = FileManager.default.temporaryDirectory
        let filename = "oldmackiosk_recording_\(Int(Date().timeIntervalSince1970)).m4a"
        let url = tempDir.appendingPathComponent(filename)
        self.recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100.0,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
        ]

        do {
            audioRecorder = try AVAudioRecorder(url: url, settings: settings)
            audioRecorder?.delegate = self
            audioRecorder?.record()

            // Auto-stop after 60 seconds
            maxDurationTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: false) { [weak self] _ in
                self?.forceStop()
            }

            print("[Audio] Recording started")
        } catch {
            print("[Audio] Recording failed: \(error.localizedDescription)")
        }
    }

    func stopRecording(completion: @escaping (Data?) -> Void) {
        self.completion = completion
        maxDurationTimer?.invalidate()
        maxDurationTimer = nil

        guard let recorder = audioRecorder, recorder.isRecording else {
            completion(nil)
            return
        }

        recorder.stop()
        // Delegate method will fire and call completion
    }

    private func forceStop() {
        audioRecorder?.stop()
    }

    // MARK: - AVAudioRecorderDelegate

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        defer {
            // Clean up temp file
            if let url = recordingURL {
                try? FileManager.default.removeItem(at: url)
            }
            audioRecorder = nil
            recordingURL = nil
        }

        guard flag, let url = recordingURL else {
            print("[Audio] Recording failed")
            completion?(nil)
            completion = nil
            return
        }

        do {
            let data = try Data(contentsOf: url)
            print("[Audio] Recording complete: \(data.count) bytes")
            completion?(data)
        } catch {
            print("[Audio] Failed to read recording: \(error)")
            completion?(nil)
        }
        completion = nil
    }
}
