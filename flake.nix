{
  description = "Development shell for jupytutor";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        pythonEnv = pkgs.python311.withPackages (ps: [
          ps.pip
        ]);
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pythonEnv
            pkgs.nodejs_20
            pkgs.yarn
            pkgs.git
            pkgs.screen
            pkgs.ncurses
            pkgs.stdenv.cc.cc.lib
            pkgs.zlib
          ];
          env = {
            PIP_DISABLE_PIP_VERSION_CHECK = "1";
            PYTHONNOUSERSITE = "1";
          };
          shellHook = ''
            export SHELL=${pkgs.bashInteractive}/bin/bash
            export TERMINFO_DIRS="${pkgs.ncurses}/share/terminfo''${TERMINFO_DIRS:+:$TERMINFO_DIRS}"
            export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            VENV_DIR="$PWD/.venv"
            recreate_venv=0
            if [ ! -f "$VENV_DIR/bin/activate" ] || [ ! -f "$VENV_DIR/pyvenv.cfg" ]; then
              recreate_venv=1
            elif ! grep -q "VIRTUAL_ENV=$VENV_DIR" "$VENV_DIR/bin/activate"; then
              recreate_venv=1
            fi

            if [ "$recreate_venv" -eq 1 ]; then
              echo "Creating .venv (missing or path changed)"
              rm -rf "$VENV_DIR"
              ${pkgs.python311}/bin/python -m venv .venv
            fi

            # Activate repo-local venv so installs are writable and path-local.
            . "$VENV_DIR/bin/activate"
            echo "Virtualenv active: .venv"
            echo "Installing environment packages (numpy, otter-grader, datascience)"
            python -m pip install --upgrade pip
            python -m pip install build twine hatchling hatch-jupyter-builder
            python -m pip install numpy otter-grader datascience
            echo "Installing JupyterLab + kernel in venv"
            python -m pip install jupyterlab ipykernel notebook==7.5.0
            echo "Installing classic Notebook + enabling server extension"
            python -m ipykernel install --user --name jupytutor-venv --display-name "Jupytutor (venv)"
            # echo "Next: jlpm install"
            "$VENV_DIR/bin/jlpm" install
            # echo "Then: pip install -e ."
            python -m pip install -e .
            jupyter server extension enable notebook
            jupyter labextension develop . --overwrite
            echo "jupytutor dev shell ready"
            echo "Run JupyterLab: jupyter lab"
            echo "Or, to build prod release: jlpm install; jlpm build:prod; python -m build"
            echo "(to clean first: jlpm clean:all && rm -rf dist build *.egg-info jupytutor/labextension)"
          '';
        };
      });
}
