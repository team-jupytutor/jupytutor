import { CodeCellModel, ICellModel } from '@jupyterlab/cells';
import { INotebookModel } from '@jupyterlab/notebook';
import z from 'zod';
import { PluginConfig, RuleConfigOverrideSchema } from '../schemas/config';
import { PredicateSchema } from '../schemas/predicate';

type RuleConfigOverride = z.output<typeof RuleConfigOverrideSchema>;
type Predicate = z.output<typeof PredicateSchema>;

type CellContext = {
  type: 'code' | 'markdown' | 'unknown';
  text: string;
  editable: boolean;
  tags: string[];
  outputText: string;
  hasError: boolean;
};

export const applyConfigRules = (
  notebookModel: INotebookModel,
  cellIndex: number,
  configRules: PluginConfig['rules']
): RuleConfigOverride => {
  const baseConfig = RuleConfigOverrideSchema.parse({});
  const cellContextCache = new Map<number, CellContext>();

  const getCellContext = (index: number): CellContext | null => {
    if (index < 0 || index >= notebookModel.cells.length) {
      return null;
    }

    if (cellContextCache.has(index)) {
      return cellContextCache.get(index) ?? null;
    }

    const cell = notebookModel.cells.get(index);
    if (!cell) {
      return null;
    }

    const context = buildCellContext(cell);
    cellContextCache.set(index, context);
    return context;
  };

  let mergedConfig = baseConfig;

  for (const rule of configRules) {
    const predicate = rule.when;
    const parsedRuleConfig = RuleConfigOverrideSchema.partial().parse(
      rule.config ?? {}
    );

    if (!predicate || evaluatePredicate(predicate, getCellContext, cellIndex)) {
      mergedConfig = mergeRuleConfigs(mergedConfig, parsedRuleConfig);
    }
  }

  // Apply cell-level metadata overrides last, so they take priority over notebook rules
  const cell = notebookModel.cells.get(cellIndex);
  if (cell) {
    const cellMetadataOverride = cell.getMetadata('jupytutor');
    if (
      cellMetadataOverride !== null &&
      typeof cellMetadataOverride === 'object' &&
      !Array.isArray(cellMetadataOverride)
    ) {
      const raw = cellMetadataOverride as Record<string, unknown>;
      // Validate the raw metadata as a partial RuleConfigOverride
      const parseResult = RuleConfigOverrideSchema.partial().safeParse(raw);
      if (parseResult.success) {
        // Only apply keys explicitly present in the cell metadata so that Zod
        // defaults for unset fields do not clobber values already established by rules.
        const explicitOverride: Partial<RuleConfigOverride> = {};
        for (const key of Object.keys(raw)) {
          if (key in RuleConfigOverrideSchema.shape) {
            (explicitOverride as any)[key] = (parseResult.data as any)[key];
          }
        }
        mergedConfig = mergeRuleConfigs(mergedConfig, explicitOverride);
      }
    }
  }

  return mergedConfig;
};

const mergeRuleConfigs = (
  current: RuleConfigOverride,
  update: Partial<RuleConfigOverride>
): RuleConfigOverride => {
  let instructorNote = current.instructorNote;

  if (update.instructorNote !== undefined) {
    const priorNotesPlaceholder = '{{prior_notes}}';
    if (update.instructorNote.includes(priorNotesPlaceholder)) {
      instructorNote = update.instructorNote.replace(
        priorNotesPlaceholder,
        instructorNote
      );
    } else {
      instructorNote = update.instructorNote;
    }
  }

  return {
    ...current,
    ...update,
    instructorNote
  };
};

const buildCellContext = (cell: ICellModel): CellContext => {
  const type =
    cell.type === 'code'
      ? 'code'
      : cell.type === 'markdown'
        ? 'markdown'
        : 'unknown';
  const text = cell.sharedModel.getSource();
  const editable =
    cell.getMetadata('editable') !== undefined
      ? Boolean(cell.getMetadata('editable'))
      : true;
  const tags =
    (Array.isArray(cell.getMetadata('tags'))
      ? (cell.getMetadata('tags') as any[])
      : []
    ).filter((tag): tag is string => typeof tag === 'string');

  let outputText = '';
  let hasError = false;

  if (type === 'code') {
    const codeCell = cell as CodeCellModel;
    outputText = extractOutputsAsText(codeCell);
    hasError = detectOutputError(codeCell);
  }

  return { type, text, editable, tags, outputText, hasError };
};

