import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import '../providers/chat_provider.dart';
import '../models/chat_message.dart';

class ChatView extends StatefulWidget {
  const ChatView({super.key});

  @override
  State<ChatView> createState() => _ChatViewState();
}

class _ChatViewState extends State<ChatView> {
  final TextEditingController _inputController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _focusNode = FocusNode();

  bool _isOptionsOpen = false;
  int? _editingMessageIndex;
  final TextEditingController _editController = TextEditingController();
  String? _copiedId;
  Timer? _copyTimer;

  bool _isInputMultiLine = false;

  @override
  void initState() {
    super.initState();
    _inputController.addListener(_onInputChanged);
  }

  void _onInputChanged() {
    final isMulti = _inputController.text.contains('\n') || _inputController.text.length > 70;
    if (isMulti != _isInputMultiLine) {
      setState(() {
        _isInputMultiLine = isMulti;
      });
    }
  }

  @override
  void dispose() {
    _inputController.removeListener(_onInputChanged);
    _copyTimer?.cancel();
    _inputController.dispose();
    _scrollController.dispose();
    _focusNode.dispose();
    _editController.dispose();
    super.dispose();
  }

  void _copyToClipboard(String id, String text) {
    Clipboard.setData(ClipboardData(text: text));
    _copyTimer?.cancel();
    setState(() {
      _copiedId = id;
    });
    _copyTimer = Timer(const Duration(seconds: 2), () {
      if (mounted) {
        setState(() {
          _copiedId = null;
        });
      }
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
      }
    });
  }

  void _handleSubmit() {
    final text = _inputController.text;
    if (text.trim().isEmpty) return;
    _inputController.clear();
    setState(() {
      _isOptionsOpen = false;
    });
    context.read<ChatProvider>().sendMessage(text);
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final bgScaffold = isDark ? const Color(0xFF000000) : const Color(0xFFFFFFFF);
    final textMuted = isDark ? const Color(0xFFA1A1AA) : const Color(0xFF71717A);

    if (provider.isGenerating) {
      _scrollToBottom();
    }

    if (!provider.isBackendOnline) {
      return _buildOfflineView(theme);
    }

    return GestureDetector(
      behavior: HitTestBehavior.translucent,
      onTap: () {
        if (_isOptionsOpen) {
          setState(() {
            _isOptionsOpen = false;
          });
        }
      },
      child: Container(
        color: bgScaffold,
        child: Stack(
          children: [
            // 1. Full-height Chat Window / Body
            Positioned.fill(
              child: Column(
                children: [
                  // Main Body: Centered Hello Sathwik when empty, or Messages stream when chatting
                  if (provider.isLoadingMessages)
                    const Expanded(child: Center(child: CircularProgressIndicator(strokeWidth: 2)))
                  else if (provider.messages.isEmpty)
                    Expanded(
                      child: Center(
                        child: SingleChildScrollView(
                          padding: const EdgeInsets.fromLTRB(20, 64, 20, 24),
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 768),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Text(
                                  'Hello, Sathwik',
                                  style: TextStyle(
                                    fontSize: 32,
                                    fontWeight: FontWeight.w700,
                                    color: isDark ? Colors.white : Colors.black,
                                    letterSpacing: -0.6,
                                  ),
                                ),
                                const SizedBox(height: 28),
                                _buildBottomInputSection(context, provider, isDark, textMuted),
                              ],
                            ),
                          ),
                        ),
                      ),
                    )
                  else ...[
                    Expanded(
                      child: Align(
                        alignment: Alignment.topCenter,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 768),
                          child: ScrollConfiguration(
                            behavior: const ScrollBehavior().copyWith(scrollbars: false),
                            child: ListView.builder(
                              controller: _scrollController,
                              padding: const EdgeInsets.fromLTRB(20, 64, 20, 24),
                              itemCount: provider.messages.length,
                              itemBuilder: (ctx, idx) {
                                final msg = provider.messages[idx];
                                return _buildMessageItem(ctx, provider, msg, idx, isDark, textMuted);
                              },
                            ),
                          ),
                        ),
                      ),
                    ),
                    Align(
                      alignment: Alignment.bottomCenter,
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 768),
                        child: _buildBottomInputSection(context, provider, isDark, textMuted),
                      ),
                    ),
                  ],
                ],
              ),
            ),

            // 2. Floating Transparent Header Bar (Flat design, borderless capsules)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _buildHeaderBar(context, provider, isDark, textMuted),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderBar(
    BuildContext context,
    ChatProvider provider,
    bool isDark,
    Color textMuted,
  ) {
    final activeTabBg = isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7);
    final inactiveTabBg = isDark ? const Color(0xFF18181B) : const Color(0xFFF4F4F5);
    final textPrimary = isDark ? Colors.white : Colors.black;

    final openTabs = provider.openTabIds.map((id) {
      return provider.sessions.firstWhere(
        (s) => s.id == id,
        orElse: () => provider.currentSession ?? provider.sessions.first,
      );
    }).toList();

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          height: 60,
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 6),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: isDark
                  ? [
                      const Color(0x40000000), // ~25% opacity
                      const Color(0x26000000), // ~15% opacity
                      const Color(0x0D000000), // ~5% opacity
                      const Color(0x00000000), // 0% opacity
                    ]
                  : [
                      const Color(0x40FFFFFF),
                      const Color(0x26FFFFFF),
                      const Color(0x0DFFFFFF),
                      const Color(0x00FFFFFF),
                    ],
              stops: const [0.0, 0.45, 0.75, 1.0],
            ),
          ),
          child: Row(
            children: [
              // Left: Expand sidebar button if sidebar is collapsed
              if (!provider.isSidebarOpen)
                IconButton(
                  tooltip: 'Open sidebar (⌘B)',
                  icon: Icon(LucideIcons.panelLeft, size: 18, color: textMuted),
                  onPressed: () => provider.toggleSidebar(),
                )
              else
                const SizedBox(width: 36),

              // Center: Browser-style Capsule Tabs (Centered)
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ...openTabs.map((session) {
                          final isActive = provider.currentSession?.id == session.id;
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 3),
                            child: Material(
                              color: isActive ? activeTabBg : inactiveTabBg,
                              borderRadius: BorderRadius.circular(999),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(999),
                                onTap: () => provider.selectTab(session.id),
                                child: Padding(
                                  padding: const EdgeInsets.only(left: 14, right: 9, top: 7, bottom: 7),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      ConstrainedBox(
                                        constraints: const BoxConstraints(maxWidth: 150),
                                        child: Text(
                                          session.name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontSize: 13,
                                            fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                                            color: isActive ? textPrimary : textMuted,
                                          ),
                                        ),
                                      ),
                                      if (openTabs.length > 1) ...[
                                        const SizedBox(width: 6),
                                        InkWell(
                                          borderRadius: BorderRadius.circular(999),
                                          onTap: () => provider.closeTab(session.id),
                                          child: Padding(
                                            padding: const EdgeInsets.all(2),
                                            child: Icon(
                                              LucideIcons.x,
                                              size: 13,
                                              color: textMuted,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        }),
                        // '+' New Tab Button
                        Padding(
                          padding: const EdgeInsets.only(left: 4),
                          child: Material(
                            color: inactiveTabBg,
                            borderRadius: BorderRadius.circular(999),
                            child: InkWell(
                              borderRadius: BorderRadius.circular(999),
                              onTap: () => provider.createNewSession(isTemporary: false),
                              child: Padding(
                                padding: const EdgeInsets.all(7),
                                child: Icon(LucideIcons.plus, size: 14, color: textMuted),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),

              // Right: Status Dot + Claude Ghost Icon
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!provider.isHindsightHealthy)
                    Container(
                      width: 7,
                      height: 7,
                      margin: const EdgeInsets.only(right: 8),
                      decoration: const BoxDecoration(
                        color: Color(0xFFF59E0B),
                        shape: BoxShape.circle,
                      ),
                    ),
                  IconButton(
                    tooltip: provider.isTemporary
                        ? 'Temporary chat active'
                        : 'Temporary chat',
                    padding: const EdgeInsets.all(8),
                    constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                    style: IconButton.styleFrom(
                      backgroundColor: provider.isTemporary ? activeTabBg : Colors.transparent,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                    ),
                    icon: Icon(
                      LucideIcons.ghost,
                      size: 18,
                      color: provider.isTemporary ? textPrimary : textMuted,
                    ),
                    onPressed: () => provider.toggleTemporary(),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }



  Widget _buildMessageItem(
    BuildContext context,
    ChatProvider provider,
    ChatMessage msg,
    int index,
    bool isDark,
    Color textMuted,
  ) {
    final isUser = msg.role == 'user';
    final userChipBg = isDark ? const Color(0xFF141414) : const Color(0xFFF4F4F5);
    final textPrimary = isDark ? Colors.white : Colors.black;

    if (isUser) {
      final isEditingThis = _editingMessageIndex == index;

      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.only(bottom: 18, left: 64),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (isEditingThis)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: userChipBg,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    children: [
                      TextField(
                        controller: _editController,
                        maxLines: 3,
                        autofocus: true,
                        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w500, color: textPrimary),
                        decoration: const InputDecoration(border: InputBorder.none),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: () {
                              setState(() {
                                _editingMessageIndex = null;
                              });
                            },
                            child: Text('Cancel', style: TextStyle(color: textMuted, fontSize: 13, fontWeight: FontWeight.w600)),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: textPrimary,
                              foregroundColor: isDark ? Colors.black : Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            onPressed: () {
                              final text = _editController.text.trim();
                              setState(() {
                                _editingMessageIndex = null;
                              });
                              if (text.isNotEmpty) {
                                provider.editAndResendPrompt(index, text);
                              }
                            },
                            child: const Text('Save & Submit', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700)),
                          ),
                        ],
                      ),
                    ],
                  ),
                )
              else
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
                  decoration: BoxDecoration(
                    color: userChipBg,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Text(
                    msg.content,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w400,
                      color: textPrimary,
                      height: 1.45,
                    ),
                  ),
                ),
              // Action Buttons: Copy Prompt + Edit Pencil
              if (!provider.isGenerating && !isEditingThis)
                Padding(
                  padding: const EdgeInsets.only(top: 4, right: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      InkWell(
                        borderRadius: BorderRadius.circular(6),
                        onTap: () => _copyToClipboard('user_${msg.id}', msg.content),
                        child: Padding(
                          padding: const EdgeInsets.all(5),
                          child: Icon(
                            _copiedId == 'user_${msg.id}' ? LucideIcons.check : LucideIcons.copy,
                            size: 14,
                            color: _copiedId == 'user_${msg.id}' ? const Color(0xFF10B981) : textMuted,
                          ),
                        ),
                      ),
                      const SizedBox(width: 4),
                      InkWell(
                        borderRadius: BorderRadius.circular(6),
                        onTap: () {
                          setState(() {
                            _editingMessageIndex = index;
                            _editController.text = msg.content;
                          });
                        },
                        child: Padding(
                          padding: const EdgeInsets.all(5),
                          child: Icon(LucideIcons.pencil, size: 14, color: textMuted),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    } else {
      // Assistant Message: Full width of the 768px chat column
      final isLastAssistant = index == provider.messages.length - 1;
      final showThinking = msg.isStreaming && msg.content.isEmpty && isLastAssistant;

      return SizedBox(
        width: double.infinity,
        child: Container(
          margin: const EdgeInsets.only(bottom: 24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (showThinking)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: AgenticWorkflowStepper(
                    isStreaming: true,
                    elapsedSeconds: provider.elapsedSeconds,
                    isDark: isDark,
                    textMuted: textMuted,
                  ),
                ),
              if (msg.content.isNotEmpty)
                SizedBox(
                  width: double.infinity,
                  child: MarkdownBody(
                    data: msg.content,
                    selectable: true,
                    fitContent: false,
                    builders: {
                      'code': CustomCodeElementBuilder(isDark: isDark, textMuted: textMuted),
                    },
                    styleSheet: MarkdownStyleSheet(
                      p: TextStyle(fontSize: 16, color: textPrimary, height: 1.6, fontWeight: FontWeight.w400),
                      strong: TextStyle(fontWeight: FontWeight.w800, color: textPrimary),
                      h1: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: textPrimary),
                      h2: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: textPrimary),
                      h3: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: textPrimary),
                      code: TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontFamilyFallback: const ['Roboto Mono', 'Menlo', 'Courier New', 'monospace'],
                        fontSize: 13.5,
                        color: textPrimary,
                        fontWeight: FontWeight.w600,
                      ),
                      codeblockDecoration: const BoxDecoration(
                        color: Colors.transparent,
                      ),
                      blockquote: TextStyle(fontSize: 15, color: textMuted, fontStyle: FontStyle.italic),
                      listBullet: TextStyle(fontSize: 16, color: textPrimary, fontWeight: FontWeight.w400),
                    ),
                  ),
                ),
              // Assistant Bottom Actions: Copy Response + Regenerate
              if (!provider.isGenerating && msg.content.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      InkWell(
                        borderRadius: BorderRadius.circular(6),
                        onTap: () => _copyToClipboard('assistant_${msg.id}', msg.content),
                        child: Padding(
                          padding: const EdgeInsets.all(5),
                          child: Icon(
                            _copiedId == 'assistant_${msg.id}' ? LucideIcons.check : LucideIcons.copy,
                            size: 14,
                            color: _copiedId == 'assistant_${msg.id}' ? const Color(0xFF10B981) : textMuted,
                          ),
                        ),
                      ),
                      const SizedBox(width: 6),
                      InkWell(
                        borderRadius: BorderRadius.circular(6),
                        onTap: () => provider.regenerateLastAssistant(),
                        child: Padding(
                          padding: const EdgeInsets.all(5),
                          child: Icon(LucideIcons.rotateCcw, size: 14, color: textMuted),
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      );
    }
  }

  Widget _buildBottomInputSection(
    BuildContext context,
    ChatProvider provider,
    bool isDark,
    Color textMuted,
  ) {
    final inputCardBg = isDark ? const Color(0xFF141414) : const Color(0xFFF4F4F5);
    final popoverCardBg = isDark ? const Color(0xFF1E1E22) : const Color(0xFFFFFFFF);
    final toggleContainerBg = isDark ? const Color(0xFF141417) : const Color(0xFFF4F4F5);
    final activeBtnBg = isDark ? const Color(0xFF2C2C32) : const Color(0xFFE4E4E7);
    final textPrimary = isDark ? Colors.white : Colors.black;

    return Container(
      padding: const EdgeInsets.only(left: 16, right: 16, bottom: 16, top: 4),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Bottom Popover anchored directly above the '+' button
          if (_isOptionsOpen)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () {},
                child: Container(
                  width: 290,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: popoverCardBg,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: isDark ? const Color(0xFF2E2E34) : const Color(0xFFE4E4E7),
                      width: 1,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: isDark ? 0.6 : 0.15),
                        blurRadius: 24,
                        offset: const Offset(0, 8),
                      ),
                    ],
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Recall Budget Row
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Recall Budget',
                            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: textPrimary),
                          ),
                          Text(
                            provider.recallBudget.toUpperCase(),
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: textPrimary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      // Recall Segmented Bar
                      Container(
                        padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(
                          color: toggleContainerBg,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: ['low', 'medium', 'high'].map((lvl) {
                            final isSelected = provider.recallBudget == lvl;
                            final label = lvl == 'low' ? 'Low' : lvl == 'medium' ? 'Med' : 'High';
                            return Expanded(
                              child: Material(
                                color: isSelected ? activeBtnBg : Colors.transparent,
                                borderRadius: BorderRadius.circular(8),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(8),
                                  onTap: () {
                                    provider.setRecallBudget(lvl);
                                    setState(() {});
                                  },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(vertical: 6),
                                    child: Center(
                                      child: Text(
                                        label,
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                          color: isSelected ? textPrimary : textMuted,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      ),

                      const SizedBox(height: 14),

                      // Reasoning Effort Row
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Reasoning Effort',
                            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: textPrimary),
                          ),
                          Text(
                            provider.thinkingEffort.toUpperCase(),
                            style: TextStyle(
                              fontFamily: 'monospace',
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: textPrimary,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      // Reasoning Segmented Bar
                      Container(
                        padding: const EdgeInsets.all(3),
                        decoration: BoxDecoration(
                          color: toggleContainerBg,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Row(
                          children: ['low', 'medium', 'high'].map((lvl) {
                            final isSelected = provider.thinkingEffort == lvl;
                            final label = lvl == 'low' ? 'Low' : lvl == 'medium' ? 'Med' : 'High';
                            return Expanded(
                              child: Material(
                                color: isSelected ? activeBtnBg : Colors.transparent,
                                borderRadius: BorderRadius.circular(8),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(8),
                                  onTap: () {
                                    provider.setThinkingEffort(lvl);
                                    setState(() {});
                                  },
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(vertical: 6),
                                    child: Center(
                                      child: Text(
                                        label,
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                                          color: isSelected ? textPrimary : textMuted,
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),

          // 2. Compressed Horizontal Input Capsule
          Container(
            decoration: BoxDecoration(
              color: inputCardBg,
              borderRadius: BorderRadius.circular(28),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            child: Row(
              crossAxisAlignment: _isInputMultiLine ? CrossAxisAlignment.end : CrossAxisAlignment.center,
              children: [
                // '+' Options Button (Round)
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: (_isOptionsOpen || provider.recallBudget != 'medium' || provider.thinkingEffort != 'medium')
                        ? (isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7))
                        : (isDark ? const Color(0xFF1C1C1F) : const Color(0xFFEAEAED)),
                  ),
                  child: IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    tooltip: 'Configure Recall & Reasoning',
                    icon: AnimatedRotation(
                      turns: _isOptionsOpen ? 0.125 : 0.0,
                      duration: const Duration(milliseconds: 150),
                      child: Icon(
                        LucideIcons.plus,
                        size: 18,
                        color: textPrimary,
                      ),
                    ),
                    onPressed: () {
                      setState(() {
                        _isOptionsOpen = !_isOptionsOpen;
                      });
                    },
                  ),
                ),

                const SizedBox(width: 8),

                // Text Input
                Expanded(
                  child: Focus(
                    onKeyEvent: (node, event) {
                      if (event is KeyDownEvent &&
                          event.logicalKey == LogicalKeyboardKey.enter &&
                          !HardwareKeyboard.instance.isShiftPressed) {
                        _handleSubmit();
                        return KeyEventResult.handled;
                      }
                      return KeyEventResult.ignored;
                    },
                    child: TextField(
                      controller: _inputController,
                      focusNode: _focusNode,
                      maxLines: 5,
                      minLines: 1,
                      textAlignVertical: TextAlignVertical.center,
                      cursorHeight: 18,
                      style: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: textPrimary),
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: 'Message Velocity...',
                        hintStyle: TextStyle(color: textMuted, fontSize: 15, fontWeight: FontWeight.w500),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
                      ),
                    ),
                  ),
                ),

                const SizedBox(width: 8),

                // Send Button (Round)
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7),
                  ),
                  child: IconButton(
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    icon: provider.isGenerating
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(LucideIcons.arrowUp, size: 18, color: textPrimary),
                    onPressed: provider.isGenerating ? null : _handleSubmit,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildOfflineView(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(LucideIcons.zap, size: 48, color: Colors.redAccent),
          const SizedBox(height: 16),
          const Text(
            'Backend Offline',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          Text(
            'Please ensure the docker stack is running at localhost:8000',
            style: TextStyle(fontSize: 13, color: Colors.grey.shade500),
          ),
          const SizedBox(height: 16),
          FilledButton.icon(
            icon: const Icon(LucideIcons.rotateCcw, size: 16),
            label: const Text('Retry Connection'),
            onPressed: () {
              context.read<ChatProvider>().init();
            },
          ),
        ],
      ),
    );
  }
}

class AgenticWorkflowStepper extends StatefulWidget {
  final bool isStreaming;
  final double elapsedSeconds;
  final double? durationSeconds;
  final bool isDark;
  final Color textMuted;

  const AgenticWorkflowStepper({
    super.key,
    this.isStreaming = false,
    this.elapsedSeconds = 0.0,
    this.durationSeconds,
    required this.isDark,
    required this.textMuted,
  });

  @override
  State<AgenticWorkflowStepper> createState() => _AgenticWorkflowStepperState();
}

class _AgenticWorkflowStepperState extends State<AgenticWorkflowStepper>
    with SingleTickerProviderStateMixin {
  late AnimationController _spinController;

  @override
  void initState() {
    super.initState();
    _spinController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    );
    if (widget.isStreaming) {
      _spinController.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant AgenticWorkflowStepper oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isStreaming != oldWidget.isStreaming) {
      if (widget.isStreaming) {
        _spinController.repeat();
      } else {
        _spinController.stop();
      }
    }
  }

  @override
  void dispose() {
    _spinController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.elapsedSeconds.floor() + 1;
    final text = 'Thinking ${s}s...';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.isStreaming) ...[
            RotationTransition(
              turns: _spinController,
              child: Icon(
                LucideIcons.loader2,
                size: 13,
                color: widget.textMuted,
              ),
            ),
            const SizedBox(width: 7),
          ],
          Text(
            text,
            style: TextStyle(
              fontFamily: 'JetBrains Mono',
              fontFamilyFallback: const ['Roboto Mono', 'Menlo', 'Courier New', 'monospace'],
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: widget.textMuted,
              letterSpacing: -0.2,
            ),
          ),
        ],
      ),
    );
  }
}

class CustomCodeElementBuilder extends MarkdownElementBuilder {
  final bool isDark;
  final Color textMuted;

  CustomCodeElementBuilder({required this.isDark, required this.textMuted});

  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final text = element.textContent;
    final className = element.attributes['class'] ?? '';
    final isBlock = className.startsWith('language-') || text.contains('\n');

    if (isBlock) {
      final language = className.replaceFirst('language-', '');
      return CodeBlockWidget(
        code: text,
        language: language,
        isDark: isDark,
        textMuted: textMuted,
      );
    }

    // Inline code
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
      margin: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF18181B) : const Color(0xFFE4E4E7),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: isDark ? const Color(0xFF27272A) : const Color(0xFFD4D4D8),
          width: 0.8,
        ),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: 'JetBrains Mono',
          fontFamilyFallback: const ['Roboto Mono', 'Menlo', 'Courier New', 'monospace'],
          fontSize: 13,
          fontWeight: FontWeight.w600,
          color: isDark ? const Color(0xFFF4F4F5) : const Color(0xFF18181B),
        ),
      ),
    );
  }
}

class CodeBlockWidget extends StatefulWidget {
  final String code;
  final String language;
  final bool isDark;
  final Color textMuted;

  const CodeBlockWidget({
    super.key,
    required this.code,
    required this.language,
    required this.isDark,
    required this.textMuted,
  });

  @override
  State<CodeBlockWidget> createState() => _CodeBlockWidgetState();
}

class _CodeBlockWidgetState extends State<CodeBlockWidget> {
  bool _copied = false;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _copy() {
    Clipboard.setData(ClipboardData(text: widget.code));
    _timer?.cancel();
    setState(() => _copied = true);
    _timer = Timer(const Duration(seconds: 2), () {
      if (mounted) setState(() => _copied = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final borderCol = widget.isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7);
    final bgCol = widget.isDark ? const Color(0xFF0F0F12) : const Color(0xFFF8F8FA);
    final headerBg = widget.isDark ? const Color(0xFF16161A) : const Color(0xFFF1F1F4);
    final textCol = widget.isDark ? const Color(0xFFEDEDED) : const Color(0xFF18181B);

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: bgCol,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borderCol, width: 1),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: Language + Copy Button
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: headerBg,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(9)),
              border: Border(bottom: BorderSide(color: borderCol, width: 1)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  widget.language.isNotEmpty ? widget.language : 'code',
                  style: TextStyle(
                    fontFamily: 'JetBrains Mono',
                    fontFamilyFallback: const ['Roboto Mono', 'Menlo', 'Courier New', 'monospace'],
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                    color: widget.textMuted,
                    letterSpacing: 0.5,
                  ),
                ),
                InkWell(
                  borderRadius: BorderRadius.circular(6),
                  onTap: _copy,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          _copied ? LucideIcons.check : LucideIcons.copy,
                          size: 13,
                          color: _copied ? const Color(0xFF10B981) : widget.textMuted,
                        ),
                        const SizedBox(width: 5),
                        Text(
                          _copied ? 'Copied' : 'Copy',
                          style: TextStyle(
                            fontFamily: 'JetBrains Mono',
                            fontFamilyFallback: const ['Roboto Mono', 'Menlo', 'Courier New', 'monospace'],
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: _copied ? const Color(0xFF10B981) : widget.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          // Code Area
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(14),
            child: Text(
              widget.code.trimRight(),
              style: TextStyle(
                fontFamily: 'JetBrains Mono',
                fontFamilyFallback: const ['Roboto Mono', 'Menlo', 'Courier New', 'monospace'],
                fontSize: 13.5,
                height: 1.5,
                color: textCol,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
