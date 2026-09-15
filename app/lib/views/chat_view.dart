import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:markdown/markdown.dart' as md;
import 'package:flutter_highlight/flutter_highlight.dart';
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
  String? _activeOptionMenu; // null, 'effort', 'recall', 'verbosity'
  int? _editingMessageIndex;
  final TextEditingController _editController = TextEditingController();
  String? _copiedId;
  Timer? _copyTimer;

  bool _isInputMultiLine = false;

  String? _lastSessionId;
  bool _wasLoadingMessages = false;
  int _lastMessageCount = 0;

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
        Future.delayed(const Duration(milliseconds: 60), () {
          if (mounted && _scrollController.hasClients) {
            _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
          }
        });
      }
    });
  }

  void _handleSubmit() {
    final text = _inputController.text;
    if (text.trim().isEmpty) return;
    _inputController.clear();
    setState(() {
      _isOptionsOpen = false;
      _activeOptionMenu = null;
    });
    context.read<ChatProvider>().sendMessage(text);
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();
    final currentSessionId = provider.currentSession?.id;

    if (currentSessionId != _lastSessionId) {
      _lastSessionId = currentSessionId;
      _lastMessageCount = provider.messages.length;
      _scrollToBottom();
    } else if (_wasLoadingMessages && !provider.isLoadingMessages) {
      _lastMessageCount = provider.messages.length;
      _scrollToBottom();
    } else if (provider.messages.length != _lastMessageCount) {
      _lastMessageCount = provider.messages.length;
      _scrollToBottom();
    }
    _wasLoadingMessages = provider.isLoadingMessages;

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
            _activeOptionMenu = null;
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
    final textPrimary = isDark ? Colors.white : Colors.black;
    final activeBtnBg = isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7);

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          height: 52,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: isDark
                  ? [
                      const Color(0x40000000),
                      const Color(0x26000000),
                      const Color(0x0D000000),
                      const Color(0x00000000),
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

              // Center: Plain text chat title (no capsule, minimal top bar)
              Expanded(
                child: Center(
                  child: provider.isTemporary
                      ? Text(
                          'Temporary Chat',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w600,
                            color: isDark ? const Color(0xFFE4E4E7) : const Color(0xFF27272A),
                            letterSpacing: -0.2,
                          ),
                        )
                      : provider.currentSession != null
                          ? ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 420),
                              child: Text(
                                provider.currentSession!.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w600,
                                  color: isDark ? const Color(0xFFE4E4E7) : const Color(0xFF27272A),
                                  letterSpacing: -0.2,
                                ),
                              ),
                            )
                          : const SizedBox.shrink(),
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
                      backgroundColor: provider.isTemporary ? activeBtnBg : Colors.transparent,
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
      return _UserMessageWidget(
        msg: msg,
        index: index,
        isDark: isDark,
        textMuted: textMuted,
        userChipBg: userChipBg,
        textPrimary: textPrimary,
        isGenerating: provider.isGenerating,
        isEditing: _editingMessageIndex == index,
        editController: _editController,
        onCancelEdit: () {
          setState(() {
            _editingMessageIndex = null;
          });
        },
        onSaveEdit: (text) {
          setState(() {
            _editingMessageIndex = null;
          });
          provider.editAndResendPrompt(index, text);
        },
        onStartEdit: () {
          setState(() {
            _editingMessageIndex = index;
            _editController.text = msg.content;
          });
        },
        onCopy: () => _copyToClipboard('user_${msg.id}', msg.content),
        isCopied: _copiedId == 'user_${msg.id}',
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
                    data: _tightenMarkdownLists(msg.content),
                    selectable: true,
                    fitContent: false,
                    builders: {
                      'code': CustomCodeElementBuilder(isDark: isDark, textMuted: textMuted),
                    },
                    styleSheet: MarkdownStyleSheet(
                      p: TextStyle(fontSize: 16, color: textPrimary, height: 1.6, fontWeight: FontWeight.w500),
                      pPadding: const EdgeInsets.only(bottom: 8.0),
                      strong: TextStyle(fontWeight: FontWeight.w800, color: textPrimary),
                      h1: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: textPrimary),
                      h1Padding: const EdgeInsets.only(top: 16.0, bottom: 4.0),
                      h2: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: textPrimary),
                      h2Padding: const EdgeInsets.only(top: 12.0, bottom: 4.0),
                      h3: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: textPrimary),
                      h3Padding: const EdgeInsets.only(top: 10.0, bottom: 2.0),
                      code: TextStyle(
                        fontFamily: 'JetBrains Mono',
                        fontSize: 13,
                        color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1D4ED8),
                        fontWeight: FontWeight.w500,
                      ),
                      codeblockDecoration: const BoxDecoration(
                        color: Colors.transparent,
                      ),
                      blockquote: TextStyle(
                        fontSize: 15,
                        color: isDark ? const Color(0xFFD4D4D8) : const Color(0xFF3F3F46),
                        height: 1.6,
                        fontStyle: FontStyle.italic,
                        fontWeight: FontWeight.w500,
                      ),
                      blockquoteDecoration: BoxDecoration(
                        border: Border(
                          left: BorderSide(
                            color: isDark ? const Color(0xFF3F3F46) : const Color(0xFFD4D4D8),
                            width: 3.0,
                          ),
                        ),
                      ),
                      blockquotePadding: const EdgeInsets.only(left: 16, top: 4, bottom: 4, right: 8),
                      listBullet: TextStyle(fontSize: 16, color: textPrimary, height: 1.25, fontWeight: FontWeight.w500),
                      listBulletPadding: const EdgeInsets.only(right: 6, top: 0.5),
                      listIndent: 20.0,
                      blockSpacing: 3.0,
                    )..styles['li'] = TextStyle(
                        fontSize: 16,
                        color: textPrimary,
                        height: 1.25,
                        fontWeight: FontWeight.w500,
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
                            color: _copiedId == 'assistant_${msg.id}'
                                ? (isDark ? const Color(0xFFA1A1AA) : const Color(0xFF71717A))
                                : textMuted,
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
              child: TapRegion(
                groupId: 'options_menu_group',
                onTapOutside: (event) {
                  if (_isOptionsOpen) {
                    setState(() {
                      _isOptionsOpen = false;
                      _activeOptionMenu = null;
                    });
                  }
                },
                child: Container(
                  width: 290,
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
                  child: AnimatedSize(
                    duration: const Duration(milliseconds: 160),
                    curve: Curves.easeOutCubic,
                    alignment: Alignment.topCenter,
                    child: _activeOptionMenu == null
                        ? _buildOptionsMainMenu(context, provider, isDark, textPrimary, textMuted)
                        : _buildOptionsSubMenu(context, provider, isDark, textPrimary, textMuted, toggleContainerBg, activeBtnBg),
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
                TapRegion(
                  groupId: 'options_menu_group',
                  child: Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: (_isOptionsOpen ||
                              provider.recallBudget != 'medium' ||
                              provider.thinkingEffort != 'medium' ||
                              provider.verbosity != 'low')
                          ? (isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7))
                          : (isDark ? const Color(0xFF1C1C1F) : const Color(0xFFEAEAED)),
                    ),
                    child: IconButton(
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                      tooltip: 'Configure Effort, Recall & Verbosity',
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
                          if (!_isOptionsOpen) {
                            _activeOptionMenu = null;
                          }
                        });
                      },
                    ),
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

  Widget _buildOptionsMainMenu(
    BuildContext context,
    ChatProvider provider,
    bool isDark,
    Color textPrimary,
    Color textMuted,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildMenuRow(
            title: 'effort',
            value: provider.thinkingEffort,
            onTap: () {
              setState(() {
                _activeOptionMenu = 'effort';
              });
            },
            isDark: isDark,
            textPrimary: textPrimary,
            textMuted: textMuted,
          ),
          Divider(
            height: 1,
            thickness: 1,
            color: isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7),
            indent: 12,
            endIndent: 12,
          ),
          _buildMenuRow(
            title: 'recall',
            value: provider.recallBudget,
            onTap: () {
              setState(() {
                _activeOptionMenu = 'recall';
              });
            },
            isDark: isDark,
            textPrimary: textPrimary,
            textMuted: textMuted,
          ),
          Divider(
            height: 1,
            thickness: 1,
            color: isDark ? const Color(0xFF27272A) : const Color(0xFFE4E4E7),
            indent: 12,
            endIndent: 12,
          ),
          _buildMenuRow(
            title: 'verbosity',
            value: provider.verbosity,
            onTap: () {
              setState(() {
                _activeOptionMenu = 'verbosity';
              });
            },
            isDark: isDark,
            textPrimary: textPrimary,
            textMuted: textMuted,
          ),
        ],
      ),
    );
  }

  Widget _buildMenuRow({
    required String title,
    required String value,
    required VoidCallback onTap,
    required bool isDark,
    required Color textPrimary,
    required Color textMuted,
  }) {
    return Material(
      color: Colors.transparent,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            children: [
              Text(
                title,
                style: TextStyle(
                  fontSize: 13.5,
                  fontWeight: FontWeight.w500,
                  color: textPrimary,
                  fontFamily: 'Satoshi',
                ),
              ),
              const Spacer(),
              Text(
                value,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w500,
                  color: textMuted,
                  fontFamily: 'Satoshi',
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSegmentedBtn({
    required String lvl,
    required String label,
    required String currentValue,
    required ValueChanged<String> onChanged,
    required Color activeBtnBg,
    required Color textPrimary,
    required Color textMuted,
  }) {
    final isSelected = currentValue == lvl;
    return Expanded(
      child: Material(
        color: isSelected ? activeBtnBg : Colors.transparent,
        borderRadius: BorderRadius.circular(8),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () {
            onChanged(lvl);
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
                  fontFamily: 'Satoshi',
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildOptionsSubMenu(
    BuildContext context,
    ChatProvider provider,
    bool isDark,
    Color textPrimary,
    Color textMuted,
    Color toggleContainerBg,
    Color activeBtnBg,
  ) {
    String title;
    String currentValue;
    ValueChanged<String> onChanged;
    String description;

    if (_activeOptionMenu == 'effort') {
      title = 'effort';
      currentValue = provider.thinkingEffort;
      onChanged = (lvl) => provider.setThinkingEffort(lvl);
      if (currentValue == 'none') {
        description = 'No reasoning effort. Fastest, lowest latency responses.';
      } else if (currentValue == 'low') {
        description = 'Minimal reasoning for faster, direct responses.';
      } else if (currentValue == 'high') {
        description = 'Deep reasoning effort for complex logic and coding.';
      } else if (currentValue == 'xhigh') {
        description = 'Extra high reasoning for complex architecture and analysis.';
      } else if (currentValue == 'max') {
        description = 'Maximum reasoning depth for the hardest reasoning problems.';
      } else {
        description = 'Balanced reasoning for general tasks (default).';
      }
    } else if (_activeOptionMenu == 'recall') {
      title = 'recall';
      currentValue = provider.recallBudget;
      onChanged = (lvl) => provider.setRecallBudget(lvl);
      description = currentValue == 'low'
          ? 'Focuses on immediate context with fast recall.'
          : currentValue == 'high'
              ? 'Deep memory recall across all past conversations.'
              : 'Standard memory recall from Hindsight (default).';
    } else {
      title = 'verbosity';
      currentValue = provider.verbosity;
      onChanged = (lvl) => provider.setVerbosity(lvl);
      description = currentValue == 'high'
          ? 'Thorough, exhaustive explanations and complete code.'
          : currentValue == 'medium'
              ? 'Balanced detail and standard explanations.'
              : 'Concise, direct, and punchy responses (default).';
    }

    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header with Back Button (no icons)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(8),
                child: InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () {
                    setState(() {
                      _activeOptionMenu = null;
                    });
                  },
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                    child: Text(
                      'Back',
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w500,
                        color: textMuted,
                        fontFamily: 'Satoshi',
                      ),
                    ),
                  ),
                ),
              ),
              Text(
                title,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: textPrimary,
                  fontFamily: 'Satoshi',
                ),
              ),
              Text(
                currentValue.toUpperCase(),
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: textPrimary,
                ),
              ),
            ],
          ),

          const SizedBox(height: 10),

          // Options Segmented Bar
          if (_activeOptionMenu == 'effort') ...[
            Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: toggleContainerBg,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Column(
                children: [
                  Row(
                    children: [
                      _buildSegmentedBtn(
                        lvl: 'none',
                        label: 'None',
                        currentValue: currentValue,
                        onChanged: onChanged,
                        activeBtnBg: activeBtnBg,
                        textPrimary: textPrimary,
                        textMuted: textMuted,
                      ),
                      _buildSegmentedBtn(
                        lvl: 'low',
                        label: 'Low',
                        currentValue: currentValue,
                        onChanged: onChanged,
                        activeBtnBg: activeBtnBg,
                        textPrimary: textPrimary,
                        textMuted: textMuted,
                      ),
                      _buildSegmentedBtn(
                        lvl: 'medium',
                        label: 'Med',
                        currentValue: currentValue,
                        onChanged: onChanged,
                        activeBtnBg: activeBtnBg,
                        textPrimary: textPrimary,
                        textMuted: textMuted,
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      _buildSegmentedBtn(
                        lvl: 'high',
                        label: 'High',
                        currentValue: currentValue,
                        onChanged: onChanged,
                        activeBtnBg: activeBtnBg,
                        textPrimary: textPrimary,
                        textMuted: textMuted,
                      ),
                      _buildSegmentedBtn(
                        lvl: 'xhigh',
                        label: 'XHigh',
                        currentValue: currentValue,
                        onChanged: onChanged,
                        activeBtnBg: activeBtnBg,
                        textPrimary: textPrimary,
                        textMuted: textMuted,
                      ),
                      _buildSegmentedBtn(
                        lvl: 'max',
                        label: 'Max',
                        currentValue: currentValue,
                        onChanged: onChanged,
                        activeBtnBg: activeBtnBg,
                        textPrimary: textPrimary,
                        textMuted: textMuted,
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ] else ...[
            Container(
              padding: const EdgeInsets.all(3),
              decoration: BoxDecoration(
                color: toggleContainerBg,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  _buildSegmentedBtn(
                    lvl: 'low',
                    label: 'Low',
                    currentValue: currentValue,
                    onChanged: onChanged,
                    activeBtnBg: activeBtnBg,
                    textPrimary: textPrimary,
                    textMuted: textMuted,
                  ),
                  _buildSegmentedBtn(
                    lvl: 'medium',
                    label: 'Med',
                    currentValue: currentValue,
                    onChanged: onChanged,
                    activeBtnBg: activeBtnBg,
                    textPrimary: textPrimary,
                    textMuted: textMuted,
                  ),
                  _buildSegmentedBtn(
                    lvl: 'high',
                    label: 'High',
                    currentValue: currentValue,
                    onChanged: onChanged,
                    activeBtnBg: activeBtnBg,
                    textPrimary: textPrimary,
                    textMuted: textMuted,
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 8),

          // Subtle explanatory description
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Text(
              description,
              style: TextStyle(
                fontSize: 11.5,
                color: textMuted,
                fontFamily: 'Satoshi',
                height: 1.3,
              ),
            ),
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

// Muted, tasteful syntax themes (GitHub Dark & Light Dimmed)
const Map<String, TextStyle> _codeDarkTheme = {
  'root': TextStyle(color: Color(0xFFE6EDF3), backgroundColor: Colors.transparent),
  'keyword': TextStyle(color: Color(0xFFFF7B72), fontWeight: FontWeight.w600),
  'built_in': TextStyle(color: Color(0xFF79C0FF)),
  'type': TextStyle(color: Color(0xFFFFA657), fontWeight: FontWeight.w600),
  'literal': TextStyle(color: Color(0xFF79C0FF)),
  'number': TextStyle(color: Color(0xFF79C0FF)),
  'operator': TextStyle(color: Color(0xFFFF7B72)),
  'punctuation': TextStyle(color: Color(0xFF8B949E)),
  'string': TextStyle(color: Color(0xFFA5D6FF)),
  'regexp': TextStyle(color: Color(0xFF7EE787)),
  'subst': TextStyle(color: Color(0xFFC9D1D9)),
  'symbol': TextStyle(color: Color(0xFF79C0FF)),
  'class': TextStyle(color: Color(0xFFFFA657), fontWeight: FontWeight.w600),
  'function': TextStyle(color: Color(0xFFD2A8FF)),
  'title': TextStyle(color: Color(0xFFD2A8FF), fontWeight: FontWeight.w600),
  'title.function': TextStyle(color: Color(0xFFD2A8FF)),
  'params': TextStyle(color: Color(0xFFC9D1D9)),
  'comment': TextStyle(color: Color(0xFF6E7681), fontStyle: FontStyle.italic),
  'doctag': TextStyle(color: Color(0xFFFF7B72)),
  'meta': TextStyle(color: Color(0xFF79C0FF)),
  'attr': TextStyle(color: Color(0xFF79C0FF)),
  'attribute': TextStyle(color: Color(0xFF79C0FF)),
  'variable': TextStyle(color: Color(0xFFFFA657)),
  'tag': TextStyle(color: Color(0xFF7EE787)),
  'name': TextStyle(color: Color(0xFF7EE787)),
  'selector-tag': TextStyle(color: Color(0xFF7EE787)),
  'selector-id': TextStyle(color: Color(0xFFD2A8FF)),
  'selector-class': TextStyle(color: Color(0xFFD2A8FF)),
};

const Map<String, TextStyle> _codeLightTheme = {
  'root': TextStyle(color: Color(0xFF24292F), backgroundColor: Colors.transparent),
  'keyword': TextStyle(color: Color(0xFFCF222E), fontWeight: FontWeight.w600),
  'built_in': TextStyle(color: Color(0xFF0550AE)),
  'type': TextStyle(color: Color(0xFF953800), fontWeight: FontWeight.w600),
  'literal': TextStyle(color: Color(0xFF0550AE)),
  'number': TextStyle(color: Color(0xFF0550AE)),
  'operator': TextStyle(color: Color(0xFFCF222E)),
  'punctuation': TextStyle(color: Color(0xFF57606A)),
  'string': TextStyle(color: Color(0xFF0A3069)),
  'regexp': TextStyle(color: Color(0xFF116329)),
  'subst': TextStyle(color: Color(0xFF24292F)),
  'symbol': TextStyle(color: Color(0xFF0550AE)),
  'class': TextStyle(color: Color(0xFF953800), fontWeight: FontWeight.w600),
  'function': TextStyle(color: Color(0xFF8250DF)),
  'title': TextStyle(color: Color(0xFF8250DF), fontWeight: FontWeight.w600),
  'title.function': TextStyle(color: Color(0xFF8250DF)),
  'params': TextStyle(color: Color(0xFF24292F)),
  'comment': TextStyle(color: Color(0xFF6E7781), fontStyle: FontStyle.italic),
  'doctag': TextStyle(color: Color(0xFFCF222E)),
  'meta': TextStyle(color: Color(0xFF0550AE)),
  'attr': TextStyle(color: Color(0xFF0550AE)),
  'attribute': TextStyle(color: Color(0xFF0550AE)),
  'variable': TextStyle(color: Color(0xFF953800)),
  'tag': TextStyle(color: Color(0xFF116329)),
  'name': TextStyle(color: Color(0xFF116329)),
  'selector-tag': TextStyle(color: Color(0xFF116329)),
  'selector-id': TextStyle(color: Color(0xFF8250DF)),
  'selector-class': TextStyle(color: Color(0xFF8250DF)),
};

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

    // Inline code: differentiated soft tint, unified JetBrains Mono font
    final inlineColor = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1D4ED8);
    final inlineBg = isDark ? const Color(0xFF18181B) : const Color(0xFFF1F5F9);
    final inlineBorder = isDark ? const Color(0xFF27272A) : const Color(0xFFE2E8F0);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      margin: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(
        color: inlineBg,
        borderRadius: BorderRadius.circular(5),
        border: Border.all(color: inlineBorder, width: 0.8),
      ),
      child: Text(
        text,
        style: TextStyle(
          fontFamily: 'JetBrains Mono',
          fontSize: 13,
          fontWeight: FontWeight.w500,
          color: inlineColor,
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
    final borderCol = widget.isDark ? const Color(0xFF222226) : const Color(0xFFE4E4E7);
    final bgCol = widget.isDark ? const Color(0xFF0D0D10) : const Color(0xFFF8F8FA);
    final copyBtnBg = widget.isDark ? const Color(0x4027272A) : const Color(0x66E4E4E7);

    String lang = widget.language.trim().toLowerCase();
    if (lang.isEmpty) lang = 'plaintext';
    if (lang == 'js') lang = 'javascript';
    if (lang == 'ts') lang = 'typescript';
    if (lang == 'py') lang = 'python';
    if (lang == 'sh' || lang == 'shell' || lang == 'zsh') lang = 'bash';
    if (lang == 'yml') lang = 'yaml';

    final theme = widget.isDark ? _codeDarkTheme : _codeLightTheme;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: bgCol,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: borderCol, width: 1),
      ),
      child: Stack(
        children: [
          // Syntax-highlighted code area with horizontal scroll
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 46, 14),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: HighlightView(
                widget.code.trimRight(),
                language: lang,
                theme: theme,
                padding: EdgeInsets.zero,
                textStyle: const TextStyle(
                  fontFamily: 'JetBrains Mono',
                  fontSize: 13.5,
                  height: 1.5,
                  fontWeight: FontWeight.w400,
                ),
              ),
            ),
          ),

          // Top-right Icon-only copy button (ChatGPT style, no text, no language name)
          Positioned(
            top: 8,
            right: 8,
            child: Tooltip(
              message: _copied ? 'Copied' : 'Copy code',
              child: Material(
                color: copyBtnBg,
                borderRadius: BorderRadius.circular(6),
                child: InkWell(
                  borderRadius: BorderRadius.circular(6),
                  onTap: _copy,
                  child: Padding(
                    padding: const EdgeInsets.all(6),
                    child: Icon(
                      _copied ? LucideIcons.check : LucideIcons.copy,
                      size: 14,
                      color: _copied
                          ? (widget.isDark ? const Color(0xFFA1A1AA) : const Color(0xFF71717A))
                          : widget.textMuted,
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Collapses empty lines between consecutive list items so that Markdown lists
/// are parsed tightly instead of loose with separate paragraphs per bullet point.
String _tightenMarkdownLists(String input) {
  if (!input.contains('- ') &&
      !input.contains('* ') &&
      !input.contains('+ ') &&
      !RegExp(r'\d+\.').hasMatch(input)) {
    return input;
  }
  final lines = input.split('\n');
  final result = <String>[];
  bool inList = false;
  bool inCodeBlock = false;

  final listPattern = RegExp(r'^(\s*)([-*+]|\d+\.)\s+');

  for (int i = 0; i < lines.length; i++) {
    final line = lines[i];

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      inList = false;
      result.add(line);
      continue;
    }

    if (inCodeBlock) {
      result.add(line);
      continue;
    }

    final isListItem = listPattern.hasMatch(line);

    if (isListItem) {
      inList = true;
      result.add(line);
    } else if (line.trim().isEmpty) {
      if (inList) {
        int nextNonEmpty = -1;
        for (int j = i + 1; j < lines.length; j++) {
          if (lines[j].trim().isNotEmpty) {
            nextNonEmpty = j;
            break;
          }
        }
        if (nextNonEmpty != -1 && listPattern.hasMatch(lines[nextNonEmpty])) {
          // Skip blank line between list items
          continue;
        } else {
          inList = false;
          result.add(line);
        }
      } else {
        result.add(line);
      }
    } else {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        result.add(line);
      } else {
        inList = false;
        result.add(line);
      }
    }
  }

  return result.join('\n');
}

class _UserMessageWidget extends StatefulWidget {
  final ChatMessage msg;
  final int index;
  final bool isDark;
  final Color textMuted;
  final Color userChipBg;
  final Color textPrimary;
  final bool isGenerating;
  final bool isEditing;
  final TextEditingController editController;
  final VoidCallback onCancelEdit;
  final ValueChanged<String> onSaveEdit;
  final VoidCallback onStartEdit;
  final VoidCallback onCopy;
  final bool isCopied;

  const _UserMessageWidget({
    required this.msg,
    required this.index,
    required this.isDark,
    required this.textMuted,
    required this.userChipBg,
    required this.textPrimary,
    required this.isGenerating,
    required this.isEditing,
    required this.editController,
    required this.onCancelEdit,
    required this.onSaveEdit,
    required this.onStartEdit,
    required this.onCopy,
    required this.isCopied,
  });

  @override
  State<_UserMessageWidget> createState() => _UserMessageWidgetState();
}

class _UserMessageWidgetState extends State<_UserMessageWidget> {
  bool _isHovered = false;

  @override
  Widget build(BuildContext context) {
    final grayCheckColor = widget.isDark ? const Color(0xFFA1A1AA) : const Color(0xFF71717A);

    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.only(bottom: 18, left: 64),
        child: MouseRegion(
          onEnter: (_) => setState(() => _isHovered = true),
          onExit: (_) => setState(() => _isHovered = false),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (widget.isEditing)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: widget.userChipBg,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    children: [
                      TextField(
                        controller: widget.editController,
                        maxLines: 3,
                        autofocus: true,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w500,
                          color: widget.textPrimary,
                        ),
                        decoration: const InputDecoration(border: InputBorder.none),
                      ),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          TextButton(
                            onPressed: widget.onCancelEdit,
                            child: Text(
                              'Cancel',
                              style: TextStyle(
                                color: widget.textMuted,
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton(
                            style: FilledButton.styleFrom(
                              backgroundColor: widget.textPrimary,
                              foregroundColor: widget.isDark ? Colors.black : Colors.white,
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            onPressed: () {
                              final text = widget.editController.text.trim();
                              if (text.isNotEmpty) {
                                widget.onSaveEdit(text);
                              }
                            },
                            child: const Text(
                              'Save & Submit',
                              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
                            ),
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
                    color: widget.userChipBg,
                    borderRadius: BorderRadius.circular(18),
                  ),
                  child: Text(
                    widget.msg.content,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w500,
                      color: widget.textPrimary,
                      height: 1.45,
                    ),
                  ),
                ),
              // Action Buttons: Copy Prompt + Edit Pencil (ONLY visible on hover)
              if (!widget.isGenerating && !widget.isEditing)
                AnimatedOpacity(
                  opacity: _isHovered ? 1.0 : 0.0,
                  duration: const Duration(milliseconds: 150),
                  child: Padding(
                    padding: const EdgeInsets.only(top: 4, right: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        InkWell(
                          borderRadius: BorderRadius.circular(6),
                          onTap: _isHovered ? widget.onCopy : null,
                          child: Padding(
                            padding: const EdgeInsets.all(5),
                            child: Icon(
                              widget.isCopied ? LucideIcons.check : LucideIcons.copy,
                              size: 14,
                              color: widget.isCopied ? grayCheckColor : widget.textMuted,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        InkWell(
                          borderRadius: BorderRadius.circular(6),
                          onTap: _isHovered ? widget.onStartEdit : null,
                          child: Padding(
                            padding: const EdgeInsets.all(5),
                            child: Icon(LucideIcons.pencil, size: 14, color: widget.textMuted),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

