import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/speech.dart';
import '../entrepreneur/common.dart';
import '../entrepreneur/entrepreneur_shell.dart';
import '../facilitator/facilitator_home.dart';
import '../intake/device.dart';
import '../intake/services.dart';

class DemoScreen extends StatelessWidget {
  const DemoScreen({
    super.key,
    required this.language,
    required this.speech,
    required this.onChangeLanguage,
  });

  final String language;
  final Speech speech;
  final VoidCallback onChangeLanguage;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('PitchPrism demo'),
      actions: [
        IconButton(
          tooltip: 'Change language',
          onPressed: onChangeLanguage,
          icon: const Icon(Icons.translate),
        ),
      ],
    ),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Choose a demo workspace',
            style: Theme.of(context).textTheme.headlineMedium,
          ),
          const SizedBox(height: 8),
          Text(
            'This debug-only preview opens the mobile UI without creating an account or contacting the API.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 32),
          FilledButton.icon(
            key: const Key('demo-entrepreneur'),
            style: FilledButton.styleFrom(
              minimumSize: const Size.fromHeight(64),
            ),
            onPressed: () => _open(context, DemoRole.entrepreneur),
            icon: const Icon(Icons.lightbulb_outline),
            label: const Text('Demo entrepreneur'),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(
            key: const Key('demo-facilitator'),
            style: OutlinedButton.styleFrom(
              minimumSize: const Size.fromHeight(64),
            ),
            onPressed: () => _open(context, DemoRole.facilitator),
            icon: const Icon(Icons.groups_outlined),
            label: const Text('Demo facilitator'),
          ),
          const SizedBox(height: 24),
          Text(
            'Demo mode is available only in debug builds with DEMO_MODE=true.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    ),
  );

  void _open(BuildContext context, DemoRole role) {
    final api = DemoApiClient(role);
    final screen = switch (role) {
      DemoRole.entrepreneur => EntrepreneurShell(
        api: api,
        speech: speech,
        language: language,
        onChangeLanguage: onChangeLanguage,
        onSignOut: () async => Navigator.of(context).pop(),
        services: (account) => demoIntakeServices(api, account),
      ),
      DemoRole.facilitator => FacilitatorHome(
        ctx: EntrepreneurContext(api: api, speech: speech, language: language),
        displayName: 'Demo facilitator',
        onSignOut: () async => Navigator.of(context).pop(),
        services: demoIntakeServices(api, 'demo-facilitator'),
      ),
    };
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
  }
}

enum DemoRole { entrepreneur, facilitator }

IntakeServices demoIntakeServices(ApiClient api, String account) =>
    IntakeServices(
      api: api,
      store: LazyOutboxStore(account),
      directory: intakeDirectory,
      recorder: DemoRecorder.new,
      pickFile: () async => null,
    );

class DemoRecorder implements Recorder {
  String? _path;

  @override
  Future<bool> hasPermission() async => true;

  @override
  Future<void> start(String path) async {
    _path = path;
  }

  @override
  Future<void> pause() async {}

  @override
  Future<void> resume() async {}

  @override
  Future<String?> stop() async => _path;

  @override
  Future<void> dispose() async {
    _path = null;
  }
}

class DemoApiClient implements ApiClient {
  DemoApiClient(this.role);
  final DemoRole role;

  @override
  Future<Map<String, dynamic>> request(
    String path, {
    Map<String, dynamic>? body,
    String? method,
  }) async {
    if (path == '/me' && method == 'PUT') {
      return _me(body?['language'] as String?);
    }
    if (path == '/me') return _me(null);
    if (path == '/me/passport') {
      return {
        'consents': {
          'sharing': {
            'sector_partner': {'id': 'demo-sector-consent'},
          },
        },
        'ideas': [
          {
            'title': 'Demo spice and snack business',
            'visibleTo': [
              {'name': 'Demo Centre', 'reason': 'owning_centre'},
              {'name': 'Demo Sector Partner', 'reason': 'shared'},
            ],
          },
        ],
      };
    }
    if (path == '/me/submissions') {
      return {
        'submissions': [
          {'title': 'Demo spice and snack business', 'status': 'SUBMITTED'},
          {'title': 'Demo tailoring service', 'status': 'IN_REVIEW'},
        ],
      };
    }
    if (path.startsWith('/consents')) return {'ok': true};
    if (path == '/assisted/submissions') {
      return {
        'submissions': [
          {
            'title': 'Demo spice and snack business',
            'status': 'SUBMITTED',
            'applicant': {'name': 'Demo applicant'},
          },
          {
            'title': 'Demo tailoring service',
            'status': 'IN_REVIEW',
            'applicant': {'name': 'Demo applicant two'},
          },
        ],
      };
    }
    if (path == '/health') return {'ok': true};
    return {};
  }

  Map<String, dynamic> _me(String? requestedLanguage) => {
    'id': role == DemoRole.entrepreneur
        ? 'demo-entrepreneur'
        : 'demo-facilitator',
    'role': role == DemoRole.entrepreneur ? 'entrepreneur' : 'facilitator',
    'displayName': role == DemoRole.entrepreneur
        ? 'Demo entrepreneur'
        : 'Demo facilitator',
    'language': requestedLanguage ?? 'en',
    'consents': {'processing': true, 'sharing': false},
    'noticeVersion': 'demo',
    'profileComplete': true,
    'profile': {
      'name': role == DemoRole.entrepreneur
          ? 'Demo entrepreneur'
          : 'Demo facilitator',
      'district': 'Demo district',
      'trade': 'Demo trade',
    },
  };

  @override
  Future<Map<String, dynamic>> uploadChunk(
    String documentId,
    int offset,
    List<int> bytes,
  ) async => {'documentId': documentId, 'receivedBytes': offset + bytes.length};
}
