import 'dart:io';

import 'package:file_picker/file_picker.dart';

import '../core/api.dart';
import '../core/speech.dart';
import '../intake/device.dart';
import '../intake/outbox.dart';
import '../intake/services.dart';
import 'onboarding_copy.dart';

/// A device-only tour. No token is created and this adapter never calls the network.
/// Answers and uploads are discarded when the tour ends; only synthetic labels are shown.
class OfflineDemo {
  OfflineDemo(String language) : api = _DemoApi(language) {
    services = IntakeServices(
      api: api,
      store: _MemoryOutboxStore(),
      directory: () => _directory,
      recorder: DeviceRecorder.new,
      pickFile: () async {
        final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp']);
        return file?.path == null ? null : (path: file!.path!, name: file!.name);
      },
    );
  }

  final ApiClient api;
  late final IntakeServices services;
  late final Future<Directory> _directory = Directory.systemTemp.createTemp('pitchprism-demo-');

  Future<void> dispose() async {
    try {
      final directory = await _directory;
      if (await directory.exists()) await directory.delete(recursive: true);
    } on FileSystemException {
      // Temporary files are already isolated from signed-in account storage.
    }
  }
}

class _MemoryOutboxStore implements OutboxStore {
  List<OutboxItem> _items = [];

  @override
  Future<List<OutboxItem>> load() async => List.of(_items);

  @override
  Future<void> save(List<OutboxItem> items) async => _items = List.of(items);
}

class _DemoApi implements ApiClient {
  _DemoApi(this._language);

  String _language;
  bool _processing = false;
  bool _onboardingComplete = false;
  int _nextId = 0;
  final _sharing = <String, Map<String, dynamic>?>{'sector_partner': null, 'funding_partner': null};
  final _ideas = <Map<String, dynamic>>[
    {'id': 'demo-idea-1', 'title': 'Sample tailoring idea (demo)', 'status': 'DRAFT'},
  ];

  static const _sampleProfile = <String, dynamic>{
    'name': 'Demo Entrepreneur', 'mobile': '9000000080', 'education': 'Secondary school',
    'workBackground': 'Two years of sample work experience', 'creditScore': '', 'village': 'Demo Village',
    'block': 'Demo Block', 'district': 'Nashik', 'state': 'Maharashtra', 'pincode': '422001',
  };

  Map<String, dynamic> _consents() => {
    'processing': _processing ? {'id': 'demo-processing'} : null,
    'sharing': Map<String, dynamic>.from(_sharing),
  };

  Map<String, dynamic> _me() => {
    'id': 'offline-demo', 'language': _language, 'noticeVersion': consentNoticeVersion,
    'onboardingComplete': _onboardingComplete, 'profile': Map<String, dynamic>.from(_sampleProfile),
    'consents': _consents(),
  };

  @override
  Future<Map<String, dynamic>> request(String path, {Map<String, dynamic>? body, String? method}) async {
    if (path == '/me' && method != 'PUT') return _me();
    if (path == '/me' && method == 'PUT') {
      _language = body?['language'] as String? ?? _language;
      return _me();
    }
    if (path == '/consents' && body != null) {
      final purpose = body['purpose'];
      if (purpose == 'processing') {
        _processing = true;
      } else if (purpose == 'partner_sharing') {
        final scope = body['scope'] as String;
        if (!_sharing.containsKey(scope)) throw const ApiException('Unknown demo sharing choice.', 400);
        _sharing[scope] = {'id': 'demo-$scope'};
      }
      return {'consents': _consents()};
    }
    if (path.startsWith('/consents/') && path.endsWith('/revoke')) {
      final scope = path.split('/')[2].replaceFirst('demo-', '');
      if (_sharing.containsKey(scope)) _sharing[scope] = null;
      return {'consents': _consents()};
    }
    if (path == '/me/onboarding' && method == 'POST') {
      // The form is exercised, but its contents are deliberately not retained.
      _onboardingComplete = true;
      return _me();
    }
    if (path == '/me/submissions') return {'submissions': List<Map<String, dynamic>>.from(_ideas)};
    if (path == '/me/passport') return {
      'consents': _consents(),
      'ideas': [for (final idea in _ideas) {
        ...idea, 'visibleTo': [{'name': 'Sample centre (demo)', 'reason': 'owning_centre'}],
      }],
    };
    if (path == '/centres') return {'centres': [{'id': 'demo-centre', 'name': 'Sample centre (demo)'}]};
    if (path == '/pitch-prompts') return {'steps': [
      for (final (key, label) in [
        ('sell', 'productsServices'), ('buyers', 'targetCustomers'), ('where', 'setupLocation'),
        ('money', 'fundingSources'), ('skills', 'workBackground'),
      ]) {'key': key, 'maxSeconds': 120,
        'prompt': {for (final language in launchLanguages) language: onboardingText(language, label)}},
    ]};
    if (path == '/pitches' && body != null) return {'id': 'demo-pitch-${++_nextId}'};
    if (path.endsWith('/answers')) return {};
    if (path.endsWith('/documents') && body != null) {
      return {'id': 'demo-document-${++_nextId}', 'receivedBytes': 0, 'state': 'receiving'};
    }
    if (path.endsWith('/submit')) {
      final id = 'demo-idea-${++_nextId}';
      _ideas.add({'id': id, 'title': 'Local demo pitch', 'status': 'DRAFT'});
      return {'submissionId': id};
    }
    if (path.endsWith('/transcript')) return {'pipeline': 'pending_capability', 'transcript': null};
    if (path.endsWith('/process')) return {};
    throw const ApiException('This action is unavailable in the offline demo.', 503);
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(String documentId, int offset, List<int> bytes) async =>
      {'receivedBytes': offset + bytes.length, 'state': 'complete'};

  @override
  Future<List<int>> download(String path) async =>
      throw const ApiException('No recording is stored on a server in the offline demo.', 404);
}
