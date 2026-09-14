import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/chat_provider.dart';
import 'sidebar_view.dart';
import 'chat_view.dart';
import 'search_dialog.dart';

class MainScreen extends StatefulWidget {
  const MainScreen({super.key});

  @override
  State<MainScreen> createState() => _MainScreenState();
}

class _MainScreenState extends State<MainScreen> {
  @override
  void initState() {
    super.initState();
    HardwareKeyboard.instance.addHandler(_handleKeyEvent);
  }

  @override
  void dispose() {
    HardwareKeyboard.instance.removeHandler(_handleKeyEvent);
    super.dispose();
  }

  bool _handleKeyEvent(KeyEvent event) {
    if (event is! KeyDownEvent) return false;

    final isMetaOrCtrl = HardwareKeyboard.instance.isMetaPressed || HardwareKeyboard.instance.isControlPressed;
    final isShift = HardwareKeyboard.instance.isShiftPressed;

    if (!mounted) return false;
    final provider = context.read<ChatProvider>();

    // 1. Cmd + Shift + O (also Cmd + Shift + N / T) -> New Chat
    if (isMetaOrCtrl && isShift &&
        (event.logicalKey == LogicalKeyboardKey.keyO ||
         event.logicalKey == LogicalKeyboardKey.keyN ||
         event.logicalKey == LogicalKeyboardKey.keyT)) {
      provider.startNewChat();
      return true;
    }

    // 2. Cmd + B -> Toggle Sidebar
    if (isMetaOrCtrl && !isShift && event.logicalKey == LogicalKeyboardKey.keyB) {
      provider.toggleSidebar();
      return true;
    }

    // 3. Cmd + K -> Global Search Modal
    if (isMetaOrCtrl && !isShift && event.logicalKey == LogicalKeyboardKey.keyK) {
      showDialog(
        context: context,
        builder: (_) => const SearchDialog(),
      );
      return true;
    }

    return false;
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<ChatProvider>();

    return Scaffold(
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
    );
  }
}
