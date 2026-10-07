import { writeFileSync } from 'node:fs';

// Writes one record per tc() test to $TC_RESULTS_PATH (used to build the test-case register).
// Uses the Vitest 4 reporter API. If a Vitest upgrade stops calling this hook again, the register job in CI fails
// with "missing result files" instead of the tc() check silently turning off.
export default class RegisterReporter {
  onTestRunEnd(testModules = []) {
    const path = process.env.TC_RESULTS_PATH;
    const out = [];
    const undocumented = [];
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests()) {
        const tc = test.meta().tc;
        if (!tc) {
          undocumented.push(test.fullName);
          continue;
        }
        const result = test.result();
        out.push({
          ...tc,
          layer: 'FE',
          status: result.state === 'passed' ? 'Pass' : result.state === 'failed' ? 'Fail' : 'Skipped',
          message: result.state === 'failed' ? (result.errors?.[0]?.message || '').split('\n')[0] : '',
        });
      }
    }
    // A test without tc() would never reach the Word register, so treat it as a failure.
    if (undocumented.length) {
      console.error(`\nTests missing tc() documentation:\n  ${undocumented.join('\n  ')}`);
      process.exitCode = 1;
    }
    if (path) writeFileSync(path, JSON.stringify(out, null, 1));
  }
}
