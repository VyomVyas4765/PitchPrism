import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import 'outbox.dart';

/// Microphone access for guided steps and spoken consent; tests use a fake.
abstract class Recorder {
  Future<bool> hasPermission();
  Future<void> start(String path);
  Future<void> pause();
  Future<void> resume();
  Future<String?> stop();
  Future<void> dispose();
}

/// AAC in .m4a at 16 kHz mono (~32 kbps): small on 2 GB phones and the same
/// container as the organiser's phone recordings, which the worker reads (A-03).
class DeviceRecorder implements Recorder {
  final _recorder = AudioRecorder();
  @override
  Future<bool> hasPermission() => _recorder.hasPermission();
  @override
  Future<void> start(String path) => _recorder.start(
    const RecordConfig(encoder: AudioEncoder.aacLc, sampleRate: 16000, numChannels: 1, bitRate: 32000),
    path: path,
  );
  @override
  Future<void> pause() => _recorder.pause();
  @override
  Future<void> resume() => _recorder.resume();
  @override
  Future<String?> stop() => _recorder.stop();
  @override
  Future<void> dispose() => _recorder.dispose();
}

/// Private app storage: recordings, copied uploads and the outbox live here,
/// not in shared media folders, and survive app restarts (M-11).
Future<Directory> intakeDirectory() async {
  final base = await getApplicationSupportDirectory();
  final directory = Directory('${base.path}${Platform.pathSeparator}intake');
  await directory.create(recursive: true);
  return directory;
}

final _random = Random.secure();

/// Unique per device for idempotent server calls; base64url keeps it within [A-Za-z0-9_-].
String newClientId(String prefix) =>
    '$prefix-${base64Url.encode(List<int>.generate(12, (_) => _random.nextInt(256))).replaceAll('=', '')}';

/// Describes a file already in app storage for the outbox (size and sha256 the server verifies).
Future<OutboxFile> describeFile(String path, {required String kind, required String mime, String? promptStep, String prefix = 'file'}) async {
  final file = File(path);
  final bytes = await file.length();
  final digest = await sha256.bind(file.openRead()).first;
  return OutboxFile(clientFileId: newClientId(prefix), path: path, kind: kind, mime: mime, bytes: bytes,
    sha256: digest.toString(), promptStep: promptStep);
}
