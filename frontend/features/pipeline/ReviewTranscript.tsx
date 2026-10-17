'use client';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import styles from './live-stages.module.css';

type Verdict = { verdict: 'sufficient' | 'vague' | 'missing' | 'contradictory' | 'declined'; reason: string };
type Review = { status: 'reviewing' | 'needs_input' | 'complete'; round: number; businessType: string | null; verdicts: Record<string, Verdict>;
  declined: Record<string, string>; questions: Array<{ qId: string; field: string; round: number; questionEn: string; reason: string | null; status: string; answer: string | null }>;
  waitingAnswers: number; model: string | null; calls: { count: number; seconds: number } };

const label = (value: string) => value.replaceAll('_', ' ');
const TONE: Record<Verdict['verdict'], string> = { sufficient: styles.done!, declined: styles.queued!, vague: styles.failed!, missing: styles.failed!, contradictory: styles.failed! };

/** D-33: how the AI review completed the pitch: topics, questions asked and the entrepreneur's (redacted) answers. */
export default function ReviewTranscript({ submissionId, refresh }: { submissionId: string; refresh?: number }) {
  const [review, setReview] = useState<Review | null>(null);
  const [state, setState] = useState<'loading' | 'none' | 'error' | 'ready'>('loading');
  useEffect(() => {
    let active = true;
    setState('loading');
    api<Review>(`/submissions/${submissionId}/review`)
      .then(result => { if (active) { setReview(result); setState('ready'); } })
      .catch(reason => { if (active) setState(reason instanceof ApiError && reason.status === 404 ? 'none' : 'error'); });
    return () => { active = false; };
  }, [submissionId, refresh]);
  if (state === 'none' || state === 'loading') return null; // ideas not reviewed from a text pitch show nothing here
  if (state === 'error' || !review) return <p className={styles.muted}>The pitch review could not be loaded.</p>;
  const rounds = [...new Set(review.questions.map(question => question.round))];
  return <section className={styles.live} aria-label="Pitch review">
    <div className={styles.head}>
      <h4>Pitch review <span className={`${styles.status} ${review.status === 'complete' ? styles.done : styles.queued}`}>{review.status === 'needs_input' ? 'waiting for answers' : review.status}</span></h4>
      <span className={styles.muted}>{review.questions.length} question{review.questions.length === 1 ? '' : 's'} over {rounds.length} round{rounds.length === 1 ? '' : 's'} · {review.calls.count} model calls, {review.calls.seconds} s{review.model ? ` · ${review.model}` : ''}</span>
    </div>
    <ul className={styles.topics}>{Object.entries(review.verdicts).map(([field, verdict]) => <li key={field} className={TONE[verdict.verdict]}
      title={verdict.reason || undefined}><span>{label(field)}</span><small>{verdict.verdict}</small></li>)}</ul>
    {Object.keys(review.declined).length > 0 && <p className={styles.muted}>Not decided by the entrepreneur: {Object.entries(review.declined).map(([field, reason]) => `${label(field)} (${reason.toLowerCase()})`).join('; ')}. These count as missing evidence in the score.</p>}
    {rounds.map(round => <div key={round}>
      <p className={styles.muted} style={{ margin: '10px 0 4px' }}>Round {round}</p>
      <ol className={styles.qa}>{review.questions.filter(question => question.round === round).map(question => <li key={question.qId}>
        <strong>{question.questionEn}</strong> <small className={styles.muted}>({label(question.field)}{question.reason ? `: ${question.reason}` : ''})</small>
        <p>{question.answer ?? <span className={styles.muted}>{question.status === 'skipped' ? 'Not answered; asked again.' : 'Waiting for an answer.'}</span>}</p>
      </li>)}</ol>
    </div>)}
  </section>;
}
