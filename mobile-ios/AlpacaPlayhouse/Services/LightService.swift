import Foundation

struct LightCommand: Encodable {
    let rooms: String
    let color: String
    let brightness: String
}

actor LightService {
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 10
        self.session = URLSession(configuration: config)
    }

    func controlLights(rooms: [String], color: String, brightness: String) async throws {
        let url = ApiConfig.lightBaseURL.appendingPathComponent("lights")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let command = LightCommand(
            rooms: rooms.joined(separator: ","),
            color: color,
            brightness: brightness
        )
        request.httpBody = try JSONEncoder().encode(command)

        let (_, _) = try await session.data(for: request)
    }

    func turnOff(rooms: [String]) async throws {
        let url = ApiConfig.lightBaseURL.appendingPathComponent("lights")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let command = LightCommand(
            rooms: rooms.joined(separator: ","),
            color: "off",
            brightness: "0%"
        )
        request.httpBody = try JSONEncoder().encode(command)

        let (_, _) = try await session.data(for: request)
    }
}
