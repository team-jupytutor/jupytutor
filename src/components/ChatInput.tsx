import { useCallback, useState } from 'react';
import '../../style/index.css';
import { ChatMenu } from './ChatMenu';

interface ChatInputProps {
  onSubmit: (input: string) => void;
  isLoading: boolean;
}

export const ChatInput = (props: ChatInputProps): JSX.Element => {
  const { onSubmit, isLoading } = props;

  const [value, setValue] = useState('');

  const handleSubmit = useCallback(() => {
    onSubmit(value);
    setValue('');
  }, [onSubmit, value]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, isLoading]
  );

  return (
    <div className={`chat-input-container ${isLoading ? 'loading' : ''}`}>
      <ChatMenu />
      <input
        type="text"
        className={`chat-input ${isLoading ? 'loading' : ''}`}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder="Ask JupyTutor anything..."
        disabled={isLoading}
      />
      <button
        className={`chat-submit-btn ${isLoading ? 'loading' : ''}`}
        onClick={handleSubmit}
        disabled={isLoading || !value.trim()}
      >
        {isLoading ? (
          <div className="loading-spinner">
            <div className="spinner-ring"></div>
          </div>
        ) : (
          <svg className="submit-icon" viewBox="0 0 24 24" fill="none">
            <path
              d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </div>
  );
};
