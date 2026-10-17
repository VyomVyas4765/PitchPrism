import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class ApiException implements Exception {
  const ApiException(this.message, this.status);
  final String message;
  final int status;
  @override
  String toString() => message;
}

/// What screens need from the API; tests substitute a fake.
abstract class ApiClient {
  Future<Map<String, dynamic>> request(
    String path, {
    Map<String, dynamic>? body,
    String? method,
  });

  /// Sends one resumable-upload chunk. A 409 is not an error here: the server
  /// returns its `receivedBytes` so the caller resumes from the right place.
  Future<Map<String, dynamic>> uploadChunk(
    String documentId,
    int offset,
    List<int> bytes,
  );
}

class PitchPrismApi implements ApiClient {
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:4000/api/v1',
  );
  final _storage = const FlutterSecureStorage();
  Future<bool> hasSession() async =>
      (await _storage.read(key: 'session')) != null;
  Future<void> saveToken(String token) =>
      _storage.write(key: 'session', value: token);
  Future<void> clearToken() => _storage.delete(key: 'session');

  @override
  Future<Map<String, dynamic>> request(
    String path, {
    Map<String, dynamic>? body,
    String? method,
  }) async {
    final token = await _storage.read(key: 'session');
    final headers = {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
    final url = Uri.parse('$baseUrl$path');
    final verb = method ?? (body == null ? 'GET' : 'POST');
    final encoded = body == null ? null : jsonEncode(body);
    final response =
        await (switch (verb) {
              'GET' => http.get(url, headers: headers),
              'PUT' => http.put(url, headers: headers, body: encoded),
              _ => http.post(url, headers: headers, body: encoded),
            })
            .timeout(const Duration(seconds: 20));
    Map<String, dynamic> data;
    try {
      data = response.body.isEmpty
          ? {}
          : jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw const ApiException('Could not read the server response.', 502);
    }
    if (response.statusCode >= 400) {
      throw ApiException(
        data['error'] as String? ?? 'Please try again.',
        response.statusCode,
      );
    }
    return data;
  }

  @override
  Future<Map<String, dynamic>> uploadChunk(
    String documentId,
    int offset,
    List<int> bytes,
  ) async {
    final token = await _storage.read(key: 'session');
    final response = await http
        .put(
          Uri.parse('$baseUrl/documents/$documentId/content'),
          headers: {
            'Content-Type': 'application/octet-stream',
            'Upload-Offset': '$offset',
            if (token != null) 'Authorization': 'Bearer $token',
          },
          body: bytes,
        )
        .timeout(const Duration(seconds: 60));
    Map<String, dynamic> data;
    try {
      data = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw const ApiException('Could not read the server response.', 502);
    }
    if (response.statusCode >= 400 && response.statusCode != 409) {
      throw ApiException(
        data['error'] as String? ?? 'Please try again.',
        response.statusCode,
      );
    }
    return data;
  }
}
