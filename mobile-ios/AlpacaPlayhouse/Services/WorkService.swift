import Foundation

struct WorkTask: Codable, Identifiable {
    let id: Int
    var title: String
    var description: String?
    var status: String
    var priority: String
    var assigneeId: String?
    var spaceId: Int?
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, title, description, status, priority
        case assigneeId = "assignee_id"
        case spaceId = "space_id"
        case createdAt = "created_at"
    }
}

struct HoursEntry: Codable, Identifiable {
    let id: Int
    var clockIn: String?
    var clockOut: String?
    var totalHours: Double?
    var notes: String?
    var status: String

    enum CodingKeys: String, CodingKey {
        case id, notes, status
        case clockIn = "clock_in"
        case clockOut = "clock_out"
        case totalHours = "total_hours"
    }
}

struct ProjectInquiry: Codable, Identifiable {
    let id: Int
    var question: String
    var answer: String?
    var status: String
    var createdAt: String?

    enum CodingKeys: String, CodingKey {
        case id, question, answer, status
        case createdAt = "created_at"
    }
}

actor WorkService {
    static let shared = WorkService()

    private func makeRequest(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest {
        var request = URLRequest(url: URL(string: "\(ApiConfig.supabaseURL)/rest/v1/\(path)")!)
        request.httpMethod = method
        let token = AuthService.shared.accessToken ?? ApiConfig.supabaseAnonKey
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(ApiConfig.supabaseAnonKey, forHTTPHeaderField: "apikey")
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("return=representation", forHTTPHeaderField: "Prefer")
            request.httpBody = body
        }
        return request
    }

    // MARK: - Tasks

    func getTasks(status: String? = nil) async throws -> [WorkTask] {
        var path = "tasks?select=*&order=created_at.desc"
        if let status { path += "&status=eq.\(status)" }
        let (data, _) = try await URLSession.shared.data(for: makeRequest(path))
        return try JSONDecoder().decode([WorkTask].self, from: data)
    }

    func createTask(title: String, description: String?, priority: String) async throws -> WorkTask {
        var dict: [String: Any] = ["title": title, "priority": priority, "status": "open"]
        if let description { dict["description"] = description }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let (data, _) = try await URLSession.shared.data(for: makeRequest("tasks", method: "POST", body: body))
        return try JSONDecoder().decode([WorkTask].self, from: data).first!
    }

    func updateTaskStatus(id: Int, status: String) async throws {
        let body = try JSONSerialization.data(withJSONObject: ["status": status])
        let _ = try await URLSession.shared.data(for: makeRequest("tasks?id=eq.\(id)", method: "PATCH", body: body))
    }

    // MARK: - Hours

    func getHours() async throws -> [HoursEntry] {
        let (data, _) = try await URLSession.shared.data(for: makeRequest("hours_entries?select=*&order=created_at.desc&limit=50"))
        return try JSONDecoder().decode([HoursEntry].self, from: data)
    }

    func clockIn(notes: String? = nil) async throws -> HoursEntry {
        var dict: [String: Any] = ["status": "active", "clock_in": "now()"]
        if let notes { dict["notes"] = notes }
        let body = try JSONSerialization.data(withJSONObject: dict)
        let (data, _) = try await URLSession.shared.data(for: makeRequest("hours_entries", method: "POST", body: body))
        return try JSONDecoder().decode([HoursEntry].self, from: data).first!
    }

    // MARK: - Inquiries

    func getInquiries() async throws -> [ProjectInquiry] {
        let (data, _) = try await URLSession.shared.data(for: makeRequest("project_inquiries?select=*&order=created_at.desc&limit=50"))
        return try JSONDecoder().decode([ProjectInquiry].self, from: data)
    }

    func createInquiry(question: String) async throws -> ProjectInquiry {
        let dict: [String: Any] = ["question": question, "status": "pending"]
        let body = try JSONSerialization.data(withJSONObject: dict)
        let (data, _) = try await URLSession.shared.data(for: makeRequest("project_inquiries", method: "POST", body: body))
        return try JSONDecoder().decode([ProjectInquiry].self, from: data).first!
    }
}
