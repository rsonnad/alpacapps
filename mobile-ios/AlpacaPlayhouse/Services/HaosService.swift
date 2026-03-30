import Foundation

// MARK: - Response Models

struct ConversationResponse {
    let speech: String
    let conversationId: String?
}

private struct HaosRequestBody: Encodable {
    let text: String
    let language: String
    let conversation_id: String?
}

private struct HaosResponseBody: Decodable {
    let response: ResponseWrapper
    let conversation_id: String?

    struct ResponseWrapper: Decodable {
        let speech: SpeechWrapper
    }

    struct SpeechWrapper: Decodable {
        let plain: PlainSpeech
    }

    struct PlainSpeech: Decodable {
        let speech: String
    }
}

// MARK: - Service

actor HaosService {
    private let session: URLSession

    init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        self.session = URLSession(configuration: config)
    }

    func sendMessage(text: String, conversationId: String? = nil) async throws -> ConversationResponse {
        let url = ApiConfig.haosBaseURL.appendingPathComponent("api/conversation/process")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("Bearer \(ApiConfig.haosToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body = HaosRequestBody(
            text: text,
            language: "en",
            conversation_id: conversationId
        )
        request.httpBody = try JSONEncoder().encode(body)

        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw HaosError.requestFailed(statusCode: statusCode)
        }

        let decoded = try JSONDecoder().decode(HaosResponseBody.self, from: data)
        return ConversationResponse(
            speech: decoded.response.speech.plain.speech,
            conversationId: decoded.conversation_id
        )
    }
}

// MARK: - Errors

enum HaosError: LocalizedError {
    case requestFailed(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .requestFailed(let code):
            return "HAOS request failed (HTTP \(code))"
        }
    }
}
