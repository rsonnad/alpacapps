import SwiftUI

@Observable
final class MusicViewModel {
    var selectedRoom = "Living Sound"
    var trackTitle: String?
    var trackArtist: String?
    var playbackState: String = "STOPPED"
    var isLoading = false
    var errorMessage: String?

    static let rooms = [
        "Living Sound",
        "Dining Sound",
        "Skyloft Sound",
        "Front Outside Sound",
        "Backyard Sound",
        "Pequeno",
        "MasterBlaster",
        "DJ",
        "Outhouse",
        "garage outdoors",
    ]

    static let playlists = [
        "Ambient Music",
        "Barb Jungr Chill2",
        "chill cats",
        "CHILL LIST",
        "Indian Chill Music",
        "Deep Focus",
        "morningtime",
        "Saturday Morning Mix",
        "Sunday Afternoon Mix",
        "Thursday Afternoon Mix",
    ]

    private let service = SonosService()

    var isPlaying: Bool {
        playbackState == "PLAYING"
    }

    func fetchState() async {
        do {
            let state = try await service.getState(room: selectedRoom)
            trackTitle = state.currentTrack?.title
            trackArtist = state.currentTrack?.artist
            playbackState = state.playbackState ?? "STOPPED"
            errorMessage = nil
        } catch {
            errorMessage = "Cannot reach Sonos"
        }
    }

    func playPlaylist(_ name: String) async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await service.playPlaylist(room: selectedRoom, playlist: name)
            errorMessage = nil
            // Short delay then refresh state
            try? await Task.sleep(for: .seconds(1))
            await fetchState()
        } catch {
            errorMessage = "Failed to start playlist"
        }
    }

    func togglePlayPause() async {
        do {
            try await service.playPause(room: selectedRoom)
            errorMessage = nil
            try? await Task.sleep(for: .milliseconds(500))
            await fetchState()
        } catch {
            errorMessage = "Command failed"
        }
    }

    func stop() async {
        do {
            try await service.stop(room: selectedRoom)
            errorMessage = nil
            try? await Task.sleep(for: .milliseconds(500))
            await fetchState()
        } catch {
            errorMessage = "Command failed"
        }
    }
}

struct MusicView: View {
    @State private var vm = MusicViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Room picker
                HStack {
                    Image(systemName: "hifispeaker.fill")
                        .foregroundStyle(AppTheme.accent)
                    Picker("Room", selection: $vm.selectedRoom) {
                        ForEach(MusicViewModel.rooms, id: \.self) { room in
                            Text(room).tag(room)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(AppTheme.accent)
                }
                .padding(.horizontal)
                .padding(.vertical, 8)

                if let error = vm.errorMessage {
                    HStack(spacing: 6) {
                        Image(systemName: "wifi.exclamationmark")
                        Text(error)
                    }
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.horizontal)
                    .padding(.bottom, 4)
                }

                Divider()

                // Playlists
                List {
                    Section("Playlists") {
                        ForEach(MusicViewModel.playlists, id: \.self) { playlist in
                            Button {
                                Task { await vm.playPlaylist(playlist) }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "music.note.list")
                                        .foregroundStyle(AppTheme.accent)
                                        .frame(width: 24)
                                    Text(playlist)
                                        .foregroundStyle(AppTheme.dark)
                                }
                            }
                            .disabled(vm.isLoading)
                        }
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(AppTheme.light)

                // Now Playing bar
                nowPlayingBar
            }
            .background(AppTheme.light)
            .navigationTitle("Music")
            .task {
                await vm.fetchState()
            }
            .onChange(of: vm.selectedRoom) {
                Task { await vm.fetchState() }
            }
        }
    }

    @ViewBuilder
    private var nowPlayingBar: some View {
        VStack(spacing: 0) {
            Divider()
            HStack(spacing: 16) {
                // Track info
                VStack(alignment: .leading, spacing: 2) {
                    Text(vm.trackTitle ?? "Not Playing")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.dark)
                        .lineLimit(1)
                    if let artist = vm.trackArtist {
                        Text(artist)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                // Controls
                HStack(spacing: 20) {
                    Button {
                        Task { await vm.stop() }
                    } label: {
                        Image(systemName: "stop.fill")
                            .font(.title3)
                            .foregroundStyle(AppTheme.dark)
                    }

                    Button {
                        Task { await vm.togglePlayPause() }
                    } label: {
                        Image(systemName: vm.isPlaying ? "pause.fill" : "play.fill")
                            .font(.title2)
                            .foregroundStyle(AppTheme.accent)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)
        }
    }
}

#Preview {
    MusicView()
}
