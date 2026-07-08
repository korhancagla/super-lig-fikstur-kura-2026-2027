# 2026-2027 Süper Lig Fixture Draw Simulator

This is a local React + TypeScript app for simulating a transparent Turkish Süper Lig fixture draw for a custom 18-team, 34-week 2026-2027 season.

It does not reproduce the real TFF private fixture algorithm. It adapts the visible 2026-2027 TFF fixture-detail rules into an auditable constraint-based simulator.

The app uses the public PDF rules only as visible constraints. It does not claim to reproduce TFF's private artificial-intelligence supported fixture-key algorithm.

## Run Locally

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal, usually:

```text
http://localhost:5173
```

For a production check:

```bash
npm run build
```

## What The App Does

- Edits teams, pots, İstanbul flags, big-three and big-four tags, European tags, and shared-stadium tags.
- Generates seeded draw numbers from 1 to 18.
- Generates a 34-week double round-robin fixture.
- Mirrors weeks 18-34 from weeks 1-17 with home/away reversed.
- Validates all implemented hard and soft constraints.
- Highlights big-four matches, İstanbul derbies, and European restricted-week warnings.
- Exports the visible fixture table as a PDF image with the Korhan Cagla brand mark.

## Implementation Shape

- Team and pot data: `src/data/teams.ts`
- Fixture engine and validators: `src/lib/fixtureEngine.ts`
- React UI: `src/App.tsx`

The engine uses:

- Seeded pseudo-random generation for repeatability.
- Home/away pattern generation for first-half sequence constraints.
- Exact-cover search for assigning every first-half pair to a valid week.
- Mirroring for the second half.
- A standard circle-method fallback if the exact-cover search cannot find a perfect hard-valid key within the attempt budget.

## Visible Rules Adapted From The 2026-2027 TFF PDF

The simulator adapts these visible 2026-2027 rule ideas:

- The fixture key is symmetric.
- A mathematical/algorithmic fixture key is used.
- No team should repeatedly follow another team.
- The first two weeks and last three weeks should avoid consecutive home or away matches.
- A team should not have more than one repeated home or repeated away sequence in a league half.
- A team should not play Beşiktaş, Fenerbahçe, Galatasaray and Trabzonspor in consecutive weeks.
- A team should not play three of those four teams inside any seven-week window.
- In a half, a team's matches against the big four should not be all home or all away.
- Trabzonspor should not play all three matches against Beşiktaş, Fenerbahçe and Galatasaray home or away in one half.
- Big-four derbies avoid the forbidden weeks.
- Big-three derbies should be home/away balanced.
- Big-four matches are assigned to selected 2026-2027 weeks.
- The big three should not all be home at the same time.
- European-team restrictions avoid difficult rest-balance weeks.
- İstanbul home-team limits are applied.
- İstanbul teams have a consecutive city-presence limit.
- Kasımpaşa and Eyüpspor sharing a home ground is handled as a separation rule.

## 18-Team Adaptations

This simulator adapts the manually provided rule set to:

- 18 teams.
- 34 total weeks.
- 17 first-half weeks.
- 17 mirrored second-half weeks.
- 9 matches per week.
- Big-four target weeks: 4, 6, 8, 9, 13, 15.
- Full-season forbidden derby weeks: 1, 2, 11, 17, 18, 22, 28, 31.
- Full-season European restricted weeks: 1, 2, 8, 18, 22, 25, 28.
- İstanbul home limit: at most 4 of the 6 İstanbul teams home in a week.
- İstanbul consecutive city presence: soft limit of 6.

## Hard Constraints

- Symmetric fixture.
- Basic round-robin validity.
- Home/away sequence limits.
- Big-three home limit.
- Big-three derby home/away balance.
- Forbidden derby-week separation.
- Big-four matches in the target first-half weeks.
- European restricted-week separation.
- İstanbul home limit.
- Same-stadium separation.

If the exact-cover search cannot satisfy every hard constraint within the attempt budget, the app returns the best-scored fallback schedule and shows the failed constraints clearly.

## Soft Constraints

- No team should regularly follow another team's opponent path. The public PDF does not define an exact numeric threshold, so this simulator reports it with a transparent soft limit.
- Big-four opponent home/away distribution.
- Big-four opponent spacing: no consecutive weeks and no three big-four opponents in a seven-week window.
- İstanbul consecutive city presence of at most 6 matches.

The generator tries to maximize compliance, but reports violations instead of discarding an otherwise valid fixture.

## Known Limitations

- The real TFF fixture algorithm is not public.
- The PDF describes visible constraints but not the full private implementation.
- This app is a transparent simulation, not an official TFF fixture generator.
- The rule set is adapted to an 18-team, 34-week custom 2026-2027 Süper Lig setup.
- Some constraints may conflict with each other; in that case the app should return the best possible schedule and explain the failed constraints.
- The solver uses a bounded search budget, so very unusual UI edits can make a perfect schedule hard or impossible to find.
