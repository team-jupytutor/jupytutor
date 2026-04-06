import { Draft, produce } from 'immer';
import { useMemo } from 'react';
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { ChatHistoryItem } from './components/ChatMessage';
import { useCellId, useNotebookPath } from './context/notebook-cell-context';
import { PluginConfig } from './schemas/config';
import { ParsedCell } from './helpers/parseNB';
import GlobalNotebookContextRetrieval from './helpers/prompt-context/globalNotebookContextRetrieval';
import { RuleConfigOverride } from './helpers/config-rules';
import type {
  MultimodalContent,
  PromptContextCellHistoryEvent
} from './helpers/prompt-context/prompt-context';

export type JupytutorCellState = {
  // this is something of a cache -- we refetch for a particular cell
  // when it's executed, which is when we consider whether to show for that cell
  cellConfig: RuleConfigOverride | null;
  cellExtraMetadata: unknown;
  history: PromptContextCellHistoryEvent[];

  chatHistory: ChatHistoryItem[];
  liveResult: string | null;
  isLoading: boolean;
};

const DEFAULT_WIDGET_STATE: () => JupytutorCellState = () => ({
  cellConfig: null,
  cellExtraMetadata: undefined,
  history: [],

  chatHistory: [],
  liveResult: null,
  isLoading: false
});

type NotebookState = {
  jupytutorStateByCellId: Record<string, JupytutorCellState>;
  notebookConfig: PluginConfig | null;
  parsedCells: ParsedCell[];
  // TODO: probably get rid of this and replace with memoized functions / hooks
  globalNotebookContextRetriever: GlobalNotebookContextRetrieval | null;
};

type JupytutorReactState = {
  patchKeyCommand750: boolean;
  userId: string | null;
  jupyterhubHostname: string | null;

  notebookStateByPath: Record<string, NotebookState>;

  setChatHistory: (
    notebookPath: string
  ) => (cellId: string) => (chatHistory: ChatHistoryItem[]) => void;
  setLiveResult: (
    notebookPath: string
  ) => (cellId: string) => (liveResult: string | null) => void;
  setIsLoading: (
    notebookPath: string
  ) => (cellId: string) => (isLoading: boolean) => void;
  appendCellHistoryEvent: (
    notebookPath: string
  ) => (cellId: string) => (event: PromptContextCellHistoryEvent) => void;
  appendCellContentUpdatedHistoryEvent: (
    notebookPath: string
  ) => (cellId: string) => (cellText: string) => void;
  setRefreshedCellConfig: (
    notebookPath: string
  ) => (cellId: string) => (cellConfig: RuleConfigOverride) => void;
  setRefreshedCellExtraMetadata: (
    notebookPath: string
  ) => (cellId: string) => (extraMetadata: unknown) => void;

  setNotebookConfig: (
    notebookPath: string
  ) => (newConfig: PluginConfig) => void;
  setNotebookParsedCells: (
    notebookPath: string
  ) => (parsedCells: ParsedCell[]) => void;
  setNotebookParsedCell: (
    notebookPath: string
  ) => (parsedCell: ParsedCell) => void;
  setGlobalNotebookContextRetriever: (
    notebookPath: string
  ) => (contextRetriever: GlobalNotebookContextRetrieval | null) => void;
};

export const ensureDraftHasNotebook = (
  draft: Draft<JupytutorReactState>,
  notebookPath: string
) => {
  if (!draft.notebookStateByPath[notebookPath]) {
    draft.notebookStateByPath[notebookPath] = {
      jupytutorStateByCellId: {},
      notebookConfig: null,
      parsedCells: [],
      globalNotebookContextRetriever: null
    };
  }
};

const ensureDraftHasNotebookCell = (
  draft: Draft<JupytutorReactState>,
  notebookPath: string,
  cellId: string
) => {
  ensureDraftHasNotebook(draft, notebookPath);

  if (!draft.notebookStateByPath[notebookPath].jupytutorStateByCellId[cellId]) {
    draft.notebookStateByPath[notebookPath].jupytutorStateByCellId[cellId] =
      DEFAULT_WIDGET_STATE();
  }
};

