const STORAGE_KEY_PREFIX = "pulso-organizador-v2";
const LEGACY_STORAGE_KEY = "pulso-organizador-v1";
const GUEST_SESSION_KEY = "hugos-productivity-guest-session";
const DEFAULT_DATA_VERSION = 2;
const DEFAULT_TASKS = [];
const DEFAULT_FILTERS = {
  view: "today",
  query: "",
  sort: "smart",
  selectedDate: toDateKey(new Date()),
};

const state = {
  tasks: [],
  deletedTasks: {},
  filters: { ...DEFAULT_FILTERS },
  currentMonth: startOfMonth(new Date()),
  deferredInstallPrompt: null,
  ui: {
    searchTimer: null,
    renderFrame: null,
    reminderCheckRunning: false,
    routineEventsDraft: [],
  },
  sync: {
    client: null,
    configured: false,
    user: null,
    pendingEmail: localStorage.getItem("hugos-productivity-pending-email") || "",
    busy: false,
    timer: null,
    lastSyncedAt: "",
    storageKey: "",
  },
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  loadState();
  bindEvents();
  render();
  initCloudSync();
  registerServiceWorker();
  window.setInterval(checkReminders, 60 * 1000);
  checkReminders();
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.deferredInstallPrompt = event;
  if (els.installBtn) {
    els.installBtn.classList.remove("hidden");
  }
});

function cacheElements() {
  [
    "todayLabel",
    "searchInput",
    "notifyBtn",
    "installBtn",
    "exportBtn",
    "importBtn",
    "importFile",
    "cloudPanel",
    "cloudStatus",
    "authForm",
    "authEmail",
    "authBtn",
    "passwordForm",
    "authPassword",
    "passwordBtn",
    "verifyForm",
    "authCode",
    "verifyCodeBtn",
    "authHint",
    "syncNowBtn",
    "signOutBtn",
    "taskForm",
    "editingId",
    "taskTitle",
    "taskDate",
    "taskTime",
    "taskReminderDate",
    "taskReminderTime",
    "taskDuration",
    "taskImportance",
    "taskEnergy",
    "taskPlace",
    "taskArea",
    "taskRepeat",
    "weekdayPicker",
    "weeklyTargetControl",
    "taskWeeklyTarget",
    "routineEventControl",
    "routineEventDate",
    "routineEventType",
    "addRoutineEventBtn",
    "routineEventList",
    "taskNotes",
    "submitLabel",
    "cancelEditBtn",
    "statsStrip",
    "sortMode",
    "boardEyebrow",
    "boardTitle",
    "dayPlanSection",
    "dayPlanTitle",
    "dayPlanDate",
    "dayPlanList",
    "taskBoard",
    "taskBoardSection",
    "calendarSection",
    "calendarTitle",
    "calendarGrid",
    "prevMonthBtn",
    "nextMonthBtn",
    "todayBtn",
    "toast",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.searchInput.addEventListener("input", (event) => {
    state.filters.query = event.target.value.trim().toLowerCase();
    debounceSearchRender();
  });

  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.view = button.dataset.view;
      if (button.dataset.view === "today") {
        state.filters.selectedDate = toDateKey(new Date());
      }
      saveState();
      render();
    });
  });

  els.sortMode.addEventListener("change", (event) => {
    state.filters.sort = event.target.value;
    saveState();
    render();
  });

  els.taskForm.addEventListener("submit", (event) => {
    event.preventDefault();
    upsertTaskFromForm();
  });

  els.taskRepeat.addEventListener("change", () => {
    syncWeekdayPickerState();
  });
  els.addRoutineEventBtn.addEventListener("click", addRoutineEventFromForm);
  els.routineEventList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-routine-event-remove]");
    if (!button) {
      return;
    }
    removeRoutineEvent(button.dataset.routineEventRemove);
  });

  els.cancelEditBtn.addEventListener("click", resetForm);

  els.taskBoard.addEventListener("click", handleTaskListClick);
  els.dayPlanList.addEventListener("click", handleTaskListClick);

  els.prevMonthBtn.addEventListener("click", () => {
    state.currentMonth = addMonths(state.currentMonth, -1);
    render();
  });

  els.nextMonthBtn.addEventListener("click", () => {
    state.currentMonth = addMonths(state.currentMonth, 1);
    render();
  });

  els.todayBtn.addEventListener("click", () => {
    state.currentMonth = startOfMonth(new Date());
    state.filters.selectedDate = toDateKey(new Date());
    state.filters.view = "today";
    render();
  });

  els.calendarGrid.addEventListener("click", (event) => {
    const dayButton = event.target.closest("[data-date]");
    if (!dayButton) {
      return;
    }
    state.filters.selectedDate = dayButton.dataset.date;
    state.filters.view = "calendar";
    saveState();
    render();
  });

  els.notifyBtn.addEventListener("click", requestNotifications);
  els.installBtn.addEventListener("click", installApp);
  els.exportBtn.addEventListener("click", exportData);
  els.importBtn.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", importData);
  els.authForm.addEventListener("submit", signInWithEmail);
  els.passwordForm.addEventListener("submit", signInWithPassword);
  els.verifyForm.addEventListener("submit", verifyOtpCode);
  els.syncNowBtn.addEventListener("click", () => syncNow());
  els.signOutBtn.addEventListener("click", signOut);

  window.addEventListener("online", () => syncNow({ silent: true }));
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await syncNow({ silent: true });
      checkReminders();
    }
  });
  window.addEventListener("focus", () => checkReminders());
}

function handleTaskListClick(event) {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }
  const card = actionButton.closest("[data-task-id]");
  const taskId = card?.dataset.taskId;
  if (!taskId) {
    return;
  }
  handleTaskAction(actionButton.dataset.action, taskId, card?.dataset.occurrenceDate || "");
}

function loadState(storageKey = getActiveStorageKey(), options = {}) {
  const { includeLegacy = false } = options;
  state.sync.storageKey = storageKey;
  state.tasks = [];
  state.deletedTasks = {};
  state.filters = { ...DEFAULT_FILTERS, selectedDate: toDateKey(new Date()) };

  let saved = readStoredState(storageKey);
  if (includeLegacy && !Array.isArray(saved.tasks)) {
    saved = readStoredState(LEGACY_STORAGE_KEY);
  }

  if (Array.isArray(saved.tasks)) {
    state.tasks = saved.tasks.map(normalizeTask);
  }
  if (saved.deletedTasks && typeof saved.deletedTasks === "object") {
    state.deletedTasks = saved.deletedTasks;
  }
  if (saved.filters) {
    state.filters = { ...state.filters, ...saved.filters };
  }

  const seeded = ensureDefaultTasks(saved.defaultDataVersion || 0);
  if (seeded) {
    saveState();
  }

  applyStateToControls();
}

function readStoredState(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function applyStateToControls() {
  els.searchInput.value = state.filters.query;
  els.sortMode.value = state.filters.sort;
  els.installBtn.classList.add("hidden");
  syncWeekdayPickerState();
}

function getActiveStorageKey() {
  if (state.sync.user) {
    const owner = state.sync.user.email || state.sync.user.id;
    return `${STORAGE_KEY_PREFIX}:user:${encodeStoragePart(owner)}`;
  }
  return `${STORAGE_KEY_PREFIX}:guest:${getGuestStorageId()}`;
}

function getLocalOnlyStorageKey() {
  return `${STORAGE_KEY_PREFIX}:local`;
}

function encodeStoragePart(value) {
  return encodeURIComponent(String(value || "anonymous").trim().toLowerCase());
}

function getGuestStorageId() {
  let guestId = sessionStorage.getItem(GUEST_SESSION_KEY);
  if (!guestId) {
    guestId = window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    sessionStorage.setItem(GUEST_SESSION_KEY, guestId);
  }
  return encodeStoragePart(guestId);
}

function getStorageOwnerEmail() {
  return state.sync.user?.email || "";
}

function saveState() {
  const payload = {
    tasks: state.tasks,
    deletedTasks: state.deletedTasks,
    defaultDataVersion: DEFAULT_DATA_VERSION,
    ownerEmail: getStorageOwnerEmail(),
    filters: {
      sort: state.filters.sort,
    },
  };
  const storageKey = state.sync.storageKey || getActiveStorageKey();
  state.sync.storageKey = storageKey;
  localStorage.setItem(storageKey, JSON.stringify(payload));
}

function ensureDefaultTasks(currentVersion) {
  if (currentVersion >= DEFAULT_DATA_VERSION) {
    return false;
  }
  const existingIds = new Set(state.tasks.map((task) => task.id));
  const deletedIds = new Set(Object.keys(state.deletedTasks));
  const additions = DEFAULT_TASKS
    .filter((task) => !existingIds.has(task.id) && !deletedIds.has(task.id))
    .map((task) => normalizeTask({ repeat: "none", dueTime: "", completed: false, ...task }));
  if (!additions.length) {
    return true;
  }
  state.tasks = [...additions, ...state.tasks];
  return true;
}

function render() {
  els.todayLabel.textContent = formatLongDate(new Date());
  renderTabs();
  renderCloudSync();
  renderStats();
  renderDayPlan();
  renderTaskBoard();
  renderCalendar();
  refreshIcons();
}

function renderSoon() {
  if (state.ui.renderFrame) {
    return;
  }
  state.ui.renderFrame = window.requestAnimationFrame(() => {
    state.ui.renderFrame = null;
    render();
  });
}

function debounceSearchRender() {
  window.clearTimeout(state.ui.searchTimer);
  state.ui.searchTimer = window.setTimeout(() => {
    render();
  }, 110);
}

function renderTabs() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.filters.view);
  });

  const calendarOnly = state.filters.view === "calendar";
  const radarOnly = state.filters.view === "radar";
  els.calendarSection.classList.toggle("hidden", false);
  els.taskBoardSection.classList.toggle("hidden", calendarOnly && window.innerWidth < 760);
  els.sortMode.closest(".sort-field").classList.toggle("hidden", radarOnly);
}

