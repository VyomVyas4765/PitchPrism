# Seed data

The development auth seed is `backend/src/seed.ts` (`pnpm seed`). It creates synthetic organisations and staff accounts only. Credentials come from `SEED_PASSWORD` in the ignored root `.env`; reruns preserve existing accounts. No applicant data is copied from the organiser dataset.

Future fixtures: Dev 1 owns the question bank; Dev 2 owns rubric/trades/schemes; Dev 3 owns organisation/programme/cohort seeds and loaders. Coordinate shared changes before adding files.
