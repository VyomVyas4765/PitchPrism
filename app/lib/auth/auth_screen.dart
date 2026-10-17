import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _api = PitchPrismApi();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  Map<String, dynamic>? _user;
  String? _verificationId;
  String? _error;
  bool _facilitator = false;
  bool _loading = true;
  bool _exchanging = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    try {
      final response = await _api.request('/auth/me');
      final user = response['user'] as Map<String, dynamic>;
      if (!['entrepreneur', 'facilitator'].contains(user['role'])) {
        throw const ApiException(
          'Use the web dashboard for this staff role.',
          403,
        );
      }
      if (mounted) setState(() => _user = user);
    } on ApiException catch (error) {
      if ([401, 403].contains(error.status)) {
        await _api.clearToken();
      } else if (mounted) {
        setState(() => _error = error.message);
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'Cannot reach PitchPrism. Check your connection and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _firebase() async {
    if (Firebase.apps.isNotEmpty) return;
    const projectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
    const apiKey = String.fromEnvironment('FIREBASE_API_KEY');
    const appId = String.fromEnvironment('FIREBASE_APP_ID');
    const senderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
    if ([projectId, apiKey, appId, senderId].any((value) => value.isEmpty)) {
      throw const ApiException(
        'Phone sign-in needs your team’s Firebase configuration. See app/README.md.',
        503,
      );
    }
    await Firebase.initializeApp(
      options: const FirebaseOptions(
        projectId: projectId,
        apiKey: apiKey,
        appId: appId,
        messagingSenderId: senderId,
      ),
    );
  }

  Future<void> _run(Future<void> Function() action) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await action();
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } on FirebaseAuthException catch (error) {
      if (mounted) {
        setState(
          () => _error = error.message ?? 'Phone sign-in failed. Try again.',
        );
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error = 'Could not complete sign-in. Check your connection and try again.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _accept(Map<String, dynamic> response) async {
    final user = response['user'] as Map<String, dynamic>;
    await _api.saveToken(response['accessToken'] as String);
    if (!['entrepreneur', 'facilitator'].contains(user['role'])) {
      try {
        await _api.request('/auth/logout', body: {});
      } finally {
        await _api.clearToken();
      }
      throw const ApiException(
        'Use the web dashboard for this staff role.',
        403,
      );
    }
    await _api.request('/workspaces/${user['role']}');
    if (mounted) {
      setState(() {
        _user = user;
        _password.clear();
        _code.clear();
      });
    }
  }

  Future<void> _exchange(PhoneAuthCredential credential) async {
    if (_exchanging || _user != null) return;
    _exchanging = true;
    try {
      final result = await FirebaseAuth.instance.signInWithCredential(
        credential,
      );
      final idToken = await result.user!.getIdToken(true);
      await _accept(
        await _api.request('/auth/otp/verify', body: {'idToken': idToken}),
      );
    } finally {
      _exchanging = false;
    }
  }

  Future<void> _sendCode() => _run(() async {
    if (!RegExp(r'^\+[1-9]\d{7,14}$').hasMatch(_phone.text.trim())) {
      throw const ApiException(
        'Enter your number with country code, for example +91 followed by your number.',
        400,
      );
    }
    await _firebase();
    await FirebaseAuth.instance.verifyPhoneNumber(
      phoneNumber: _phone.text.trim(),
      verificationCompleted: (credential) {
        if (mounted) _run(() => _exchange(credential));
      },
      verificationFailed: (error) {
        if (mounted) {
          setState(() {
            _error = error.message ?? 'Could not send a code.';
            _loading = false;
          });
        }
      },
      codeSent: (id, _) {
        if (mounted && _user == null) {
          setState(() {
            _verificationId = id;
            _loading = false;
          });
        }
      },
      codeAutoRetrievalTimeout: (id) {
        if (mounted && _user == null) {
          setState(() {
            _verificationId = id;
            _loading = false;
          });
        }
      },
    );
  });

  Future<void> _signOut() => _run(() async {
    try {
      await _api.request('/auth/logout', body: {});
    } on ApiException catch (error) {
      if (error.status != 401) rethrow;
    }
    await _api.clearToken();
    if (Firebase.apps.isNotEmpty) await FirebaseAuth.instance.signOut();
    if (mounted) {
      setState(() {
        _user = null;
        _verificationId = null;
      });
    }
  });

  @override
  void dispose() {
    _phone.dispose();
    _code.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('PitchPrism')),
    body: SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  _user == null
                      ? (_facilitator
                            ? 'Facilitator sign in'
                            : 'Your idea starts here')
                      : 'Welcome, ${_user!['displayName']}',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 24),
                if (_error != null)
                  Semantics(
                    liveRegion: true,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Text(
                        _error!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.error,
                        ),
                      ),
                    ),
                  ),
                if (_user != null) ...[
                  Text(
                    'Signed in as ${(_user!['role'] as String).replaceAll('_', ' ')}.',
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'Your workspace is ready. Pitching and assisted workflows come next.',
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _loading ? null : _signOut,
                    child: const Text('Sign out'),
                  ),
                ] else if (_facilitator) ...[
                  TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.username],
                    decoration: const InputDecoration(
                      labelText: 'Email address',
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _password,
                    obscureText: true,
                    autofillHints: const [AutofillHints.password],
                    decoration: const InputDecoration(labelText: 'Password'),
                  ),
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _loading
                        ? null
                        : () => _run(() async {
                            await _accept(
                              await _api.request(
                                '/auth/login',
                                body: {
                                  'email': _email.text.trim(),
                                  'password': _password.text,
                                  'client': 'mobile',
                                },
                              ),
                            );
                          }),
                    child: const Text('Sign in'),
                  ),
                ] else ...[
                  const Text(
                    'Sign in with your phone. Your number will be sent to Google/Firebase to verify it and help prevent abuse.',
                  ),
                  const SizedBox(height: 24),
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    enabled: !_loading,
                    autofillHints: const [AutofillHints.telephoneNumber],
                    decoration: const InputDecoration(
                      labelText: 'Phone number with country code',
                      hintText: '+91…',
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: _loading ? null : _sendCode,
                    child: Text(
                      _verificationId == null ? 'Send code' : 'Send a new code',
                    ),
                  ),
                  if (_verificationId != null) ...[
                    const SizedBox(height: 24),
                    TextField(
                      controller: _code,
                      keyboardType: TextInputType.number,
                      autofillHints: const [AutofillHints.oneTimeCode],
                      decoration: const InputDecoration(
                        labelText: 'Verification code',
                      ),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _loading
                          ? null
                          : () => _run(() async {
                              await _exchange(
                                PhoneAuthProvider.credential(
                                  verificationId: _verificationId!,
                                  smsCode: _code.text.trim(),
                                ),
                              );
                            }),
                      child: const Text('Verify and sign in'),
                    ),
                  ],
                ],
                if (_loading)
                  const Padding(
                    padding: EdgeInsets.all(20),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                if (_user == null)
                  TextButton(
                    onPressed: _loading
                        ? null
                        : () => setState(() {
                            _facilitator = !_facilitator;
                            _error = null;
                          }),
                    child: Text(
                      _facilitator
                          ? 'Entrepreneur phone sign in'
                          : 'I am a field facilitator',
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
