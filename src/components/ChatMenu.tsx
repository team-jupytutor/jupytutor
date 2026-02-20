import { Menu, MenuButton, MenuItem } from '@szhsin/react-menu';
import '@szhsin/react-menu/dist/index.css';
import { produce } from 'immer';
import { PluginConfig } from '../schemas/config';
import {
  useChatHistory,
  useNotebookConfig,
  useNotebookPreferences
} from '../store';

// COULD ADD OPTION TO HIDE / MINIMIZE THE CHAT HERE TOO, OR MAKE THIS A SEPARATE BUTTON

export const ChatMenu = () => {
  const [, setChatHistory] = useChatHistory();
  const [notebookConfig, setNotebookConfig] = useNotebookConfig();
  const proactiveEnabled = useNotebookPreferences()?.proactiveEnabled;

  return (
    <Menu
      menuButton={
        <MenuButton
          className={`menu-btn ${proactiveEnabled ? 'enabled' : 'disabled'}`}
          aria-label="Options"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 8 16"
            width="8"
            height="16"
            aria-hidden="true"
            style={{ fill: 'var(--jp-ui-font-color0)' }}
          >
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="4" cy="8" r="1.5" />
            <circle cx="4" cy="13" r="1.5" />
          </svg>
        </MenuButton>
      }
      direction="top"
      portal
    >
      <MenuItem onClick={() => setChatHistory([])}>Clear this chat</MenuItem>
      <MenuItem
        onClick={() =>
          setNotebookConfig(
            produce(
              // TODO maybe have a preferences hook, this is a little awkward
              notebookConfig ?? ({} as PluginConfig),
              (draft: PluginConfig) => {
                if (!draft.preferences) {
                  draft.preferences = { proactiveEnabled: !proactiveEnabled };
                  return;
                }
                draft.preferences.proactiveEnabled =
                  !draft.preferences.proactiveEnabled;
              }
            )
          )
        }
      >
        {proactiveEnabled
          ? 'Turn off Jupytutor for this notebook'
          : 'Turn on Jupytutor for this notebook'}
      </MenuItem>
    </Menu>
  );
};