function renderCloudSync() {
  if (!els.cloudStatus) {
    return;
  }

  els.cloudStatus.classList.remove("ready", "busy", "offline");
  els.cloudPanel.hidden = !state.sync.configured;
  els.authForm.hidden = false;
  els.passwordForm.hidden = false;
  els.verifyForm.hidden = !state.sync.pendingEmail;
  els.authHint.hidden = false;
  els.syncNowBtn.disabled = true;
  els.signOutBtn.hidden = true;

  if (!state.sync.configured) {
    els.cloudStatus.classList.add("offline");
    els.cloudStatus.querySelector("span").textContent = "Solo local";
    els.authForm.hidden = true;
    els.passwordForm.hidden = true;
    els.verifyForm.hidden = true;
    els.authHint.hidden = true;
    return;
  }

  if (state.sync.busy) {
    els.cloudStatus.classList.add("busy");
    els.cloudStatus.querySelector("span").textContent = "Sincronizando";
    els.authForm.hidden = Boolean(state.sync.user);
    els.passwordForm.hidden = Boolean(state.sync.user);
    els.verifyForm.hidden = Boolean(state.sync.user) || !state.sync.pendingEmail;
    els.syncNowBtn.disabled = true;
    els.signOutBtn.hidden = !state.sync.user;
    return;
  }

  if (state.sync.user) {
    els.cloudStatus.classList.add("ready");
    els.cloudStatus.querySelector("span").textContent = state.sync.user.email || "Cuenta activa";
    els.authForm.hidden = true;
    els.passwordForm.hidden = true;
    els.verifyForm.hidden = true;
    els.authHint.hidden = true;
    els.syncNowBtn.disabled = false;
    els.signOutBtn.hidden = false;
    return;
  }

  els.cloudStatus.querySelector("span").textContent = "Sin sesión";
  els.verifyForm.hidden = !state.sync.pendingEmail;
  els.authHint.textContent = state.sync.pendingEmail
    ? `Código enviado a ${state.sync.pendingEmail}. También puedes abrir el enlace del email.`
    : "Usa el enlace del email, el código o una contraseña creada en Supabase.";
}

