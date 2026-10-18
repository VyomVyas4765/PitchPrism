import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/api.dart';
import 'common.dart';
import 'onboarding_copy.dart';

const indianStates = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep'];

/// One-time application after language, sign-in and processing consent.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.ctx, required this.profile, required this.onDone});
  final EntrepreneurContext ctx;
  final Map<String, dynamic> profile;
  final VoidCallback onDone;
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _form = GlobalKey<FormState>();
  late final Map<String, TextEditingController> _fields;
  String? _state;
  String? _gender;
  bool _saving = false;
  String? _error;
  final _search = TextEditingController();
  Timer? _searchTimer;
  List<Map<String, dynamic>> _suggestions = const [];
  String? _searchNote;
  bool _searching = false;
  int _searchSerial = 0;

  @override
  void initState() {
    super.initState();
    _state = widget.profile['state'] as String?;
    _gender = widget.profile['gender'] as String?;
    _fields = {for (final key in _labels)
      key: TextEditingController(text: widget.profile[key] as String? ?? '')};
    _fields['pincode']!.addListener(_pincodeTyped);
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _search.dispose();
    for (final controller in _fields.values) { controller.dispose(); }
    super.dispose();
  }

  // ---- area suggestions (the server looks places up; nothing else about the person is sent)
  Future<List<Map<String, dynamic>>> _lookup(String query) async {
    final data = await widget.ctx.api.request('/geo/suggest?q=${Uri.encodeQueryComponent(query)}');
    _searchNote = data['unavailable'] == true ? 'searchAreaOffline' : null;
    return ((data['suggestions'] as List?) ?? const []).cast<Map<String, dynamic>>();
  }

  void _searchChanged(String value) {
    _searchTimer?.cancel();
    final query = value.trim();
    if (query.length < 3) {
      setState(() { _suggestions = const []; _searchNote = null; _searching = false; });
      return;
    }
    // Wait for a pause in typing: the free place service allows about one request a second.
    _searchTimer = Timer(const Duration(milliseconds: 700), () async {
      final serial = ++_searchSerial;
      if (mounted) setState(() => _searching = true);
      List<Map<String, dynamic>> found = const [];
      try {
        found = await _lookup(query);
      } catch (_) {
        _searchNote = 'searchAreaOffline';
      }
      if (!mounted || serial != _searchSerial) return;
      setState(() { _suggestions = found; _searching = false; if (found.isEmpty && _searchNote == null) _searchNote = 'searchAreaNone'; });
    });
  }

  String? _stateFrom(String? name) {
    if (name == null || name.trim().isEmpty) return null;
    String norm(String value) => value.toLowerCase().replaceAll('&', 'and').replaceAll(RegExp(r'[^a-z ]'), '').replaceAll(RegExp(r'\s+'), ' ').trim();
    const aliases = {'orissa': 'odisha', 'nct of delhi': 'delhi', 'pondicherry': 'puducherry', 'uttaranchal': 'uttarakhand'};
    final wanted = aliases[norm(name)] ?? norm(name);
    for (final state in indianStates) {
      if (norm(state) == wanted) return state;
    }
    return null;
  }

  void _apply(Map<String, dynamic> place) {
    String text(String key) => (place[key] as String?)?.trim() ?? '';
    void put(String key, String value) { if (value.isNotEmpty) _fields[key]!.text = value; }
    _fields['pincode']!.removeListener(_pincodeTyped);
    put('village', text('village'));
    put('block', text('block'));
    put('district', text('district'));
    put('pincode', text('pincode'));
    _fields['pincode']!.addListener(_pincodeTyped);
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _state = _stateFrom(text('state')) ?? _state;
      _suggestions = const [];
      _searchNote = null;
      _search.clear();
    });
  }

  // A full pincode fills the rest of the area by itself, unless the person already filled the district.
  void _pincodeTyped() {
    final pin = _fields['pincode']!.text.trim();
    if (!RegExp(r'^[1-9]\d{5}$').hasMatch(pin) || _fields['district']!.text.trim().isNotEmpty) return;
    () async {
      try {
        final found = await _lookup(pin);
        if (!mounted || found.isEmpty || _fields['district']!.text.trim().isNotEmpty) return;
        _apply(found.first);
      } catch (_) {/* typing the fields by hand still works */}
    }();
  }

  Widget _areaSearch(BuildContext context) {
    final theme = Theme.of(context);
    final t = widget.ctx.t;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Padding(padding: const EdgeInsets.only(bottom: 4), child: TextField(
        key: const Key('profile-area-search'), controller: _search, onChanged: _searchChanged,
        textInputAction: TextInputAction.search, maxLength: 80,
        decoration: InputDecoration(labelText: t('searchArea'), hintText: t('searchAreaHint'), counterText: '',
          prefixIcon: const Icon(Icons.place_outlined),
          suffixIcon: _searching ? const Padding(padding: EdgeInsets.all(12),
            child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))) : null),
      )),
      if (_suggestions.isNotEmpty) Card(key: const Key('profile-area-suggestions'), margin: const EdgeInsets.only(bottom: 12), child: Column(children: [
        for (final place in _suggestions)
          ListTile(dense: true, leading: const Icon(Icons.location_on_outlined), title: Text(place['label'] as String? ?? ''),
            onTap: () => _apply(place)),
      ])),
      if (_suggestions.isEmpty && _searchNote != null) Padding(padding: const EdgeInsets.only(bottom: 12),
        child: Text(t(_searchNote!), style: theme.textTheme.bodySmall)),
    ]);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() { _saving = true; _error = null; });
    final body = {for (final entry in _fields.entries) entry.key: entry.value.text.trim()};
    final score = body.remove('creditScore')!;
    try {
      await widget.ctx.api.request('/me/onboarding', method: 'POST', body: {
        ...body, 'state': _state, 'gender': _gender,
        'creditScore': score.isEmpty ? null : int.parse(score),
      });
      widget.onDone();
    } on ApiException catch (error) {
      if (error.status == 409) { widget.onDone(); return; }
      if (mounted) setState(() => _error = error.message);
    } catch (_) {
      if (mounted) setState(() => _error = 'Cannot reach PitchPrism.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _field(String key, {int lines = 1, TextInputType? keyboard}) {
    final t = widget.ctx.t;
    String c(String key) => onboardingText(widget.ctx.language, key);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        key: Key('profile-$key'), controller: _fields[key],
        maxLines: lines, keyboardType: keyboard,
        inputFormatters: key == 'mobile' || key == 'pincode' || key == 'creditScore'
          ? [FilteringTextInputFormatter.digitsOnly] : null,
        textInputAction: lines > 1 ? TextInputAction.newline : TextInputAction.done,
        onFieldSubmitted: (_) => FocusScope.of(context).unfocus(),
        onTapOutside: (_) => FocusScope.of(context).unfocus(),
        maxLength: key == 'name' ? 100 : (key == 'district' || key == 'village' || key == 'block' ? 80 :
          key == 'education' ? 150 : key == 'mobile' ? 10 :
          key == 'pincode' ? 6 : key == 'creditScore' ? 3 : 300),
        decoration: InputDecoration(labelText: c(key), alignLabelWithHint: lines > 1),
        validator: (value) {
          final text = (value ?? '').trim();
          if (text.isEmpty) return key == 'creditScore' ? null : t('required');
          if (key == 'mobile' && !RegExp(r'^[6-9]\d{9}$').hasMatch(text)) return c('invalidMobile');
          if (key == 'pincode' && !RegExp(r'^[1-9]\d{5}$').hasMatch(text)) return t('pincodeInvalid');
          if (key == 'creditScore' && (int.tryParse(text) == null || int.parse(text) < 300 || int.parse(text) > 900)) return c('invalidScore');
          return null;
        },
      ),
    );
  }

  Widget _section(BuildContext context, String title, List<String> keys) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(padding: const EdgeInsets.symmetric(vertical: 12), child: Row(children: [
        Expanded(child: Text(title, style: Theme.of(context).textTheme.titleLarge)),
        ListenButton(context_: widget.ctx,
          text: keys.map((key) => onboardingText(widget.ctx.language, key)).join('. ')),
      ])),
      for (final key in keys) _field(key,
        lines: _longFields.contains(key) ? 3 : 1,
        keyboard: key == 'mobile' ? TextInputType.number :
          key == 'pincode' || key == 'creditScore' ? TextInputType.number : null),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    String c(String key) => onboardingText(widget.ctx.language, key);
    return Column(children: [Expanded(child: Form(key: _form, child: SingleChildScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(widget.ctx.t('profileTitle'), style: theme.textTheme.headlineMedium),
        const SizedBox(height: 8),
        Text(c('intro')),
        _section(context, c('contact'), ['name', 'mobile', 'education', 'workBackground', 'creditScore']),
        DropdownButtonFormField<String?>(
          key: const Key('profile-gender'), initialValue: _gender,
          isExpanded: true,
          decoration: InputDecoration(labelText: widget.ctx.t('gender')),
          items: [
            DropdownMenuItem(value: null, child: Text(widget.ctx.t('genderSkip'), overflow: TextOverflow.ellipsis, maxLines: 1)),
            DropdownMenuItem(value: 'female', child: Text(widget.ctx.t('genderFemale'), overflow: TextOverflow.ellipsis, maxLines: 1)),
            DropdownMenuItem(value: 'male', child: Text(widget.ctx.t('genderMale'), overflow: TextOverflow.ellipsis, maxLines: 1)),
            DropdownMenuItem(value: 'other', child: Text(widget.ctx.t('genderOther'), overflow: TextOverflow.ellipsis, maxLines: 1)),
          ],
          onChanged: _saving ? null : (value) => setState(() => _gender = value),
        ),
        _areaSearch(context),
        _section(context, c('location'), ['village', 'block', 'district', 'pincode']),
        DropdownButtonFormField<String>(
          key: const Key('profile-state'), initialValue: _state,
          isExpanded: true,
          decoration: InputDecoration(labelText: c('state')),
          items: [for (final state in indianStates) DropdownMenuItem(value: state,
            child: Text(state, overflow: TextOverflow.ellipsis, maxLines: 1))],
          onChanged: _saving ? null : (value) => setState(() => _state = value),
          validator: (value) => value == null ? widget.ctx.t('required') : null,
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12),
          child: Semantics(liveRegion: true, child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)))),
        FilledButton(key: const Key('profile-save'), onPressed: _saving ? null : _save,
          child: Text(_saving ? c('saving') : widget.ctx.t('save'))),
      ]),
    ))), KeyboardDismissBar(label: widget.ctx.t('hideKeyboard'))]);
  }
}

const _longFields = {'workBackground'};
const _labels = ['name', 'mobile', 'education', 'workBackground', 'creditScore', 'village', 'block', 'district',
  'pincode'];
