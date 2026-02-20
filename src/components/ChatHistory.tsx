import { useCallback, useEffect, useRef } from 'react';
import { AssistantMessage, ChatHistoryItem, ChatMessage } from './ChatMessage';

import { throttle } from 'underscore';

type ChatHistoryProps = {
  chatHistory: ChatHistoryItem[];
  liveResult: string | null;
};

export function ChatHistory({ chatHistory, liveResult }: ChatHistoryProps) {
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const throttledScrollToBottom = useCallback(
    throttle(() => {
      if (chatContainerRef.current) {
        chatContainerRef.current.scrollTop =
          chatContainerRef.current.scrollHeight;
      }
    }, 250),
    []
  );

  // console.log({ chatContainerRef, chatHistory, liveResult });

  useEffect(() => {
    throttledScrollToBottom();
  }, [chatHistory, liveResult]);

  return (
    <div className="chat-container" ref={chatContainerRef}>
      {chatHistory
        .filter(item => !item.noShow)
        .map((item, index) => (
          <ChatMessage {...item} index={index} />
        ))}
      {/* The above handles the ChatHistory. Below handles a new streaming message. */}
      {liveResult && (
        <AssistantMessage message={liveResult} streaming={'streaming'} />
      )}
    </div>
  );
}
