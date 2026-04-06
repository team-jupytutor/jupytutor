import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Cell, CodeCellModel, ICellModel } from '@jupyterlab/cells';
import {
  INotebookModel,
  INotebookTracker,
  Notebook,
  NotebookActions,
  NotebookPanel
} from '@jupyterlab/notebook';
import { IOutputModel } from '@jupyterlab/rendermime';
import { produce } from 'immer';
import { isEqual } from 'underscore';
import z from 'zod';
import JupytutorWidget from './Jupytutor';
import type {
  MultimodalContent,
  PromptContextCodeCellHistory
} from './helpers/prompt-context/prompt-context';
import { applyConfigRules } from './helpers/config-rules';
import { devLog } from './helpers/devLog';
import parseNB, { parseCellModel } from './helpers/parseNB';
import { patchKeyCommand750 } from './helpers/patch-keycommand-7.5.0';
import { parseContextFromNotebook } from './helpers/prompt-context/notebookContextParsing';
import { ConfigSchema, PluginConfig } from './schemas/config';
import { ensureDraftHasNotebook, useJupytutorReactState } from './store';

const JupytutorCellMetadataSchema = z.object({
  cellConfig: z.unknown().optional(),
  extraMetadata: z.unknown().optional()
});

const JUPYTUTOR_CONTAINER_CLASS = 'jp-jupytutor-container';

const removeJupytutorContainer = (cell: Cell) => {
  cell.node
    .querySelectorAll(`.${JUPYTUTOR_CONTAINER_CLASS}`)
    .forEach(container => container.remove());
};

/**
 * Helper function to extract the user identifier from DataHub-style URLs
 * @returns The username/identifier from the URL path, or null if not found
 */
const getUserIdentifierFromURL = (): string | null => {
  const pathname = window.location.pathname;
  // Match DataHub-style URLs: /user/<username>/...
  const match = pathname.match(/\/user\/([^/]+)/);
  return match ? match[1] : null;
};

const parseConfiguration = (config: unknown): PluginConfig => {
  return ConfigSchema.parse(config);
};

const loadConfigurationFromNotebookModel = (notebookModel: INotebookModel) => {
  const rawConfig = notebookModel.getMetadata('jupytutor') ?? {};
  return parseConfiguration(rawConfig);
};

const attachNotebookMetadata = (
  notebookPath: string,
  notebookModel: INotebookModel
) => {
  useJupytutorReactState.setState(state =>
    produce(state, draft => {
      ensureDraftHasNotebook(draft, notebookPath);

      draft.notebookStateByPath[notebookPath].notebookConfig =
        loadConfigurationFromNotebookModel(notebookModel);
    })
  );

  const slot: Parameters<typeof notebookModel.metadataChanged.connect>[0] = (
    _,
    update
  ) => {
    if (update.key !== 'jupytutor') return;

    devLog(
      () => 'jupytutor metadata changed',
      () => ({ update })
    );

    useJupytutorReactState.setState(
      produce(draft => {
        if (!draft.notebookStateByPath[notebookPath]) {
          draft.notebookStateByPath[notebookPath] = {
            widgetStateByCellId: {},
            notebookConfig: null
          };
        }

        draft.notebookStateByPath[notebookPath].notebookConfig =
          parseConfiguration(update.newValue);
      })
    );
  };
  notebookModel.metadataChanged.connect(slot);

  // important to make sure this doesn't overwrite with a default 'on'
  //   or really overwrite at all if we haven't already loaded once from the nb
  const zustandUnsubscribe = useJupytutorReactState.subscribe(
    state => state.notebookStateByPath[notebookPath]?.notebookConfig,
    notebookConfig => {
      if (!notebookModel.getMetadata('jupytutor')) {
        // the notebook config might be a loaded default. we shouldn't write it
        // unless the notebook already had some jupytutor config
        return;
      }

      notebookModel.setMetadata('jupytutor', notebookConfig);
    },
    {
      // this isn't great perf-wise, but I want to prevent echoes
      // (I think Jupyter actually prevents echoes already, but don't want to risk it)
      equalityFn: isEqual
    }
  );

  return () => {
    notebookModel.metadataChanged.disconnect(slot);
    zustandUnsubscribe();
  };
};

