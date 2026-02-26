import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import '../../style/index.css';

/**
 * Custom hook for managing fade-in visibility state
 * @param delay - Delay in milliseconds before setting visible to true (default: 100)
 * @returns boolean indicating visibility state
 */
const useFadeInVisibleState = (delay: number = 100): boolean => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, delay);

    return () => clearTimeout(timer);
  }, [delay]);

  return isVisible;
};

/**
 * Shared ReactMarkdown components configuration for consistent styling
 * across all message types
 */
const markdownComponents: Components = {
  a: ({ node, ...props }) => (
    <a
      className="assistant-link"
      {...props}
      target="_blank"
      rel="noopener noreferrer"
    />
  ),
  h1: ({ node, ...props }) => (
    <h1
      style={{
        fontSize: '1.4em',
        fontWeight: 'bold',
        marginTop: '0.8em',
        marginBottom: '0.4em'
      }}
      {...props}
    />
  ),
  h2: ({ node, ...props }) => (
    <h2
      style={{
        fontSize: '1.2em',
        fontWeight: 'bold',
        marginTop: '0.8em',
        marginBottom: '0.4em'
      }}
      {...props}
    />
  ),
  h3: ({ node, ...props }) => (
    <h3
      style={{
        fontSize: '1.1em',
        fontWeight: 'bold',
        marginTop: '0.6em',
        marginBottom: '0.3em'
      }}
      {...props}
    />
  )
};

export interface ChatHistoryItem {
  role: 'user' | 'assistant' | 'system';
  content: { text: string; type: string }[] | string;
  noShow?: boolean;
  index?: number;
}

export const ChatMessage = (props: ChatHistoryItem) => {
  const message =
    typeof props.content === 'string' ? props.content : props.content[0].text;
  const isUser = props.role === 'user';

  return (
    <div key={props.index} className="chat-message-wrapper">
      {isUser ? (
        <UserMessage message={message} position="right" />
      ) : (
        <AssistantMessage message={message} streaming={'streamed'} />
      )}
    </div>
  );
};

interface ChatBubbleProps {
  message: string;
  position: 'left' | 'right';
  timestamp?: string;
}

const UserMessage = (props: ChatBubbleProps): JSX.Element => {
  const { message, position, timestamp } = props;
  const isVisible = useFadeInVisibleState(100);

  return (
    <div
      className={`chat-bubble chat-bubble-${position} ${isVisible ? 'chat-bubble-visible' : ''}`}
    >
      <div className="chat-message">
        {/* <ReactMarkdown components={markdownComponents}> */}
        {message}
        {/* </ReactMarkdown> */}
      </div>
      {timestamp && <div className="chat-timestamp">{timestamp}</div>}
    </div>
  );
};

interface AssistantMessageProps {
  message: string;
  streaming: 'none' | 'streamed' | 'streaming';
}

export const AssistantMessage = (props: AssistantMessageProps): JSX.Element => {
  const { message, streaming } = props;
  const shouldFadeIn = streaming === 'none';
  const fadeInVisible = useFadeInVisibleState(100);
  const isVisible = shouldFadeIn ? fadeInVisible : true;

  return (
    <div className="chat-message-wrapper">
      <div className="streaming-message">
        <div
          className={`assistant-message ${isVisible ? 'assistant-visible' : ''} ${streaming === 'streaming' ? 'assistant-streaming' : ''}`}
        >
          <ReactMarkdown components={markdownComponents}>
            {message}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};
