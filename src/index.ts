import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Cell, CodeCell } from '@jupyterlab/cells';
import {
  INotebookModel,
  INotebookTracker,
  Notebook,
  NotebookActions
} from '@jupyterlab/notebook';
import JupytutorWidget from './Jupytutor';
import { applyConfigRules } from './helpers/config-rules';
import { parseContextFromNotebook } from './helpers/context/notebookContextParsing';
import NotebookContextRetrieval, {
  STARTING_TEXTBOOK_CONTEXT
} from './helpers/context/notebookContextRetrieval';
import parseNB from './helpers/parseNB';
import { ConfigSchema, PluginConfig } from './schemas/config';
import { useJupytutorReactState } from './store';
import { devLog } from './helpers/devLog';
import { patchKeyCommand750 } from './helpers/patch-keycommand-7.5.0';

// const assertNever = (x: never) => {
//   throw new Error(`Unexpected value: ${x}`);
// };

/**
 * Helper function to extract the user identifier from DataHub-style URLs
 * @returns The username/identifier from the URL path, or null if not found
 */
const getUserIdentifier = (): string | null => {
  const pathname = window.location.pathname;
  // Match DataHub-style URLs: /user/<username>/...
  const match = pathname.match(/\/user\/([^/]+)/);
  return match ? match[1] : null;
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
        window.location.host === 'data8-staging.berkeley.edu' ||
        window.location.host === 'prob140.datahub.berkeley.edu' ||
        window.location.host === 'prob140-staging.berkeley.edu' ||
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
    const userId = getUserIdentifier();

    let notebookContextRetriever: NotebookContextRetrieval | null = null;
    let pluginEnabled: boolean = false;

    const gatherNotebookContext = async () => {
      try {
        const currentWidget = notebookTracker.currentWidget;

        if (!currentWidget) {
          console.warn('No active notebook found for context gathering');
          return;
        }

        await currentWidget.context.ready;
        await currentWidget.revealed;

        const notebook = currentWidget.content;
        const notebookModel = notebook.model;
        if (!notebookModel) {
          console.warn('No notebook model found for context gathering');
          return;
        }

        const notebookConfig = loadConfiguration(notebookModel);

        // TODO: listen for changes
        pluginEnabled = notebookConfig.pluginEnabled;

        // Skip context gathering if activation flag criteria not met
        if (!pluginEnabled) {
          devLog(
            () =>
              'Activation flag not found in notebook. Skipping context gathering.'
          );
          return;
        }

        // Parse the notebook to get all cells and their links
        const [allCells, _] = parseNB(notebook);

        devLog(
          () => 'Gathered all cells from notebook on initial load.',
          () => allCells
        );

        notebookContextRetriever = await parseContextFromNotebook(
          allCells,
          notebookConfig
        );

        devLog(() => 'Textbook Context Gathering Completed\n');

        devLog(
          () => 'Starting Textbook Prompt:\n',
          () => STARTING_TEXTBOOK_CONTEXT
        );

        devLog(
          () => 'Textbook Context Snippet:\n',
          async () =>
            (await notebookContextRetriever?.getContext())?.substring(
              STARTING_TEXTBOOK_CONTEXT.length,
              STARTING_TEXTBOOK_CONTEXT.length + 500
            )
        );

        devLog(
          () => 'Textbook Context Length:\n',
          async () => (await notebookContextRetriever?.getContext())?.length
        );

        devLog(
          () => 'Textbook Source Links:\n',
          async () => await notebookContextRetriever?.getSourceLinks()
        );
      } catch (error) {
        console.error('Error gathering context:', error);
      }
    };

    // Gather context when a notebook is opened or becomes active
    notebookTracker.currentChanged.connect(gatherNotebookContext);

    // Also gather context immediately if there's already an active notebook
    if (notebookTracker.currentWidget) {
      gatherNotebookContext();
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

        const notebookConfig = loadConfiguration(notebookModel);

        devLog(() => ({ notebookConfig }));

        if (!notebookConfig.pluginEnabled) {
          // NEVER DO ANYTHING IF THE ACTIVATION FLAG IS NOT MET, NO MATTER WHAT
          return;
        }

        const cellIndex = [...notebookModel.cells].findIndex(
          c => c === cell.model
        );
        const cellConfig = applyConfigRules(
          notebookModel,
          cellIndex,
          notebookConfig.rules
        );
        devLog(() => ({ cellConfig }));

        const proactiveEnabledForSession =
          notebookConfig.preferences.proactiveEnabled;

        const proactiveEnabledForCell =
          cellConfig.chatProactive && proactiveEnabledForSession;

        if (cellConfig.chatEnabled && proactiveEnabledForCell) {
          const [allCells, activeIndex] = parseNB(notebook);

          const jupytutor = new JupytutorWidget({
            autograderResponse: '',
            allCells,
            activeIndex,
            localContextScope: 'upToGrader',
            sendTextbookWithRequest:
              notebookConfig.remoteContextGathering.enabled,
            notebookContextRetriever,
            cellType: 'code',
            userId,
            baseURL: notebookConfig.api.baseURL,
            instructorNote: cellConfig.instructorNote,
            quickResponses: cellConfig.quickResponses,
            setNotebookConfig: (newConfig: PluginConfig) => {
              // todo possibly put this function in the zustand state, too
              notebookModel.setMetadata('jupytutor', newConfig);
              loadConfiguration(notebookModel);
            }
          });

          // TODO: rejig 'active cell' logic

          if (cell.model.type === 'code') {
            const codeCell = cell as CodeCell;

            if (codeCell.outputArea && codeCell.outputArea.layout) {
              (codeCell.outputArea.layout as any).addWidget(jupytutor);
            }
          } else if (cell.model.type === 'markdown') {
            // Check if there's already a JupyTutor widget in this cell and remove it
            const existingContainer = cell.node.querySelector(
              '.jp-jupytutor-markdown-container'
            );
            if (existingContainer) {
              existingContainer.remove();
            }

            // Create a proper container div with React mounting point
            const container = document.createElement('div');
            container.className = 'jp-jupytutor-markdown-container';
            container.style.cssText = `
          margin-top: 15px;
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          padding: 0;
          background-color: #ffffff;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        `;

            // Mount the ReactWidget properly
            container.appendChild(jupytutor.node);

            // Add to the cell
            cell.node.appendChild(container);

            // Ensure React renders by calling update after DOM insertion
            requestAnimationFrame(() => {
              jupytutor.update();
            });
          } else {
            console.warn('Unknown cell type; not adding Jupytutor widget.');
          }
        }
      }
    );
  }
};

const loadConfiguration = (notebookModel: INotebookModel) => {
  const rawConfig = notebookModel.getMetadata('jupytutor') ?? {};
  const notebookConfig = ConfigSchema.parse(rawConfig);
  // reload into Zustand store
  useJupytutorReactState.setState({ notebookConfig });
  return notebookConfig;
};

export default plugin;
