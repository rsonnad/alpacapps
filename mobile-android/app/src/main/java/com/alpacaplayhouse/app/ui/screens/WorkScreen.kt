package com.alpacaplayhouse.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowForward
import androidx.compose.material.icons.filled.QuestionAnswer
import androidx.compose.material.icons.filled.Task
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.alpacaplayhouse.app.data.HoursEntry
import com.alpacaplayhouse.app.data.ProjectInquiry
import com.alpacaplayhouse.app.data.WorkApi
import com.alpacaplayhouse.app.data.WorkTask
import com.alpacaplayhouse.app.ui.theme.*
import kotlinx.coroutines.launch

private enum class WorkTab { Tasks, Hours, Inquiry }

// Status badge colors
private val StatusOpen = Color(0xFF3B82F6)      // blue
private val StatusActive = Color(0xFFF59E0B)     // amber
private val StatusDone = Color(0xFF10B981)       // green
private val StatusOpenBg = Color(0xFFDBEAFE)
private val StatusActiveBg = Color(0xFFFEF3C7)
private val StatusDoneBg = Color(0xFFD1FAE5)
private val StatusOpenBgDark = Color(0xFF1E3A5F)
private val StatusActiveBgDark = Color(0xFF3D2E0A)
private val StatusDoneBgDark = Color(0xFF0A3D2A)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkScreen() {
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableStateOf(WorkTab.Tasks) }
    val isDark = isSystemInDarkTheme()

    Column(modifier = Modifier.fillMaxSize()) {
        // Header row with title + action button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Work",
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                color = if (isDark) Color.White else AlpacaText,
                modifier = Modifier.weight(1f),
            )
        }

        // Sub-tabs — compact, pill-style
        SingleChoiceSegmentedButtonRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
        ) {
            WorkTab.entries.forEachIndexed { index, tab ->
                SegmentedButton(
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = WorkTab.entries.size,
                    ),
                    onClick = { selectedTab = tab },
                    selected = selectedTab == tab,
                    icon = {},
                    colors = SegmentedButtonDefaults.colors(
                        activeContainerColor = AlpacaPrimary,
                        activeContentColor = Color.White,
                        inactiveContainerColor = if (isDark) AlpacaDarkSurface else Color(0xFFF1F5F9),
                        inactiveContentColor = if (isDark) Color.White.copy(alpha = 0.7f) else AlpacaMuted,
                    ),
                ) {
                    Text(
                        text = when (tab) {
                            WorkTab.Tasks -> "Tasks"
                            WorkTab.Hours -> "Hours"
                            WorkTab.Inquiry -> "Inquiry"
                        },
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }

        when (selectedTab) {
            WorkTab.Tasks -> TasksPane(isDark)
            WorkTab.Hours -> HoursPane(isDark)
            WorkTab.Inquiry -> InquiryPane(isDark)
        }
    }
}

// --- Tasks Pane ---