function renderStats() {
  const today = toDateKey(new Date());
  const active = state.tasks.filter((task) => !task.completed);
  const overdue = active.filter((task) => task.dueDate && compareDateKeys(task.dueDate, today) < 0).length;
  const todayCount = active.filter((task) => task.dueDate === today).length;
  const weekCount = active.filter((task) => {
    if (!task.dueDate) {
      return false;
    }
    const days = diffDays(today, task.dueDate);
    return days >= 0 && days <= 7;
  }).length;
  const completed = state.tasks.filter((task) => task.completed).length;

  els.statsStrip.innerHTML = [
    ["Pendientes", active.length],
    ["Hoy", todayCount],
    ["7 días", weekCount],
    ["Tarde", overdue],
  ]
    .map(([label, value]) => `<div class="stat-tile"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  if (completed > 0) {
    els.statsStrip.insertAdjacentHTML(
      "beforeend",
      `<div class="stat-tile"><strong>${completed}</strong><span>Hechas</span></div>`,
    );
  }
}

function renderDayPlan() {
  const selectedDate = state.filters.selectedDate || toDateKey(new Date());
  const tasks = getTasksForDate(selectedDate).filter(matchesQuery);
  const completedTasks = getCompletedTasksForDate(selectedDate).filter(matchesQuery);
  els.dayPlanDate.textContent = formatDateKey(selectedDate);
  els.dayPlanTitle.textContent = isTodayKey(selectedDate) ? "Schedule de hoy" : "Schedule del día";

  if (!tasks.length && !completedTasks.length) {
    els.dayPlanList.innerHTML = `
      <div class="schedule-card area-personal">
        <div class="schedule-time"><strong>Libre</strong><span>Sin bloques</span></div>
        <div class="task-toggle" aria-hidden="true"><i data-lucide="circle" aria-hidden="true"></i></div>
        <div class="task-main">
          <p class="task-name">Nada marcado para este día</p>
          <p class="task-note">Añade una tarea con fecha, una rutina por días o una cuota semanal.</p>
        </div>
      </div>
    `;
    return;
  }

  const pendingCards = buildDaySchedule(tasks, selectedDate).slice(0, 9).map((entry) => scheduleCardTemplate(entry));
  const completedCards = buildCompletedSchedule(completedTasks, selectedDate).map((entry) => scheduleCardTemplate(entry));
  els.dayPlanList.innerHTML = [...pendingCards, ...completedCards].join("");
}

function renderTaskBoard() {
  const view = state.filters.view;
  const selectedLabel = formatDateKey(state.filters.selectedDate);

  if (view === "radar") {
    els.boardEyebrow.textContent = "Mapa";
    els.boardTitle.textContent = "Radar de tareas";
    renderRadar();
    return;
  }

  const tasks = getVisibleTasks();
  const titleByView = {
    today: isTodayKey(state.filters.selectedDate) ? "Hoy" : selectedLabel,
    pending: "Pendientes",
    calendar: `Tareas del ${selectedLabel}`,
  };
  const eyebrowByView = {
    today: "Plan",
    pending: "Lista",
    calendar: "Día seleccionado",
  };

  els.boardEyebrow.textContent = eyebrowByView[view] || "Plan";
  els.boardTitle.textContent = titleByView[view] || "Tareas";

  if (!tasks.length) {
    els.taskBoard.innerHTML = `
      <div class="task-card area-personal">
        <div class="task-toggle" aria-hidden="true"><i data-lucide="circle" aria-hidden="true"></i></div>
        <div class="task-main">
          <p class="task-name">Sin tareas aquí</p>
          <p class="task-note">Hugo's Productivity mostrará aquí lo que encaje con esta vista.</p>
        </div>
      </div>
    `;
    return;
  }

  els.taskBoard.className = "task-list";
  els.taskBoard.innerHTML = tasks
    .map((task) => taskCardTemplate(task, false, view === "calendar" ? state.filters.selectedDate : ""))
    .join("");
}

function renderRadar() {
  const today = toDateKey(new Date());
  const active = state.tasks.filter((task) => !task.completed && matchesQuery(task));
  const priorityIds = new Set(sortTasks(active).slice(0, 5).map((task) => task.id));
  const lanes = [
    {
      title: "Prioridad",
      tasks: active.filter((task) => priorityIds.has(task.id)),
    },
    {
      title: "Esta semana",
      tasks: active.filter((task) => task.dueDate && diffDays(today, task.dueDate) >= 0 && diffDays(today, task.dueDate) <= 7 && !priorityIds.has(task.id)),
    },
    {
      title: "Sin fecha",
      tasks: active.filter((task) => !task.dueDate),
    },
    {
      title: "Hechas",
      tasks: state.tasks.filter((task) => task.completed && matchesQuery(task)).slice(0, 6),
    },
  ];

  els.taskBoard.className = "lane-grid";
  els.taskBoard.innerHTML = lanes
    .map((lane) => {
      const cards = lane.tasks.length
        ? lane.tasks.slice(0, 6).map((task) => taskCardTemplate(task, true)).join("")
        : `<p class="empty-copy">Nada por aquí.</p>`;
      return `
        <div class="lane">
          <h3>${lane.title}<span>${lane.tasks.length}</span></h3>
          ${cards}
        </div>
      `;
    })
    .join("");
}

function renderCalendar() {
  const monthStart = startOfMonth(state.currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const weekdays = ["L", "M", "X", "J", "V", "S", "D"];
  const today = toDateKey(new Date());
  const monthTitle = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(monthStart);

  els.calendarTitle.textContent = capitalize(monthTitle);

  const dayHeaders = weekdays.map((day) => `<div class="weekday">${day}</div>`).join("");
  const calendarDays = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
  const calendarBuckets = getCalendarBuckets(calendarDays.map(toDateKey));
  const dayButtons = calendarDays.map((date) => {
    const key = toDateKey(date);
    const bucket = calendarBuckets.get(key) || { pending: [], completed: [], weeklyTargets: [] };
    const tasks = bucket.pending;
    const completedTasks = bucket.completed;
    const dayItems = [
      ...tasks.map((task) => ({ task, completed: false })),
      ...completedTasks.map((task) => ({ task, completed: true })),
    ];
    const weeklyTargetItems = bucket.weeklyTargets;
    const visibleNormalItems = dayItems.slice(0, Math.max(0, 3 - weeklyTargetItems.length));
    const totalItems = dayItems.length + weeklyTargetItems.length;
    const outside = date.getMonth() !== monthStart.getMonth();
    const classes = [
      "calendar-day",
      outside ? "outside" : "",
      key === today ? "today" : "",
      key === state.filters.selectedDate ? "selected" : "",
      completedTasks.length ? "has-done" : "",
      weeklyTargetItems.length ? "has-weekly-target" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return `
      <button class="${classes}" type="button" data-date="${key}">
        <span class="day-number">${date.getDate()}</span>
        <span class="day-items">
          ${visibleNormalItems.map((item) => `<span class="day-item ${item.completed ? "done" : ""}">${escapeHtml(item.task.title)}</span>`).join("")}
          ${weeklyTargetItems.slice(0, 3).map((item) => `<span class="day-routine ${item.completed ? "done" : ""}"><span class="routine-dot" aria-hidden="true"></span>${escapeHtml(item.label)} ${item.progress}</span>`).join("")}
          ${totalItems > 3 ? `<span class="more-items">+${totalItems - 3}</span>` : ""}
        </span>
      </button>
    `;
  }).join("");

  els.calendarGrid.innerHTML = dayHeaders + dayButtons;
}

function getCalendarBuckets(dateKeys) {
  const buckets = new Map(dateKeys.map((key) => [key, { pending: [], completed: [], weeklyTargets: [] }]));
  const dateKeySet = new Set(dateKeys);

  state.tasks.forEach((task) => {
    if (!matchesQuery(task)) {
      return;
    }

    if (isRecurringTask(task)) {
      dateKeys.forEach((dateKey) => {
        const bucket = buckets.get(dateKey);
        if (!bucket) {
          return;
        }
        if (task.repeat === "weeklyTarget") {
          const stats = getWeeklyTargetStats(task, dateKey);
          const completed = (task.doneDates || []).includes(dateKey);
          if (completed || isRecurringTaskOnDate(task, dateKey)) {
            bucket.weeklyTargets.push({
              task,
              completed,
              label: formatRoutineOccurrenceTitle(task, dateKey),
              progress: `${stats.done}/${stats.target}`,
            });
          }
          return;
        }
        if ((task.doneDates || []).includes(dateKey)) {
          bucket.completed.push(task);
        } else if (isRecurringTaskOnDate(task, dateKey)) {
          bucket.pending.push(task);
        }
      });
      return;
    }

    if (!task.completed && dateKeySet.has(task.dueDate)) {
      buckets.get(task.dueDate)?.pending.push(task);
      return;
    }

    const completedKey = getTaskCompletedDateKey(task);
    if (task.completed && dateKeySet.has(completedKey)) {
      buckets.get(completedKey)?.completed.push(task);
    }
  });

  return buckets;
}

function getVisibleTasks() {
  const today = toDateKey(new Date());
  let tasks = state.tasks.filter(matchesQuery);

  if (state.filters.view === "today") {
    tasks = getTasksForDate(state.filters.selectedDate).filter(matchesQuery);
    if (state.filters.selectedDate === today) {
      const datedIds = new Set(tasks.map((task) => task.id));
      tasks = [
        ...tasks,
        ...state.tasks.filter((task) => !datedIds.has(task.id) && !isRecurringTask(task) && !task.completed && !task.dueDate && matchesQuery(task)),
      ];
    }
  } else if (state.filters.view === "pending") {
    tasks = tasks.filter((task) => !isTaskCompletedForDate(task, getTaskDisplayDate(task)) && !isPastCompletedRoutine(task));
  } else if (state.filters.view === "calendar") {
    const selectedDate = state.filters.selectedDate;
    const pendingTasks = getTasksForDate(selectedDate).filter(matchesQuery);
    const completedTasks = getCompletedTasksForDate(selectedDate).filter(matchesQuery);
    return [...sortTasks(pendingTasks), ...sortCompletedTasks(completedTasks, selectedDate)];
  }

  return sortTasks(tasks);
}

function sortTasks(tasks) {
  const sortMode = state.filters.sort;

  return [...tasks].sort((a, b) => {
    if (sortMode === "importance") {
      return b.importance - a.importance || compareDue(a, b);
    }
    if (sortMode === "near") {
      return compareDue(a, b) || b.importance - a.importance;
    }
    if (sortMode === "duration") {
      return a.duration - b.duration || b.importance - a.importance;
    }
    return compareDue(a, b) || b.importance - a.importance || a.duration - b.duration;
  });
}

function sortTasksForDate(tasks, dateKey) {
  return [...tasks].sort((a, b) => {
    const aDue = getTaskDueDate(a, dateKey);
    const bDue = getTaskDueDate(b, dateKey);
    if (aDue && bDue) {
      return aDue - bDue || b.importance - a.importance;
    }
    return b.importance - a.importance || a.duration - b.duration;
  });
}

function sortCompletedTasks(tasks, dateKey) {
  return [...tasks].sort((a, b) => getCompletedSortMinutes(a, dateKey) - getCompletedSortMinutes(b, dateKey));
}

function buildDaySchedule(tasks, dateKey) {
  const sorted = sortTasksForDate(tasks, dateKey);
  let floatingCursor = getScheduleStartMinutes(dateKey);

  return sorted.map((task) => {
    const hasFixedTime = Boolean(task.dueTime);
    const startMinutes = hasFixedTime ? timeToMinutes(task.dueTime) : floatingCursor;
    const duration = clampNumber(task.duration, 5, 480, 30);
    if (!hasFixedTime) {
      floatingCursor = Math.min(23 * 60, startMinutes + duration + 15);
    }
    return {
      task,
      dateKey,
      startMinutes,
      label: minutesToTime(startMinutes),
      kind: hasFixedTime ? "Fijo" : getScheduleKind(task, dateKey),
    };
  });
}

function buildCompletedSchedule(tasks, dateKey) {
  return [...tasks]
    .sort((a, b) => getCompletedSortMinutes(a, dateKey) - getCompletedSortMinutes(b, dateKey))
    .map((task) => ({
      task,
      dateKey,
      startMinutes: getCompletedSortMinutes(task, dateKey),
      label: getCompletedTimeLabel(task, dateKey),
      kind: "Hecha",
      completedHistory: true,
    }));
}

function getCompletedSortMinutes(task, dateKey) {
  const completedAt = getTaskCompletedAtForDate(task, dateKey);
  if (completedAt) {
    return timeToMinutes(`${String(completedAt.getHours()).padStart(2, "0")}:${String(completedAt.getMinutes()).padStart(2, "0")}`);
  }
  if (task.dueTime) {
    return timeToMinutes(task.dueTime);
  }
  return 23 * 60 + 59;
}

function getCompletedTimeLabel(task, dateKey) {
  const completedAt = getTaskCompletedAtForDate(task, dateKey);
  if (completedAt) {
    return minutesToTime(completedAt.getHours() * 60 + completedAt.getMinutes());
  }
  return task.dueTime || "Hecha";
}

function getScheduleStartMinutes(dateKey) {
  if (!isTodayKey(dateKey)) {
    return 9 * 60;
  }
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  return Math.max(9 * 60, roundUpTo(minutes, 15));
}

function getScheduleKind(task, dateKey) {
  if (task.repeat === "weeklyTarget") {
    const stats = getWeeklyTargetStats(task, dateKey);
    return `${stats.remaining}/${stats.target} esta semana`;
  }
  if (isRecurringTask(task)) {
    return "Rutina";
  }
  return "Sugerido";
}

function scheduleCardTemplate(entry) {
  const { task, dateKey, label, kind } = entry;
  const isDone = isTaskCompletedForDate(task, dateKey);
  const completedHistory = entry.completedHistory || isDone;
  const areaClass = `area-${task.area || "personal"}`;
  const recurring = isRecurringTask(task);
  const reminder = formatReminder(task);
  const routineEvent = getRoutineEventForDate(task, dateKey);
  const actionButtons = isDone
    ? `
      <button class="icon-button" type="button" data-action="restore" title="Reabrir" aria-label="Reabrir"><i data-lucide="rotate-ccw" aria-hidden="true"></i></button>
      <button class="icon-button" type="button" data-action="delete" title="Eliminar" aria-label="Eliminar"><i data-lucide="trash-2" aria-hidden="true"></i></button>
    `
    : `
      <button class="icon-button" type="button" data-action="complete" title="Completar" aria-label="Completar"><i data-lucide="check" aria-hidden="true"></i></button>
      <button class="icon-button" type="button" data-action="edit" title="Editar" aria-label="Editar"><i data-lucide="pencil" aria-hidden="true"></i></button>
      <button class="icon-button" type="button" data-action="delete" title="Eliminar" aria-label="Eliminar"><i data-lucide="trash-2" aria-hidden="true"></i></button>
    `;

  return `
    <article class="schedule-card ${areaClass} ${isDone ? "completed" : ""} ${completedHistory ? "completed-history" : ""}" data-task-id="${task.id}" data-occurrence-date="${dateKey}">
      <div class="schedule-time">
        <strong>${label}</strong>
        <span>${escapeHtml(kind)}</span>
      </div>
      <button class="task-toggle ${isDone ? "done" : ""}" type="button" data-action="${isDone ? "restore" : "complete"}" title="${isDone ? "Reabrir" : "Completar"}" aria-label="${isDone ? "Reabrir" : "Completar"}">
        <i data-lucide="${isDone ? "check" : "circle"}" aria-hidden="true"></i>
      </button>
      <div class="task-main">
        <p class="task-name">${escapeHtml(formatRoutineOccurrenceTitle(task, dateKey))}</p>
        <div class="task-meta">
          <span>${task.duration} min</span>
          <span>${capitalize(task.energy)}</span>
          ${task.repeat !== "none" ? `<span class="${recurring ? "routine-badge" : ""}">${formatRepeat(task)}</span>` : ""}
          ${routineEvent ? `<span class="routine-event-pill">${escapeHtml(routineEvent.title)}</span>` : ""}
          ${reminder ? `<span class="reminder-pill">${reminder}</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        ${actionButtons}
      </div>
    </article>
  `;
}

function taskCardTemplate(task, compact = false, occurrenceDate = "") {
  const due = formatDue(task, occurrenceDate);
  const reminder = formatReminder(task);
  const isDone = isTaskCompletedForDate(task, occurrenceDate || getTaskDisplayDate(task));
  const completed = isDone ? "completed" : "";
  const completedHistory = isDone ? "completed-history" : "";
  const areaClass = `area-${task.area || "personal"}`;
  const note = !compact && task.notes ? `<p class="task-note">${escapeHtml(task.notes)}</p>` : "";
  const recurring = isRecurringTask(task);
  const routineEvent = getRoutineEventForDate(task, occurrenceDate || getTaskDisplayDate(task));
  const actionButtons = isDone
    ? `
      <button class="icon-button" type="button" data-action="restore" title="Reabrir" aria-label="Reabrir"><i data-lucide="rotate-ccw" aria-hidden="true"></i></button>
      <button class="icon-button" type="button" data-action="delete" title="Eliminar" aria-label="Eliminar"><i data-lucide="trash-2" aria-hidden="true"></i></button>
    `
    : `
      <button class="icon-button" type="button" data-action="edit" title="Editar" aria-label="Editar"><i data-lucide="pencil" aria-hidden="true"></i></button>
      ${recurring ? "" : `<button class="icon-button" type="button" data-action="postpone" title="Pasar a mañana" aria-label="Pasar a mañana"><i data-lucide="calendar-plus" aria-hidden="true"></i></button>`}
      <button class="icon-button" type="button" data-action="delete" title="Eliminar" aria-label="Eliminar"><i data-lucide="trash-2" aria-hidden="true"></i></button>
    `;

  return `
    <article class="task-card ${compact ? "day-plan-card" : ""} ${areaClass} ${completed} ${completedHistory}" data-task-id="${task.id}" data-occurrence-date="${occurrenceDate || ""}">
      <button class="task-toggle ${isDone ? "done" : ""}" type="button" data-action="${isDone ? "restore" : "complete"}" title="${isDone ? "Reabrir" : "Completar"}" aria-label="${isDone ? "Reabrir" : "Completar"}">
        <i data-lucide="${isDone ? "check" : "circle"}" aria-hidden="true"></i>
      </button>
      <div class="task-main">
        <p class="task-name">${escapeHtml(formatRoutineOccurrenceTitle(task, occurrenceDate || getTaskDisplayDate(task)))}</p>
        <div class="task-meta">
          <span>${due}</span>
          <span>${task.duration} min</span>
          <span>${capitalize(task.energy)}</span>
          <span>${formatPlace(task.place)}</span>
          ${task.repeat !== "none" ? `<span class="${recurring ? "routine-badge" : ""}">${formatRepeat(task)}</span>` : ""}
          ${routineEvent ? `<span class="routine-event-pill">${escapeHtml(routineEvent.title)}</span>` : ""}
          ${reminder ? `<span class="reminder-pill">${reminder}</span>` : ""}
        </div>
        <div class="task-tags">
          <span class="area-pill">${capitalize(task.area)}</span>
          ${priorityDots(task.importance)}
        </div>
        ${note}
      </div>
      <div class="task-actions">
        ${actionButtons}
      </div>
    </article>
  `;
}

function priorityDots(level) {
  const dots = Array.from({ length: 5 }, (_, index) => {
    const filled = index < level ? "filled" : "";
    return `<span class="priority-dot ${filled}"></span>`;
  }).join("");
  return `<span class="priority-dots" aria-label="Importancia ${level} de 5">${dots}</span>`;
}

function upsertTaskFromForm() {
  const title = els.taskTitle.value.trim();
  if (!title) {
    return;
  }

  const existingId = els.editingId.value;
  const existingTask = existingId ? state.tasks.find((item) => item.id === existingId) : null;
  const repeatDays = getSelectedRepeatDays();
  if (els.taskRepeat.value === "weekdays" && !repeatDays.length) {
    toast("Elige al menos un día de repetición.");
    return;
  }
  const weeklyTarget = clampNumber(els.taskWeeklyTarget.value, 1, 7, 4);
  const reminder = normalizeReminderInput(els.taskReminderDate.value, els.taskReminderTime.value, els.taskDate.value);
  const reminderUnchanged =
    existingTask?.reminderDate === reminder.date && existingTask?.reminderTime === reminder.time;
  const dueUnchanged = existingTask?.dueDate === els.taskDate.value && existingTask?.dueTime === els.taskTime.value;
  const task = normalizeTask({
    id: existingId || crypto.randomUUID(),
    title,
    dueDate: els.taskDate.value,
    dueTime: els.taskTime.value,
    reminderDate: reminder.date,
    reminderTime: reminder.time,
    duration: clampNumber(els.taskDuration.value, 5, 480, 30),
    importance: clampNumber(els.taskImportance.value, 1, 5, 3),
    energy: els.taskEnergy.value,
    place: els.taskPlace.value,
    area: els.taskArea.value,
    repeat: els.taskRepeat.value,
    repeatDays,
    weeklyTarget,
    routineEvents: els.taskRepeat.value === "weeklyTarget" ? state.ui.routineEventsDraft : [],
    notes: els.taskNotes.value.trim(),
    completed: false,
    doneDates: existingTask?.doneDates || [],
    createdAt: existingTask?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notified: dueUnchanged ? Boolean(existingTask?.notified) : false,
    reminderNotified: reminderUnchanged ? Boolean(existingTask?.reminderNotified) : false,
  });

  if (existingId) {
    state.tasks = state.tasks.map((item) => (item.id === existingId ? { ...item, ...task } : item));
    toast("Tarea actualizada.");
  } else {
    state.tasks.unshift(task);
    toast("Tarea añadida.");
  }

  resetForm();
  saveState();
  scheduleCloudSync();
  render();
}

function handleTaskAction(action, taskId, occurrenceDate = "") {
  if (action === "complete") {
    completeTask(taskId, occurrenceDate);
  }
  if (action === "restore") {
    restoreTask(taskId, occurrenceDate);
    toast("Tarea reabierta.");
  }
  if (action === "edit") {
    editTask(taskId);
  }
  if (action === "postpone") {
    postponeTask(taskId);
  }
  if (action === "delete") {
    deleteTask(taskId);
  }
}

function completeTask(taskId, occurrenceDate = "") {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  if (isRecurringTask(task)) {
    const dateKey = occurrenceDate || getTaskDisplayDate(task) || toDateKey(new Date());
    const doneDates = [...new Set([...(task.doneDates || []), dateKey])];
    updateTask(taskId, { doneDates, notified: false, reminderNotified: false });
    toast("Rutina completada para ese día.");
    return;
  }
  updateTask(taskId, { completed: true, completedAt: new Date().toISOString() });
  const next = createNextOccurrence(task);
  if (next) {
    state.tasks.unshift(next);
    toast("Hecha. He creado la siguiente repetición.");
  } else {
    toast("Tarea completada.");
  }
  saveState();
  scheduleCloudSync();
  render();
}

function restoreTask(taskId, occurrenceDate = "") {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  if (isRecurringTask(task) && occurrenceDate) {
    const doneDates = (task.doneDates || []).filter((dateKey) => dateKey !== occurrenceDate);
    updateTask(taskId, { doneDates, notified: false, reminderNotified: false });
    return;
  }
  updateTask(taskId, { completed: false, completedAt: "", notified: false, reminderNotified: false });
}

function editTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  els.editingId.value = task.id;
  els.taskTitle.value = task.title;
  els.taskDate.value = task.dueDate;
  els.taskTime.value = task.dueTime;
  els.taskReminderDate.value = task.reminderDate || "";
  els.taskReminderTime.value = task.reminderTime || "";
  els.taskDuration.value = task.duration;
  els.taskImportance.value = task.importance;
  els.taskEnergy.value = task.energy;
  els.taskPlace.value = task.place;
  els.taskArea.value = task.area;
  els.taskRepeat.value = task.repeat;
  els.taskWeeklyTarget.value = task.weeklyTarget || 4;
  state.ui.routineEventsDraft = normalizeRoutineEvents(task.routineEvents || []);
  renderRoutineEventsDraft();
  els.taskNotes.value = task.notes;
  setSelectedRepeatDays(task.repeatDays || []);
  syncWeekdayPickerState();
  els.submitLabel.textContent = "Guardar";
  els.cancelEditBtn.hidden = false;
  els.taskTitle.focus();
}

function postponeTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  const base = task.dueDate ? fromDateKey(task.dueDate) : new Date();
  const nextDate = toDateKey(addDays(base, 1));
  state.filters.selectedDate = nextDate;
  updateTask(taskId, {
    dueDate: nextDate,
    reminderDate: getShiftedReminderDate(task, nextDate),
    notified: false,
    reminderNotified: false,
  });
  toast("Movida a mañana.");
}

function deleteTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) {
    return;
  }
  const confirmed = window.confirm(`Eliminar "${task.title}"?`);
  if (!confirmed) {
    return;
  }
  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  state.deletedTasks[taskId] = new Date().toISOString();
  saveState();
  scheduleCloudSync();
  render();
  toast("Tarea eliminada.");
}

function updateTask(taskId, patch) {
  state.tasks = state.tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }
    return normalizeTask({ ...task, ...patch, updatedAt: new Date().toISOString() });
  });
  saveState();
  scheduleCloudSync();
  render();
}

function resetForm() {
  els.taskForm.reset();
  els.editingId.value = "";
  els.taskDuration.value = 30;
  els.taskReminderDate.value = "";
  els.taskReminderTime.value = "";
  els.taskImportance.value = 3;
  els.taskEnergy.value = "media";
  els.taskPlace.value = "donde";
  els.taskArea.value = "personal";
  els.taskRepeat.value = "none";
  els.taskWeeklyTarget.value = 4;
  state.ui.routineEventsDraft = [];
  els.routineEventDate.value = "";
  els.routineEventType.value = "";
  renderRoutineEventsDraft();
  setSelectedRepeatDays([]);
  syncWeekdayPickerState();
  els.submitLabel.textContent = "Añadir";
  els.cancelEditBtn.hidden = true;
}

