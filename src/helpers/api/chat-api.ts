import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import z from 'zod';
import { ChatHistoryItem } from '../../components/ChatMessage';
import { useNotebookPath } from '../../context/notebook-cell-context';
import {
  useCellConfig,
  useChatHistory,
  useIsLoading,
  useJupytutorReactState,
  useLiveResult,
  useNotebookConfig
} from '../../store';
import { devLog } from '../devLog';
import { ParsedCell } from '../parseNB';
import GlobalNotebookContextRetrieval, {
  STARTING_TEXTBOOK_CONTEXT
} from '../prompt-context/globalNotebookContextRetrieval';

/**
 * Converts a base64 data URL to a File object
 * @param {string} dataUrl - Base64 data URL (e.g., "data:image/png;base64,iVBORw0KGgo...")
 * @param {string} filename - Name for the file
 * @returns {File} File object
 */
const dataUrlToFile = (
  dataUrl: string,
  filename: string = 'file'
): File | null => {
  try {
    // Validate data URL format
    if (!dataUrl.startsWith('data:')) {
      // throw new Error('Invalid data URL: must start with "data:"');
      devLog.warn(
        () => 'Invalid data URL: must start with "data:"',
        () => dataUrl
      );
      return null;
    }

    const [header, base64Data] = dataUrl.split(',');
    if (!base64Data) {
      // throw new Error('Invalid data URL: missing base64 data');
      devLog.warn(
        () => 'Invalid data URL: missing base64 data',
        () => dataUrl
      );
      return null;
    }

    const mimeMatch = header.match(/data:([^;]+)/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

    // Validate MIME type for images
    if (!mimeType.startsWith('image/')) {
      devLog.warn(
        () => `Unexpected MIME type: ${mimeType}, expected image/*`,
        () => dataUrl
      );
      return null;
    }

    // Convert base64 to binary
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);

    // Create File object
    const file = new File([byteArray], filename, { type: mimeType });

    devLog(
      () =>
        `Created file: ${filename}, type: ${mimeType}, size: ${file.size} bytes`
    );

    return file;
  } catch (error) {
    devLog.error(
      () => 'Error converting data URL to File:',
      () => error
    );
    devLog.error(
      () => 'Data URL preview:',
      () => dataUrl.substring(0, 100) + '...'
    );
    throw new Error(
      `Invalid data URL format: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const getFilenameForImage = (image: string, index: number) => {
  try {
    const [header] = image.split(',');
    const mimeMatch = header.match(/data:([^;]+)/);
    if (mimeMatch) {
      const mimeType = mimeMatch[1];
      const extension =
        mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/jpeg'
            ? 'jpg'
            : mimeType === 'image/gif'
              ? 'gif'
              : 'png';
      return `image_${index}.${extension}`;
    }
    return `image_${index}.png`;
  } catch (error) {
    console.warn('Could not extract filename from image:', error);
    return `image_${index}.png`;
  }
};

export const useQueryAPIFunction = (relativeTo: number) => {
  const notebookPath = useNotebookPath();
  const parsedCells = useJupytutorReactState(
    state => state.notebookStateByPath[notebookPath]?.parsedCells ?? []
  );
  const [notebookConfig] = useNotebookConfig();
  const sendTextbookWithRequest =
    notebookConfig?.remoteContextGathering.enabled ?? false;
  const baseURL = notebookConfig?.api.baseURL ?? '';
  const globalNotebookContextRetriever = useJupytutorReactState(
    state =>
      state.notebookStateByPath[notebookPath]?.globalNotebookContextRetriever ??
      null
  );
  const instructorNote = useCellConfig()?.instructorNote ?? null;

  const localContext = useQuery({
    queryKey: [
      'localContext',
      parsedCells,
      relativeTo,
      globalNotebookContextRetriever,
      instructorNote
    ],
    queryFn: async () => {
      const context = await gatherLocalContext(
        parsedCells,
        relativeTo,
        sendTextbookWithRequest,
        globalNotebookContextRetriever,
        instructorNote
      );
      return context;
    }
  });

  const [chatHistory, setChatHistory] = useChatHistory();
  const [, setLiveResult] = useLiveResult();
  const [, setIsLoading] = useIsLoading();
  const userId = useJupytutorReactState(state => state.userId);

  const queryAPI = useCallback(
    async (chatInput: string) => {
      // Add user message immediately for responsiveness
      const userMessage: ChatHistoryItem = {
        role: 'user',
        content: chatInput
      };
      const eagerUpdatedChatHistory = [...chatHistory, userMessage];
      setChatHistory(eagerUpdatedChatHistory);

      setIsLoading(true);
      const images = gatherImagesFromCells(parsedCells, relativeTo, 10, 5);

      if (images.length > 0) {
        devLog(
          () => 'Image detected.'
          //images[0].substring(0, 100) + '...'
        );
      }

      try {
        // PRTODO broken
        // await localContext.promise;
        const localContextData = localContext.data ?? [];
        const chatHistoryToSend = [...localContextData, ...chatHistory];

        const imageFiles = images.map((image, index) => {
          const filename = getFilenameForImage(image, index);

          return {
            name: filename,
            file: dataUrlToFile(image, filename)
          };
        });

        // Use streaming request
        setLiveResult(''); // Clear previous live result

        // Create FormData for streaming request
        const formData = new FormData();
        formData.append('chatHistory', JSON.stringify(chatHistoryToSend));
        formData.append('images', JSON.stringify(images));
        formData.append('newMessage', chatInput);
        // TODO: pending server update (prompts come from client); for now, this prompt assumes test failed
        formData.append('cellType', 'grader');
        formData.append('userId', userId ?? '');

        // Add files
        imageFiles
          .filter(file => file.file instanceof File)
          .forEach(file => {
            if (file.file) {
              formData.append(file.name, file.file);
            }
          });

        const response = await fetch(`${baseURL}interaction/stream`, {
          method: 'POST',
          body: formData,
          mode: 'cors',
          credentials: 'include',
          cache: 'no-cache'
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let currentMessage = '';

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
              if (line.trim() === '') continue;

              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));

                  if (data.type === 'message_delta') {
                    currentMessage += data.content;
                    setLiveResult(currentMessage);
                  } else if (data.type === 'final_response') {
                    // Complete message received - add to chat history

                    const { newChatHistory } = z
                      .object({
                        newChatHistory: z.array(z.any())
                      })
                      .parse(data.data);

                    setChatHistory(newChatHistory);
                    setLiveResult(null); // Clear live result when message is complete
                    break;
                  }
                } catch (parseError) {
                  devLog.error(
                    () => 'Failed to parse SSE data:',
                    () => parseError,
                    () => 'Line:',
                    () => line
                  );
                }
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        devLog.error(
          () => 'API request failed:',
          () => error
        );
        // Remove user message if request failed
        setChatHistory(chatHistory); // from before adding the user message
      }

      setIsLoading(false);
    },
    [
      chatHistory,
      setChatHistory,
      setLiveResult,
      setIsLoading,
      userId,
      baseURL,
      sendTextbookWithRequest,
      globalNotebookContextRetriever,
      parsedCells,
      instructorNote,
      relativeTo,
      localContext,
      sendTextbookWithRequest
    ]
  );

  return queryAPI;
};

/**
 * Include images from all code cells and the first non-code cell back from the active indexwith images
 *
 * @param cells - the cells to gather images from
 * @param maxGoBack - the maximum number of cells to go back to find an image
 * @returns a string of images from the cells
 */
const gatherImagesFromCells = (
  cells: ParsedCell[],
  relativeTo: number,
  maxGoBack: number,
  maxImages: number = 5
) => {
  const images = [];
  for (let i = relativeTo; i > Math.max(0, relativeTo - maxGoBack); i--) {
    const cell = cells[i];
    if (cell.imageSources.length > 0 && cell.type === 'code') {
      images.push(...cell.imageSources);
    }
    if (cell.imageSources.length > 0 && cell.type !== 'code') {
      images.push(...cell.imageSources);
      break;
    }
  }
  return images.slice(0, maxImages);
};

const filterCells = (
  cells: ParsedCell[],
  scope: 'whole' | 'upToGrader' | 'fiveAround' | 'tenAround' | 'none',
  relativeTo: number
) => {
  switch (scope) {
    case 'whole':
      return cells;
    case 'upToGrader':
      return cells.slice(0, Math.max(0, relativeTo + 1));
    case 'fiveAround':
      return cells.slice(
        Math.max(0, relativeTo - 5),
        Math.min(cells.length, relativeTo + 5)
      );
    case 'tenAround':
      return cells.slice(
        Math.max(0, relativeTo - 10),
        Math.min(cells.length, relativeTo + 10)
      );
    case 'none':
      return [cells[relativeTo]];
  }
};

const gatherLocalContext = async (
  allCells: ParsedCell[],
  relativeTo: number,
  sendTextbookWithRequest: boolean,
  contextRetriever: GlobalNotebookContextRetrieval | null,
  instructorNote: string | null
) => {
  const activeCell = allCells[relativeTo];
  const filteredCells = allCells.filter(
    cell =>
      cell.imageSources.length > 0 || cell.text !== '' || cell.text != null
  );
  const newActiveIndex = filteredCells.findIndex(cell => cell === activeCell);
  return createChatContextFromCells(
    // TODO: consider using other filtering mechanisms
    filterCells(filteredCells, 'upToGrader', newActiveIndex),
    sendTextbookWithRequest,
    contextRetriever,
    instructorNote
  );
};

const getCodeCellOutputAsLLMContent = (
  cell: ParsedCell
): { type: 'input_text'; text: string }[] => {
  return cell.outputs.map(output => {
    if ('image/png' in output.data) {
      return {
        type: 'input_text',
        // TODO: include in the chat prompt
        text: '[Image output]'
      };
    }
    if ('text/html' in output.data) {
      return {
        type: 'input_text',
        text: output.data['text/html']?.toString() ?? ''
      };
    }
    if ('text/plain' in output.data) {
      return {
        type: 'input_text',
        text: output.data['text/plain']?.toString() ?? ''
      };
    }
    // TODO: make sure this is getting trimmed somewhere
    return { type: 'input_text', text: JSON.stringify(output.data) };
  });
};

const createChatContextFromCells = async (
  cells: ParsedCell[],
  sendTextbookWithRequest: boolean,
  contextRetriever: GlobalNotebookContextRetrieval | null,
  instructorNote: string | null
): Promise<ChatHistoryItem[]> => {
  let textbookContext: ChatHistoryItem[] = [];
  if (sendTextbookWithRequest && contextRetriever != null) {
    const context = await contextRetriever.getContext();

    textbookContext = [
      {
        role: 'system',
        content: [
          {
            text: STARTING_TEXTBOOK_CONTEXT,
            type: 'input_text'
          }
        ],
        noShow: true
      },
      {
        role: 'system',
        content: [
          {
            text: context || '',
            type: 'input_text'
          }
        ],
        noShow: true
      }
    ];
    devLog(() => 'Sending textbook with request');
  } else {
    devLog(() => 'NOT sending textbook with request');
  }

  const notebookContext: ChatHistoryItem[] = cells.map(cell => {
    const output = getCodeCellOutputAsLLMContent(cell);
    const hasOutput = output.length > 0;
    if (hasOutput && cell.type === 'code') {
      return {
        role: 'system' as const,
        content: [
          {
            text:
              cell.text + '\nThe above code produced the following output:\n',
            type: 'input_text'
          },
          ...output
        ],
        noShow: true
      };
    } else if (cell.type === 'markdown') {
      devLog(() => 'Sending free response prompt with request!');

      return {
        role: 'system' as const,
        content: [
          {
            text: cell.text,
            type: 'input_text'
          }
        ],
        noShow: true
      };
    }
    return {
      role: 'system' as const,
      content: [
        {
          text: cell.text ?? '',
          type: 'input_text'
        }
      ],
      noShow: true
    };
  });

  return [
    ...textbookContext,
    ...notebookContext,
    ...(instructorNote !== null
      ? [
          {
            role: 'system' as const,
            content: [
              {
                text: instructorNote,
                type: 'input_text'
              }
            ],
            noShow: true
          }
        ]
      : [])
  ];
};
