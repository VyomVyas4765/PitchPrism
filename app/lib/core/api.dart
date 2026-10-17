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

class PitchPrismApi {
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

  Future<Map<String, dynamic>> request(
    String path, {
    Map<String, dynamic>? body,
  }) async {
    final token = await _storage.read(key: 'session');
    final headers = {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
    final url = Uri.parse('$baseUrl$path');
    final response =
        await (body == null
                ? http.get(url, headers: headers)
                : http.post(url, headers: headers, body: jsonEncode(body)))
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
}
