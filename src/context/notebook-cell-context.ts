import { createContext, useContext } from 'react';

const NotebookContext = createContext<{ notebookPath: string | null }>({
  notebookPath: null
});

export const NotebookContextProvider = NotebookContext.Provider;
export const NotebookContextConsumer = NotebookContext.Consumer;

export const useNotebookPath = () => {
  const context = useContext(NotebookContext);
  if (!context || context.notebookPath === null) {
    throw new Error(
      'useNotebookId must be used within a NotebookContextProvider with a non-null notebookPath'
    );
  }
  return context.notebookPath;
};

const CellContext = createContext<{ cellId: string | null }>({
  cellId: null
});

export const CellContextProvider = CellContext.Provider;
export const CellContextConsumer = CellContext.Consumer;

export const useCellId = () => {
  const context = useContext(CellContext);
  if (!context || context.cellId === null) {
    throw new Error(
      'useCellId must be used within a CellContextProvider with a non-null cellId'
    );
  }
  return context.cellId;
};