const refreshCellConfig = (
  notebookPath: string,
  notebookModel: INotebookModel,
  cellModel: ICellModel,
  notebookConfig: PluginConfig
) => {
  const cellIndex = [...notebookModel.cells].findIndex(c => c === cellModel);
  const parsedCellMetadata = JupytutorCellMetadataSchema.safeParse(
    cellModel.getMetadata('jupytutor')
  ).data;
  const cellMetadataConfig = parsedCellMetadata?.cellConfig;
  const cellConfig = applyConfigRules(
    notebookModel,
    cellIndex,
    notebookConfig.rules,
    cellMetadataConfig
  );
  useJupytutorReactState.getState().setRefreshedCellConfig(notebookPath)(
    cellModel.id
  )(cellConfig);
  useJupytutorReactState.getState().setRefreshedCellExtraMetadata(notebookPath)(
    cellModel.id
  )(parsedCellMetadata?.extraMetadata);
  devLog(() => ({ cellConfig }));

  return cellConfig;
};

const refreshNotebookParse = (notebookPath: string, notebook: Notebook) => {
  const allCells = parseNB(notebook);
  useJupytutorReactState.getState().setNotebookParsedCells(notebookPath)(
    allCells
  );
  return allCells;
};

const extractOutputText = (output: IOutputModel): string => {
  const outputData = output.toJSON() as Record<string, any>;
  const data = outputData?.data;
  const outputType = outputData?.output_type;

  if (outputType === 'error') {
    return outputData?.traceback?.join('\n') ?? outputData?.evalue ?? '';
  }

  if (outputType === 'display_data' || outputType === 'execute_result') {
    const mimeData = (data as Record<string, any>) ?? {};
    const textPlain = mimeData['text/plain'];
    if (textPlain !== undefined) {
      return Array.isArray(textPlain)
        ? textPlain.join('\n')
        : String(textPlain);
    }
    const imageMimes = Object.keys(mimeData).filter(mime =>
      mime.startsWith('image/')
    );
    if (imageMimes.length > 0) {
      return `[Image output: ${imageMimes.join(', ')}]`;
    }
  }

  if (outputData?.text !== undefined) {
    return Array.isArray(outputData.text)
      ? outputData.text.join('\n')
      : String(outputData.text);
  }

  if (data !== undefined && typeof data === 'string') {
    return data;
  }

  return JSON.stringify(data ?? outputData);
};

const normalizeMimePayloadToString = (payload: unknown): string | null => {
  if (typeof payload === 'string') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload
      .map(item => (typeof item === 'string' ? item : String(item)))
      .join('');
  }
  return null;
};

const extractDataUrlsFromHtml = (html: string): string[] => {
  const matches = html.match(/src=["'](data:image\/[^"']+)["']/gi) ?? [];
  return matches
    .map(match => {
      const captured = match.match(/src=["'](data:image\/[^"']+)["']/i);
      return captured?.[1] ?? '';
    })
    .filter(url => url.length > 0);
};

const extractOutputImageDataUrls = (output: IOutputModel): string[] => {
  const outputData = output.toJSON() as Record<string, any>;
  const data = (outputData?.data as Record<string, unknown> | undefined) ?? {};
  const imageUrls = new Set<string>();

  const imageMimeTypes = Object.keys(data).filter(mime =>
    mime.startsWith('image/')
  );
  for (const mime of imageMimeTypes) {
    const rawPayload = normalizeMimePayloadToString(data[mime]);
    if (!rawPayload || rawPayload.trim().length === 0) {
      continue;
    }

    if (rawPayload.startsWith('data:')) {
      imageUrls.add(rawPayload);
      continue;
    }

    if (mime === 'image/svg+xml') {
      imageUrls.add(`data:${mime};utf8,${encodeURIComponent(rawPayload)}`);
      continue;
    }

    const compactBase64 = rawPayload.replace(/\s+/g, '');
    imageUrls.add(`data:${mime};base64,${compactBase64}`);
  }

  const htmlPayload = normalizeMimePayloadToString(data['text/html']);
  if (htmlPayload) {
    for (const dataUrl of extractDataUrlsFromHtml(htmlPayload)) {
      imageUrls.add(dataUrl);
    }
  }

  return Array.from(imageUrls);
};

const cellRunOutputFromModel = (cell: CodeCellModel): MultimodalContent => {
  const outputParts: MultimodalContent = [];

  for (let i = 0; i < cell.outputs.length; i++) {
    const output = cell.outputs.get(i);
    if (!output) {
      continue;
    }

    const outputText = extractOutputText(output).trim();
    if (outputText.length > 0) {
      outputParts.push({
        type: 'input_text',
        content: outputText
      });
    }

    const imageDataUrls = extractOutputImageDataUrls(output);
    for (const imageDataUrl of imageDataUrls) {
      outputParts.push({
        type: 'input_image',
        image_url: imageDataUrl
      });
    }
  }

  return outputParts;
};

