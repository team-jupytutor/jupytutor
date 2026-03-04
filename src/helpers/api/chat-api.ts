import { useCallback, useMemo } from 'react';
import { ChatHistoryItem } from '../../components/ChatMessage';
import {
  useCellId,
  useNotebookPath
} from '../../context/notebook-cell-context';
import {
  useChatHistory,
  useIsLoading,
  useJupytutorReactState,
  useLiveResult,
  useNotebookConfig
} from '../../store';
import { devLog } from '../devLog';
import { ParsedCell } from '../parseNB';
import { getPromptContextFromCells } from '../prompt-context/prompt-context';

type V2InputChunk =
  | {
      type: 'input_text';
      text: string;
    }
  | {
      type: 'input_image';
      image_url: string;
    };

export const useQueryAPIFunction = () => {
  const cellId = useCellId();
  const notebookPath = useNotebookPath();
  const parsedCells = useJupytutorReactState(
    state => state.notebookStateByPath[notebookPath]?.parsedCells ?? []
  );
  const [notebookConfig] = useNotebookConfig();
  const baseURL = notebookConfig?.api.baseURL ?? '';
  const globalNotebookContextRetriever = useJupytutorReactState(
    state =>
      state.notebookStateByPath[notebookPath]?.globalNotebookContextRetriever ??
      null
  );

  const [chatHistory, setChatHistory] = useChatHistory();
  const [, setLiveResult] = useLiveResult();
  const [, setIsLoading] = useIsLoading();
  const userId = useJupytutorReactState(state => state.userId);
  const jupyterhubHostname = useJupytutorReactState(
    state => state.jupyterhubHostname
  );
  const appendCellHistoryEvent = useJupytutorReactState(
    state => state.appendCellHistoryEvent
  );
  const appendCellHistoryEventForCell = useMemo(
    () => appendCellHistoryEvent(notebookPath)(cellId),
    [appendCellHistoryEvent, notebookPath, cellId]
  );

  const queryAPI = useCallback(
    async (chatInput: string) => {
      const userMessage: ChatHistoryItem = {
        role: 'user',
        content: chatInput
      };
      const eagerUpdatedChatHistory = [...chatHistory, userMessage];
      setChatHistory(eagerUpdatedChatHistory);

      setIsLoading(true);

      const promptContext = await getPromptContextFromCells(
        notebookPath,
        parsedCells,
        globalNotebookContextRetriever,
        cellId
      );

      devLog(
        () => 'Prompt context for request:',
        () => promptContext
      );

      const images = gatherImagesFromCells(parsedCells, cellId, 10, 5);
      const newMessage: V2InputChunk[] = [
        {
          type: 'input_text',
          text: chatInput
        },
        ...images.map(
          image =>
            ({
              type: 'input_image',
              image_url: image
            }) as V2InputChunk
        )
      ];

      if (images.length > 0) {
        devLog(
          () => `Including ${images.length} image(s) in v2 user message`
        );
      }

      try {
        // Use streaming request
        setLiveResult(''); // Clear previous live result

        // Derived convenience fields FOR NOW
        const courseId = jupyterhubHostname?.split('.')[0] ?? '';
        const assignmentId = notebookPath
          ? (notebookPath
              .split('/')
              .pop()
              ?.replace(/\.ipynb$/, '') ?? '')
          : '';
        const requestBody = {
          promptContext,
          newMessage,
          stream: true,
          userId: userId ?? '',
          jupyterhubHostname: jupyterhubHostname ?? '',
          notebookPath: notebookPath ?? '',
          courseId,
          assignmentId
        };

        devLog(
          () => 'Sending v2 API request:',
          () => {
            return {
              endpoint: `${baseURL}interaction/v2/stream`,
              imageCount: images.length,
              promptContextKeys: Object.keys(promptContext.resources ?? {})
            };
          }
        );

        const response = await fetch(`${baseURL}interaction/v2/stream`, {
          method: 'POST',
          body: JSON.stringify(requestBody),
          headers: {
            'Content-Type': 'application/json'
          },
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
        let finalResponsePayload: unknown = null;

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
                    finalResponsePayload = data.data;
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

        const fallbackAssistantText = getAssistantTextFromFinalResponsePayload(
          finalResponsePayload
        );
        const finalAssistantText =
          currentMessage.trim().length > 0
            ? currentMessage.trim()
            : fallbackAssistantText;
        const finalChatHistory: ChatHistoryItem[] =
          finalAssistantText.length > 0
            ? [
                ...eagerUpdatedChatHistory,
                {
                  role: 'assistant',
                  content: finalAssistantText
                }
              ]
            : eagerUpdatedChatHistory;

        setChatHistory(finalChatHistory);
        appendCellHistoryEventForCell({
          timestamp: Date.now(),
          type: 'chat',
          sender: 'user',
          content: chatInput
        });
        if (finalAssistantText.length > 0) {
          appendCellHistoryEventForCell({
            timestamp: Date.now(),
            type: 'chat',
            sender: 'assistant',
            content: finalAssistantText
          });
        }
        setLiveResult(null);
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
      appendCellHistoryEventForCell,
      setChatHistory,
      setLiveResult,
      setIsLoading,
      userId,
      jupyterhubHostname,
      notebookPath,
      baseURL,
      globalNotebookContextRetriever,
      parsedCells
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
  relativeTo: string,
  maxGoBack: number,
  maxImages: number = 5
) => {
  const relativeToIndex = cells.findIndex(cell => cell.id === relativeTo);
  const images: string[] = [];
  for (
    let i = relativeToIndex;
    i > Math.max(0, relativeToIndex - maxGoBack);
    i--
  ) {
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

const chatHistoryItemToText = (item: ChatHistoryItem): string => {
  if (typeof item.content === 'string') {
    return item.content;
  }

  return item.content[item.content.length - 1]?.text ?? '';
};

const isChatHistoryItem = (item: unknown): item is ChatHistoryItem => {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Partial<ChatHistoryItem>;

  if (candidate.role !== 'user' && candidate.role !== 'assistant') {
    return false;
  }

  if (typeof candidate.content === 'string') return true;
  if (!Array.isArray(candidate.content)) return false;

  return candidate.content.every(
    messagePart =>
      !!messagePart &&
      typeof messagePart === 'object' &&
      typeof messagePart.text === 'string' &&
      typeof messagePart.type === 'string'
  );
};

const sanitizeChatHistory = (items: unknown[]): ChatHistoryItem[] =>
  items.filter(isChatHistoryItem);

const getAssistantTextFromFinalResponsePayload = (payload: unknown): string => {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const candidate = payload as { newChatHistory?: unknown };
  if (!Array.isArray(candidate.newChatHistory)) {
    return '';
  }

  const visibleChatHistory = sanitizeChatHistory(candidate.newChatHistory);
  for (let i = visibleChatHistory.length - 1; i >= 0; i--) {
    const item = visibleChatHistory[i];
    if (item.role === 'assistant') {
      return chatHistoryItemToText(item).trim();
    }
  }

  return '';
};

// const filterCells = (
//   cells: ParsedCell[],
//   scope: 'whole' | 'upToGrader' | 'fiveAround' | 'tenAround' | 'none',
//   relativeToIndex: number
// ) => {
//   switch (scope) {
//     case 'whole':
//       return cells;
//     case 'upToGrader':
//       return cells.slice(0, Math.max(0, relativeToIndex + 1));
//     case 'fiveAround':
//       return cells.slice(
//         Math.max(0, relativeToIndex - 5),
//         Math.min(cells.length, relativeToIndex + 5)
//       );
//     case 'tenAround':
//       return cells.slice(
//         Math.max(0, relativeToIndex - 10),
//         Math.min(cells.length, relativeToIndex + 10)
//       );
//     case 'none':
//       return [cells[relativeToIndex]];
//   }
// };

// const gatherLocalContext = async (
//   allCells: ParsedCell[],
//   cellId: string,
//   sendTextbookWithRequest: boolean,
//   contextRetriever: GlobalNotebookContextRetrieval | null,
//   instructorNote: string | null
// ) => {
//   const activeCell = allCells.find(cell => cell.id === cellId);
//   const filteredCells = allCells.filter(
//     cell =>
//       cell.imageSources.length > 0 || cell.text !== '' || cell.text != null
//   );
//   const cellIndexInFiltered = filteredCells.findIndex(
//     cell => cell === activeCell
//   );
//   return await createChatContextFromCells(
//     // TODO: consider using other filtering mechanisms
//     filterCells(filteredCells, 'upToGrader', cellIndexInFiltered),
//     sendTextbookWithRequest,
//     contextRetriever,
//     instructorNote
//   );
// };

// const getCodeCellOutputAsLLMContent = (
//   cell: ParsedCell
// ): { type: 'input_text'; text: string }[] => {
//   return cell.outputs.map(output => {
//     if ('image/png' in output.data) {
//       return {
//         type: 'input_text',
//         // TODO: include in the chat prompt
//         text: '[Image output]'
//       };
//     }
//     if ('text/html' in output.data) {
//       return {
//         type: 'input_text',
//         text: output.data['text/html']?.toString() ?? ''
//       };
//     }
//     if ('text/plain' in output.data) {
//       return {
//         type: 'input_text',
//         text: output.data['text/plain']?.toString() ?? ''
//       };
//     }
//     // TODO: make sure this is getting trimmed somewhere
//     return { type: 'input_text', text: JSON.stringify(output.data) };
//   });
// };

// const createChatContextFromCells = async (
//   cells: ParsedCell[],
//   sendTextbookWithRequest: boolean,
//   contextRetriever: GlobalNotebookContextRetrieval | null,
//   instructorNote: string | null
// ): Promise<ChatHistoryItem[]> => {
//   let textbookContext: ChatHistoryItem[] = [];
//   if (sendTextbookWithRequest && contextRetriever != null) {
//     const context = await contextRetriever.getContext();

//     textbookContext = [
//       {
//         role: 'system',
//         content: [
//           {
//             text: STARTING_TEXTBOOK_CONTEXT,
//             type: 'input_text'
//           }
//         ],
//         noShow: true
//       },
//       {
//         role: 'system',
//         content: [
//           {
//             text: JSON.stringify(context ?? {}),
//             type: 'input_text'
//           }
//         ],
//         noShow: true
//       }
//     ];
//     devLog(() => 'Sending textbook with request');
//   } else {
//     devLog(() => 'NOT sending textbook with request');
//   }

//   const notebookContext: ChatHistoryItem[] = cells.map(cell => {
//     const output = getCodeCellOutputAsLLMContent(cell);
//     const hasOutput = output.length > 0;
//     if (hasOutput && cell.type === 'code') {
//       return {
//         role: 'system' as const,
//         content: [
//           {
//             text:
//               cell.text + '\nThe above code produced the following output:\n',
//             type: 'input_text'
//           },
//           ...output
//         ],
//         noShow: true
//       };
//     } else if (cell.type === 'markdown') {
//       devLog(() => 'Sending free response prompt with request!');

//       return {
//         role: 'system' as const,
//         content: [
//           {
//             text: cell.text,
//             type: 'input_text'
//           }
//         ],
//         noShow: true
//       };
//     }
//     return {
//       role: 'system' as const,
//       content: [
//         {
//           text: cell.text ?? '',
//           type: 'input_text'
//         }
//       ],
//       noShow: true
//     };
//   });

//   return [
//     ...textbookContext,
//     ...notebookContext,
//     ...(instructorNote !== null
//       ? [
//           {
//             role: 'system' as const,
//             content: [
//               {
//                 text: instructorNote,
//                 type: 'input_text'
//               }
//             ],
//             noShow: true
//           }
//         ]
//       : [])
//   ];
// };
