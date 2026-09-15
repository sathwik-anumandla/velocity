import 'dart:async';
import 'package:flutter/material.dart';
import '../models/session.dart';
import '../models/chat_message.dart';
import '../models/search_result.dart';
import '../services/api_service.dart';

class ChatProvider extends ChangeNotifier {
  final ApiService _api = ApiService();

  List<Session> _sessions = [];
  Session? _currentSession;
  List<ChatMessage> _messages = [];
  final List<String> _openTabIds = [];

  bool _isBackendOnline = false;
  bool _isHindsightHealthy = true;
  bool _isLoadingSessions = false;
  bool _isLoadingMessages = false;
  bool _isGenerating = false;
  bool _isThinking = false;
  String? _activeToolQuery;
  List<String> _activeTools = [];
  double _elapsedSeconds = 0.0;
  Timer? _elapsedTimer;
  DateTime? _generationStartTime;

  bool _isSidebarOpen = true;
  ThemeMode _themeMode = ThemeMode.dark;

  List<SearchResult> _searchResults = [];
  bool _isSearching = false;

  StreamSubscription<String>? _streamSub;

  // Getters
  List<Session> get sessions => _sessions;
  Session? get currentSession => _currentSession;
  List<ChatMessage> get messages => _messages;
  List<String> get openTabIds => _openTabIds;
  bool get isBackendOnline => _isBackendOnline;
  bool get isHindsightHealthy => _isHindsightHealthy;
  bool get isLoadingSessions => _isLoadingSessions;
  bool get isLoadingMessages => _isLoadingMessages;
  bool get isGenerating => _isGenerating;
  bool get isThinking => _isThinking;
  String? get activeToolQuery => _activeToolQuery;
  List<String> get activeTools => _activeTools;
  double get elapsedSeconds => _elapsedSeconds;
  bool get isSidebarOpen => _isSidebarOpen;
  ThemeMode get themeMode => _themeMode;
  List<SearchResult> get searchResults => _searchResults;
  bool get isSearching => _isSearching;

  String _recallBudget = 'medium';
  String _thinkingEffort = 'medium';
  String _verbosity = 'low';
  bool _isTemporaryMode = false;

  String get recallBudget => _currentSession?.recallBudget ?? _recallBudget;
  String get thinkingEffort => _currentSession?.thinkingEffort ?? _thinkingEffort;
  String get verbosity => _currentSession?.verbosity ?? _verbosity;
  bool get isTemporary => _isTemporaryMode || (_currentSession?.isTemporary ?? false);

  ChatProvider() {
    init();
  }

  Future<void> init() async {
    await checkBackendHealth();
    if (_isBackendOnline) {
      await loadSessions();
    }
  }

  Future<void> checkBackendHealth() async {
    final healthMap = await _api.getSystemHealth();
    _isBackendOnline = healthMap['backend'] == 'healthy';
    _isHindsightHealthy = healthMap['hindsight'] == 'healthy';
    notifyListeners();
  }

  Future<void> loadSessions() async {
    _isLoadingSessions = true;
    notifyListeners();
    try {
      final list = await _api.listSessions();
      _sessions = list;
      if (_currentSession == null && !_isTemporaryMode && _sessions.isNotEmpty) {
        await selectSession(_sessions.first);
      }
    } catch (e) {
      debugPrint('Error loading sessions: $e');
    } finally {
      _isLoadingSessions = false;
      notifyListeners();
    }
  }

  Future<void> selectSession(Session session) async {
    if (_isGenerating) return;
    _isTemporaryMode = false;
    _currentSession = session;
    _recallBudget = session.recallBudget;
    _thinkingEffort = session.thinkingEffort;
    _verbosity = session.verbosity;
    if (!_openTabIds.contains(session.id)) {
      _openTabIds.add(session.id);
    }

    if (session.isTemporary) {
      _messages = [];
      notifyListeners();
      return;
    }

    if (_messages.isEmpty) {
      _isLoadingMessages = true;
    }

    try {
      final msgs = await _api.getSessionMessages(session.id);
      _messages = msgs;
    } catch (e) {
      debugPrint('Error loading messages: $e');
    } finally {
      _isLoadingMessages = false;
      notifyListeners();
    }
  }

  void selectTab(String sessionId) {
    final s = _sessions.where((sess) => sess.id == sessionId).toList();
    if (s.isNotEmpty) {
      selectSession(s.first);
    }
  }

  void closeTab(String sessionId) {
    _openTabIds.remove(sessionId);
    if (_currentSession?.id == sessionId) {
      if (_openTabIds.isNotEmpty) {
        selectTab(_openTabIds.last);
      } else {
        startNewChat();
      }
    } else {
      notifyListeners();
    }
  }

  void toggleTemporary() {
    if (isTemporary) {
      _isTemporaryMode = false;
      if (_sessions.isNotEmpty) {
        selectSession(_sessions.first);
      } else {
        startNewChat(isTemporary: false);
      }
    } else {
      startNewChat(isTemporary: true);
    }
  }

