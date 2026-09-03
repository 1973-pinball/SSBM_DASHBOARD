# Tournament Forecast Research Plan

> Status: **planned, not started**. This phase is local-only. Do not upload forecast data or model output to Supabase until chronological out-of-sample results show that the system is useful.

## Goal

Build and evaluate models that forecast an upcoming Melee major using results from prior majors. The initial output is an internal research tool: it should explain each model, show honest in-sample and out-of-sample performance, and produce reproducible event predictions.

The first live case study will be the next Riptide, but the pipeline must work for any major rather than learning Riptide-specific rules.

## Data sources

- **Liquipedia snapshot already in the repository:** canonical major names, dates, tiers, winners, and runner-ups.
- **Start.gg:** entrants, seeds, completed sets, scores, bracket rounds, placements, and the official bracket for an upcoming event.
- **Nikki replay archive:** optional explanatory replay-derived features for safely identified players. These features enter a predictive model only if leakage-safe backtests show an out-of-sample improvement.

Start.gg ingestion will require a developer token stored locally in an ignored `.env.forecast.local` file. No credential belongs in source control.

## Build roadmap

1. **Major registry**
   Match the bundled Liquipedia major list to the corresponding Start.gg tournaments and events. Record source IDs, dates, tier, format, and mapping confidence.

2. **Start.gg downloader**
   Download entrants, seeds, full completed-set results, scores, rounds, bracket structure, and final standings. Cache source responses locally so experiments are reproducible and do not repeatedly hit the API.

3. **Canonical local dataset**
   Normalize events, players, aliases, entrants, seeds, sets, and standings into a compact local research dataset. Preserve source identifiers and provenance on every record.

4. **Cleaning and identity resolution**
   Remove byes, DQs, unfinished sets, and duplicates. Resolve player aliases conservatively, report ambiguous mappings, and keep unresolved players anonymous rather than guessing.

5. **Model suite**
   Evaluate models of increasing complexity:

   - Neutral 50/50 baseline
   - Higher-seed baseline
   - Recency-weighted Elo
   - Glicko-2
   - Dynamic Bradley-Terry
   - Regularized Bradley-Terry with recent-form features

6. **Evaluation framework**
   Report both fit and generalization quality:

   - In-sample accuracy, Brier score, log loss, AUC, and calibration
   - Chronological out-of-sample versions of the same metrics
   - Prediction coverage and exclusions
   - Performance against the neutral and seed baselines

7. **Historical major backtests**
   Forecast each historical major using only information available before that event. Record predicted winner probabilities, top-eight probabilities, calibration, and realized outcomes.

8. **Upcoming-event simulator**
   Support two forecast modes:

   - A provisional field simulation before the official bracket is published
   - An exact double-elimination simulation after entrants, seeds, and bracket positions are official

9. **Local comparison report**
   Produce an internal report that compares methodology, validation results, calibration, historical forecasts, and the current upcoming-event prediction. Keep assumptions and forecast cutoffs visible.

10. **Storage report**
    Measure the actual local dataset and model-output sizes, then estimate Supabase table and index storage. Do not upload anything during this phase.

## Validation rules

- Every historical prediction must use a strict pre-event cutoff.
- Model selection must be based on chronological out-of-sample performance, not training fit.
- Seeds are a strong real-world baseline and must be included in every comparison.
- Report uncertainty and calibration, not only the most likely winner.
- More complex features stay out unless they improve leakage-safe out-of-sample results.
- If no model reliably beats both the neutral and seed baselines, label the forecaster experimental and do not productize it.

## Expected storage

The first pass should contain tens of thousands of sets and a few thousand player/entrant rows. A compact local dataset is expected to be roughly **10–50 MB**, with a future indexed Postgres/Supabase version likely remaining **under 100 MB**. These are planning estimates; the storage report will replace them with measured figures after ingestion.

## Deliverables before any product work

- Reproducible source-to-dataset pipeline
- Data quality and identity-resolution report
- Side-by-side model methodology guide
- In-sample and chronological out-of-sample scorecard
- Calibration plots and baseline comparisons
- Historical major backtest report
- Upcoming-event forecast with assumptions and cutoff
- Measured local size and projected Supabase storage
- Recommendation to proceed, revise, or stop

## Current state

The repository has an early Nikki-archive Bradley-Terry experiment and bracket simulator, but the all-major results ingestion, comparative model suite, walk-forward evaluation, and internal report described above have **not started**.

