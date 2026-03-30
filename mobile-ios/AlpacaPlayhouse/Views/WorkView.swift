import SwiftUI

enum WorkTab: String, CaseIterable {
    case tasks = "Tasks"
    case hours = "Hours"
    case inquiry = "Inquiry"

    var icon: String {
        switch self {
        case .tasks: "checklist"
        case .hours: "clock"
        case .inquiry: "questionmark.bubble"
        }
    }
}

struct WorkView: View {
    @State private var selectedTab = WorkTab.tasks

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Sub-tab picker
                Picker("Section", selection: $selectedTab) {
                    ForEach(WorkTab.allCases, id: \.self) { tab in
                        Label(tab.rawValue, systemImage: tab.icon)
                            .tag(tab)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
                .padding(.vertical, 8)

                switch selectedTab {
                case .tasks: TasksPane()
                case .hours: HoursPane()
                case .inquiry: InquiryPane()
                }
            }
            .navigationTitle("Work")
        }
    }
}

// MARK: - Tasks

struct TasksPane: View {
    @State private var tasks: [WorkTask] = []
    @State private var isLoading = true
    @State private var filterStatus: String?
    @State private var showCreate = false

    var body: some View {
        VStack(spacing: 0) {
            // Filter
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    FilterButton(title: "All", isSelected: filterStatus == nil) { filterStatus = nil }
                    FilterButton(title: "Open", isSelected: filterStatus == "open") { filterStatus = "open" }
                    FilterButton(title: "Active", isSelected: filterStatus == "in_progress") { filterStatus = "in_progress" }
                    FilterButton(title: "Done", isSelected: filterStatus == "done") { filterStatus = "done" }
                }
                .padding(.horizontal)
                .padding(.vertical, 8)
            }

            if isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else if tasks.isEmpty {
                Spacer()
                Text("No tasks found")
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                List(tasks) { task in
                    TaskRow(task: task) { newStatus in
                        Task {
                            try? await WorkService.shared.updateTaskStatus(id: task.id, status: newStatus)
                            if let idx = tasks.firstIndex(where: { $0.id == task.id }) {
                                tasks[idx].status = newStatus
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            Button {
                showCreate = true
            } label: {
                Image(systemName: "plus")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .foregroundStyle(.white)
                    .frame(width: 56, height: 56)
                    .background(AppTheme.primary)
                    .clipShape(Circle())
                    .shadow(radius: 4)
            }
            .padding()
        }
        .sheet(isPresented: $showCreate) {
            CreateTaskSheet { title, desc, priority in
                Task {
                    if let newTask = try? await WorkService.shared.createTask(title: title, description: desc, priority: priority) {
                        tasks.insert(newTask, at: 0)
                    }
                }
            }
        }
        .task(id: filterStatus) {
            isLoading = true
            tasks = (try? await WorkService.shared.getTasks(status: filterStatus)) ?? []
            isLoading = false
        }
    }
}

struct FilterButton: View {
    let title: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline)
                .fontWeight(isSelected ? .semibold : .regular)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(isSelected ? AppTheme.primary.opacity(0.15) : Color(.systemGray6))
                .foregroundStyle(isSelected ? AppTheme.primary : .primary)
                .clipShape(Capsule())
        }
    }
}

struct TaskRow: View {
    let task: WorkTask
    let onStatusChange: (String) -> Void

    var statusColor: Color {
        switch task.status {
        case "open": AppTheme.primary
        case "in_progress": AppTheme.accent
        case "done": AppTheme.primaryLight
        default: .secondary
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(task.title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                Spacer()
                Button {
                    let next: String
                    switch task.status {
                    case "open": next = "in_progress"
                    case "in_progress": next = "done"
                    default: next = "open"
                    }
                    onStatusChange(next)
                } label: {
                    Text(task.status.replacingOccurrences(of: "_", with: " "))
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(statusColor.opacity(0.15))
                        .foregroundStyle(statusColor)
                        .clipShape(Capsule())
                }
            }
            if let desc = task.description {
                Text(desc)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
    }
}

struct CreateTaskSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var description = ""
    @State private var priority = "medium"
    let onCreate: (String, String?, String) -> Void

    var body: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $title)
                TextField("Description (optional)", text: $description, axis: .vertical)
                    .lineLimit(2...4)
                Picker("Priority", selection: $priority) {
                    Text("Low").tag("low")
                    Text("Medium").tag("medium")
                    Text("High").tag("high")
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        onCreate(title, description.isEmpty ? nil : description, priority)
                        dismiss()
                    }
                    .disabled(title.isEmpty)
                }
            }
        }
    }
}

// MARK: - Hours

struct HoursPane: View {
    @State private var entries: [HoursEntry] = []
    @State private var isLoading = true

    var body: some View {
        VStack(spacing: 0) {
            Button {
                Task {
                    if let entry = try? await WorkService.shared.clockIn() {
                        entries.insert(entry, at: 0)
                    }
                }
            } label: {
                Label("Clock In", systemImage: "clock")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(AppTheme.primary)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding()

            if isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else if entries.isEmpty {
                Spacer()
                Text("No hours logged yet")
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                List(entries) { entry in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(entry.clockIn?.prefix(16).replacingOccurrences(of: "T", with: " ") ?? "—")
                                .font(.subheadline)
                                .fontWeight(.medium)
                            if let notes = entry.notes {
                                Text(notes)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if let hrs = entry.totalHours {
                            Text(String(format: "%.1fh", hrs))
                                .font(.title3)
                                .fontWeight(.bold)
                                .foregroundStyle(AppTheme.primary)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .task {
            entries = (try? await WorkService.shared.getHours()) ?? []
            isLoading = false
        }
    }
}

// MARK: - Inquiry

struct InquiryPane: View {
    @State private var inquiries: [ProjectInquiry] = []
    @State private var isLoading = true
    @State private var question = ""
    @State private var submitting = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                TextField("Ask a question...", text: $question)
                    .textFieldStyle(.roundedBorder)
                Button("Ask") {
                    guard !question.isEmpty else { return }
                    submitting = true
                    Task {
                        if let inquiry = try? await WorkService.shared.createInquiry(question: question) {
                            inquiries.insert(inquiry, at: 0)
                            question = ""
                        }
                        submitting = false
                    }
                }
                .disabled(question.isEmpty || submitting)
                .buttonStyle(.borderedProminent)
                .tint(AppTheme.primary)
            }
            .padding()

            if isLoading {
                Spacer()
                ProgressView()
                Spacer()
            } else if inquiries.isEmpty {
                Spacer()
                Text("No inquiries yet. Ask a question above!")
                    .foregroundStyle(.secondary)
                Spacer()
            } else {
                List(inquiries) { inquiry in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(inquiry.question)
                            .font(.subheadline)
                            .fontWeight(.medium)
                        if let answer = inquiry.answer {
                            Text(answer)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("Pending...")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .task {
            inquiries = (try? await WorkService.shared.getInquiries()) ?? []
            isLoading = false
        }
    }
}
