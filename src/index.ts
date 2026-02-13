import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Cell, ICellModel } from '@jupyterlab/cells';
import {
  INotebookModel,
  INotebookTracker,
  Notebook,
  NotebookActions,
  NotebookPanel
} from '@jupyterlab/notebook';
import { produce } from 'immer';
import { isEqual } from 'underscore';
import JupytutorWidget from './Jupytutor';
import { applyConfigRules } from './helpers/config-rules';
import { devLog } from './helpers/devLog';
import parseNB from './helpers/parseNB';
import { patchKeyCommand750 } from './helpers/patch-keycommand-7.5.0';
import { STARTING_TEXTBOOK_CONTEXT } from './helpers/prompt-context/globalNotebookContextRetrieval';
import { parseContextFromNotebook } from './helpers/prompt-context/notebookContextParsing';
import { ConfigSchema, PluginConfig } from './schemas/config';
import { ensureDraftHasNotebook, useJupytutorReactState } from './store';

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
  const cellConfig = applyConfigRules(
    notebookModel,
    cellIndex,
    notebookConfig.rules
  );
  useJupytutorReactState.getState().setRefreshedCellConfig(notebookPath)(
    cellModel.id
  )(cellConfig);
  devLog(() => ({ cellConfig }));

  return cellConfig;
};

const refreshNotebookParse = (notebookPath: string, notebook: Notebook) => {
  const allCells = parseNB(notebook);
  useJupytutorReactState.getState().setNotebookParsedCells(notebookPath)(
    allCells
  );
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

    devLog(() => 'Textbook Context Gathering Completed\n');

    devLog(
      () => 'Starting Textbook Prompt:\n',
      () => STARTING_TEXTBOOK_CONTEXT
    );

    devLog(
      () => 'Textbook Context Snippet:\n',
      async () =>
        (await globalNotebookContextRetriever?.getContext())?.substring(
          STARTING_TEXTBOOK_CONTEXT.length,
          STARTING_TEXTBOOK_CONTEXT.length + 500
        )
    );

    devLog(
      () => 'Textbook Context Length:\n',
      async () => (await globalNotebookContextRetriever?.getContext())?.length
    );

    devLog(
      () => 'Textbook Source Links:\n',
      async () => await globalNotebookContextRetriever?.getSourceLinks()
    );

    // TODO use this detach
    return detachMetadata;
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
        window.location.host === 'prob140.datahub.berkeley.edu' ||
        window.location.hostname === 'localhost'
      )
    ) {
      // bail early while we work on early versions of the plugin --
      //   don't want to have negative impact on `datahub.berkeley.edu`,
      //   including possibly leaking notebook watchers / json metadata parsers
      return;
    }

    patchKeyCommand750(app);

    // Get the DataHub user identifier
    const userId = getUserIdentifierFromURL();
    useJupytutorReactState.setState({ userId });

    // Gather context when a notebook is opened or becomes active
    notebookTracker.currentChanged.connect(attachNotebook);

    // Also gather context immediately if there's already an active notebook
    if (notebookTracker.currentWidget) {
      attachNotebook(notebookTracker, notebookTracker.currentWidget);
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

        if (cellConfig.chatEnabled && proactiveEnabledForCell) {
          refreshNotebookParse(notebookPath, notebook);

          const jupytutor = new JupytutorWidget({
            cellId: cell.model.id,
            notebookPath,
            // TODO: rejig 'active cell' logic
            activeIndex: notebook.activeCellIndex
          });

          // Check if there's already a JupyTutor widget in this cell and remove it
          const CLASS_NAME = 'jp-jupytutor-container';
          const existingContainer = cell.node.querySelector(`.${CLASS_NAME}`);
          if (existingContainer) {
            existingContainer.remove();
          }

          // Create a proper container div with React mounting point
          const container = document.createElement('div');
          container.className = CLASS_NAME;

          container.appendChild(jupytutor.node);
          cell.node.appendChild(container);

          // Ensure React renders by calling update after DOM insertion
          requestAnimationFrame(() => {
            jupytutor.update();
          });
        } else {
          console.warn('Unknown cell type; not adding Jupytutor widget.');
        }
      }
    );
  }
};

export default plugin;
