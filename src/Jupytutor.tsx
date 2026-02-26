import { ReactWidget } from '@jupyterlab/apputils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../style/index.css';
import { ChatHistory } from './components/ChatHistory';
import { ChatInput } from './components/ChatInput';
import { TailoredOptions } from './components/TailoredOptions';
import {
  CellContextProvider,
  NotebookContextProvider
} from './context/notebook-cell-context';
import { useQueryAPIFunction } from './helpers/api/chat-api';
import { useCellConfig, usePatchKeyCommand750, useWidgetState } from './store';

export interface JupytutorProps {
  cellId: string;
  notebookPath: string;
  activeIndex: number;
}

export const Jupytutor = (props: JupytutorProps): JSX.Element => {
  const widgetState = useWidgetState();
  const quickResponses = useCellConfig()?.quickResponses ?? [];

  const { activeIndex } = props;

  const patchKeyCommand750 = usePatchKeyCommand750();
  const dataProps = patchKeyCommand750
    ? { 'data-lm-suppress-shortcuts': true }
    : {};

  const queryAPI = useQueryAPIFunction(activeIndex);

  const callSuggestion = async (suggestion: string) => {
    if (widgetState.isLoading) return;
    await queryAPI(suggestion);
  };

  const callChatInput = async (input: string) => {
    if (widgetState.isLoading) return;
    await queryAPI(input);
  };

  return (
    <div
      className={`jupytutor ${widgetState.isLoading ? 'loading' : ''}`}
      {...dataProps}
    >
      <ChatHistory
        chatHistory={widgetState.chatHistory}
        liveResult={widgetState.liveResult}
      />

      {quickResponses.length > 0 && (
        <TailoredOptions
          options={quickResponses}
          callSuggestion={callSuggestion}
          isLoading={widgetState.isLoading}
        />
      )}
      <ChatInput onSubmit={callChatInput} isLoading={widgetState.isLoading} />
    </div>
  );
};

// Provides an interface for Jupyter to render the React Component
class JupytutorWidget extends ReactWidget {
  private readonly props: JupytutorProps;
  private readonly queryClient: QueryClient;

  constructor(
    props: JupytutorProps = {
      cellId: '',
      notebookPath: '',
      activeIndex: -1
    }
  ) {
    super();
    this.props = props;
    this.queryClient = new QueryClient();
    this.addClass('jp-ReactWidget'); // For styling
  }

  render(): JSX.Element {
    return (
      <QueryClientProvider client={this.queryClient}>
        <NotebookContextProvider
          value={{ notebookPath: this.props.notebookPath }}
        >
          <CellContextProvider value={{ cellId: this.props.cellId }}>
            <Jupytutor {...this.props} />
          </CellContextProvider>
        </NotebookContextProvider>
      </QueryClientProvider>
    );
  }
}

export default JupytutorWidget;
