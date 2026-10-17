import 'package:flutter/material.dart';

import '../core/api.dart';
import '../entrepreneur/common.dart';
import '../intake/outbox.dart';
import '../intake/pitch_screen.dart';
import '../intake/services.dart';
import 'applicant_screen.dart';

/// M-17/M-18: new applicants on a shared phone, the per-item offline queue, and
/// the submissions this facilitator created (server-scoped to them alone).
class FacilitatorHome extends StatefulWidget {
  const FacilitatorHome({super.key, required this.ctx, required this.displayName, required this.onSignOut, required this.services});
  final EntrepreneurContext ctx;
  final String displayName;
  final Future<void> Function() onSignOut;
  final IntakeServices services;
  @override
  State<FacilitatorHome> createState() => _FacilitatorHomeState();
}

class _FacilitatorHomeState extends State<FacilitatorHome> {
  EntrepreneurContext get ctx => widget.ctx;
  int _version = 0;

  @override
  void initState() {
    super.initState();
    widget.services.sync.syncAll().catchError((Object _) => <OutboxItem>[]);
  }

  Future<void> _open(Widget screen) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    if (mounted) setState(() => _version++);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(widget.displayName),
      actions: [IconButton(tooltip: ctx.t('signOut'), onPressed: widget.onSignOut, icon: const Icon(Icons.logout))],
    ),
    body: LoadView<Map<String, dynamic>>(
      key: ValueKey(_version),
      retryLabel: ctx.t('retry'),
      load: () async {
        try {
          return await ctx.api.request('/assisted/submissions');
        } on ApiException catch (error) {
          if (error.status == 401) await widget.onSignOut();
          rethrow;
        }
      },
      builder: (context, data, reload) {
        final items = (data['submissions'] as List).cast<Map<String, dynamic>>();
        return RefreshIndicator(
          onRefresh: () async => reload(),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              FilledButton.icon(
                key: const Key('facilitator-new'),
                onPressed: () => _open(ApplicantScreen(ctx: ctx, services: widget.services)),
                icon: const Icon(Icons.person_add),
                label: Text(ctx.t('newApplicant')),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                key: const Key('facilitator-outbox'),
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(56)),
                onPressed: () => _open(OutboxScreen(ctx: ctx, services: widget.services)),
                icon: const Icon(Icons.cloud_upload_outlined),
                label: Text(ctx.t('outbox')),
              ),
              const Divider(height: 32),
              if (items.isEmpty) Text(ctx.t('noIdeas')),
              for (final item in items)
                ListTile(
                  title: Text(item['title'] as String),
                  subtitle: Text([
                    ctx.t('status${item['status']}'),
                    if ((item['applicant'] as Map)['name'] != null) (item['applicant'] as Map)['name'] as String,
                  ].join(' · ')),
                ),
            ],
          ),
        );
      },
    ),
  );
}
