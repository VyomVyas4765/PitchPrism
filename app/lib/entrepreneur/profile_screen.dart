import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

/// Matches the server's accepted list (entrepreneur module INDIAN_STATES).
const indianStates = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli and Daman and Diu', 'Lakshadweep'];

/// M-04 (tap part): name, district or PIN code, trade, optional gender.
/// Validation mirrors the server; voice entry waits for a validated local STT.
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
  late final _name = TextEditingController(text: widget.profile['name'] as String?);
  late final _district = TextEditingController(text: widget.profile['district'] as String?);
  late final _pincode = TextEditingController(text: widget.profile['pincode'] as String?);
  late final _trade = TextEditingController(text: widget.profile['trade'] as String?);
  late String? _gender = widget.profile['gender'] as String?;
  late String? _state = widget.profile['state'] as String?;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final controller in [_name, _district, _pincode, _trade]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final district = _district.text.trim();
    final pincode = _pincode.text.trim();
    try {
      await widget.ctx.api.request('/me', method: 'PUT', body: {
        'name': _name.text.trim(),
        if (district.isNotEmpty) 'district': district,
        if (pincode.isNotEmpty) 'pincode': pincode,
        'trade': _trade.text.trim(),
        'gender': _gender,
        if (_state != null) 'state': _state,
      });
      widget.onDone();
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } catch (_) {
      setState(() => _error = 'Cannot reach PitchPrism.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String? _required(String? value) => (value ?? '').trim().isEmpty ? widget.ctx.t('required') : null;

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    final theme = Theme.of(context);
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Row(children: [
            Expanded(child: Text(t('profileTitle'), style: theme.textTheme.headlineMedium)),
            ListenButton(context_: widget.ctx, text: '${t('name')}. ${t('district')}. ${t('pincode')}. ${t('trade')}.'),
          ]),
          const SizedBox(height: 16),
          TextFormField(key: const Key('profile-name'), controller: _name, decoration: InputDecoration(labelText: t('name')),
            validator: _required, maxLength: 100, textCapitalization: TextCapitalization.words),
          const SizedBox(height: 8),
          TextFormField(key: const Key('profile-district'), controller: _district, decoration: InputDecoration(labelText: t('district')),
            maxLength: 80,
            validator: (value) => (value ?? '').trim().isEmpty && _pincode.text.trim().isEmpty ? t('districtOrPincode') : null),
          const SizedBox(height: 8),
          TextFormField(key: const Key('profile-pincode'), controller: _pincode, decoration: InputDecoration(labelText: t('pincode')),
            keyboardType: TextInputType.number, maxLength: 6,
            validator: (value) {
              final text = (value ?? '').trim();
              return text.isEmpty || RegExp(r'^[1-9]\d{5}$').hasMatch(text) ? null : t('pincodeInvalid');
            }),
          const SizedBox(height: 8),
          TextFormField(key: const Key('profile-trade'), controller: _trade, decoration: InputDecoration(labelText: t('trade')),
            validator: _required, maxLength: 80),
          const SizedBox(height: 8),
          DropdownButtonFormField<String?>(
            key: const Key('profile-state'),
            initialValue: _state,
            decoration: InputDecoration(labelText: t('state')),
            items: [for (final state in indianStates) DropdownMenuItem(value: state, child: Text(state))],
            onChanged: _saving ? null : (value) => setState(() => _state = value),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String?>(
            key: const Key('profile-gender'),
            initialValue: _gender,
            decoration: InputDecoration(labelText: t('gender')),
            items: [
              DropdownMenuItem(value: null, child: Text(t('genderSkip'))),
              DropdownMenuItem(value: 'female', child: Text(t('genderFemale'))),
              DropdownMenuItem(value: 'male', child: Text(t('genderMale'))),
              DropdownMenuItem(value: 'other', child: Text(t('genderOther'))),
            ],
            onChanged: _saving ? null : (value) => setState(() => _gender = value),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Semantics(liveRegion: true, child: Text(_error!, style: TextStyle(color: theme.colorScheme.error))),
            ),
          const SizedBox(height: 24),
          FilledButton(key: const Key('profile-save'), onPressed: _saving ? null : _save, child: Text(t('save'))),
        ],
      ),
    );
  }
}
