import { ParsedCell } from '../parseNB';
import GlobalNotebookContextRetrieval from './globalNotebookContextRetrieval';

type MultimodalContentChunk =
  | {
      type: 'input_text';
      content: string;
    }
  | {
      type: 'input_image';
      image_url: string;
    };

type MultimodalContent = MultimodalContentChunk[];

type PromptContextCellBase = {
  type: string;
  instructorNote?: string;
  activeCell?: true;
};

type PromptContextContentUpdatedHistoryEvent = {
  timestamp: number;
  type: 'content updated';
  content: MultimodalContent;
};

type PromptContextChatHistoryEvent = {
  timestamp: number;
  type: 'chat';
  content: string;
};

type PromptContextMarkdownCellHistory =
  | PromptContextContentUpdatedHistoryEvent
  | PromptContextChatHistoryEvent;

type PromptContextMarkdownCell = PromptContextCellBase & {
  type: 'markdown';
  history: PromptContextMarkdownCellHistory[];
};

type PromptContextCodeCellHistory =
  | PromptContextContentUpdatedHistoryEvent
  | PromptContextChatHistoryEvent
  | {
      timestamp: number;
      type: 'cell run';
      hadError: boolean;
      output: MultimodalContent;
    };

type PromptContextCodeCell = PromptContextCellBase & {
  type: 'code';
  history: PromptContextCodeCellHistory[];
};

type PromptContextCell = PromptContextMarkdownCell | PromptContextCodeCell;

export const filteredCellsDescription = `
  Here, we include all cells in the notebook **up to and including** the cell that the user is currently working on. Note that there may be additional cells in the notebook, and the user may have worked on these cells even if they are later in the notebook.

  Note that we include recent history of each cell. This history extends only to the current browser session, so the initial cell state may not represent the original content of the cell before the user began modifying it.

  We include code cell execution history so you can trace how the state of the kernel has changed over time; keep in mind that errors may have prevented cells from running all the way through.

  Note that one cell will be marked as 'active'; this is the cell that the user is currently working in.
`.trim();

// TODO: in the future, we may do this trimming / reflowing on the server when we build the prompt, rather than on the client

export const buildTrimmedPromptContextForCell = (cell: ParsedCell): PromptContextCell | null => {
  if (cell.type === 'unknown') return null;
  if (cell.type === 'markdown')
};

export const buildFullActivePromptContextForCell = () => {};

export type PromptContext = {
  resources: {
    [key: string]: string;
  };
  notebook: {
    overview: string;
    filteredCells: {
      _description: string;
      cells: PromptContextCell[];
    };
  };
  activeCellContext: PromptContextCell;
};

export const formattingNotes = `
IMPORTANT - Response Formatting:
- Use markdown headers (## for h2, ### for h3) for ALL section titles if needed for clarity.
- Always add blank lines before and after headers
- Use proper markdown link syntax: [Link Text](URL), NOT <a> or [LINK] tags.
- Use **bold** or *italic* sparingly and only for emphasis within text (NOT for section headers)
`.trim();

export const getPromptContextFromCells = async (
  cells: ParsedCell[],
  contextRetriever: GlobalNotebookContextRetrieval | null,
  instructorNote: string | null
): Promise<PromptContext> => {
  const globalNotebookContext: Record<string, string> = contextRetriever
    ? ((await contextRetriever.getContext()) ?? {})
    : {};
  return {
    resources: globalNotebookContext,
    notebook: {
      overview: '',
      filteredCells: {
        _description: filteredCellsDescription,
        cells: cells.map(buildTrimmedPromptContextForCell).filter((cell): cell is PromptContextCell => cell !== null)
      }
    },
    activeCellContext: buildFullActivePromptContextForCell;
  };
};
