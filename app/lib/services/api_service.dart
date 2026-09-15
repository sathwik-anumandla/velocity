import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:http/http.dart' as http;
import '../models/session.dart';
import '../models/chat_message.dart';
import '../models/search_result.dart';

String _getDefaultBaseUrl() {
  const envUrl = String.fromEnvironment('API_URL');
  if (envUrl.isNotEmpty) return envUrl;
  if (!kIsWeb && Platform.isAndroid) {
    return 'http://10.0.2.2:8000';
  }
  return 'http://localhost:8000';
}

class ApiService {
  final String baseUrl;
  final http.Client _client;

  ApiService({String? baseUrl})
      : baseUrl = baseUrl ?? _getDefaultBaseUrl(),
        _client = http.Client();

  /// Health Check
  Future<bool> checkHealth() async {
    try {
      final response = await _client
          .get(Uri.parse('$baseUrl/health'))
          .timeout(const Duration(seconds: 3));
      if (response.statusCode == 200) {
        final data = json.decode(response.body);
        return data['backend'] == 'healthy';
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /// Full System Health Check
  Future<Map<String, dynamic>> getSystemHealth() async {
    try {
      final response = await _client
          .get(Uri.parse('$baseUrl/health'))
          .timeout(const Duration(seconds: 3));
      if (response.statusCode == 200) {
        return json.decode(response.body) as Map<String, dynamic>;
      }
      return {'backend': 'unreachable', 'hindsight': 'unreachable'};
    } catch (_) {
      return {'backend': 'unreachable', 'hindsight': 'unreachable'};
    }
  }

  /// List persistent sessions
  Future<List<Session>> listSessions() async {
    final response = await _client
        .get(Uri.parse('$baseUrl/sessions'))
        .timeout(const Duration(seconds: 5));
    if (response.statusCode == 200) {
      final List<dynamic> list = json.decode(utf8.decode(response.bodyBytes));
      return list.map((item) => Session.fromJson(item as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load sessions: ${response.statusCode}');
  }

  /// Create a new session
  Future<Session> createSession({
    String? name,
    String recallBudget = 'medium',
    String thinkingEffort = 'medium',
    String verbosity = 'low',
  }) async {
    final response = await _client.post(
      Uri.parse('$baseUrl/sessions'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode({
        if (name != null && name.isNotEmpty) 'name': name,
        'recall_budget': recallBudget,
        'thinking_effort': thinkingEffort,
        'verbosity': verbosity,
      }),
    );
    if (response.statusCode == 200) {
      return Session.fromJson(json.decode(utf8.decode(response.bodyBytes)));
    }
    throw Exception('Failed to create session: ${response.statusCode}');
  }

  /// Update session name or sticky settings
  Future<Session> updateSession(
    String sessionId, {
    String? name,
    String? recallBudget,
    String? thinkingEffort,
    String? verbosity,
  }) async {
    final body = <String, dynamic>{};
    if (name != null) body['name'] = name;
    if (recallBudget != null) body['recall_budget'] = recallBudget;
    if (thinkingEffort != null) body['thinking_effort'] = thinkingEffort;
    if (verbosity != null) body['verbosity'] = verbosity;

    final response = await _client.patch(
      Uri.parse('$baseUrl/sessions/$sessionId'),
      headers: {'Content-Type': 'application/json'},
      body: json.encode(body),
    );
    if (response.statusCode == 200) {
      return Session.fromJson(json.decode(utf8.decode(response.bodyBytes)));
    }
    throw Exception('Failed to update session: ${response.statusCode}');
  }

  /// Delete session
  Future<bool> deleteSession(String sessionId) async {
    final response = await _client.delete(Uri.parse('$baseUrl/sessions/$sessionId'));
    return response.statusCode == 200;
  }

  /// Truncate session messages from a given message ID onward
  Future<bool> truncateMessagesFrom(String sessionId, String fromMessageId) async {
    try {
      final uri = Uri.parse('$baseUrl/sessions/$sessionId/messages')
          .replace(queryParameters: {'from_message_id': fromMessageId});
      final response = await _client.delete(uri);
      return response.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  /// Get session message history
  Future<List<ChatMessage>> getSessionMessages(String sessionId) async {
    final response = await _client.get(Uri.parse('$baseUrl/sessions/$sessionId'));
    if (response.statusCode == 200) {
      final data = json.decode(utf8.decode(response.bodyBytes));
      final List<dynamic> msgList = data['messages'] ?? [];
      return msgList.map((m) => ChatMessage.fromJson(m as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to load messages for session $sessionId');
  }

  /// Search across all sessions using FTS5
  Future<List<SearchResult>> searchMessages(String query) async {
    if (query.trim().isEmpty) return [];
    final uri = Uri.parse('$baseUrl/search').replace(queryParameters: {'q': query.trim()});
    final response = await _client.get(uri);
    if (response.statusCode == 200) {
      final List<dynamic> list = json.decode(utf8.decode(response.bodyBytes));
      return list.map((item) => SearchResult.fromJson(item as Map<String, dynamic>)).toList();
    }
    throw Exception('Failed to search messages');
  }

  /// SSE Stream Chat Turn
  Future<StreamSubscription<String>> streamChat({
    required String sessionId,
    required String message,
    String? recallBudget,
    String? thinkingEffort,
    String? verbosity,
    bool isTemporary = false,
    required Function() onThinking,
    required Function(String query) onToolStart,
    required Function() onToolDone,
    required Function(String deltaText) onDelta,
    required Function(String fullText, String memoryStatus, Map<String, dynamic> usage) onComplete,
    required Function(String error) onError,
    Function(String title)? onSessionRenamed,
  }) async {
    final request = http.Request('POST', Uri.parse('$baseUrl/chat/stream'));
    request.headers['Content-Type'] = 'application/json';
    request.body = json.encode({
      'session_id': sessionId,
      'message': message,
      if (recallBudget != null) 'recall_budget': recallBudget,
      if (thinkingEffort != null) 'thinking_effort': thinkingEffort,
      if (verbosity != null) 'verbosity': verbosity,
      'is_temporary': isTemporary,
    });

    final streamClient = http.Client();
    String? currentEvent;
    String fullAssistantText = '';

    try {
      final streamedResponse = await streamClient.send(request);
      final subscription = streamedResponse.stream
          .transform(utf8.decoder)
          .transform(const LineSplitter())
          .listen(
      (line) {
        if (line.isEmpty) return;

        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
          final dataStr = line.substring(6).trim();
          try {
            final dataObj = json.decode(dataStr) as Map<String, dynamic>;

            if (currentEvent == 'session_renamed') {
              final name = dataObj['name'] as String?;
              if (name != null && onSessionRenamed != null) {
                onSessionRenamed(name);
              }
            } else if (currentEvent == 'thinking') {
              onThinking();
            } else if (currentEvent == 'tool_start') {
              final query = dataObj['query'] as String? ?? '';
              onToolStart(query);
            } else if (currentEvent == 'tool_done') {
              onToolDone();
            } else if (currentEvent == 'delta') {
              final text = dataObj['text'] as String? ?? '';
              fullAssistantText += text;
              onDelta(text);
            } else if (currentEvent == 'complete') {
              final text = dataObj['text'] as String? ?? fullAssistantText;
              final memoryStatus = dataObj['memory_status'] as String? ?? 'ok';
              final usage = (dataObj['usage'] as Map<String, dynamic>?) ?? {};
              onComplete(text, memoryStatus, usage);
            } else if (currentEvent == 'error') {
              final err = dataObj['error'] as String? ?? 'Unknown error';
              onError(err);
            }
          } catch (e) {
            // Non-JSON or raw text data
            if (currentEvent == 'delta') {
              fullAssistantText += dataStr;
              onDelta(dataStr);
            }
          }
        }
      },
      onError: (err) {
        onError(err.toString());
        streamClient.close();
      },
      onDone: () {
        streamClient.close();
      },
      cancelOnError: true,
    );

    return subscription;
    } catch (e) {
      onError(e.toString());
      streamClient.close();
      rethrow;
    }
  }
}
