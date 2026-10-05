import { writeFileSync } from 'node:fs';

// Writes one record per tc() test to $TC_RESULTS_PATH (used to build the test-case register).
export default class RegisterReporter {
  onFinished(files = []) {
    const path = process.env.TC_RESULTS_PATH;
    const out = [];
    const undocumented = [];
    const walk = (task) => {
      if (task.type === 'test' && !task.meta?.tc) undocumented.push(task.name);
      if (task.type === 'test' && task.meta?.tc) {
        const state = task.result?.state;
        out.push({
          ...task.meta.tc,
          layer: 'FE',
          status: state === 'pass' ? 'Pass' : state === 'fail' ? 'Fail' : 'Skipped',
          message: state === 'fail' ? (task.result.errors?.[0]?.message || '').split('\n')[0] : '',
        });
      }
      (task.tasks || []).forEach(walk);
    };
    files.forEach(walk);
    // A test without tc() would never reach the Word register, so treat it as a failure.
    if (undocumented.length) {
      console.error(`\nTests missing tc() documentation:\n  ${undocumented.join('\n  ')}`);
      process.exitCode = 1;
    }
    if (path) writeFileSync(path, JSON.stringify(out, null, 1));
  }
}