const attachNotebook = async (
  _notebookTracker: INotebookTracker,
  notebookPanel: NotebookPanel | null
) => {
  try {
    if (!notebookPanel) {
      console.warn('No active notebook found for context gathering');
      return;
    }

    devLog(
      () => 'Notebook path:',
      () => notebookPanel.context.path
    );

    await notebookPanel.context.ready;
    await notebookPanel.revealed;

    const notebook = notebookPanel.content;
    const notebookModel = notebook.model;
    if (!notebookModel) {
      console.warn('No notebook model found for context gathering');
      return;
    }

    const detachMetadata = attachNotebookMetadata(
      notebookPanel.context.path,
      notebookModel
    );

    const notebookConfig = loadConfigurationFromNotebookModel(notebookModel);

    // Skip context gathering if activation flag criteria not met
    if (!notebookConfig.pluginEnabled) {
      devLog(
        () =>
          'Activation flag not found in notebook. Skipping context gathering.'
      );
      return;
    }

    // Parse the notebook to get all cells and their links
    const allCells = parseNB(notebook);

    devLog(
      () => 'Gathered all cells from notebook on initial load.',
      () => allCells
    );

    useJupytutorReactState
      .getState()
      .setNotebookParsedCells(notebookPanel.context.path)(allCells);

    const globalNotebookContextRetriever = await parseContextFromNotebook(
      allCells,
      notebookConfig
    );
    useJupytutorReactState
      .getState()
      .setGlobalNotebookContextRetriever(notebookPanel.context.path)(
      globalNotebookContextRetriever
    );

    devLog(
      () => 'Identified Source Links:\n',
      async () => await globalNotebookContextRetriever?.getSourceLinks()
    );

    const cellContentListenerDisconnects = new Map<string, () => void>();

    const disconnectCellContentListeners = () => {
      for (const disconnect of cellContentListenerDisconnects.values()) {
        disconnect();
      }
      cellContentListenerDisconnects.clear();
    };

    const handleSingleCellContentChanged = (cellModel: ICellModel) => {
      // Guard against noisy content-change signals (e.g., markdown runs) that do
      // not actually change source text.
      const parsedCells =
        useJupytutorReactState.getState().notebookStateByPath[
          notebookPanel.context.path
        ]?.parsedCells ?? [];
      const existingParsedCell = parsedCells.find(c => c.id === cellModel.id);
      const currentSource = cellModel.sharedModel.getSource();
      if (existingParsedCell && existingParsedCell.text === currentSource) {
        return;
      }

      useJupytutorReactState
        .getState()
        .setNotebookParsedCell(notebookPanel.context.path)(
        parseCellModel(cellModel)
      );
    };

    const connectCellContentListeners = () => {
      disconnectCellContentListeners();
      for (const cellModel of notebookModel.cells) {
        const slot: Parameters<typeof cellModel.contentChanged.connect>[0] =
          () => {
            handleSingleCellContentChanged(cellModel);
          };
        cellModel.contentChanged.connect(slot);
        cellContentListenerDisconnects.set(cellModel.id, () => {
          cellModel.contentChanged.disconnect(slot);
        });
      }
    };

    connectCellContentListeners();

    const handleNotebookCellsChanged: Parameters<
      typeof notebookModel.cells.changed.connect
    >[0] = () => {
      // Structural list changes (add/remove/reorder) require a full reparse.
      refreshNotebookParse(notebookPanel.context.path, notebook);
      connectCellContentListeners();
    };
    notebookModel.cells.changed.connect(handleNotebookCellsChanged);

    const handleNotebookSaveState = (
      _: unknown,
      saveState: 'started' | 'failed' | 'completed'
    ) => {
      if (saveState !== 'completed') {
        return;
      }

      const allCells = refreshNotebookParse(notebookPanel.context.path, notebook);
      const appendCellContentUpdatedHistoryEvent = useJupytutorReactState
        .getState()
        .appendCellContentUpdatedHistoryEvent(notebookPanel.context.path);

      for (const cell of allCells) {
        if (cell.type !== 'markdown') {
          continue;
        }
        appendCellContentUpdatedHistoryEvent(cell.id)(cell.text);
      }
    };
    notebookPanel.context.saveState.connect(handleNotebookSaveState);

    // TODO use this detach
    return () => {
      detachMetadata();
      disconnectCellContentListeners();
      notebookModel.cells.changed.disconnect(handleNotebookCellsChanged);
      notebookPanel.context.saveState.disconnect(handleNotebookSaveState);
    };
  } catch (error) {
    // TODO finally return detach
    console.error('Error gathering context:', error);
  }
};

