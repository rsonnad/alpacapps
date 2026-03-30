import Foundation

struct SonosState: Decodable {
    let currentTrack: SonosTrack?
    let playbackState: String?
    let volume: Int?

    struct SonosTrack: Decodable {
        let artist: String?
        let title: String?
        let album: String?
        let albumArtUri: String?
        let duration: Int?
        let uri: String?
    }
}

actor SonosService {
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        self.session = URLSession(configuration: config)
    }

    func getState(room: String) async throws -> SonosState {
        let encoded = room.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? room
        let url = ApiConfig.sonosBaseURL.appendingPathComponent("\(encoded)/state")
        let (data, _) = try await session.data(from: url)
        let decoder = JSONDecoder()
        return try decoder.decode(SonosState.self, from: data)
    }

    func playPlaylist(room: String, playlist: String) async throws {
        let encodedRoom = room.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? room
        let encodedPlaylist = playlist.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? playlist
        let url = ApiConfig.sonosBaseURL.appendingPathComponent("\(encodedRoom)/playlist/\(encodedPlaylist)")
        let (_, _) = try await session.data(from: url)
    }

    func playPause(room: String) async throws {
        let encoded = room.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? room
        let url = ApiConfig.sonosBaseURL.appendingPathComponent("\(encoded)/playpause")
        let (_, _) = try await session.data(from: url)
    }

    func stop(room: String) async throws {
        let encoded = room.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? room
        let url = ApiConfig.sonosBaseURL.appendingPathComponent("\(encoded)/pause")
        let (_, _) = try await session.data(from: url)
    }

    func setVolume(room: String, level: Int) async throws {
        let encoded = room.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? room
        let url = ApiConfig.sonosBaseURL.appendingPathComponent("\(encoded)/volume/\(level)")
        let (_, _) = try await session.data(from: url)
    }
}