function addRoutineEventFromForm() {
  const date = els.routineEventDate.value || state.filters.selectedDate || toDateKey(new Date());
  const title = els.routineEventType.value.trim();
  if (!title) {
    els.routineEventType.focus();
    return;
  }
  const existing = state.ui.routineEventsDraft.find((event) => event.date === date);
  if (existing) {
    existing.title = title;
  } else {
    state.ui.routineEventsDraft.push({
      id: crypto.randomUUID(),
      date,
      title,
    });
  }
  state.ui.routineEventsDraft = normalizeRoutineEvents(state.ui.routineEventsDraft);
  els.routineEventDate.value = "";
  els.routineEventType.value = "";
  renderRoutineEventsDraft();
}

function removeRoutineEvent(eventId) {
  state.ui.routineEventsDraft = state.ui.routineEventsDraft.filter((event) => event.id !== eventId);
  renderRoutineEventsDraft();
}

function renderRoutineEventsDraft() {
  if (!els.routineEventList) {
    return;
  }
  if (!state.ui.routineEventsDraft.length) {
    els.routineEventList.innerHTML = `<p class="empty-copy compact">Sin eventos vinculados.</p>`;
    return;
  }
  els.routineEventList.innerHTML = state.ui.routineEventsDraft
    .map((event) => `
      <div class="routine-event-chip">
        <span>${formatDateKey(event.date)}</span>
        <strong>${escapeHtml(event.title)}</strong>
        <button class="icon-button mini" type="button" data-routine-event-remove="${event.id}" title="Quitar evento" aria-label="Quitar evento">
          <i data-lucide="x" aria-hidden="true"></i>
        </button>
      </div>
    `)
    .join("");
  refreshIcons();
}

function normalizeReminderInput(dateValue, timeValue, fallbackDate = "") {
  if (!dateValue && !timeValue) {
    return { date: "", time: "" };
  }
  return {
    date: dateValue || fallbackDate || toDateKey(new Date()),
    time: timeValue || "09:00",
  };
}

function getShiftedReminderDate(task, nextDueDate) {
  if (!task.reminderDate || !task.dueDate || !nextDueDate) {
    return task.reminderDate || "";
  }
  const offsetDays = diffDays(task.dueDate, task.reminderDate);
  return toDateKey(addDays(fromDateKey(nextDueDate), offsetDays));
}

function createNextOccurrence(task) {
  if (!task.dueDate || task.repeat === "none" || isRecurringTask(task)) {
    return null;
  }

  let nextDate = fromDateKey(task.dueDate);
  const today = startOfDay(new Date());
  do {
    if (task.repeat === "daily") {
      nextDate = addDays(nextDate, 1);
    }
    if (task.repeat === "weekly") {
      nextDate = addDays(nextDate, 7);
    }
    if (task.repeat === "monthly") {
      nextDate = addMonths(nextDate, 1);
    }
  } while (nextDate < today);

  const nextDateKey = toDateKey(nextDate);
  return normalizeTask({
    ...task,
    id: crypto.randomUUID(),
    dueDate: nextDateKey,
    reminderDate: getShiftedReminderDate(task, nextDateKey),
    completed: false,
    completedAt: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    notified: false,
    reminderNotified: false,
  });
}

function getTasksForDate(dateKey) {
  return state.tasks.filter((task) => {
    if (!matchesQuery(task)) {
      return false;
    }
    if (isRecurringTask(task)) {
      return isRecurringTaskOnDate(task, dateKey) && !isTaskCompletedForDate(task, dateKey);
    }
    return !task.completed && task.dueDate === dateKey;
  });
}

function getCompletedTasksForDate(dateKey) {
  return state.tasks.filter((task) => {
    if (!matchesQuery(task)) {
      return false;
    }
    if (isRecurringTask(task)) {
      return (task.doneDates || []).includes(dateKey);
    }
    return Boolean(task.completed && getTaskCompletedDateKey(task) === dateKey);
  });
}

function getTaskCompletedDateKey(task) {
  if (task.dueDate) {
    return task.dueDate;
  }
  const completedAt = getTaskCompletedAt(task);
  return completedAt ? toDateKey(completedAt) : "";
}

function getTaskCompletedAt(task) {
  if (!task.completedAt) {
    return null;
  }
  const completedAt = new Date(task.completedAt);
  return Number.isNaN(completedAt.getTime()) ? null : completedAt;
}

function getTaskCompletedAtForDate(task, dateKey) {
  const completedAt = getTaskCompletedAt(task);
  if (completedAt && toDateKey(completedAt) === dateKey) {
    return completedAt;
  }
  return null;
}

function isRecurringTask(task) {
  return (
    (task.repeat === "weekdays" && Array.isArray(task.repeatDays) && task.repeatDays.length > 0) ||
    task.repeat === "weeklyTarget"
  );
}

function isRecurringTaskOnDate(task, dateKey) {
  if (!isRecurringTask(task)) {
    return false;
  }
  if (getRoutineStartKey(task) && compareDateKeys(dateKey, getRoutineStartKey(task)) < 0) {
    return false;
  }
  if (task.repeat === "weeklyTarget") {
    if (getRoutineEventForDate(task, dateKey)) {
      return true;
    }
    return shouldSuggestWeeklyTargetOnDate(task, dateKey);
  }
  return task.repeatDays.includes(getIsoWeekday(fromDateKey(dateKey)));
}

function isTaskCompletedForDate(task, dateKey = "") {
  if (isRecurringTask(task)) {
    return Boolean(dateKey && (task.doneDates || []).includes(dateKey));
  }
  return Boolean(task.completed);
}

function isPastCompletedRoutine(task) {
  if (!isRecurringTask(task)) {
    return Boolean(task.completed);
  }
  return !getNextOccurrenceKey(task);
}

function getTaskDisplayDate(task) {
  if (isRecurringTask(task)) {
    return getNextOccurrenceKey(task) || "";
  }
  return task.dueDate || "";
}

function getNextOccurrenceKey(task, startKey = toDateKey(new Date())) {
  if (!isRecurringTask(task)) {
    return task.dueDate || "";
  }
  let cursor = fromDateKey(startKey);
  for (let index = 0; index < 90; index += 1) {
    const dateKey = toDateKey(cursor);
    if (isRecurringTaskOnDate(task, dateKey) && !isTaskCompletedForDate(task, dateKey)) {
      return dateKey;
    }
    cursor = addDays(cursor, 1);
  }
  return "";
}

