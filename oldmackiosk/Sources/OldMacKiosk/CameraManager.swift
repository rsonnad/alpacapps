import AppKit
import AVFoundation

// MARK: - CameraManager — AVFoundation photo capture with countdown overlay

class CameraManager: NSObject {
    private var captureSession: AVCaptureSession?
    private var photoOutput: AVCapturePhotoOutput?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var overlayView: NSView?
    private var completion: ((Data?) -> Void)?
    private var countdownLabel: NSTextField?

    func capturePhoto(in parentView: NSView, completion: @escaping (Data?) -> Void) {
        self.completion = completion

        // Check camera permission
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startCapture(in: parentView)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.startCapture(in: parentView)
                    } else {
                        completion(nil)
                    }
                }
            }
        default:
            print("[Camera] Access denied")
            completion(nil)
        }
    }

    private func startCapture(in parentView: NSView) {
        let session = AVCaptureSession()
        session.sessionPreset = .photo

        // Get front-facing camera (FaceTime)
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front)
            ?? AVCaptureDevice.default(for: .video) else {
            print("[Camera] No camera found")
            completion?(nil)
            return
        }

        guard let input = try? AVCaptureDeviceInput(device: camera) else {
            print("[Camera] Cannot create input")
            completion?(nil)
            return
        }

        let output = AVCapturePhotoOutput()

        guard session.canAddInput(input), session.canAddOutput(output) else {
            print("[Camera] Cannot add input/output")
            completion?(nil)
            return
        }

        session.addInput(input)
        session.addOutput(output)

        self.captureSession = session
        self.photoOutput = output

        // Create overlay with preview
        let overlay = NSView(frame: parentView.bounds)
        overlay.wantsLayer = true
        overlay.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.9).cgColor

        // Camera preview layer
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        // Center preview with padding
        let previewSize = NSSize(width: parentView.bounds.width * 0.6, height: parentView.bounds.height * 0.7)
        let previewOrigin = NSPoint(
            x: (parentView.bounds.width - previewSize.width) / 2,
            y: (parentView.bounds.height - previewSize.height) / 2 + 30
        )
        preview.frame = NSRect(origin: previewOrigin, size: previewSize)
        preview.cornerRadius = 16
        overlay.layer?.addSublayer(preview)
        self.previewLayer = preview

        // Countdown label
        let label = NSTextField(labelWithString: "3")
        label.font = NSFont.systemFont(ofSize: 120, weight: .bold)
        label.textColor = .white
        label.alignment = .center
        label.frame = NSRect(x: 0, y: parentView.bounds.height * 0.1, width: parentView.bounds.width, height: 150)
        overlay.addSubview(label)
        self.countdownLabel = label

        parentView.addSubview(overlay)
        self.overlayView = overlay

        // Start session
        DispatchQueue.global(qos: .userInitiated).async {
            session.startRunning()
        }

        // Countdown: 3, 2, 1, capture
        countdown(from: 3)
    }

    private func countdown(from count: Int) {
        guard count > 0 else {
            // Take photo
            takePhoto()
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.countdownLabel?.stringValue = "\(count)"

            // Pulse animation
            NSAnimationContext.runAnimationGroup { ctx in
                ctx.duration = 0.3
                self?.countdownLabel?.alphaValue = 0.3
            } completionHandler: {
                NSAnimationContext.runAnimationGroup { ctx in
                    ctx.duration = 0.3
                    self?.countdownLabel?.alphaValue = 1.0
                }
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in
            self?.countdown(from: count - 1)
        }
    }

    private func takePhoto() {
        DispatchQueue.main.async { [weak self] in
            self?.countdownLabel?.stringValue = "📸"
        }

        let settings = AVCapturePhotoSettings()
        if #available(macOS 13.0, *) {
            settings.flashMode = .off
        }
        photoOutput?.capturePhoto(with: settings, delegate: self)
    }

    private func cleanup() {
        captureSession?.stopRunning()
        captureSession = nil
        photoOutput = nil
        previewLayer?.removeFromSuperlayer()
        previewLayer = nil
        overlayView?.removeFromSuperview()
        overlayView = nil
    }
}

// MARK: - AVCapturePhotoCaptureDelegate

extension CameraManager: AVCapturePhotoCaptureDelegate {
    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            defer { self?.cleanup() }

            if let error = error {
                print("[Camera] Capture error: \(error.localizedDescription)")
                self?.completion?(nil)
                return
            }

            guard let imageData = photo.fileDataRepresentation() else {
                print("[Camera] No image data")
                self?.completion?(nil)
                return
            }

            // Convert to JPEG with compression
            guard let image = NSImage(data: imageData),
                  let _ = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                self?.completion?(imageData)
                return
            }

            // Mirror the image (front camera)
            let mirrored = NSImage(size: image.size)
            mirrored.lockFocus()
            let transform = NSAffineTransform()
            transform.translateX(by: image.size.width, yBy: 0)
            transform.scaleX(by: -1, yBy: 1)
            transform.concat()
            let rect = NSRect(origin: .zero, size: image.size)
            image.draw(in: rect)
            mirrored.unlockFocus()

            // Compress to JPEG
            if let mirroredCG = mirrored.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                let rep = NSBitmapImageRep(cgImage: mirroredCG)
                let jpegData = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.8])
                self?.completion?(jpegData)
            } else {
                self?.completion?(imageData)
            }
        }
    }
}
