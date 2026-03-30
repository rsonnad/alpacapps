import SwiftUI

// MARK: - Models

struct LightScene: Identifiable {
    let id = UUID()
    let name: String
    let icon: String
    let color: String
    let brightness: String
}

struct LightZone: Identifiable {
    let id = UUID()
    let name: String
    let icon: String
    let rooms: [String]
    let scenes: [LightScene]
    let requiresPin: Bool
}

// MARK: - View Model

@Observable
final class LightsViewModel {
    var skyloftUnlocked = false
    var showPinAlert = false
    var pinEntry = ""
    var pinError = false
    var activeScenes: [UUID: String] = [:]  // zone id -> scene name
    var loadingZone: UUID?
    var errorMessage: String?

    private static let pinCode = "1234"

    private let service = LightService()

    static let defaultScenes: [LightScene] = [
        LightScene(name: "Bright", icon: "sun.max.fill", color: "white", brightness: "100%"),
        LightScene(name: "Warm", icon: "sun.min.fill", color: "warm", brightness: "80%"),
        LightScene(name: "Dim", icon: "moon.fill", color: "warm", brightness: "30%"),
        LightScene(name: "Party", icon: "party.popper.fill", color: "magenta", brightness: "100%"),
        LightScene(name: "Off", icon: "lightbulb.slash", color: "off", brightness: "0%"),
    ]

    static let outsideScenes: [LightScene] = {
        var scenes = defaultScenes
        // Insert Welcome before Off
        let welcomeScene = LightScene(name: "Welcome", icon: "hand.wave.fill", color: "amber", brightness: "100%")
        if let offIndex = scenes.firstIndex(where: { $0.name == "Off" }) {
            scenes.insert(welcomeScene, at: offIndex)
        }
        return scenes
    }()

    static let zones: [LightZone] = [
        LightZone(
            name: "Outside",
            icon: "tree.fill",
            rooms: ["facade", "cabins-fence", "sauna"],
            scenes: outsideScenes,
            requiresPin: false
        ),
        LightZone(
            name: "Living / Dining / Kitchen",
            icon: "sofa.fill",
            rooms: ["living", "kitchen", "kitchen-nook"],
            scenes: defaultScenes,
            requiresPin: false
        ),
        LightZone(
            name: "Skyloft / Master",
            icon: "bed.double.fill",
            rooms: ["skyloft", "skyloft-bath", "master-bath", "stairs"],
            scenes: defaultScenes,
            requiresPin: true
        ),
    ]

    func checkPin() -> Bool {
        if pinEntry == Self.pinCode {
            skyloftUnlocked = true
            pinError = false
            pinEntry = ""
            return true
        } else {
            pinError = true
            pinEntry = ""
            return false
        }
    }

    func applyScene(_ scene: LightScene, to zone: LightZone) async {
        loadingZone = zone.id
        defer { loadingZone = nil }

        do {
            if scene.color == "off" {
                try await service.turnOff(rooms: zone.rooms)
            } else {
                try await service.controlLights(
                    rooms: zone.rooms,
                    color: scene.color,
                    brightness: scene.brightness
                )
            }
            activeScenes[zone.id] = scene.name
            errorMessage = nil
        } catch {
            errorMessage = "Failed to set \(scene.name)"
        }
    }
}

// MARK: - Views

struct LightsView: View {
    @State private var vm = LightsViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let error = vm.errorMessage {
                        HStack(spacing: 6) {
                            Image(systemName: "wifi.exclamationmark")
                            Text(error)
                        }
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.horizontal)
                    }

                    ForEach(LightsViewModel.zones) { zone in
                        zoneCard(zone)
                    }
                }
                .padding()
            }
            .background(AppTheme.light)
            .navigationTitle("Lights")
            .alert("Enter PIN", isPresented: $vm.showPinAlert) {
                SecureField("4-digit PIN", text: $vm.pinEntry)
                    .keyboardType(.numberPad)
                Button("Unlock") {
                    _ = vm.checkPin()
                }
                Button("Cancel", role: .cancel) {
                    vm.pinEntry = ""
                }
            } message: {
                if vm.pinError {
                    Text("Incorrect PIN. Try again.")
                } else {
                    Text("This zone requires a PIN to control.")
                }
            }
        }
    }

    @ViewBuilder
    private func zoneCard(_ zone: LightZone) -> some View {
        let isLocked = zone.requiresPin && !vm.skyloftUnlocked
        let isActive = vm.loadingZone == zone.id

        VStack(alignment: .leading, spacing: 12) {
            // Zone header
            HStack(spacing: 10) {
                Image(systemName: zone.icon)
                    .font(.title3)
                    .foregroundStyle(AppTheme.accent)
                    .frame(width: 28)

                Text(zone.name)
                    .font(.headline)
                    .foregroundStyle(AppTheme.dark)

                Spacer()

                if isLocked {
                    Button {
                        vm.pinError = false
                        vm.showPinAlert = true
                    } label: {
                        Image(systemName: "lock.fill")
                            .foregroundStyle(.secondary)
                    }
                } else if let active = vm.activeScenes[zone.id] {
                    Text(active)
                        .font(.caption)
                        .foregroundStyle(AppTheme.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(AppTheme.accent.opacity(0.12))
                        .clipShape(Capsule())
                }

                if isActive {
                    ProgressView()
                        .scaleEffect(0.8)
                }
            }

            // Room tags
            HStack(spacing: 6) {
                ForEach(zone.rooms, id: \.self) { room in
                    Text(room)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.secondary.opacity(0.1))
                        .clipShape(Capsule())
                }
            }

            // Scene buttons
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(zone.scenes) { scene in
                        sceneButton(scene, zone: zone, isLocked: isLocked)
                    }
                }
            }
        }
        .padding()
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: .black.opacity(0.06), radius: 6, y: 2)
        .opacity(isLocked ? 0.7 : 1.0)
    }

    @ViewBuilder
    private func sceneButton(_ scene: LightScene, zone: LightZone, isLocked: Bool) -> some View {
        let isActiveScene = vm.activeScenes[zone.id] == scene.name

        Button {
            if isLocked {
                vm.pinError = false
                vm.showPinAlert = true
            } else {
                Task { await vm.applyScene(scene, to: zone) }
            }
        } label: {
            VStack(spacing: 6) {
                Image(systemName: scene.icon)
                    .font(.title3)
                    .frame(width: 44, height: 44)
                    .background(
                        isActiveScene
                            ? AppTheme.accent.opacity(0.15)
                            : Color.secondary.opacity(0.08)
                    )
                    .clipShape(Circle())
                    .foregroundStyle(isActiveScene ? AppTheme.accent : AppTheme.dark)

                Text(scene.name)
                    .font(.caption2)
                    .foregroundStyle(isActiveScene ? AppTheme.accent : .secondary)
            }
        }
        .disabled(vm.loadingZone != nil)
    }
}

#Preview {
    LightsView()
}
