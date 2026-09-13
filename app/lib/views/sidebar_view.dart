import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:provider/provider.dart';
import '../providers/chat_provider.dart';
import '../models/session.dart';
import 'search_dialog.dart';

class SidebarView extends StatefulWidget {
  const SidebarView({super.key});

  @override
  State<SidebarView> createState() => _SidebarViewState();
}

class _SidebarViewState extends State<SidebarView> with SingleTickerProviderStateMixin {
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1600),
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.35, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  void _showRenameDialog(BuildContext context, ChatProvider provider, Session session) {
    final controller = TextEditingController(text: session.name);
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: Theme.of(ctx).cardColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('Rename Conversation', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: const TextStyle(fontSize: 14),
          decoration: InputDecoration(
            hintText: 'Enter conversation title...',
            filled: true,
            fillColor: Theme.of(ctx).brightness == Brightness.dark
                ? const Color(0xFF141414)
                : const Color(0xFFF4F4F5),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(10),
              borderSide: BorderSide.none,
            ),
          ),
          onSubmitted: (val) {
            if (val.trim().isNotEmpty) {
              provider.renameSession(session.id, val.trim());
            }
            Navigator.of(ctx).pop();
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel', style: TextStyle(fontWeight: FontWeight.w600)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                provider.renameSession(session.id, controller.text.trim());
              }
              Navigator.of(ctx).pop();
            },
            child: const Text('Save', style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    final bgColor = isDark ? const Color(0xFF0A0A0A) : const Color(0xFFF7F7F8);
    final cardBg = isDark ? const Color(0xFF141414) : const Color(0xFFFFFFFF);
    final activeBg = isDark ? const Color(0xFF1A1A1A) : const Color(0xFFE4E4E7);
    final hoverBg = isDark ? const Color(0xFF141414) : const Color(0xFFECECEE);
    final textMuted = isDark ? const Color(0xFFA1A1AA) : const Color(0xFF71717A);
    final textPrimary = isDark ? const Color(0xFFFFFFFF) : const Color(0xFF09090B);

    return Container(
      width: 280,
      color: bgColor,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. Sidebar Brand Header (Only Velocity)
          Padding(
            padding: const EdgeInsets.only(left: 6, right: 2, top: 4, bottom: 12),
            child: Row(
              children: [
                Text(
                  'Velocity',
                  style: TextStyle(
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                    color: textPrimary,
                    letterSpacing: -0.5,
                  ),
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Close sidebar (⌘B)',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  icon: Icon(LucideIcons.panelLeftClose, size: 18, color: textMuted),
                  onPressed: () => provider.toggleSidebar(),
                ),
              ],
            ),
          ),

          // 2. Action Buttons: New Session & Search
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => provider.createNewSession(isTemporary: false),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(LucideIcons.plus, size: 16, color: textMuted),
                    const SizedBox(width: 10),
                    Text(
                      'New chat',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: textPrimary,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 2),
            child: InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () {
                showDialog(
                  context: context,
                  builder: (_) => const SearchDialog(),
                );
              },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: cardBg,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  children: [
                    Icon(LucideIcons.search, size: 15, color: textMuted),
                    const SizedBox(width: 10),
                    Text(
                      'Search',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: textMuted,
                      ),
                    ),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: isDark ? const Color(0xFF1E1E1E) : const Color(0xFFE4E4E7),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        '⌘K',
                        style: TextStyle(
                          fontFamily: 'monospace',
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          color: textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),

          const SizedBox(height: 14),

          // 3. Conversations Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Conversations',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: textMuted,
                  ),
                ),
                Text(
                  '${provider.sessions.length}',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: textMuted,
                  ),
                ),
              ],
            ),
          ),

          // 4. Conversations List (NO chat icons, 3 dots menu on right)
          Expanded(
            child: provider.isLoadingSessions
                ? const Center(child: CircularProgressIndicator(strokeWidth: 2))
                : provider.sessions.isEmpty
                    ? Center(
                        child: Text(
                          'No previous sessions',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: textMuted),
                        ),
                      )
                    : ListView.builder(
                        itemCount: provider.sessions.length,
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        itemBuilder: (context, index) {
                          final session = provider.sessions[index];
                          final isSelected = provider.currentSession?.id == session.id;

                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 2),
                            child: Material(
                              color: isSelected ? activeBg : Colors.transparent,
                              borderRadius: BorderRadius.circular(10),
                              child: InkWell(
                                borderRadius: BorderRadius.circular(10),
                                hoverColor: isSelected ? activeBg : hoverBg,
                                splashColor: Colors.transparent,
                                highlightColor: Colors.transparent,
                                enableFeedback: false,
                                onTap: () => provider.selectSession(session),
                                child: Padding(
                                  padding: const EdgeInsets.only(left: 12, right: 6, top: 8, bottom: 8),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.center,
                                    children: [
                                      // Chat title
                                      Expanded(
                                        child: Text(
                                          session.name,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: TextStyle(
                                            fontSize: 14,
                                            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w500,
                                            color: isSelected ? textPrimary : (isDark ? const Color(0xFFD4D4D8) : const Color(0xFF3F3F46)),
                                          ),
                                        ),
                                      ),
                                      const SizedBox(width: 4),
                                      // Vertical 3 Dots Options Menu
                                      PopupMenuButton<String>(
                                        tooltip: 'Options',
                                        padding: EdgeInsets.zero,
                                        color: cardBg,
                                        elevation: 8,
                                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                                        onSelected: (val) {
                                          if (val == 'rename') {
                                            _showRenameDialog(context, provider, session);
                                          } else if (val == 'delete') {
                                            provider.deleteSession(session.id);
                                          }
                                        },
                                        itemBuilder: (ctx) => [
                                          PopupMenuItem(
                                            value: 'rename',
                                            height: 36,
                                            child: Row(
                                              children: [
                                                Icon(LucideIcons.pencil, size: 14, color: textPrimary),
                                                const SizedBox(width: 8),
                                                Text(
                                                  'Rename',
                                                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: textPrimary),
                                                ),
                                              ],
                                            ),
                                          ),
                                          const PopupMenuItem(
                                            value: 'delete',
                                            height: 36,
                                            child: Row(
                                              children: [
                                                Icon(LucideIcons.trash2, size: 14, color: Colors.redAccent),
                                                SizedBox(width: 8),
                                                Text(
                                                  'Delete',
                                                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Colors.redAccent),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ],
                                        child: Padding(
                                          padding: const EdgeInsets.all(4),
                                          child: Icon(
                                            LucideIcons.moreVertical,
                                            size: 16,
                                            color: isSelected ? textPrimary : textMuted,
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
          ),

          // 5. Footer: Glowing Hindsight Memory Button + Theme Toggle
          Padding(
            padding: const EdgeInsets.only(left: 4, right: 4, top: 8, bottom: 4),
            child: Row(
              children: [
                // Glowing Hindsight Pulse Dot
                AnimatedBuilder(
                  animation: _pulseAnimation,
                  builder: (context, child) {
                    final color = provider.isHindsightHealthy
                        ? const Color(0xFF10B981)
                        : const Color(0xFFF59E0B);
                    return Container(
                      width: 8,
                      height: 8,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: color.withValues(alpha: _pulseAnimation.value),
                        boxShadow: [
                          BoxShadow(
                            color: color.withValues(alpha: 0.6 * _pulseAnimation.value),
                            blurRadius: 6,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                    );
                  },
                ),
                const SizedBox(width: 8),
                Text(
                  provider.isHindsightHealthy ? 'Hindsight Memory' : 'Hindsight: Degraded',
                  style: TextStyle(
                    fontFamily: 'monospace',
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: textMuted,
                  ),
                ),
                const Spacer(),
                // Theme Toggle
                IconButton(
                  tooltip: isDark ? 'Light theme' : 'Dark theme',
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  icon: Icon(
                    isDark ? LucideIcons.sun : LucideIcons.moon,
                    size: 16,
                    color: textMuted,
                  ),
                  onPressed: () => provider.toggleTheme(),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