@Composable
private fun TasksPane(isDark: Boolean) {
    val scope = rememberCoroutineScope()
    var tasks by remember { mutableStateOf<List<WorkTask>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var showCreate by remember { mutableStateOf(false) }
    var filterStatus by remember { mutableStateOf<String?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(filterStatus) {
        isLoading = true
        errorMsg = null
        WorkApi.getTasks(filterStatus)
            .onSuccess { tasks = it }
            .onFailure { errorMsg = it.message }
        isLoading = false
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Filter row + Add button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                listOf(
                    null to "All",
                    "open" to "Open",
                    "in_progress" to "Active",
                    "done" to "Done",
                ).forEach { (status, label) ->
                    val selected = filterStatus == status
                    FilterChip(
                        selected = selected,
                        onClick = { filterStatus = status },
                        label = {
                            Text(
                                label,
                                fontSize = 12.sp,
                                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                            )
                        },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = AlpacaPrimary.copy(alpha = 0.15f),
                            selectedLabelColor = AlpacaPrimary,
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            borderColor = if (isDark) Color.White.copy(alpha = 0.12f) else Color(0xFFE2E8F0),
                            enabled = true,
                            selected = selected,
                        ),
                        modifier = Modifier.height(32.dp),
                    )
                }
            }

            // Add button — top right
            IconButton(
                onClick = { showCreate = true },
                modifier = Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(AlpacaPrimary),
            ) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = "New Task",
                    tint = Color.White,
                    modifier = Modifier.size(20.dp),
                )
            }
        }

        // Content
        Box(modifier = Modifier.weight(1f)) {
            when {
                isLoading -> {
                    CircularProgressIndicator(
                        modifier = Modifier.align(Alignment.Center),
                        color = AlpacaPrimary,
                    )
                }
                errorMsg != null -> {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            text = "Could not load tasks",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (isDark) Color.White else AlpacaText,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = errorMsg ?: "",
                            fontSize = 12.sp,
                            color = AlpacaMuted,
                        )
                    }
                }
                tasks.isEmpty() -> {
                    Column(
                        modifier = Modifier
                            .align(Alignment.Center)
                            .padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(
                            Icons.Default.Task,
                            contentDescription = null,
                            tint = AlpacaMuted.copy(alpha = 0.4f),
                            modifier = Modifier.size(48.dp),
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "No tasks found",
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Medium,
                            color = if (isDark) Color.White.copy(alpha = 0.6f) else AlpacaMuted,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Tap + to create your first task",
                            fontSize = 13.sp,
                            color = AlpacaMuted.copy(alpha = 0.6f),
                        )
                    }
                }
                else -> {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        items(tasks, key = { it.id }) { task ->
                            TaskCard(task, isDark) { newStatus ->
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
            }
        }
    }

    if (showCreate) {
        CreateTaskDialog(
            isDark = isDark,
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
private fun TaskCard(task: WorkTask, isDark: Boolean, onStatusChange: (String) -> Unit) {
    val (statusColor, statusBg, statusLabel) = when (task.status) {
        "open" -> Triple(StatusOpen, if (isDark) StatusOpenBgDark else StatusOpenBg, "Open")
        "in_progress" -> Triple(StatusActive, if (isDark) StatusActiveBgDark else StatusActiveBg, "Active")
        "done" -> Triple(StatusDone, if (isDark) StatusDoneBgDark else StatusDoneBg, "Done")
        else -> Triple(AlpacaMuted, if (isDark) AlpacaDarkSurface else Color(0xFFF1F5F9), task.status)
    }

    val priorityIndicator = when (task.priority) {
        "high" -> Color(0xFFEF4444)
        "medium" -> Color(0xFFF59E0B)
        "low" -> Color(0xFF10B981)
        else -> AlpacaMuted
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (isDark) AlpacaDarkSurface else Color.White,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = if (isDark) 0.dp else 1.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.Top,
        ) {
            // Priority indicator dot
            Box(
                modifier = Modifier
                    .padding(top = 6.dp)
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(priorityIndicator),
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = task.title,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = if (isDark) Color.White else AlpacaText,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                if (task.description != null) {
                    Text(
                        text = task.description,
                        fontSize = 13.sp,
                        color = AlpacaMuted,
                        modifier = Modifier.padding(top = 2.dp),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (task.created_at != null) {
                    Text(
                        text = task.created_at.take(10),
                        fontSize = 11.sp,
                        color = AlpacaMuted.copy(alpha = 0.6f),
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
            }

            Spacer(modifier = Modifier.width(8.dp))

            // Status chip — tappable to cycle
            Surface(
                onClick = {
                    val next = when (task.status) {
                        "open" -> "in_progress"
                        "in_progress" -> "done"
                        else -> "open"
                    }
                    onStatusChange(next)
                },
                shape = RoundedCornerShape(8.dp),
                color = statusBg,
            ) {
                Text(
                    text = statusLabel,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = statusColor,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun CreateTaskDialog(
    isDark: Boolean,
    onDismiss: () -> Unit,
    onCreate: (String, String?, String) -> Unit,
) {
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("medium") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = if (isDark) AlpacaDarkSurface else Color.White,
        title = {
            Text(
                "New Task",
                fontWeight = FontWeight.Bold,
                color = if (isDark) Color.White else AlpacaText,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    shape = RoundedCornerShape(10.dp),
                )
                Text(
                    "Priority",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = AlpacaMuted,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("low" to "Low", "medium" to "Medium", "high" to "High").forEach { (p, label) ->
                        FilterChip(
                            selected = priority == p,
                            onClick = { priority = p },
                            label = { Text(label, fontSize = 12.sp) },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = AlpacaPrimary.copy(alpha = 0.15f),
                                selectedLabelColor = AlpacaPrimary,
                            ),
                        )
                    }
                }
            }
        },
        confirmButton = {
            Button(
                onClick = { onCreate(title, description.ifBlank { null }, priority) },
                enabled = title.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = AlpacaPrimary),
                shape = RoundedCornerShape(10.dp),
            ) { Text("Create") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = AlpacaMuted) }
        },
    )
}

// --- Hours Pane ---

@Composable
private fun HoursPane(isDark: Boolean) {
    val scope = rememberCoroutineScope()
    var entries by remember { mutableStateOf<List<HoursEntry>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var clockingIn by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WorkApi.getHours().onSuccess { entries = it }
        isLoading = false
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Clock In button
        item {
            Button(
                onClick = {
                    clockingIn = true
                    scope.launch {
                        WorkApi.clockIn().onSuccess { entry ->
                            entries = listOf(entry) + entries
                        }
                        clockingIn = false
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = AlpacaPrimary,
                    contentColor = Color.White,
                ),
                enabled = !clockingIn,
                elevation = ButtonDefaults.buttonElevation(
                    defaultElevation = 2.dp,
                    pressedElevation = 0.dp,
                ),
            ) {
                if (clockingIn) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Icon(Icons.Default.AccessTime, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Clock In", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }

        // Summary card
        if (entries.isNotEmpty()) {
            item {
                val totalHours = entries.mapNotNull { it.total_hours }.sum()
                val activeCount = entries.count { it.status == "active" }
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isDark) AlpacaDarkSurface else Color(0xFFF0FDF4),
                    ),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "%.1f".format(totalHours),
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                                color = AlpacaPrimary,
                            )
                            Text("Total Hours", fontSize = 11.sp, color = AlpacaMuted)
                        }
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "${entries.size}",
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isDark) Color.White else AlpacaText,
                            )
                            Text("Entries", fontSize = 11.sp, color = AlpacaMuted)
                        }
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(
                                text = "$activeCount",
                                fontSize = 22.sp,
                                fontWeight = FontWeight.Bold,
                                color = StatusActive,
                            )
                            Text("Active", fontSize = 11.sp, color = AlpacaMuted)
                        }
                    }
                }
            }
        }

        // Loading / Empty / Entries
        if (isLoading) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = AlpacaPrimary)
                }
            }
        } else if (entries.isEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Default.AccessTime,
                        contentDescription = null,
                        tint = AlpacaMuted.copy(alpha = 0.4f),
                        modifier = Modifier.size(48.dp),
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "No hours logged yet",
                        fontSize = 16.sp,
                        color = if (isDark) Color.White.copy(alpha = 0.6f) else AlpacaMuted,
                    )
                    Text(
                        text = "Tap Clock In to start tracking",
                        fontSize = 13.sp,
                        color = AlpacaMuted.copy(alpha = 0.6f),
                    )
                }
            }
        } else {
            items(entries, key = { it.id }) { entry ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isDark) AlpacaDarkSurface else Color.White,
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = if (isDark) 0.dp else 1.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Status dot
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(
                                    if (entry.status == "active") StatusActive
                                    else StatusDone,
                                ),
                        )
                        Spacer(modifier = Modifier.width(12.dp))

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = entry.clock_in?.take(16)?.replace("T", " ") ?: "—",
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = if (isDark) Color.White else AlpacaText,
                            )
                            if (entry.notes != null) {
                                Text(
                                    text = entry.notes,
                                    fontSize = 12.sp,
                                    color = AlpacaMuted,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }

                        entry.total_hours?.let { hrs ->
                            Text(
                                text = "%.1fh".format(hrs),
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = AlpacaPrimary,
                            )
                        }
                    }
                }
            }
        }
    }
}

