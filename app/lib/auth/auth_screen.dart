import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/speech.dart';
import '../entrepreneur/common.dart';
import '../entrepreneur/entrepreneur_shell.dart';
import '../facilitator/facilitator_home.dart';
import '../intake/services.dart';
import '../l10n/strings.dart';

/// D-27: email and password is the only way in. Entrepreneurs create their own account (always as an
/// entrepreneur); facilitators sign in with the account their organisation invited them to create.
class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key, this.language = 'en', this.speech, this.onChangeLanguage, this.api});
  final String language;
  final Speech? speech;
  final VoidCallback? onChangeLanguage;
  final PitchPrismApi? api;
  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  late final PitchPrismApi _api = widget.api ?? PitchPrismApi();
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  Map<String, dynamic>? _user;
  String? _error;
  bool _creating = false;
  bool _loading = true;
  late final Speech _speech = widget.speech ?? SystemSpeech();

  String t(String key) => tr(widget.language, key);

  @override
  void initState() {
    super.initState();
    if (kDebugMode) {
      unawaited(_api.request('/health')
          .then<void>((_) => debugPrint('PitchPrism development API: reachable'))
          .catchError((Object _) => debugPrint('PitchPrism development API: unavailable')));
    }
    _restore();
  }

  Future<void> _restore() async {
    try {
      if (!await _api.hasSession()) return;
      final user = (await _api.request('/auth/me'))['user'] as Map<String, dynamic>;
      if (!['entrepreneur', 'facilitator'].contains(user['role'])) throw ApiException(t('staffUseWeb'), 403);
      if (mounted) setState(() => _user = user);
    } on ApiException catch (error) {
      if ([401, 403].contains(error.status)) {
        await _api.clearToken();
        if (error.status == 403 && mounted) setState(() => _error = error.message);
      } else if (mounted) {
        setState(() => _error = error.message);
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Cannot reach PitchPrism. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = {'email': _email.text.trim(), 'password': _password.text, 'client': 'mobile'};
      final response = await _api.request(_creating ? '/auth/register' : '/auth/login', body: body);
      final user = response['user'] as Map<String, dynamic>;
      await _api.saveToken(response['accessToken'] as String);
      if (!['entrepreneur', 'facilitator'].contains(user['role'])) {
        try {
          await _api.request('/auth/logout', body: {});
        } finally {
          await _api.clearToken();
        }
        throw ApiException(t('staffUseWeb'), 403);
      }
      if (mounted) {
        setState(() {
          _user = user;
          _password.clear();
          _confirm.clear();
        });
      }
    } on ApiException catch (error) {
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Cannot reach PitchPrism. Check your connection and try again.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _signOut() async {
    try {
      await _api.request('/auth/logout', body: {});
    } on ApiException catch (error) {
      if (error.status != 401) rethrow;
    } catch (_) {}
    await _api.clearToken();
    if (mounted) setState(() => _user = null);
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final user = _user;
    if (user != null && user['role'] == 'entrepreneur') {
      return EntrepreneurShell(api: _api, speech: _speech, language: widget.language,
        onChangeLanguage: widget.onChangeLanguage ?? () {}, onSignOut: _signOut);
    }
    if (user != null && user['role'] == 'facilitator') {
      return FacilitatorHome(
        ctx: EntrepreneurContext(api: _api, speech: _speech, language: widget.language),
        displayName: user['displayName'] as String,
        onSignOut: _signOut,
        // One outbox per account keeps each facilitator's queue apart on a shared phone.
        services: IntakeServices.device(_api, user['id'] as String),
      );
    }
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('PitchPrism'), actions: [
        if (widget.onChangeLanguage != null)
          IconButton(tooltip: t('chooseLanguage'), onPressed: widget.onChangeLanguage, icon: const Icon(Icons.translate)),
      ]),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: Form(
              key: _form,
              child: ListView(
                padding: const EdgeInsets.all(24),
                children: [
                  Text(t(_creating ? 'createAccount' : 'signInTitle'), style: theme.textTheme.headlineMedium),
                  const SizedBox(height: 24),
                  if (_error != null)
                    Semantics(liveRegion: true, child: Padding(padding: const EdgeInsets.only(bottom: 16),
                      child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)))),
                  TextFormField(
                    key: const Key('auth-email'), controller: _email, keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email], decoration: InputDecoration(labelText: t('email')),
                    validator: (value) => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch((value ?? '').trim()) ? null : t('emailInvalid'),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    key: const Key('auth-password'), controller: _password, obscureText: true,
                    autofillHints: [_creating ? AutofillHints.newPassword : AutofillHints.password],
                    decoration: InputDecoration(labelText: t('password'), helperText: _creating ? t('passwordRule') : null),
                    validator: (value) => (value ?? '').isEmpty ? t('required') : _creating && value!.length < 12 ? t('passwordRule') : null,
                  ),
                  if (_creating) ...[
                    const SizedBox(height: 16),
                    TextFormField(
                      key: const Key('auth-confirm'), controller: _confirm, obscureText: true,
                      autofillHints: const [AutofillHints.newPassword], decoration: InputDecoration(labelText: t('confirmPassword')),
                      validator: (value) => value == _password.text ? null : t('passwordsDiffer'),
                    ),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(key: const Key('auth-submit'), onPressed: _loading ? null : _submit,
                    child: Text(t(_creating ? 'createAccount' : 'signIn'))),
                  if (_loading) const Padding(padding: EdgeInsets.all(20), child: Center(child: CircularProgressIndicator())),
                  TextButton(
                    key: const Key('auth-toggle'),
                    style: TextButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    onPressed: _loading ? null : () => setState(() {
                      _creating = !_creating;
                      _error = null;
                    }),
                    child: Text(t(_creating ? 'haveAccount' : 'newHere')),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
