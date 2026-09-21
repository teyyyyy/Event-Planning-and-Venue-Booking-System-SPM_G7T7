import { writeFileSync } from 'node:fs';

// Writes one record per tc() test to $TC_RESULTS_PATH (used to build the test-case register).
export default class RegisterReporter {
  onFinished(files = []) {
    const path = process.env.TC_RESULTS_PATH;
    if (!path) return;
    const out = [];
    const walk = (task) => {
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
    writeFileSync(path, JSON.stringify(out, null, 1));
  }
}