  void toggleSidebar() {
    _isSidebarOpen = !_isSidebarOpen;
    notifyListeners();
  }

  void toggleTheme() {
    _themeMode = _themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }

  Future<void> editAndResendPrompt(int index, String newText) async {
    if (_isGenerating) return;
    if (index >= 0 && index < _messages.length) {
      final targetMessage = _messages[index];
      final currentSessionId = _currentSession?.id;
      if (currentSessionId != null) {
        await _api.truncateMessagesFrom(currentSessionId, targetMessage.id);
      }
      _messages = _messages.sublist(0, index);
      notifyListeners();
      await sendMessage(newText);
    }
  }

  Future<void> regenerateLastAssistant() async {
    if (_isGenerating || _messages.isEmpty) return;
    final currentSessionId = _currentSession?.id;
    if (_messages.last.role == 'assistant') {
      final lastAssistant = _messages.removeLast();
      if (currentSessionId != null) {
        await _api.truncateMessagesFrom(currentSessionId, lastAssistant.id);
      }
    }
    if (_messages.isNotEmpty && _messages.last.role == 'user') {
      final lastUser = _messages.removeLast();
      if (currentSessionId != null) {
        await _api.truncateMessagesFrom(currentSessionId, lastUser.id);
      }
      notifyListeners();
      await sendMessage(lastUser.content);
    }
  }

  void startNewChat({bool isTemporary = false}) {
    if (_isGenerating) return;
    _currentSession = null;
    _messages = [];
    _isTemporaryMode = isTemporary;
    _recallBudget = 'medium';
    _thinkingEffort = 'medium';
    _verbosity = 'low';
    notifyListeners();
  }

  Future<void> createNewSession({bool isTemporary = false}) async {
    startNewChat(isTemporary: isTemporary);
  }

  Future<void> renameSession(String sessionId, String newName) async {
    final idx = _sessions.indexWhere((s) => s.id == sessionId);
    if (idx != -1) {
      _sessions[idx].name = newName;
      if (_currentSession?.id == sessionId) {
        _currentSession!.name = newName;
      }
      notifyListeners();
    }

    final target = _sessions.firstWhere((s) => s.id == sessionId);
    if (!target.isTemporary) {
      try {
        await _api.updateSession(sessionId, name: newName);
      } catch (e) {
        debugPrint('Error renaming session: $e');
      }
    }
  }

  Future<void> deleteSession(String sessionId) async {
    _openTabIds.remove(sessionId);
    final idx = _sessions.indexWhere((s) => s.id == sessionId);
    if (idx == -1) return;

    final target = _sessions[idx];
    _sessions.removeAt(idx);

    if (_currentSession?.id == sessionId) {
      if (_sessions.isNotEmpty) {
        await selectSession(_sessions.first);
      } else {
        startNewChat(isTemporary: false);
      }
    } else {
      notifyListeners();
    }

    if (!target.isTemporary) {
      try {
        await _api.deleteSession(sessionId);
      } catch (e) {
        debugPrint('Error deleting session: $e');
      }
    }
  }

  Future<void> setRecallBudget(String budget) async {
    _recallBudget = budget;
    if (_currentSession != null) {
      _currentSession!.recallBudget = budget;
    }
    notifyListeners();

    if (_currentSession != null && !_currentSession!.isTemporary) {
      try {
        await _api.updateSession(_currentSession!.id, recallBudget: budget);
      } catch (e) {
        debugPrint('Error updating recall budget: $e');
      }
    }
  }

  Future<void> setThinkingEffort(String effort) async {
    _thinkingEffort = effort;
    if (_currentSession != null) {
      _currentSession!.thinkingEffort = effort;
    }
    notifyListeners();

    if (_currentSession != null && !_currentSession!.isTemporary) {
      try {
        await _api.updateSession(_currentSession!.id, thinkingEffort: effort);
      } catch (e) {
        debugPrint('Error updating thinking effort: $e');
      }
    }
  }

  Future<void> setVerbosity(String level) async {
    _verbosity = level;
    if (_currentSession != null) {
      _currentSession!.verbosity = level;
    }
    notifyListeners();

    if (_currentSession != null && !_currentSession!.isTemporary) {
      try {
        await _api.updateSession(_currentSession!.id, verbosity: level);
      } catch (e) {
        debugPrint('Error updating verbosity: $e');
      }
    }
  }

  Future<void> search(String query) async {
    if (query.trim().isEmpty) {
      _searchResults = [];
      notifyListeners();
      return;
    }
    _isSearching = true;
    notifyListeners();
    try {
      _searchResults = await _api.searchMessages(query);
    } catch (e) {
      debugPrint('Error searching messages: $e');
      _searchResults = [];
    } finally {
      _isSearching = false;
      notifyListeners();
    }
  }

