import 'package:flutter/material.dart';

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

  @override
  void initState() {
    super.initState();
    _state = widget.profile['state'] as String?;
    _gender = widget.profile['gender'] as String?;
    _fields = {for (final key in _labels)
      key: TextEditingController(text: widget.profile[key] as String? ?? '')};
  }

  @override
  void dispose() {
    for (final controller in _fields.values) { controller.dispose(); }
    super.dispose();
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
        maxLength: key == 'name' ? 100 : (key == 'district' || key == 'village' || key == 'block' ? 80 :
          key == 'education' ? 150 : key == 'mobile' ? 20 :
          key == 'pincode' ? 6 : key == 'creditScore' ? 3 : 300),
        decoration: InputDecoration(labelText: c(key), alignLabelWithHint: lines > 1),
        validator: (value) {
          final text = (value ?? '').trim();
          if (text.isEmpty) return key == 'creditScore' ? null : t('required');
          if (key == 'mobile' && (!RegExp(r'^\+?[0-9 ()-]{10,20}$').hasMatch(text) ||
              !RegExp(r'^(?:91)?[6-9]\d{9}$').hasMatch(text.replaceAll(RegExp(r'\D'), '')))) return c('invalidMobile');
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
        keyboard: key == 'mobile' ? TextInputType.phone :
          key == 'pincode' || key == 'creditScore' ? TextInputType.number : null),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    String c(String key) => onboardingText(widget.ctx.language, key);
    return Form(key: _form, child: SingleChildScrollView(
      padding: const EdgeInsets.all(20), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(widget.ctx.t('profileTitle'), style: theme.textTheme.headlineMedium),
        const SizedBox(height: 8),
        Text(c('intro')),
        _section(context, c('contact'), ['name', 'mobile', 'education', 'workBackground', 'creditScore']),
        DropdownButtonFormField<String?>(
          key: const Key('profile-gender'), initialValue: _gender,
          decoration: InputDecoration(labelText: widget.ctx.t('gender')),
          items: [
            DropdownMenuItem(value: null, child: Text(widget.ctx.t('genderSkip'))),
            DropdownMenuItem(value: 'female', child: Text(widget.ctx.t('genderFemale'))),
            DropdownMenuItem(value: 'male', child: Text(widget.ctx.t('genderMale'))),
            DropdownMenuItem(value: 'other', child: Text(widget.ctx.t('genderOther'))),
          ],
          onChanged: _saving ? null : (value) => setState(() => _gender = value),
        ),
        _section(context, c('location'), ['village', 'block', 'district', 'pincode']),
        DropdownButtonFormField<String>(
          key: const Key('profile-state'), initialValue: _state,
          decoration: InputDecoration(labelText: c('state')),
          items: [for (final state in indianStates) DropdownMenuItem(value: state, child: Text(state))],
          onChanged: _saving ? null : (value) => setState(() => _state = value),
          validator: (value) => value == null ? widget.ctx.t('required') : null,
        ),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 12),
          child: Semantics(liveRegion: true, child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)))),
        FilledButton(key: const Key('profile-save'), onPressed: _saving ? null : _save,
          child: Text(_saving ? c('saving') : widget.ctx.t('save'))),
      ]),
    ));
  }
}

const _longFields = {'workBackground'};
const _labels = ['name', 'mobile', 'education', 'workBackground', 'creditScore', 'village', 'block', 'district',
  'pincode'];