function getRoutineStartKey(task) {
  if (task.dueDate) {
    return task.dueDate;
  }
  if (task.createdAt) {
    return toDateKey(new Date(task.createdAt));
  }
  return "";
}

function shouldSuggestWeeklyTargetOnDate(task, dateKey) {
  if (isTaskCompletedForDate(task, dateKey)) {
    return false;
  }
  return getScheduledWeeklyTargetDates(task, dateKey).includes(dateKey);
}

function getWeeklyTargetStats(task, dateKey) {
  const target = clampNumber(task.weeklyTarget, 1, 7, 4);
  const weekStart = startOfWeek(fromDateKey(dateKey));
  const weekEnd = addDays(weekStart, 6);
  const weekStartKey = toDateKey(weekStart);
  const weekEndKey = toDateKey(weekEnd);
  const doneDates = (task.doneDates || []).filter((doneDate) => {
    return compareDateKeys(doneDate, weekStartKey) >= 0 && compareDateKeys(doneDate, weekEndKey) <= 0;
  });
  const routineEvents = getRoutineEventsForRange(task, weekStartKey, weekEndKey);
  const remaining = Math.max(0, target - doneDates.length);
  const daysLeft = Math.max(1, diffDays(dateKey, weekEndKey) + 1);
  return {
    target,
    done: doneDates.length,
    doneDates,
    routineEvents,
    remaining,
    daysLeft,
    weekStartKey,
    weekEndKey,
  };
}

function getScheduledWeeklyTargetDates(task, dateKey) {
  const stats = getWeeklyTargetStats(task, dateKey);
  if (stats.remaining <= 0) {
    return stats.routineEvents.map((event) => event.date);
  }

  const todayKey = toDateKey(new Date());
  if (compareDateKeys(stats.weekEndKey, todayKey) < 0) {
    return [];
  }

  const routineStartKey = getRoutineStartKey(task);
  let anchorKey = stats.weekStartKey;
  if (routineStartKey && compareDateKeys(routineStartKey, anchorKey) > 0) {
    anchorKey = routineStartKey;
  }
  if (compareDateKeys(todayKey, stats.weekStartKey) >= 0 && compareDateKeys(todayKey, stats.weekEndKey) <= 0) {
    anchorKey = maxDateKey(anchorKey, todayKey);
  }

  const completed = new Set(stats.doneDates);
  const explicitDates = stats.routineEvents
    .map((event) => event.date)
    .filter((eventDate) => compareDateKeys(eventDate, anchorKey) >= 0 && !completed.has(eventDate));
  const explicitDateSet = new Set(explicitDates);
  const candidates = [];
  let cursor = fromDateKey(stats.weekStartKey);
  for (let index = 0; index < 7; index += 1) {
    const candidateKey = toDateKey(cursor);
    if (compareDateKeys(candidateKey, anchorKey) >= 0 && !completed.has(candidateKey) && !explicitDateSet.has(candidateKey)) {
      candidates.push(candidateKey);
    }
    cursor = addDays(cursor, 1);
  }
  const autoSlots = Math.max(0, stats.remaining - explicitDates.length);
  return [...explicitDates, ...candidates.slice(0, autoSlots)].sort(compareDateKeys);
}

function getRoutineEventForDate(task, dateKey) {
  if (!dateKey || task.repeat !== "weeklyTarget") {
    return null;
  }
  return (task.routineEvents || []).find((event) => event.date === dateKey) || null;
}

function getRoutineEventsForRange(task, startKey, endKey) {
  return (task.routineEvents || []).filter((event) => {
    return compareDateKeys(event.date, startKey) >= 0 && compareDateKeys(event.date, endKey) <= 0;
  });
}

function formatRoutineOccurrenceTitle(task, dateKey = "") {
  const routineEvent = getRoutineEventForDate(task, dateKey);
  if (!routineEvent) {
    return task.title;
  }
  return `${task.title} · ${routineEvent.title}`;
}

function getSelectedRepeatDays() {
  return Array.from(document.querySelectorAll('input[name="repeatDay"]:checked'))
    .map((input) => Number(input.value))
    .filter((value) => value >= 1 && value <= 7);
}

function setSelectedRepeatDays(days) {
  const selected = new Set((days || []).map(Number));
  document.querySelectorAll('input[name="repeatDay"]').forEach((input) => {
    input.checked = selected.has(Number(input.value));
  });
}

function syncWeekdayPickerState() {
  if (!els.weekdayPicker) {
    return;
  }
  const weekdaysEnabled = els.taskRepeat.value === "weekdays";
  const weeklyTargetEnabled = els.taskRepeat.value === "weeklyTarget";
  els.weekdayPicker.hidden = !weekdaysEnabled;
  els.weeklyTargetControl.hidden = !weeklyTargetEnabled;
  els.routineEventControl.hidden = !weeklyTargetEnabled;
  if (weeklyTargetEnabled && !els.routineEventDate.value) {
    els.routineEventDate.value = state.filters.selectedDate || toDateKey(new Date());
  }
  if (weekdaysEnabled && !getSelectedRepeatDays().length) {
    setSelectedRepeatDays([getIsoWeekday(fromDateKey(state.filters.selectedDate || toDateKey(new Date())))]);
  }
}

async function initCloudSync() {
  const config = getSupabaseConfig();
  state.sync.configured = Boolean(config.url && config.key && window.supabase?.createClient);
  renderCloudSync();

  if (!state.sync.configured) {
    loadState(getLocalOnlyStorageKey(), { includeLegacy: true });
    render();
    return;
  }

  state.sync.client = window.supabase.createClient(config.url, config.key, {
    auth: {
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  });

  const { data, error } = await state.sync.client.auth.getSession();
  if (!error) {
    state.sync.user = data.session?.user || null;
  }
  if (state.sync.user) {
    clearPendingEmail();
    loadState(getActiveStorageKey());
    render();
  }

  state.sync.client.auth.onAuthStateChange((_event, session) => {
    const previousStorageKey = state.sync.storageKey;
    state.sync.user = session?.user || null;
    if (state.sync.user) {
      clearPendingEmail();
      const nextStorageKey = getActiveStorageKey();
      if (nextStorageKey !== previousStorageKey) {
        loadState(nextStorageKey);
      }
    } else if (previousStorageKey !== getActiveStorageKey()) {
      loadState(getActiveStorageKey());
    }
    renderCloudSync();
    render();
    if (state.sync.user) {
      syncNow({ silent: true });
      if ("Notification" in window && Notification.permission === "granted") {
        syncPushSubscription({ silent: true });
      }
    }
  });

  if (state.sync.user) {
    await syncNow({ silent: true });
    if ("Notification" in window && Notification.permission === "granted") {
      syncPushSubscription({ silent: true });
    }
  }
}

function getSupabaseConfig() {
  const config = window.PULSO_SUPABASE || {};
  return {
    url: String(config.url || "").trim(),
    key: String(config.publishableKey || config.anonKey || "").trim(),
    vapidPublicKey: String(config.vapidPublicKey || "").trim(),
  };
}

async function signInWithEmail(event) {
  event.preventDefault();
  if (!state.sync.client) {
    toast("Configura Supabase primero.");
    return;
  }

  const email = els.authEmail.value.trim();
  if (!email) {
    els.authEmail.focus();
    return;
  }

  els.authBtn.disabled = true;
  const { error } = await state.sync.client.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: getAuthRedirectUrl(),
    },
  });
  els.authBtn.disabled = false;

  if (error) {
    toast(formatAuthError(error));
    return;
  }
  setPendingEmail(email);
  els.authCode.focus();
  renderCloudSync();
  toast("Revisa tu email: enlace o código.");
}

async function verifyOtpCode(event) {
  event.preventDefault();
  if (!state.sync.client) {
    toast("Configura Supabase primero.");
    return;
  }
  const email = state.sync.pendingEmail || els.authEmail.value.trim();
  const token = els.authCode.value.trim();
  if (!email) {
    els.authEmail.focus();
    return;
  }
  if (!token) {
    els.authCode.focus();
    return;
  }

  els.verifyCodeBtn.disabled = true;
  const { data, error } = await state.sync.client.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  els.verifyCodeBtn.disabled = false;

  if (error) {
    toast(formatAuthError(error));
    return;
  }
  state.sync.user = data.user || data.session?.user || state.sync.user;
  clearPendingEmail();
  els.authCode.value = "";
  loadState(getActiveStorageKey());
  renderCloudSync();
  render();
  await syncNow({ silent: true });
  toast("Sesión iniciada.");
}

async function signInWithPassword(event) {
  event.preventDefault();
  if (!state.sync.client) {
    toast("Configura Supabase primero.");
    return;
  }
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email) {
    els.authEmail.focus();
    return;
  }
  if (!password) {
    els.authPassword.focus();
    return;
  }

  els.passwordBtn.disabled = true;
  const { data, error } = await state.sync.client.auth.signInWithPassword({
    email,
    password,
  });
  els.passwordBtn.disabled = false;

  if (error) {
    toast(formatAuthError(error));
    return;
  }
  state.sync.user = data.user || data.session?.user || state.sync.user;
  clearPendingEmail();
  els.authPassword.value = "";
  loadState(getActiveStorageKey());
  renderCloudSync();
  render();
  await syncNow({ silent: true });
  toast("Sesión iniciada.");
}

function getAuthRedirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

function setPendingEmail(email) {
  state.sync.pendingEmail = email;
  localStorage.setItem("hugos-productivity-pending-email", email);
}

function clearPendingEmail() {
  state.sync.pendingEmail = "";
  localStorage.removeItem("hugos-productivity-pending-email");
}

function formatAuthError(error) {
  if (!error) {
    return "Error de autenticación.";
  }
  if (error.status === 429 || error.code === "over_email_send_rate_limit") {
    return "Límite de emails alcanzado. Espera un rato o configura SMTP en Supabase.";
  }
  if (error.message && error.message.toLowerCase().includes("invalid login credentials")) {
    return "Credenciales incorrectas. Crea el usuario en Supabase con Auto Confirm.";
  }
  if (error.code === "otp_disabled") {
    return "Activa Email OTP en Supabase Auth.";
  }
  if (error.message) {
    return error.message;
  }
  return "No he podido enviar/verificar el acceso.";
}

async function signOut() {
  if (!state.sync.client) {
    return;
  }
  await removePushSubscription();
  await state.sync.client.auth.signOut();
  state.sync.user = null;
  loadState(getActiveStorageKey());
  renderCloudSync();
  render();
  toast("Sesión cerrada.");
}

function scheduleCloudSync() {
  if (!state.sync.client || !state.sync.user) {
    return;
  }
  window.clearTimeout(state.sync.timer);
  state.sync.timer = window.setTimeout(() => {
    syncNow({ silent: true });
  }, 800);
}

async function syncNow(options = {}) {
  const { silent = false } = options;
  if (!state.sync.client || !state.sync.user) {
    return;
  }
  if (state.sync.busy) {
    return;
  }

  state.sync.busy = true;
  renderCloudSync();

  try {
    await pullRemoteTasks();
    await pushLocalTasks();
    pruneDeletedTasks();
    state.sync.lastSyncedAt = new Date().toISOString();
    saveState();
    render();
    if (!silent) {
      toast("Sincronizado.");
    }
  } catch (error) {
    console.error(error);
    if (!silent) {
      toast("No he podido sincronizar.");
    }
  } finally {
    state.sync.busy = false;
    renderCloudSync();
  }
}

async function pushLocalTasks() {
  const userId = state.sync.user.id;
  const taskRows = state.tasks.map((task) => ({
    user_id: userId,
    task_id: task.id,
    payload: task,
    updated_at: task.updatedAt || task.createdAt || new Date().toISOString(),
    deleted_at: null,
  }));

  const deletedRows = Object.entries(state.deletedTasks).map(([taskId, deletedAt]) => ({
    user_id: userId,
    task_id: taskId,
    payload: {},
    updated_at: deletedAt,
    deleted_at: deletedAt,
  }));

  const rows = [...taskRows, ...deletedRows];
  for (const batch of chunk(rows, 100)) {
    if (!batch.length) {
      continue;
    }
    const { error } = await state.sync.client
      .from("pulso_tasks")
      .upsert(batch, { onConflict: "user_id,task_id" });
    if (error) {
      throw error;
    }
  }
}

async function pullRemoteTasks() {
  const userId = state.sync.user.id;
  const { data, error } = await state.sync.client
    .from("pulso_tasks")
    .select("task_id,payload,updated_at,deleted_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: true });

  if (error) {
    throw error;
  }

  const localById = new Map(state.tasks.map((task) => [task.id, task]));
  let changed = false;

  for (const row of data || []) {
    const taskId = row.task_id;
    const remoteUpdatedAt = row.updated_at || "";
    const localDeletedAt = state.deletedTasks[taskId] || "";

    if (row.deleted_at) {
      if (!localDeletedAt || compareIso(row.deleted_at, localDeletedAt) > 0) {
        state.deletedTasks[taskId] = row.deleted_at;
        state.tasks = state.tasks.filter((task) => task.id !== taskId);
        changed = true;
      }
      continue;
    }

    if (localDeletedAt && compareIso(localDeletedAt, remoteUpdatedAt) >= 0) {
      continue;
    }

    const remoteTask = normalizeTask({ ...(row.payload || {}), id: taskId });
    remoteTask.updatedAt = remoteTask.updatedAt || remoteUpdatedAt;
    const localTask = localById.get(taskId);

    if (!localTask) {
      state.tasks.push(remoteTask);
      delete state.deletedTasks[taskId];
      changed = true;
      continue;
    }

    if (compareIso(remoteTask.updatedAt, localTask.updatedAt) > 0) {
      state.tasks = state.tasks.map((task) => (task.id === taskId ? remoteTask : task));
      delete state.deletedTasks[taskId];
      changed = true;
    }
  }

  if (changed) {
    state.tasks = sortTasks(state.tasks);
  }
}


async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("Este navegador no permite avisos.");
    return;
  }
  if (!window.isSecureContext) {
    toast("Los avisos necesitan HTTPS o la app instalada.");
    return;
  }
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission === "granted") {
    await ensureNotificationServiceWorker();
    const pushReady = await syncPushSubscription();
    toast(pushReady ? "Avisos activados en segundo plano." : "Avisos activados en esta app.");
    checkReminders();
  } else {
    toast("Avisos sin activar.");
  }
}

async function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  if (state.ui.reminderCheckRunning) {
    return;
  }
  state.ui.reminderCheckRunning = true;
  try {
    const now = new Date();
    let changed = false;
    for (const task of state.tasks) {
      if (task.completed || isPastCompletedRoutine(task)) {
        continue;
      }

      const reminder = getTaskReminderDate(task);
      if (reminder) {
        const minutes = (reminder.getTime() - now.getTime()) / 60000;
        if (!task.reminderNotified && minutes <= 0 && minutes >= -24 * 60) {
          const shown = await showTaskNotification(task, `${formatReminder(task)} · ${task.duration} min`, "reminder");
          if (shown) {
            task.reminderNotified = true;
            task.updatedAt = new Date().toISOString();
            changed = true;
          }
        }
        continue;
      }

      if (task.notified || !task.dueDate || !task.dueTime) {
        continue;
      }
      const due = getTaskDueDate(task);
      const minutes = (due.getTime() - now.getTime()) / 60000;
      if (minutes <= 10 && minutes >= -3) {
        const shown = await showTaskNotification(task, `${formatDue(task)} · ${task.duration} min`, "due");
        if (shown) {
          task.notified = true;
          task.updatedAt = new Date().toISOString();
          changed = true;
        }
      }
    }
    if (!changed) {
      return;
    }
    saveState();
    scheduleCloudSync();
  } finally {
    state.ui.reminderCheckRunning = false;
  }
}

async function ensureNotificationServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }
  try {
    await navigator.serviceWorker.register("./service-worker.js");
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

async function showTaskNotification(task, body, kind) {
  const options = {
    body,
    icon: "./assets/icon.svg",
    badge: "./assets/icon.svg",
    tag: `task-${task.id}-${kind}`,
    renotify: true,
    data: {
      taskId: task.id,
      url: `${window.location.pathname}${window.location.search}`,
    },
    vibrate: [80, 40, 80],
  };

  try {
    const registration = await ensureNotificationServiceWorker();
    if (registration?.showNotification) {
      await registration.showNotification(task.title, options);
      return true;
    }
  } catch {
    // Fallback below for browsers that expose notifications but reject service-worker display.
  }

  try {
    new Notification(task.title, options);
    return true;
  } catch {
    return false;
  }
}

async function syncPushSubscription(options = {}) {
  const { silent = false } = options;
  if (!state.sync.client || !state.sync.user) {
    if (!silent) {
      toast("Inicia sesion para recibir avisos con la app cerrada.");
    }
    return false;
  }

  const config = getSupabaseConfig();
  if (!config.vapidPublicKey) {
    if (!silent) {
      toast("Falta la clave publica VAPID para avisos en segundo plano.");
    }
    return false;
  }

  const registration = await ensureNotificationServiceWorker();
  if (!registration?.pushManager) {
    if (!silent) {
      toast("Este navegador no permite avisos en segundo plano.");
    }
    return false;
  }

  try {
    const subscription =
      (await registration.pushManager.getSubscription()) ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
      }));
    const row = pushSubscriptionToRow(subscription);
    const { error } = await state.sync.client.from("pulso_push_subscriptions").upsert(row, {
      onConflict: "user_id,endpoint",
    });
    if (error) {
      throw error;
    }
    return true;
  } catch (error) {
    console.error(error);
    if (!silent) {
      toast("No he podido guardar el dispositivo para segundo plano.");
    }
    return false;
  }
}

async function removePushSubscription() {
  if (!state.sync.client || !state.sync.user || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    if (!subscription) {
      return;
    }
    await state.sync.client
      .from("pulso_push_subscriptions")
      .delete()
      .eq("user_id", state.sync.user.id)
      .eq("endpoint", subscription.endpoint);
  } catch {
    // Sign out should continue even if the browser refuses push cleanup.
  }
}

