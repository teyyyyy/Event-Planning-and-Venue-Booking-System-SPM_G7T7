import { it } from 'vitest';

// Declares a unit test together with the fields of the unit-test-case template.
// The register reporter reads these back out so the Word document is generated from the tests.
export function tc(id, unit, scenario, expected, info, fn) {
  it(`${id} ${scenario}`, async (ctx) => {
    ctx.task.meta.tc = {
      id, unit, scenario, expected,
      preconditions: info.pre || 'None',
      steps: info.steps,
      data: info.data || 'N/A',
      type: info.kind || 'Positive',
      remarks: info.remarks || '',
    };
    await fn(ctx);
  });
}
