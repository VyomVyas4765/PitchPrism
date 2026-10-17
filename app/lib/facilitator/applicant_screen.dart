import 'package:flutter/material.dart';

import '../core/speech.dart';
import '../entrepreneur/common.dart';
import '../intake/device.dart';
import '../intake/outbox.dart';
import '../intake/pitch_screen.dart';
import '../intake/record_tile.dart';
import '../intake/services.dart';
import '../l10n/strings.dart';

/// M-17: a new applicant on a shared phone. The notice is read aloud in the
/// applicant's language, their spoken "yes" is recorded and the facilitator
/// confirms it. Everything is queued on the phone, so it works offline.
class ApplicantScreen extends StatefulWidget {
  const ApplicantScreen({super.key, required this.ctx, required this.services});
  final EntrepreneurContext ctx; // the facilitator's own language
  final IntakeServices services;
  @override
  State<ApplicantScreen> createState() => _ApplicantScreenState();
}

class _ApplicantScreenState extends State<ApplicantScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _district = TextEditingController();
  final _pincode = TextEditingController();
  final _trade = TextEditingController();
  final _clientApplicantId = newClientId('applicant');
  late String _language = widget.ctx.language;
  OutboxFile? _consentRecording;
  bool _confirmed = false;
  final _sharing = <String>{};

  EntrepreneurContext get _applicantCtx =>
      EntrepreneurContext(api: widget.ctx.api, speech: widget.ctx.speech, language: _language);

  @override
  void dispose() {
    for (final controller in [_name, _district, _pincode, _trade]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _continue(String mode) async {
    if (!_form.currentState!.validate() || _consentRecording == null || !_confirmed) return;
    final district = _district.text.trim();
    final pincode = _pincode.text.trim();
    final item = OutboxItem(
      clientDraftId: newClientId('draft'), mode: mode, language: _language,
      applicant: OutboxApplicant(
        clientApplicantId: _clientApplicantId,
        fields: {
          'language': _language, 'name': _name.text.trim(), 'trade': _trade.text.trim(),
          if (district.isNotEmpty) 'district': district,
          if (pincode.isNotEmpty) 'pincode': pincode,
        },
        consentRecording: _consentRecording!,
        sharing: _sharing.toList(),
      ),
    );
    await widget.services.upsert(item);
    if (!mounted) return;
    await Navigator.of(context).pushReplacement(MaterialPageRoute<bool>(
      builder: (_) => PitchScreen(ctx: _applicantCtx, services: widget.services, item: item)));
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.ctx.t;
    final a = _applicantCtx.t; // the applicant hears and reads their own language
    final ready = _consentRecording != null && _confirmed;
    return Scaffold(
      appBar: AppBar(title: Text(t('newApplicant'))),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            DropdownButtonFormField<String>(
              key: const Key('applicant-language'),
              initialValue: _language,
              decoration: InputDecoration(labelText: t('chooseLanguage')),
              items: [for (final language in launchLanguages) DropdownMenuItem(value: language, child: Text(tr(language, 'languageName')))],
              onChanged: (value) => setState(() => _language = value!),
            ),
            const SizedBox(height: 8),
            TextFormField(key: const Key('applicant-name'), controller: _name, decoration: InputDecoration(labelText: a('name')),
              maxLength: 100, validator: (value) => (value ?? '').trim().isEmpty ? a('required') : null),
            TextFormField(key: const Key('applicant-district'), controller: _district, decoration: InputDecoration(labelText: a('district')),
              maxLength: 80, validator: (value) => (value ?? '').trim().isEmpty && _pincode.text.trim().isEmpty ? a('districtOrPincode') : null),
            TextFormField(key: const Key('applicant-pincode'), controller: _pincode, decoration: InputDecoration(labelText: a('pincode')),
              keyboardType: TextInputType.number, maxLength: 6,
              validator: (value) => (value ?? '').trim().isEmpty || RegExp(r'^[1-9]\d{5}$').hasMatch(value!.trim()) ? null : a('pincodeInvalid')),
            TextFormField(key: const Key('applicant-trade'), controller: _trade, decoration: InputDecoration(labelText: a('trade')),
              maxLength: 80, validator: (value) => (value ?? '').trim().isEmpty ? a('required') : null),
            const Divider(height: 32),
            Row(children: [
              Expanded(child: Text(a('consentTitle'), style: Theme.of(context).textTheme.titleLarge)),
              ListenButton(context_: _applicantCtx, text: '${a('consentNotice')} ${a('consentProcessing')}'),
            ]),
            Text(a('consentNotice')),
            const SizedBox(height: 8),
            Text(t('consentRecordHelp')),
            const SizedBox(height: 8),
            RecordTile(
              key: const Key('applicant-consent-recording'),
              ctx: widget.ctx,
              recorder: widget.services.recorder(),
              directory: widget.services.directory,
              fileStem: '$_clientApplicantId-consent',
              maxSeconds: 120,
              existing: _consentRecording,
              onRecorded: (file) => setState(() => _consentRecording = file),
            ),
            CheckboxListTile(
              key: const Key('applicant-confirm'),
              value: _confirmed,
              onChanged: _consentRecording == null ? null : (value) => setState(() => _confirmed = value ?? false),
              title: Text(t('consentConfirm')),
              controlAffinity: ListTileControlAffinity.leading,
            ),
            for (final scope in ['sector_partner', 'funding_partner'])
              SwitchListTile(
                key: Key('applicant-share-$scope'),
                value: _sharing.contains(scope),
                onChanged: ready ? (value) => setState(() => value ? _sharing.add(scope) : _sharing.remove(scope)) : null,
                title: Text(a(scope == 'sector_partner' ? 'shareSector' : 'shareFunding')),
              ),
            const SizedBox(height: 16),
            for (final (key, mode, icon) in [('speak', 'guided', Icons.mic), ('type', 'typed', Icons.keyboard), ('upload', 'upload', Icons.upload_file)])
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: FilledButton.icon(
                  key: Key('applicant-$mode'),
                  onPressed: ready ? () => _continue(mode) : null,
                  icon: Icon(icon),
                  label: Text(a(key)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