function pushSubscriptionToRow(subscription) {
  const json = subscription.toJSON();
  return {
    user_id: state.sync.user.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh || "",
    auth: json.keys?.auth || "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    user_agent: navigator.userAgent || "",
    updated_at: new Date().toISOString(),
  };
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function installApp() {
  if (!state.deferredInstallPrompt) {
    toast("Instálala desde el menú del navegador.");
    return;
  }
  state.deferredInstallPrompt.prompt();
  await state.deferredInstallPrompt.userChoice;
  state.deferredInstallPrompt = null;
  els.installBtn.classList.add("hidden");
}

function exportData() {
  const payload = {
    app: "Hugo's Productivity",
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: state.tasks,
    deletedTasks: state.deletedTasks,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `hugos-productivity-${toDateKey(new Date())}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("Datos exportados.");
}

function importData(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result || "{}"));
      const importedTasks = Array.isArray(payload.tasks) ? payload.tasks : Array.isArray(payload) ? payload : [];
      const existingIds = new Set(state.tasks.map((task) => task.id));
      const merged = importedTasks.map(normalizeTask).map((task) => {
        if (existingIds.has(task.id)) {
          return { ...task, id: crypto.randomUUID() };
        }
        return task;
      });
      merged.forEach((task) => {
        delete state.deletedTasks[task.id];
      });
      if (payload.deletedTasks && typeof payload.deletedTasks === "object") {
        state.deletedTasks = { ...state.deletedTasks, ...payload.deletedTasks };
      }
      state.tasks = [...merged, ...state.tasks];
      saveState();
      scheduleCloudSync();
      render();
      toast(`${merged.length} tareas importadas.`);
    } catch {
      toast("No he podido importar ese archivo.");
    } finally {
      els.importFile.value = "";
    }
  });
  reader.readAsText(file);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {
      // La app sigue funcionando aunque el navegador bloquee el modo offline.
    });
  });
}

function normalizeTask(task) {
  const createdAt = task.createdAt || new Date().toISOString();
  return {
    id: task.id || crypto.randomUUID(),
    title: String(task.title || "").trim(),
    dueDate: task.dueDate || "",
    dueTime: task.dueTime || "",
    reminderDate: task.reminderDate || "",
    reminderTime: task.reminderTime || "",
    duration: clampNumber(task.duration, 5, 480, 30),
    importance: clampNumber(task.importance, 1, 5, 3),
    energy: ["baja", "media", "alta"].includes(task.energy) ? task.energy : "media",
    place: ["donde", "casa", "fuera", "online"].includes(task.place) ? task.place : "donde",
    area: ["personal", "estudio", "trabajo", "salud", "casa", "creativo"].includes(task.area) ? task.area : "personal",
    repeat: ["none", "daily", "weekly", "monthly", "weekdays", "weeklyTarget"].includes(task.repeat) ? task.repeat : "none",
    repeatDays: Array.isArray(task.repeatDays)
      ? [...new Set(task.repeatDays.map(Number).filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b)
      : [],
    weeklyTarget: clampNumber(task.weeklyTarget, 1, 7, 4),
    routineEvents: normalizeRoutineEvents(task.routineEvents || []),
    notes: task.notes || "",
    completed: Boolean(task.completed),
    completedAt: task.completedAt || "",
    doneDates: Array.isArray(task.doneDates) ? [...new Set(task.doneDates.filter(Boolean))] : [],
    createdAt,
    updatedAt: task.updatedAt || createdAt,
    notified: Boolean(task.notified),
    reminderNotified: Boolean(task.reminderNotified),
  };
}

function normalizeRoutineEvents(events) {
  const byDate = new Map();
  (Array.isArray(events) ? events : []).forEach((event) => {
    const date = String(event?.date || "").trim();
    const title = String(event?.title || event?.type || "").trim();
    if (!date || !title || !isValidDateKey(date)) {
      return;
    }
    byDate.set(date, {
      id: event.id || crypto.randomUUID(),
      date,
      title: title.slice(0, 40),
    });
  });
  return [...byDate.values()].sort((a, b) => compareDateKeys(a.date, b.date));
}

function matchesQuery(task) {
  const query = state.filters.query;
  if (!query) {
    return true;
  }
  const routineEvents = (task.routineEvents || []).map((event) => event.title).join(" ");
  return `${task.title} ${task.notes} ${task.area} ${task.place} ${task.energy} ${routineEvents}`.toLowerCase().includes(query);
}

function getTaskDueDate(task, dateKey = "") {
  const dueDate = dateKey || getTaskDisplayDate(task);
  if (!dueDate) {
    return null;
  }
  return new Date(`${dueDate}T${task.dueTime || "23:59"}`);
}

function getTaskReminderDate(task) {
  if (!task.reminderDate || !task.reminderTime) {
    return null;
  }
  return new Date(`${task.reminderDate}T${task.reminderTime}`);
}

function formatDue(task, occurrenceDate = "") {
  if (isRecurringTask(task)) {
    const date = occurrenceDate || getTaskDisplayDate(task);
    const dayText = date ? formatDateKey(date) : formatRepeat(task);
    return task.dueTime ? `${dayText}, ${task.dueTime}` : `Rutina · ${dayText}`;
  }
  if (!task.dueDate) {
    return "Sin fecha";
  }
  const date = formatDateKey(task.dueDate);
  return task.dueTime ? `${date}, ${task.dueTime}` : date;
}

function formatReminder(task) {
  if (!task.reminderDate || !task.reminderTime) {
    return "";
  }
  return `Aviso ${formatDateKey(task.reminderDate)}, ${task.reminderTime}`;
}

function formatDateKey(key) {
  return new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short" }).format(fromDateKey(key));
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function formatPlace(place) {
  const labels = {
    donde: "Donde sea",
    casa: "Casa",
    fuera: "Fuera",
    online: "Online",
  };
  return labels[place] || "Donde sea";
}

function formatRepeat(taskOrRepeat) {
  const repeat = typeof taskOrRepeat === "string" ? taskOrRepeat : taskOrRepeat.repeat;
  if (repeat === "weekdays") {
    return typeof taskOrRepeat === "string" ? "Días" : formatRepeatDays(taskOrRepeat.repeatDays || []);
  }
  if (repeat === "weeklyTarget") {
    return typeof taskOrRepeat === "string" ? "Veces/semana" : `${taskOrRepeat.weeklyTarget || 4}/semana`;
  }
  const labels = {
    daily: "Diario",
    weekly: "Semanal",
    monthly: "Mensual",
  };
  return labels[repeat] || "";
}

function formatRepeatDays(days) {
  const labels = {
    1: "L",
    2: "M",
    3: "X",
    4: "J",
    5: "V",
    6: "S",
    7: "D",
  };
  return (days || []).map((day) => labels[day]).filter(Boolean).join(" · ");
}

function compareDue(a, b) {
  const aDue = getTaskDueDate(a);
  const bDue = getTaskDueDate(b);
  if (aDue && bDue) {
    return aDue - bDue;
  }
  if (aDue) {
    return -1;
  }
  if (bDue) {
    return 1;
  }
  return b.importance - a.importance;
}

function compareDateKeys(a, b) {
  return fromDateKey(a) - fromDateKey(b);
}

function maxDateKey(a, b) {
  return compareDateKeys(a, b) >= 0 ? a : b;
}

function diffDays(startKey, endKey) {
  const start = startOfDay(fromDateKey(startKey));
  const end = startOfDay(fromDateKey(endKey));
  return Math.round((end - start) / 86400000);
}

function isTodayKey(key) {
  return key === toDateKey(new Date());
}

function getIsoWeekday(date) {
  return date.getDay() || 7;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isValidDateKey(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) {
    return false;
  }
  const date = fromDateKey(key);
  return toDateKey(date) === key;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date) {
  const day = date.getDay() || 7;
  return addDays(startOfDay(date), 1 - day);
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function addMonths(date, amount) {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + amount);
  return copy;
}

function timeToMinutes(timeValue) {
  const [hours = 0, minutes = 0] = String(timeValue || "09:00").split(":").map(Number);
  return clampNumber(hours, 0, 23, 9) * 60 + clampNumber(minutes, 0, 59, 0);
}

function minutesToTime(minutesValue) {
  const minutes = clampNumber(minutesValue, 0, 23 * 60 + 59, 9 * 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function roundUpTo(value, step) {
  return Math.ceil(value / step) * step;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

function compareIso(a, b) {
  return new Date(a || 0).getTime() - new Date(b || 0).getTime();
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function pruneDeletedTasks() {
  const limit = addDays(new Date(), -45).getTime();
  Object.entries(state.deletedTasks).forEach(([taskId, deletedAt]) => {
    if (new Date(deletedAt).getTime() < limit) {
      delete state.deletedTasks[taskId];
    }
  });
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timeout);
  toast.timeout = window.setTimeout(() => {
    els.toast.classList.remove("show");
  }, 2400);
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}
