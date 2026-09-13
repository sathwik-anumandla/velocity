class SearchResult {
  final String messageId;
  final String sessionId;
  final String sessionName;
  final String role;
  final String content;
  final String snippet;
  final DateTime createdAt;

  SearchResult({
    required this.messageId,
    required this.sessionId,
    required this.sessionName,
    required this.role,
    required this.content,
    required this.snippet,
    required this.createdAt,
  });

  factory SearchResult.fromJson(Map<String, dynamic> json) {
    return SearchResult(
      messageId: json['message_id'] as String,
      sessionId: json['session_id'] as String,
      sessionName: json['session_name'] as String? ?? 'Untitled',
      role: json['role'] as String,
      content: json['content'] as String,
      snippet: json['snippet'] as String? ?? '',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String) ?? DateTime.now()
          : DateTime.now(),
    );
  }
}
