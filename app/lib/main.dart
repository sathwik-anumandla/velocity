import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'providers/chat_provider.dart';
import 'views/main_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => ChatProvider()),
      ],
      child: const VelocityApp(),
    ),
  );
}

class VelocityApp extends StatelessWidget {
  const VelocityApp({super.key});

  @override
  Widget build(BuildContext context) {
    final themeMode = context.select<ChatProvider, ThemeMode>((p) => p.themeMode);

    return MaterialApp(
      title: 'Velocity',
      debugShowCheckedModeBanner: false,
      themeMode: themeMode,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        fontFamily: 'Satoshi',
        scaffoldBackgroundColor: const Color(0xFFFFFFFF),
        cardColor: const Color(0xFFF4F4F5),
        dividerColor: Colors.transparent,
        scrollbarTheme: const ScrollbarThemeData(
          thumbVisibility: WidgetStatePropertyAll(false),
          trackVisibility: WidgetStatePropertyAll(false),
        ),
        colorScheme: const ColorScheme.light(
          primary: Color(0xFF000000),
          surface: Color(0xFFF4F4F5),
          surfaceContainer: Color(0xFFECECEE),
          outline: Color(0xFFE4E4E7),
          onSurface: Color(0xFF09090B),
        ),
      ),
      darkTheme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        fontFamily: 'Satoshi',
        scaffoldBackgroundColor: const Color(0xFF000000), // Pitch Black
        cardColor: const Color(0xFF0A0A0A),
        dividerColor: Colors.transparent,
        scrollbarTheme: const ScrollbarThemeData(
          thumbVisibility: WidgetStatePropertyAll(false),
          trackVisibility: WidgetStatePropertyAll(false),
        ),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFFFFFFFF),
          surface: Color(0xFF0A0A0A),
          surfaceContainer: Color(0xFF141414),
          outline: Color(0xFF1E1E1E),
          onSurface: Color(0xFFFAFAFA),
        ),
      ),
      home: const MainScreen(),
    );
  }
}
