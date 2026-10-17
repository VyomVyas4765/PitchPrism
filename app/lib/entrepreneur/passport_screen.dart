import 'package:flutter/material.dart';

import '../core/api.dart';
import 'common.dart';

/// M-15: who can see each idea and why, with one switch per partner type.
/// Turning a switch off revokes on the server before the screen reloads, so a
/// partner's access ends on its next request.
class PassportScreen extends StatelessWidget {
  const PassportScreen({super.key, required this.ctx, required this.noticeVersion});
  final EntrepreneurContext ctx;
  final String noticeVersion;

  Future<void> _toggle(BuildContext context, String scope, Map<String, dynamic>? active, VoidCallback reload) async {
    try {
      if (active != null) {
        await ctx.api.request('/consents/${active['id']}/revoke', body: {});
      } else {
        await ctx.api.request('/consents', body: {
          'purpose': 'partner_sharing', 'scope': scope, 'noticeVersion': noticeVersion,
          'language': ctx.language, 'method': 'app_tap',
        });
      }
    } on ApiException catch (error) {
      if (context.mounted) showMessage(context, error.message);
    } catch (_) {
      if (context.mounted) showMessage(context, 'Cannot reach PitchPrism.');
    }
    reload();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(ctx.t('passport'))),
    body: LoadView<Map<String, dynamic>>(
      retryLabel: ctx.t('retry'),
      load: () => ctx.api.request('/me/passport'),
      builder: (context, data, reload) {
        final sharing = (data['consents'] as Map<String, dynamic>)['sharing'] as Map<String, dynamic>;
        final ideas = (data['ideas'] as List).cast<Map<String, dynamic>>();
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            for (final scope in ['sector_partner', 'funding_partner'])
              SwitchListTile(
                key: Key('passport-$scope'),
                value: sharing[scope] != null,
                title: Text(ctx.t(scope == 'sector_partner' ? 'shareSector' : 'shareFunding')),
                subtitle: Text(ctx.t(sharing[scope] != null ? 'sharingOn' : 'sharingOff')),
                onChanged: (_) => _toggle(context, scope, sharing[scope] as Map<String, dynamic>?, reload),
              ),
            const Divider(height: 32),
            if (ideas.isEmpty) Text(ctx.t('noIdeas')),
            for (final idea in ideas)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(idea['title'] as String, style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Text(ctx.t('visibleTo')),
                      for (final org in (idea['visibleTo'] as List).cast<Map<String, dynamic>>())
                        ListTile(
                          dense: true,
                          leading: const Icon(Icons.verified_outlined),
                          title: Text(org['name'] as String? ?? '—'),
                          subtitle: Text(ctx.t(switch (org['reason']) {
                            'owning_centre' => 'reasonOwner',
                            'collected_by' => 'reasonCollected',
                            _ => 'reasonShared',
                          })),
                        ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    ),
  );
}

/// M-12 basis: own ideas and their current status.
class IdeasScreen extends StatelessWidget {
  const IdeasScreen({super.key, required this.ctx});
  final EntrepreneurContext ctx;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(ctx.t('myIdeas'))),
    body: LoadView<Map<String, dynamic>>(
      retryLabel: ctx.t('retry'),
      load: () => ctx.api.request('/me/submissions'),
      builder: (context, data, reload) {
        final items = (data['submissions'] as List).cast<Map<String, dynamic>>();
        if (items.isEmpty) return Center(child: Text(ctx.t('noIdeas')));
        return RefreshIndicator(
          onRefresh: () async => reload(),
          child: ListView(children: [
            for (final item in items)
              ListTile(
                title: Text(item['title'] as String),
                subtitle: Text(ctx.t('status${item['status']}')),
              ),
          ]),
        );
      },
    ),
  );
}
