import '../../style/index.css';

interface TailoredOptionsProps {
  options: string[];
  callSuggestion: (suggestion: string) => void;
  isLoading: boolean;
}

export const TailoredOptions = (props: TailoredOptionsProps): JSX.Element => {
  return (
    <div
      className={`tailoredOptionsContainer ${props.isLoading ? 'loading' : ''}`}
    >
      {props.options.map((item, index) => (
        <TailoredOption
          text={item}
          key={index}
          callSuggestion={props.callSuggestion}
        />
      ))}
    </div>
  );
};

interface TailoredOptionProps {
  text: string;
  callSuggestion?: (suggestion: string) => void;
}

const TailoredOption = (props: TailoredOptionProps): JSX.Element => {
  return (
    <div
      className="tailoredOption"
      onClick={() => props.callSuggestion && props.callSuggestion(props.text)}
    >
      <h4>{props.text}</h4>
    </div>
  );
};