  Future<void> sendMessage(String text) async {
    final cleanText = text.trim();
    if (cleanText.isEmpty || _isGenerating) return;

    if (_currentSession == null) {
      if (_isTemporaryMode) {
        final now = DateTime.now();
        final tempId = 'temp-${now.millisecondsSinceEpoch}';
        _currentSession = Session(
          id: tempId,
          name: 'Temporary Chat',
          recallBudget: _recallBudget,
          thinkingEffort: _thinkingEffort,
          verbosity: _verbosity,
          createdAt: now,
          updatedAt: now,
          isTemporary: true,
        );
      } else {
        try {
          final newSess = await _api.createSession(
            name: 'New Chat',
            recallBudget: _recallBudget,
            thinkingEffort: _thinkingEffort,
            verbosity: _verbosity,
          );
          _sessions.insert(0, newSess);
          _currentSession = newSess;
        } catch (e) {
          debugPrint('Error creating session: $e');
          return;
        }
      }
    }
    final session = _currentSession!;
    if (!_openTabIds.contains(session.id)) {
      _openTabIds.add(session.id);
    }

    final userMsg = ChatMessage(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
      sessionId: session.id,
      role: 'user',
      content: cleanText,
      createdAt: DateTime.now(),
    );
    _messages.add(userMsg);

    final currentRecallBudget = recallBudget;
    final currentThinkingEffort = thinkingEffort;
    final currentVerbosity = verbosity;

    final assistantMsg = ChatMessage(
      id: (DateTime.now().microsecondsSinceEpoch + 1).toString(),
      sessionId: session.id,
      role: 'assistant',
      content: '',
      createdAt: DateTime.now(),
      isStreaming: true,
      recallBudget: currentRecallBudget,
      thinkingEffort: currentThinkingEffort,
    );
    _messages.add(assistantMsg);

    _isGenerating = true;
    _isThinking = true;
    _activeToolQuery = null;
    _activeTools = [];
    _generationStartTime = DateTime.now();
    _elapsedSeconds = 0.0;

    _elapsedTimer?.cancel();
    _elapsedTimer = Timer.periodic(const Duration(milliseconds: 100), (_) {
      if (_generationStartTime != null) {
        _elapsedSeconds = DateTime.now().difference(_generationStartTime!).inMilliseconds / 1000.0;
        notifyListeners();
      }
    });

    notifyListeners();

    _streamSub = await _api.streamChat(
      sessionId: session.id,
      message: cleanText,
      recallBudget: currentRecallBudget,
      thinkingEffort: currentThinkingEffort,
      verbosity: currentVerbosity,
      isTemporary: session.isTemporary,
      onThinking: () {
        _isThinking = true;
        notifyListeners();
      },
      onToolStart: (query) {
        final q = query.isNotEmpty ? query : 'Searching the web...';
        _activeToolQuery = q;
        if (!_activeTools.contains(q)) {
          _activeTools.add(q);
        }
        notifyListeners();
      },
      onToolDone: () {
        _activeToolQuery = null;
        notifyListeners();
      },
      onSessionRenamed: (newTitle) {
        if (_currentSession?.id == session.id) {
          _currentSession!.name = newTitle;
        }
        final sIdx = _sessions.indexWhere((s) => s.id == session.id);
        if (sIdx != -1) {
          _sessions[sIdx].name = newTitle;
        }
        notifyListeners();
      },
      onDelta: (deltaText) {
        assistantMsg.content += deltaText;
        notifyListeners();
      },
      onComplete: (fullText, memoryStatus, usage) {
        _elapsedTimer?.cancel();
        _elapsedTimer = null;
        _isThinking = false;
        _activeToolQuery = null;
        _isGenerating = false;
        assistantMsg.content = fullText;
        assistantMsg.memoryStatus = memoryStatus;
        assistantMsg.isStreaming = false;
        assistantMsg.durationSeconds = _elapsedSeconds > 0 ? _elapsedSeconds : 1.5;
        assistantMsg.toolCalls = List.from(_activeTools);
        session.updatedAt = DateTime.now();
        notifyListeners();
      },
      onError: (err) {
        _elapsedTimer?.cancel();
        _elapsedTimer = null;
        _isThinking = false;
        _activeToolQuery = null;
        _isGenerating = false;
        assistantMsg.content = '[Error: $err]';
        assistantMsg.memoryStatus = 'degraded';
        assistantMsg.isStreaming = false;
        assistantMsg.durationSeconds = _elapsedSeconds > 0 ? _elapsedSeconds : null;
        notifyListeners();
      },
    );
  }

  void cancelGeneration() {
    _elapsedTimer?.cancel();
    _elapsedTimer = null;
    _streamSub?.cancel();
    _streamSub = null;
    _isGenerating = false;
    _isThinking = false;
    _activeToolQuery = null;
    if (_messages.isNotEmpty && _messages.last.isStreaming) {
      _messages.last.isStreaming = false;
    }
    notifyListeners();
  }

  @override
  void dispose() {
    _elapsedTimer?.cancel();
    _streamSub?.cancel();
    super.dispose();
  }
}
