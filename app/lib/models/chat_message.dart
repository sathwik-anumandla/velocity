class ChatMessage {
  final String id;
  final String sessionId;
  final String role; // 'user' | 'assistant'
  String content;
  String memoryStatus; // 'ok' | 'degraded'
  final DateTime createdAt;
  bool isStreaming;
  double? durationSeconds;
  String? recallBudget;
  String? thinkingEffort;
  List<String> toolCalls;

  ChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.content,
    this.memoryStatus = 'ok',
    required this.createdAt,
    this.isStreaming = false,
    this.durationSeconds,
    this.recallBudget,
    this.thinkingEffort,
    this.toolCalls = const [],
  });

  bool get isUser => role == 'user';
  bool get isAssistant => role == 'assistant';

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      id: json['id'] as String,
      sessionId: json['session_id'] as String,
      role: json['role'] as String,
      content: json['content'] as String,
      memoryStatus: json['memory_status'] as String? ?? 'ok',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String) ?? DateTime.now()
          : DateTime.now(),
      isStreaming: false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'session_id': sessionId,
      'role': role,
      'content': content,
      'memory_status': memoryStatus,
      'created_at': createdAt.toIso8601String(),
    };
  }
}
