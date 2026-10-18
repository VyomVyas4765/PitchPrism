import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/widgets.dart' show Rect;
import 'package:pdf/pdf.dart' show PdfPageFormat;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

import '../core/api.dart';
import 'device.dart';
import 'outbox.dart';

/// A file the person picked, before it is copied into app storage.
typedef PickedFile = ({String path, String name});

/// Hands a saved file to the phone's share sheet (Save to Files, Print, AirDrop, a messaging app).
typedef ShareFile = Future<void> Function(String path, String mime, Rect? origin);

/// Renders an HTML page to PDF bytes with the phone's own engine (WebKit on iOS), which shapes Indic scripts correctly.
typedef HtmlToPdf = Future<List<int>> Function(String html);

// Deprecated upstream because output differs by platform; on iOS it is WebKit, which shapes Devanagari, Telugu,
// Odia and Bengali correctly, unlike the pdf package's own text layout.
// ignore: deprecated_member_use
Future<List<int>> htmlToPdfNative(String html) => Printing.convertHtml(format: PdfPageFormat.a4, html: html);

Future<void> shareFileSheet(String path, String mime, Rect? origin) async {
  await SharePlus.instance.share(ShareParams(files: [XFile(path, mimeType: mime)], sharePositionOrigin: origin));
}

/// Device services for intake, passed explicitly so widget tests can fake them.
class IntakeServices {
  IntakeServices({
    required this.api,
    required this.store,
    required this.directory,
    required this.recorder,
    required this.pickFile,
    this.pickAudio = pickAudioFile,
    this.pickPdf = pickPdfFile,
    this.pickPhoto = pickPhotoFile,
    this.shareFile = shareFileSheet,
    this.htmlToPdf = htmlToPdfNative,
  }) : sync = OutboxSync(api, store);
  final ApiClient api;
  final OutboxStore store;
  final OutboxSync sync;
  final Future<Directory> Function() directory;
  final Recorder Function() recorder;
  final Future<PickedFile?> Function() pickFile;
  /// A saved voice note or other recording on the phone (the chat's "Add voice note").
  final Future<PickedFile?> Function() pickAudio;
  /// The filled form as a PDF (the chat's "Send PDF").
  final Future<PickedFile?> Function() pickPdf;
  /// A photo of the filled form from the phone's library (the chat's "Send photo").
  final Future<PickedFile?> Function() pickPhoto;
  /// Opens the share sheet for a file the app saved (the chat's "Download plan (PDF)").
  final ShareFile shareFile;
  /// Makes the Business Idea Brief PDF in the person's own language ("My ideas" → Business draft).
  final HtmlToPdf htmlToPdf;

  /// The phone's real microphone, file picker and private storage for one account.
  factory IntakeServices.device(ApiClient api, String account) => IntakeServices(
    api: api,
    store: LazyOutboxStore(account),
    directory: intakeDirectory,
    recorder: DeviceRecorder.new,
    pickFile: () async {
      final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp']);
      final path = file?.path;
      return path == null ? null : (path: path, name: file!.name);
    },
  );

  Future<void> upsert(OutboxItem item) async {
    final items = await store.load();
    final index = items.indexWhere((existing) => existing.clientDraftId == item.clientDraftId);
    if (index < 0) {
      items.add(item);
    } else {
      items[index] = item;
    }
    await store.save(items);
  }
}

/// One outbox file per signed-in account, so a shared phone keeps each
/// facilitator's or entrepreneur's queue apart (M-18 per-applicant separation).
class LazyOutboxStore implements OutboxStore {
  LazyOutboxStore(this.account);
  final String account;
  late final Future<FileOutboxStore> _inner = intakeDirectory().then((dir) => FileOutboxStore(dir, account));
  @override
  Future<List<OutboxItem>> load() async => (await _inner).load();
  @override
  Future<void> save(List<OutboxItem> items) async => (await _inner).save(items);
}

/// Audio formats the reading pipeline recognises by content (ai/ingest/classify.py): AAC/M4A, MP3, WAV, Ogg/Opus.
const audioExtensions = ['m4a', 'mp4', 'mp3', 'wav', 'ogg', 'opus'];

Future<PickedFile?> pickAudioFile() async {
  final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: audioExtensions);
  final path = file?.path;
  return path == null ? null : (path: path, name: file!.name);
}

Future<PickedFile?> pickPdfFile() async {
  final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf']);
  final path = file?.path;
  return path == null ? null : (path: path, name: file!.name);
}

/// The photo library; iOS hands HEIC photos over as JPEG while compression is on (the plugin default).
Future<PickedFile?> pickPhotoFile() async {
  final file = await FilePicker.pickFile(type: FileType.image);
  final path = file?.path;
  return path == null ? null : (path: path, name: file!.name);
}

/// The MIME type for a picked voice note, or null when its format cannot be read.
String? classifyAudio(String name) => switch (name.toLowerCase().split('.').last) {
  'm4a' || 'mp4' => 'audio/mp4',
  'mp3' => 'audio/mpeg',
  'wav' => 'audio/wav',
  'ogg' || 'opus' => 'audio/ogg',
  _ => null,
};

/// The document kind and MIME type the server accepts, from a picked file's extension.
({String kind, String mime})? classifyPicked(String name) => switch (name.toLowerCase().split('.').last) {
  'pdf' => (kind: 'pdf', mime: 'application/pdf'),
  'jpg' || 'jpeg' => (kind: 'image', mime: 'image/jpeg'),
  'png' => (kind: 'image', mime: 'image/png'),
  'webp' => (kind: 'image', mime: 'image/webp'),
  _ => null,
};