// --- Inquiry Pane ---

@Composable
private fun InquiryPane(isDark: Boolean) {
    val scope = rememberCoroutineScope()
    var inquiries by remember { mutableStateOf<List<ProjectInquiry>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var question by remember { mutableStateOf("") }
    var submitting by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        WorkApi.getInquiries().onSuccess { inquiries = it }
        isLoading = false
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Ask input
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (isDark) AlpacaDarkSurface else Color.White,
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = if (isDark) 0.dp else 1.dp),
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = question,
                        onValueChange = { question = it },
                        placeholder = { Text("Ask a question...", fontSize = 14.sp) },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        shape = RoundedCornerShape(10.dp),
                        textStyle = LocalTextStyle.current.copy(fontSize = 14.sp),
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    IconButton(
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
                        modifier = Modifier
                            .size(40.dp)
                            .clip(CircleShape)
                            .background(
                                if (question.isNotBlank()) AlpacaPrimary
                                else AlpacaPrimary.copy(alpha = 0.3f),
                            ),
                    ) {
                        if (submitting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(18.dp),
                                color = Color.White,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Icon(
                                Icons.Default.ArrowForward,
                                contentDescription = "Ask",
                                tint = Color.White,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }
        }

        // Loading / Empty / List
        if (isLoading) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = AlpacaPrimary)
                }
            }
        } else if (inquiries.isEmpty()) {
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Icon(
                        Icons.Default.QuestionAnswer,
                        contentDescription = null,
                        tint = AlpacaMuted.copy(alpha = 0.4f),
                        modifier = Modifier.size(48.dp),
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "No inquiries yet",
                        fontSize = 16.sp,
                        color = if (isDark) Color.White.copy(alpha = 0.6f) else AlpacaMuted,
                    )
                    Text(
                        text = "Ask a question above to get started",
                        fontSize = 13.sp,
                        color = AlpacaMuted.copy(alpha = 0.6f),
                    )
                }
            }
        } else {
            items(inquiries, key = { it.id }) { inquiry ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isDark) AlpacaDarkSurface else Color.White,
                    ),
                    elevation = CardDefaults.cardElevation(defaultElevation = if (isDark) 0.dp else 1.dp),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = inquiry.question,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (isDark) Color.White else AlpacaText,
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        if (inquiry.answer != null) {
                            Text(
                                text = inquiry.answer,
                                fontSize = 13.sp,
                                color = if (isDark) Color.White.copy(alpha = 0.7f) else Color(0xFF475569),
                                lineHeight = 18.sp,
                            )
                        } else {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(12.dp),
                                    strokeWidth = 1.5.dp,
                                    color = AlpacaMuted.copy(alpha = 0.4f),
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Pending response...",
                                    fontSize = 12.sp,
                                    color = AlpacaMuted.copy(alpha = 0.5f),
                                )
                            }
                        }
                        if (inquiry.created_at != null) {
                            Text(
                                text = inquiry.created_at.take(10),
                                fontSize = 11.sp,
                                color = AlpacaMuted.copy(alpha = 0.5f),
                                modifier = Modifier.padding(top = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