const cellData = (
  draft: Draft<JupytutorReactState>,
  notebookPath: string,
  cellId: string
) => {
  ensureDraftHasNotebookCell(draft, notebookPath, cellId);
  return draft.notebookStateByPath[notebookPath].jupytutorStateByCellId[cellId];
};

export const useJupytutorReactState = create<JupytutorReactState>()(
  subscribeWithSelector(set => ({
    patchKeyCommand750: false,
    userId: null,
    jupyterhubHostname: null,

    notebookStateByPath: {} as Record<string, NotebookState>,
    setChatHistory:
      (notebookPath: string) =>
      (cellId: string) =>
      (chatHistory: ChatHistoryItem[]) => {
        set(state => {
          return produce(state, draft => {
            cellData(draft, notebookPath, cellId).chatHistory = chatHistory;
          });
        });
      },

    setLiveResult:
      (notebookPath: string) =>
      (cellId: string) =>
      (liveResult: string | null) => {
        set(state => {
          return produce(state, draft => {
            cellData(draft, notebookPath, cellId).liveResult = liveResult;
          });
        });
      },

    setIsLoading:
      (notebookPath: string) => (cellId: string) => (isLoading: boolean) => {
        set(state => {
          return produce(state, draft => {
            cellData(draft, notebookPath, cellId).isLoading = isLoading;
          });
        });
      },

    appendCellHistoryEvent:
      (notebookPath: string) =>
      (cellId: string) =>
      (event: PromptContextCellHistoryEvent) => {
        set(state => {
          return produce(state, draft => {
            cellData(draft, notebookPath, cellId).history.push(event);
          });
        });
      },

    appendCellContentUpdatedHistoryEvent:
      (notebookPath: string) =>
      (cellId: string) =>
      (cellText: string) => {
        set(state => {
          return produce(state, draft => {
            const widgetState = cellData(draft, notebookPath, cellId);
            const currentContent: MultimodalContent = [
              {
                type: 'input_text',
                content: cellText
              }
            ];

            let lastContentUpdate: MultimodalContent | null = null;
            for (let i = widgetState.history.length - 1; i >= 0; i--) {
              const event = widgetState.history[i];
              if (event.type === 'content updated') {
                lastContentUpdate = event.content;
                break;
              }
            }

            if (
              lastContentUpdate === null ||
              JSON.stringify(lastContentUpdate) !== JSON.stringify(currentContent)
            ) {
              widgetState.history.push({
                timestamp: Date.now(),
                type: 'content updated',
                content: currentContent
              });
            }
          });
        });
      },

    setRefreshedCellConfig:
      (notebookPath: string) =>
      (cellId: string) =>
      (cellConfig: RuleConfigOverride) => {
        set(state => {
          return produce(state, draft => {
            cellData(draft, notebookPath, cellId).cellConfig = cellConfig;
          });
        });
      },

    setRefreshedCellExtraMetadata:
      (notebookPath: string) =>
      (cellId: string) =>
      (extraMetadata: unknown) => {
        set(state => {
          return produce(state, draft => {
            cellData(draft, notebookPath, cellId).cellExtraMetadata =
              extraMetadata;
          });
        });
      },

    setNotebookConfig: (notebookPath: string) => (newConfig: PluginConfig) => {
      set(state => {
        return produce(state, draft => {
          draft.notebookStateByPath[notebookPath].notebookConfig = newConfig;
        });
      });
    },
    setNotebookParsedCells:
      (notebookPath: string) => (parsedCells: ParsedCell[]) => {
        set(state => {
          return produce(state, draft => {
            ensureDraftHasNotebook(draft, notebookPath);
            draft.notebookStateByPath[notebookPath].parsedCells = parsedCells;
          });
        });
      },
    setNotebookParsedCell:
      (notebookPath: string) => (parsedCell: ParsedCell) => {
        set(state => {
          return produce(state, draft => {
            ensureDraftHasNotebook(draft, notebookPath);
            const parsedCells = draft.notebookStateByPath[notebookPath].parsedCells;
            const existingIndex = parsedCells.findIndex(
              cell => cell.id === parsedCell.id
            );
            if (existingIndex >= 0) {
              parsedCells[existingIndex] = parsedCell;
            } else {
              parsedCells.push(parsedCell);
            }
          });
        });
      },
    setGlobalNotebookContextRetriever:
      (notebookPath: string) =>
      (contextRetriever: GlobalNotebookContextRetrieval | null) => {
        set(state => {
          return produce(state, draft => {
            draft.notebookStateByPath[
              notebookPath
            ].globalNotebookContextRetriever = contextRetriever;
          });
        });
      }
  }))
);

