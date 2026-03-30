package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.QuestionAnswer
import androidx.compose.material.icons.filled.Task
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.alpacaplayhouse.app.data.HoursEntry
import com.alpacaplayhouse.app.data.ProjectInquiry
import com.alpacaplayhouse.app.data.WorkApi
import com.alpacaplayhouse.app.data.WorkTask
import kotlinx.coroutines.launch

private enum class WorkTab { Tasks, Hours, Inquiry }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkScreen() {
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableStateOf(WorkTab.Tasks) }

    Column(modifier = Modifier.fillMaxSize()) {
        // Header
        Text(
            text = "Work",
            style = MaterialTheme.typography.headlineMedium,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(16.dp),
        )

        // Sub-tabs
        PrimaryTabRow(selectedTabIndex = WorkTab.entries.indexOf(selectedTab)) {
            Tab(
                selected = selectedTab == WorkTab.Tasks,
                onClick = { selectedTab = WorkTab.Tasks },
                text = { Text("Tasks") },
                icon = { Icon(Icons.Default.Task, contentDescription = null) },
            )
            Tab(
                selected = selectedTab == WorkTab.Hours,
                onClick = { selectedTab = WorkTab.Hours },
                text = { Text("Hours") },
                icon = { Icon(Icons.Default.AccessTime, contentDescription = null) },
            )
            Tab(
                selected = selectedTab == WorkTab.Inquiry,
                onClick = { selectedTab = WorkTab.Inquiry },
                text = { Text("Inquiry") },
                icon = { Icon(Icons.Default.QuestionAnswer, contentDescription = null) },
            )
        }

        when (selectedTab) {
            WorkTab.Tasks -> TasksPane()
            WorkTab.Hours -> HoursPane()
            WorkTab.Inquiry -> InquiryPane()
        }
    }
}

// --- Tasks Pane ---

@Composable
private fun TasksPane() {
    val scope = rememberCoroutineScope()
    var tasks by remember { mutableStateOf<List<WorkTask>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var showCreate by remember { mutableStateOf(false) }
    var filterStatus by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(filterStatus) {
        isLoading = true
        WorkApi.getTasks(filterStatus).onSuccess { tasks = it }
        isLoading = false
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Filter chips
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf(null to "All", "open" to "Open", "in_progress" to "Active", "done" to "Done").forEach { (status, label) ->
                FilterChip(
                    selected = filterStatus == status,
                    onClick = { filterStatus = status },
                    label = { Text(label) },
                )
            }
        }

        Box(modifier = Modifier.weight(1f)) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
            } else if (tasks.isEmpty()) {
                Text(
                    text = "No tasks found",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(32.dp),
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(tasks, key = { it.id }) { task ->
                        TaskCard(task) { newStatus ->
                            scope.launch {
                                WorkApi.updateTaskStatus(task.id, newStatus).onSuccess {
                                    tasks = tasks.map {
                                        if (it.id == task.id) it.copy(status = newStatus) else it
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // FAB
            FloatingActionButton(
                onClick = { showCreate = true },
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp),
                containerColor = MaterialTheme.colorScheme.primary,
            ) {
                Icon(Icons.Default.Add, contentDescription = "New Task")
            }
        }
    }

    if (showCreate) {
        CreateTaskDialog(
            onDismiss = { showCreate = false },
            onCreate = { title, desc, priority ->
                scope.launch {
                    WorkApi.createTask(title, desc, priority).onSuccess { newTask ->
                        tasks = listOf(newTask) + tasks
                    }
                    showCreate = false
                }
            },
        )
    }
}

@Composable
private fun TaskCard(task: WorkTask, onStatusChange: (String) -> Unit) {
    val statusColor = when (task.status) {
        "open" -> MaterialTheme.colorScheme.primary
        "in_progress" -> MaterialTheme.colorScheme.tertiary
        "done" -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.onSurfaceVariant
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = task.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                    modifier = Modifier.weight(1f),
                )
                AssistChip(
                    onClick = {
                        val next = when (task.status) {
                            "open" -> "in_progress"
                            "in_progress" -> "done"
                            else -> "open"
                        }
                        onStatusChange(next)
                    },
                    label = { Text(task.status.replace("_", " ")) },
                    colors = AssistChipDefaults.assistChipColors(
                        containerColor = statusColor.copy(alpha = 0.12f),
                        labelColor = statusColor,
                    ),
                )
            }
            if (task.description != null) {
                Text(
                    text = task.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                    maxLines = 2,
                )
            }
        }
    }
}

@Composable
private fun CreateTaskDialog(
    onDismiss: () -> Unit,
    onCreate: (String, String?, String) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("medium") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Task") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("low", "medium", "high").forEach { p ->
                        FilterChip(
                            selected = priority == p,
                            onClick = { priority = p },
                            label = { Text(p.replaceFirstChar { it.uppercase() }) },
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onCreate(title, description.ifBlank { null }, priority) },
                enabled = title.isNotBlank(),
            ) { Text("Create") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// --- Hours Pane ---

@Composable
private fun HoursPane() {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<HoursEntry>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }

    LaunchedEffect(Unit) {
        WorkApi.getHours().onSuccess { entries = it }
        isLoading = false
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Clock in button
        Button(
            onClick = {
                scope.launch {
                    WorkApi.clockIn().onSuccess { entry ->
                        entries = listOf(entry) + entries
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .height(48.dp),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Default.AccessTime, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text("Clock In")
        }

        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(32.dp),
            )
        } else if (entries.isEmpty()) {
            Text(
                text = "No hours logged yet",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
            )
        } else {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(entries, key = { it.id }) { entry ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = entry.clock_in?.take(16)?.replace("T", " ") ?: "—",
                                    style = MaterialTheme.typography.titleSmall,
                                )
                                if (entry.notes != null) {
                                    Text(
                                        text = entry.notes,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            entry.total_hours?.let { hrs ->
                                Text(
                                    text = "%.1fh".format(hrs),
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

// --- Inquiry Pane ---

@Composable
private fun InquiryPane() {
    val scope = rememberCoroutineScope()
    var inquiries by remember { mutableStateOf<List<ProjectInquiry>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var question by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WorkApi.getInquiries().onSuccess { inquiries = it }
        isLoading = false
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Ask a question
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = question,
                onValueChange = { question = it },
                label = { Text("Ask a question...") },
                modifier = Modifier.weight(1f),
                singleLine = true,
            )
            Button(
                onClick = {
                    if (question.isNotBlank()) {
                        submitting = true
                        scope.launch {
                            WorkApi.createInquiry(question).onSuccess { inquiry ->
                                inquiries = listOf(inquiry) + inquiries
                                question = ""
                            }
                            submitting = false
                        }
                    }
                },
                enabled = question.isNotBlank() && !submitting,
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Ask")
            }
        }

        if (isLoading) {
            CircularProgressIndicator(
                modifier = Modifier
                    .align(Alignment.CenterHorizontally)
                    .padding(32.dp),
            )
        } else if (inquiries.isEmpty()) {
            Text(
                text = "No inquiries yet. Ask a question above!",
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(32.dp),
            )
        } else {
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(inquiries, key = { it.id }) { inquiry ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Text(
                                text = inquiry.question,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.Medium,
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            if (inquiry.answer != null) {
                                Text(
                                    text = inquiry.answer,
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                Text(
                                    text = "Pending...",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
