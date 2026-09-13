import 'package:flutter_test/flutter_test.dart';
import 'package:velocity_app/main.dart';

void main() {
  testWidgets('VelocityApp smoke test', (WidgetTester tester) async {
    await tester.pumpWidget(const VelocityApp());
    expect(find.text('Velocity'), findsOneWidget);
  });
}
