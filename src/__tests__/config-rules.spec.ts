import { applyConfigRules } from '../helpers/config-rules';
import { PluginConfig } from '../schemas/config';

/**
 * Minimal mock of an ICellModel for testing applyConfigRules.
 */
const makeMockCell = (
  overrides: {
    type?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
  } = {}
) => {
  const metadata: Record<string, unknown> = overrides.metadata ?? {};
  if (overrides.tags !== undefined) {
    metadata['tags'] = overrides.tags;
  }
  return {
    type: overrides.type ?? 'code',
    sharedModel: { getSource: () => overrides.source ?? '' },
    getMetadata: (key: string) => metadata[key],
    outputs: { length: 0, get: () => null }
  };
};

/**
 * Minimal mock of an INotebookModel with a list of cells.
 */
const makeMockNotebook = (cells: ReturnType<typeof makeMockCell>[]) => ({
  cells: {
    length: cells.length,
    get: (index: number) => cells[index] ?? null
  }
});

const noRules: PluginConfig['rules'] = [];

describe('applyConfigRules – cell-level metadata', () => {
  it('returns default config when no rules and no cell metadata', () => {
    const notebook = makeMockNotebook([makeMockCell()]);
    const result = applyConfigRules(notebook as any, 0, noRules);
    expect(result.chatEnabled).toBe(false);
    expect(result.chatProactive).toBe(true);
    expect(result.instructorNote).toBe('');
    expect(result.quickResponses).toEqual([]);
  });

  it('applies cell-level metadata overrides', () => {
    const notebook = makeMockNotebook([
      makeMockCell({
        metadata: {
          jupytutor: {
            chatEnabled: true,
            instructorNote: 'Cell note',
            quickResponses: ['Help me']
          }
        }
      })
    ]);
    const result = applyConfigRules(notebook as any, 0, noRules);
    expect(result.chatEnabled).toBe(true);
    expect(result.instructorNote).toBe('Cell note');
    expect(result.quickResponses).toEqual(['Help me']);
  });

  it('cell-level metadata takes priority over notebook rules', () => {
    const notebook = makeMockNotebook([
      makeMockCell({
        metadata: {
          jupytutor: {
            instructorNote: 'Cell override'
          }
        }
      })
    ]);
    const rules: PluginConfig['rules'] = [
      { config: { chatEnabled: true, instructorNote: 'Rule note' } }
    ];
    const result = applyConfigRules(notebook as any, 0, rules);
    expect(result.instructorNote).toBe('Cell override');
    expect(result.chatEnabled).toBe(true); // from rule, not overridden by cell
  });

  it('cell-level metadata supports {{prior_notes}} placeholder', () => {
    const notebook = makeMockNotebook([
      makeMockCell({
        metadata: {
          jupytutor: {
            instructorNote: '{{prior_notes}} -- cell addendum'
          }
        }
      })
    ]);
    const rules: PluginConfig['rules'] = [
      { config: { instructorNote: 'From rule' } }
    ];
    const result = applyConfigRules(notebook as any, 0, rules);
    expect(result.instructorNote).toBe('From rule -- cell addendum');
  });

  it('ignores cell metadata when it is not an object', () => {
    const notebook = makeMockNotebook([
      makeMockCell({
        metadata: { jupytutor: 'not an object' }
      })
    ]);
    const result = applyConfigRules(notebook as any, 0, noRules);
    expect(result.chatEnabled).toBe(false);
  });

  it('ignores missing jupytutor cell metadata', () => {
    const notebook = makeMockNotebook([makeMockCell()]);
    const result = applyConfigRules(notebook as any, 0, noRules);
    expect(result.chatEnabled).toBe(false);
  });

  it('cell metadata partial override leaves other fields from rules intact', () => {
    const notebook = makeMockNotebook([
      makeMockCell({
        metadata: {
          jupytutor: { quickResponses: ['From cell'] }
        }
      })
    ]);
    const rules: PluginConfig['rules'] = [
      { config: { chatEnabled: true, instructorNote: 'From rule' } }
    ];
    const result = applyConfigRules(notebook as any, 0, rules);
    expect(result.chatEnabled).toBe(true);
    expect(result.instructorNote).toBe('From rule');
    expect(result.quickResponses).toEqual(['From cell']);
  });
});
