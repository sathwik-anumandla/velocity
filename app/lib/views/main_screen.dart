import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/chat_provider.dart';
import 'sidebar_view.dart';
import 'chat_view.dart';
import 'search_dialog.dart';

class MainScreen extends StatelessWidget {
  const MainScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();

    return CallbackShortcuts(
      bindings: <ShortcutActivator, VoidCallback>{
        // Cmd+Shift+T or Cmd+Shift+N for New Chat Tab
        const SingleActivator(LogicalKeyboardKey.keyT, meta: true, shift: true): () {
          provider.createNewSession(isTemporary: false);
        },
        const SingleActivator(LogicalKeyboardKey.keyN, meta: true, shift: true): () {
          provider.createNewSession(isTemporary: false);
        },
        // Cmd+B for Sidebar Collapse/Expand
        const SingleActivator(LogicalKeyboardKey.keyB, meta: true): () {
          provider.toggleSidebar();
        },
        // Cmd+K for Global Search Modal
        const SingleActivator(LogicalKeyboardKey.keyK, meta: true): () {
          showDialog(
            context: context,
            builder: (_) => const SearchDialog(),
          );
        },
      },
      child: Focus(
        autofocus: true,
        child: Scaffold(
          body: Row(
            children: [
              AnimatedContainer(
                duration: const Duration(milliseconds: 200),
                curve: Curves.easeInOut,
                width: provider.isSidebarOpen ? 260 : 0,
                child: const ClipRect(
                  child: OverflowBox(
                    minWidth: 260,
                    maxWidth: 260,
                    alignment: Alignment.topLeft,
                    child: SidebarView(),
                  ),
                ),
              ),
              const Expanded(child: ChatView()),
            ],
          ),
        ),
      ),
    );
  }
}