const extractOutputsAsText = (cell: CodeCellModel): string => {
  const outputs: string[] = [];

  for (let i = 0; i < cell.outputs.length; i++) {
    const output = cell.outputs.get(i);
    outputs.push(extractOutputText(output));
  }

  return outputs.filter(Boolean).join('\n');
};

const extractOutputText = (output: any): string => {
  const json = typeof output?.toJSON === 'function' ? output.toJSON() : output;

  if (!json) {
    return '';
  }

  const data = (json as any).data;
  const textPlain =
    typeof data === 'object' && data !== null
      ? (data as any)['text/plain'] ?? (data as any).text
      : undefined;

  if (textPlain !== undefined) {
    return Array.isArray(textPlain) ? textPlain.join('\n') : String(textPlain);
  }

  if ((json as any).text !== undefined) {
    const textValue = (json as any).text;
    return Array.isArray(textValue) ? textValue.join('\n') : String(textValue);
  }

  if ((json as any).evalue !== undefined) {
    return String((json as any).evalue);
  }

  return JSON.stringify(json);
};

const detectOutputError = (cell: CodeCellModel): boolean => {
  for (let i = 0; i < cell.outputs.length; i++) {
    const output = cell.outputs.get(i);
    const json = typeof output?.toJSON === 'function' ? output.toJSON() : null;
    const outputType =
      (json as any)?.output_type ?? (output as any)?.type ?? undefined;

    if (outputType === 'error') {
      return true;
    }
  }

  return false;
};

const evaluatePredicate = (
  predicate: Predicate,
  contextForIndex: (idx: number) => CellContext | null,
  cellIndex: number
): boolean => {
  if ('AND' in predicate && Array.isArray(predicate.AND)) {
    return predicate.AND.every(inner =>
      evaluatePredicate(inner, contextForIndex, cellIndex)
    );
  }

  if ('OR' in predicate && Array.isArray(predicate.OR)) {
    return predicate.OR.some(inner =>
      evaluatePredicate(inner, contextForIndex, cellIndex)
    );
  }

  if ('NOT' in predicate && predicate.NOT) {
    return !evaluatePredicate(predicate.NOT, contextForIndex, cellIndex);
  }

  if ('nearbyCell' in predicate && predicate.nearbyCell) {
    const nearbyIndex = cellIndex + predicate.nearbyCell.relativePosition;
    return evaluatePredicate(
      predicate.nearbyCell.matches,
      contextForIndex,
      nearbyIndex
    );
  }

  const context = contextForIndex(cellIndex);
  if (!context) {
    return false;
  }

  if ('cellType' in predicate) {
    const expected = predicate.cellType;
    const expectedValue =
      typeof expected === 'string' ? expected : expected.is ?? undefined;
    return expectedValue === context.type;
  }

  if ('output' in predicate) {
    if (!context.outputText) {
      return false;
    }

    return evaluateStringPredicate(context.outputText, predicate.output);
  }

  if ('hasError' in predicate) {
    return predicate.hasError === context.hasError;
  }

  if ('content' in predicate) {
    return evaluateStringPredicate(context.text, predicate.content);
  }

  if ('isEditable' in predicate) {
    return predicate.isEditable === context.editable;
  }

  if ('tags' in predicate) {
    return evaluateArrayPredicate(context.tags, predicate.tags);
  }

  return false;
};

const evaluateArrayPredicate = (
  values: string[],
  predicate:
    | { any: string | { is: string } | { matchesRegex: { pattern: string; flags?: string } } }
    | { all: string | { is: string } | { matchesRegex: { pattern: string; flags?: string } } }
): boolean => {
  if ('any' in predicate) {
    return values.some(value =>
      evaluateStringPredicate(value, predicate.any as any)
    );
  }

  if ('all' in predicate) {
    return values.every(value =>
      evaluateStringPredicate(value, predicate.all as any)
    );
  }

  return false;
};

const evaluateStringPredicate = (
  value: string,
  predicate:
    | string
    | { is: string }
    | {
        matchesRegex: {
          pattern: string;
          flags?: string;
        };
      }
): boolean => {
  if (typeof predicate === 'string') {
    return value === predicate;
  }

  if ('is' in predicate) {
    return value === predicate.is;
  }

  if ('matchesRegex' in predicate) {
    try {
      const { pattern, flags = '' } = predicate.matchesRegex;
      const regex = new RegExp(pattern, flags);
      return regex.test(value);
    } catch {
      return false;
    }
  }

  return false;
};