// @ts-expect-error debug
window.useJupytutorReactState = useJupytutorReactState;

const useNotebookState = () => {
  const notebookPath = useNotebookPath();
  return useJupytutorReactState(
    state => state.notebookStateByPath[notebookPath]
  );
};

export const useNotebookPreferences = () => {
  const [config] = useNotebookConfig();
  return config?.preferences;
};

export const usePatchKeyCommand750 = () => {
  return useJupytutorReactState(state => state.patchKeyCommand750);
};

export const useWidgetState = () => {
  const notebookPath = useNotebookPath();
  const cellId = useCellId();

  if (cellId === null) {
    throw new Error('useWidgetState must be used within a CellContextProvider');
  }

  return (
    useJupytutorReactState(
      state =>
        state.notebookStateByPath[notebookPath]?.jupytutorStateByCellId[cellId]
    ) ?? DEFAULT_WIDGET_STATE()
  );
};

export const useChatHistory = (): [
  ChatHistoryItem[],
  (chatHistory: ChatHistoryItem[]) => void
] => {
  const notebookPath = useNotebookPath();
  const cellId = useCellId();
  const setChatHistory = useJupytutorReactState(state => state.setChatHistory);
  const widgetState = useWidgetState();
  const setChatHistoryCurried = useMemo(
    () => setChatHistory(notebookPath)(cellId),
    [widgetState, notebookPath, cellId]
  );

  return [widgetState.chatHistory, setChatHistoryCurried];
};

export const useLiveResult = (): [
  string | null,
  (liveResult: string | null) => void
] => {
  const notebookPath = useNotebookPath();
  const cellId = useCellId();
  const setLiveResult = useJupytutorReactState(state => state.setLiveResult);
  const widgetState = useWidgetState();
  const setLiveResultCurried = useMemo(
    () => setLiveResult(notebookPath)(cellId),
    [widgetState, notebookPath, cellId]
  );

  return [widgetState.liveResult, setLiveResultCurried];
};

export const useIsLoading = (): [boolean, (isLoading: boolean) => void] => {
  const notebookPath = useNotebookPath();
  const cellId = useCellId();
  const setIsLoading = useJupytutorReactState(state => state.setIsLoading);
  const widgetState = useWidgetState();
  const setIsLoadingCurried = useMemo(
    () => setIsLoading(notebookPath)(cellId),
    [widgetState, notebookPath, cellId]
  );

  return [widgetState.isLoading, setIsLoadingCurried];
};

export const useNotebookConfig = () => {
  const notebookPath = useNotebookPath();
  const notebookState = useNotebookState();
  const setNotebookConfig = useJupytutorReactState(
    state => state.setNotebookConfig
  );
  const setNotebookConfigCurried = useMemo(
    () => setNotebookConfig(notebookPath),
    [notebookPath]
  );
  return [notebookState.notebookConfig, setNotebookConfigCurried] as const;
};

export const useCellConfig = () => {
  const notebookPath = useNotebookPath();
  const cellId = useCellId();
  const cellState = useJupytutorReactState(
    state =>
      state.notebookStateByPath[notebookPath]?.jupytutorStateByCellId[cellId]
  );
  return cellState.cellConfig;
};

export const useCellExtraMetadata = () => {
  const notebookPath = useNotebookPath();
  const cellId = useCellId();
  const cellState = useJupytutorReactState(
    state =>
      state.notebookStateByPath[notebookPath]?.jupytutorStateByCellId[cellId]
  );
  return cellState?.cellExtraMetadata;
};
