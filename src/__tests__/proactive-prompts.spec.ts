import { setProactiveEnabled } from '../index';
import { ConfigSchema } from '../schemas/config';

describe('setProactiveEnabled', () => {
  it('updates only the notebook-level proactive preference', () => {
    const config = ConfigSchema.parse({
      pluginEnabled: true,
      preferences: { proactiveEnabled: false }
    });

    const updated = setProactiveEnabled(config, true);

    expect(updated.preferences.proactiveEnabled).toBe(true);
    expect(updated.pluginEnabled).toBe(true);
    expect(config.preferences.proactiveEnabled).toBe(false);
  });
});
