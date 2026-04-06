import { useJupytutorReactState } from '../../store';
import { ParsedCell } from '../parseNB';
import GlobalNotebookContextRetrieval, {
  STARTING_TEXTBOOK_CONTEXT
} from './globalNotebookContextRetrieval';

// NOTE: These prompt-context type definitions are duplicated in
// `jupytutor_server/src/types/prompt-context.js` for server-side validation/parsing.
// Keep both files in sync when editing this format.
export type MultimodalContentChunk =
  | {
      type: 'input_text';
      content: string;
    }
  | {
      type: 'input_image';
      image_url: string;
    };

export type MultimodalContent = MultimodalContentChunk[];

type PromptContextCellBase = {
  type: string;
  currentContent: MultimodalContent;
  instructorNote?: string;
  activeCell?: true;
};

export type PromptContextContentUpdatedHistoryEvent = {
  timestamp: number;
  type: 'content updated';
  content: MultimodalContent;
};

export type PromptContextChatHistoryEvent = {
  timestamp: number;
  type: 'chat';
  content: string;
};

export type PromptContextChatHistorySender = 'assistant' | 'user';

export type PromptContextChatHistoryEventWithSender =
  PromptContextChatHistoryEvent & {
    sender: PromptContextChatHistorySender;
  };

export type PromptContextMarkdownCellHistory =
  | PromptContextContentUpdatedHistoryEvent
  | PromptContextChatHistoryEventWithSender;

export type PromptContextMarkdownCell = PromptContextCellBase & {
  type: 'markdown';
  history: PromptContextMarkdownCellHistory[];
};

export type PromptContextCodeCellHistory =
  | PromptContextContentUpdatedHistoryEvent
  | PromptContextChatHistoryEventWithSender
  | {
      timestamp: number;
      type: 'cell run';
      hadError: boolean;
      output: MultimodalContent;
    };

export type PromptContextCodeCell = PromptContextCellBase & {
  type: 'code';
  history: PromptContextCodeCellHistory[];
};

export type PromptContextCellHistoryEvent =
  | PromptContextMarkdownCellHistory
  | PromptContextCodeCellHistory;

export type PromptContextCell =
  | PromptContextMarkdownCell
  | PromptContextCodeCell;

// I'm putting this in the client because it's describing the implementation of how this information is gathered,
//   but I could see it going on the server, too (since it's largely structural)
export const filteredCellsDescription = `
  Here, we include all cells in the notebook **up to and including** the cell that the user is currently working on. Note that there may be additional cells in the notebook, and the user may have worked on these cells even if they are later in the notebook.

  Note that we include recent history of each cell. This history extends only to the current browser session, so the initial cell state may not represent the original content of the cell before the user began modifying it.

  Content update events represent committed edits (code runs and markdown saves), not every keystroke. currentContent always reflects the latest cell text as currently edited, even if it has not yet been committed.

  We include code cell execution history so you can trace how the state of the kernel has changed over time; keep in mind that errors may have prevented cells from running all the way through. Only the final output is visible to the student at the moment.

  Chat messages are only included for the currently active cell. In every cell context, the current content is surfaced separately as currentContent so it can be distinguished from history snapshots.

  Note that one cell will be marked as 'active'; this is the cell that the user is currently working in.
`.trim();

// TODO: in the future, we may do this trimming / reflowing on the server when we build the prompt, rather than on the client

export const buildBasePromptContextForCell = (
  notebookPath: string,
  cell: ParsedCell,
  isActive: boolean,
  includeChatHistory: boolean
): PromptContextCell | null => {
  if (cell.type === 'unknown') return null;

  const rawHistory =
    useJupytutorReactState.getState().notebookStateByPath[notebookPath]
      ?.jupytutorStateByCellId[cell.id]?.history ?? [];
  const currentContent = buildCellTextAsMultimodalContent(cell.text);
  const historyWithoutDuplicateLatestContent =
    trimTrailingContentUpdatedHistory(rawHistory, currentContent);
  const historyWithSingletonInitialContentUpdateTrimmed =
    trimSingletonContentUpdatedHistoryIfUnchanged(
      historyWithoutDuplicateLatestContent,
      currentContent
    );
  const cellHistory = includeChatHistory
    ? historyWithSingletonInitialContentUpdateTrimmed
    : filterOutChatEvents(historyWithSingletonInitialContentUpdateTrimmed);

  if (cell.type === 'markdown') {
    return {
      type: 'markdown',
      currentContent,
      history: cellHistory.filter(isMarkdownHistoryEvent),
      ...(isActive ? { activeCell: true } : {})
    };
  }

  if (cell.type === 'code') {
    return {
      type: 'code',
      currentContent,
      history: cellHistory.filter(isCodeHistoryEvent),
      ...(isActive ? { activeCell: true } : {})
    };
  }

  return null;
};