/**
 * Initialization data for the jupytutor extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupytutor:plugin',
  description:
    'A Jupyter extension for providing students LLM feedback based on autograder results and supplied course context.',
  autoStart: true,
  requires: [INotebookTracker],
  activate: async (app: JupyterFrontEnd, notebookTracker: INotebookTracker) => {
    if (
      !(
        window.location.host === 'data8.datahub.berkeley.edu' ||
        window.location.host === 'data8-staging.datahub.berkeley.edu' ||
        window.location.host === 'prob140.datahub.berkeley.edu' ||
        window.location.host === 'prob140-staging.datahub.berkeley.edu' ||
        window.location.hostname === 'localhost'
      )
    ) {
      // bail early while we work on early versions of the plugin --
      //   don't want to have negative impact on `datahub.berkeley.edu`,
      //   including possibly leaking notebook watchers / json metadata parsers
      return;
    }

    patchKeyCommand750(app);

    // Get the DataHub user identifier and JupyterHub hostname
    const userId = getUserIdentifierFromURL();
    const jupyterhubHostname = window.location.hostname;
    useJupytutorReactState.setState({ userId, jupyterhubHostname });

    // Gather context when a notebook is opened or becomes active
    let detachCurrentNotebook = () => {};

    const attachNotebookAndTrack = async (
      notebookPanel: NotebookPanel | null
    ) => {
      detachCurrentNotebook();
      detachCurrentNotebook = () => {};

      const detach = await attachNotebook(notebookTracker, notebookPanel);
      if (typeof detach === 'function') {
        detachCurrentNotebook = detach;
      }
    };

    notebookTracker.currentChanged.connect((_, notebookPanel) => {
      void attachNotebookAndTrack(notebookPanel);
    });

    // Also gather context immediately if there's already an active notebook
    if (notebookTracker.currentWidget) {
      void attachNotebookAndTrack(notebookTracker.currentWidget);
    }

    // Listen for the execution of a cell. [1, 3, 6]
    NotebookActions.executed.connect(
      (
        _,
        {
          notebook,
          cell,
          success
        }: { notebook: Notebook; cell: Cell; success: boolean }
      ) => {
        const notebookModel = notebook.model;
        if (!notebookModel) {
          console.warn('No notebook model found during cell execution.');
          return;
        }

        // TODO i don't love that this is using a global. can we get the path from the listener?
        const notebookPath = notebookTracker.currentWidget?.context.path ?? '';

        const notebookConfig =
          useJupytutorReactState.getState().notebookStateByPath[notebookPath]
            .notebookConfig;

        if (!notebookConfig || !notebookConfig.pluginEnabled) {
          // NEVER DO ANYTHING IF THE ACTIVATION FLAG IS NOT MET, NO MATTER WHAT
          return;
        }

        // TODO - profile this, maybe memoize it
        //   (to do perfectly, need to react to lots of notebook events... but may
        //    suffice in practice to react only to cell execution events)
        const cellConfig = refreshCellConfig(
          notebookPath,
          notebookModel,
          cell.model,
          notebookConfig
        );

        const proactiveEnabledForSession =
          notebookConfig.preferences.proactiveEnabled;

        const proactiveEnabledForCell =
          cellConfig.chatProactive && proactiveEnabledForSession;

        if (cell.model.type === 'code') {
          const codeCell = cell.model as CodeCellModel;
          useJupytutorReactState
            .getState()
            .appendCellContentUpdatedHistoryEvent(notebookPath)(cell.model.id)(
            codeCell.sharedModel.getSource()
          );

          const runHistoryEvent: PromptContextCodeCellHistory = {
            timestamp: Date.now(),
            type: 'cell run',
            hadError: !success,
            output: cellRunOutputFromModel(codeCell)
          };

          useJupytutorReactState
            .getState()
            .appendCellHistoryEvent(notebookPath)(cell.model.id)(
            runHistoryEvent
          );
        }

        if (cellConfig.chatEnabled && proactiveEnabledForCell) {
          refreshNotebookParse(notebookPath, notebook);

          const jupytutor = new JupytutorWidget({
            cellId: cell.model.id,
            notebookPath
          });

          // Remove any existing JupyTutor widgets before re-rendering
          removeJupytutorContainer(cell);

          // Create a proper container div with React mounting point
          const container = document.createElement('div');
          container.className = JUPYTUTOR_CONTAINER_CLASS;

          container.appendChild(jupytutor.node);
          cell.node.appendChild(container);

          // Ensure React renders by calling update after DOM insertion
          requestAnimationFrame(() => {
            jupytutor.update();
          });
        } else {
          removeJupytutorContainer(cell);
        }
      }
    );
  }
};

export default plugin;
