/**
 * Stands in for `pantessa/desk` while `pantessa@1.1.0` is not yet published.
 *
 * `vitest.config.ts` aliases the package here ONLY when it cannot be resolved,
 * and the alias evaporates the moment it can. Nothing in it works: the unit
 * tests inject their own driver, and `tests/drive.test.ts` — the one that
 * exercises the REAL loop against the mock desk — skips itself rather than
 * pretend. If you see this file's error in a test run, install the SDK.
 */
export function driveJob(): never {
  throw new Error(
    'pantessa@1.1.0 is not installed, so pantessa/desk is a stub. ' +
      'Install it (`pnpm add pantessa@^1.1.0`) and re-run — the alias in vitest.config.ts removes itself.',
  )
}
