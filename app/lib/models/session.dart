class Session {
  final String id;
  String name;
  String recallBudget;
  String thinkingEffort;
  String verbosity;
  final DateTime createdAt;
  DateTime updatedAt;
  final bool isTemporary;

  Session({
    required this.id,
    required this.name,
    this.recallBudget = 'medium',
    this.thinkingEffort = 'medium',
    this.verbosity = 'low',
    required this.createdAt,
    required this.updatedAt,
    this.isTemporary = false,
  });

  factory Session.fromJson(Map<String, dynamic> json, {bool isTemporary = false}) {
    return Session(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Untitled Session',
      recallBudget: json['recall_budget'] as String? ?? 'medium',
      thinkingEffort: json['thinking_effort'] as String? ?? 'medium',
      verbosity: json['verbosity'] as String? ?? 'low',
      createdAt: json['created_at'] != null
          ? DateTime.tryParse(json['created_at'] as String) ?? DateTime.now()
          : DateTime.now(),
      updatedAt: json['updated_at'] != null
          ? DateTime.tryParse(json['updated_at'] as String) ?? DateTime.now()
          : DateTime.now(),
      isTemporary: isTemporary,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'recall_budget': recallBudget,
      'thinking_effort': thinkingEffort,
      'verbosity': verbosity,
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }
}
