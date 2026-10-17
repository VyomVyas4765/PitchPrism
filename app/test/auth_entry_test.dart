import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:pitchprism_app/main.dart';

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets('unconfigured Firebase opens real facilitator password login', (
    tester,
  ) async {
    await tester.pumpWidget(const PitchPrismApp());
    await tester.pumpAndSettle();
    expect(find.text('Facilitator sign in'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Email address'), findsOneWidget);
    expect(find.widgetWithText(TextField, 'Password'), findsOneWidget);
    expect(find.text('Send code'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('phone entry explains deferred setup without offering fake OTP', (
    tester,
  ) async {
    await tester.pumpWidget(const PitchPrismApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Entrepreneur phone sign in'));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'Phone sign-in is not available yet. Field facilitators can sign in with their email and password.',
      ),
      findsOneWidget,
    );
    expect(find.text('Send code'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
