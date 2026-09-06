## What changes

<!-- One or two sentences. What behaviour is different after this? -->

## Why

<!-- The problem, not the patch. If it fixes an issue, link it. -->

## Checklist

- [ ] `npm test` passes
- [ ] `npm run typecheck` and `npm run lint` are clean
- [ ] New behaviour has a test that fails without the change
- [ ] No hardcoded power or current limits — ceilings come from what the device reports
- [ ] No silent fallbacks: errors travel as errors, not as `0`, `null` or `[]`
- [ ] Layer boundaries respected (`tools/` → `device/` → `transport/`, never upward)

## Tested against a real charger?

<!-- Optional but valuable. Which model and firmware, and which tools you exercised.
     Please don't run write tools against someone else's charger. -->