const buildTrimmedPromptContextForCell = (
  notebookPath: string,
  cell: ParsedCell,
  isActive: boolean
): PromptContextCell | null => {
  const baseContext = buildBasePromptContextForCell(
    notebookPath,
    cell,
    isActive,
    false
  );
  return baseContext;
};

export const buildFullActivePromptContextForCell = (
  notebookPath: string,
  cell: ParsedCell
) => {
  const baseContext = buildBasePromptContextForCell(
    notebookPath,
    cell,
    true,
    true
  );

  if (!baseContext) return null;

  baseContext.instructorNote =
    useJupytutorReactState.getState().notebookStateByPath[notebookPath]
      ?.jupytutorStateByCellId[cell.id]?.cellConfig?.instructorNote ?? '';

  return baseContext;
};

const buildCellTextAsMultimodalContent = (text: string): MultimodalContent => [
  {
    type: 'input_text',
    content: text
  }
];

const isMarkdownHistoryEvent = (
  item: PromptContextCellHistoryEvent
): item is PromptContextMarkdownCellHistory => item.type !== 'cell run';

const isCodeHistoryEvent = (
  item: PromptContextCellHistoryEvent
): item is PromptContextCodeCellHistory =>
  item.type === 'content updated' ||
  item.type === 'chat' ||
  item.type === 'cell run';

const trimTrailingContentUpdatedHistory = (
  history: PromptContextCellHistoryEvent[],
  currentContent: MultimodalContent
): PromptContextCellHistoryEvent[] => {
  const last = history[history.length - 1];
  if (
    last?.type === 'content updated' &&
    JSON.stringify(last.content) === JSON.stringify(currentContent)
  ) {
    return history.slice(0, -1);
  }

  return history;
};

const trimSingletonContentUpdatedHistoryIfUnchanged = (
  history: PromptContextCellHistoryEvent[],
  currentContent: MultimodalContent
): PromptContextCellHistoryEvent[] => {
  const contentUpdatedIndices: number[] = [];
  for (let i = 0; i < history.length; i++) {
    if (history[i]?.type === 'content updated') {
      contentUpdatedIndices.push(i);
    }
  }

  if (contentUpdatedIndices.length !== 1) {
    return history;
  }

  const onlyContentUpdatedIndex = contentUpdatedIndices[0];
  const onlyContentUpdatedEvent = history[onlyContentUpdatedIndex];
  if (
    onlyContentUpdatedEvent?.type === 'content updated' &&
    JSON.stringify(onlyContentUpdatedEvent.content) ===
      JSON.stringify(currentContent)
  ) {
    return history.filter((_, index) => index !== onlyContentUpdatedIndex);
  }

  return history;
};

const filterOutChatEvents = (
  history: PromptContextCellHistoryEvent[]
): PromptContextCellHistoryEvent[] =>
  history.filter(item => item.type !== 'chat');

export type PromptContext = {
  resources: {
    _description: string;
    [key: string]: string;
  };
  notebook: {
    overview: string;
    filteredCells: {
      _description: string;
      cells: PromptContextCell[];
    };
  };
  activeCellContext: PromptContextCell | null;
};

export const formattingNotes = `
IMPORTANT - Response Formatting:
- Use markdown headers (## for h2, ### for h3) for ALL section titles if needed for clarity.
- Always add blank lines before and after headers
- Use proper markdown link syntax: [Link Text](URL), NOT <a> or [LINK] tags.
- Use **bold** or *italic* sparingly and only for emphasis within text (NOT for section headers)
`.trim();

export const getPromptContextFromCells = async (
  notebookPath: string,
  cells: ParsedCell[],
  contextRetriever: GlobalNotebookContextRetrieval | null,
  activeCellId: string
): Promise<PromptContext> => {
  const globalNotebookContext: Record<string, string> = contextRetriever
    ? ((await contextRetriever.getContext()) ?? {})
    : {};
  const activeCell = cells.find(c => c.id === activeCellId);
  const activeCellIndex = cells.findIndex(c => c.id === activeCellId);
  const cellsToInclude =
    activeCellIndex >= 0 ? cells.slice(0, activeCellIndex + 1) : cells;

  return {
    resources: {
      // TODO probably put this description on the server
      _description: STARTING_TEXTBOOK_CONTEXT,
      ...globalNotebookContext
    },
    notebook: {
      overview: '',
      filteredCells: {
        _description: filteredCellsDescription,
        cells: cellsToInclude
          .map(c =>
            buildTrimmedPromptContextForCell(
              notebookPath,
              c,
              c.id === activeCellId
            )
          )
          .filter((cell): cell is PromptContextCell => cell !== null)
      }
    },
    activeCellContext: activeCell
      ? buildFullActivePromptContextForCell(notebookPath, activeCell)
      : null
  };
};
