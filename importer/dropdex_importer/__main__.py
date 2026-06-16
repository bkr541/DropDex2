"""
Entry point for `python -m dropdex_importer`.

Subcommands:
  reparse  — reparse retained ANLZ assets without re-uploading
"""

import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m dropdex_importer <command>")
        print("Commands: reparse")
        sys.exit(1)

    command = sys.argv[1]
    if command == "reparse":
        from .reparse import main as reparse_main  # noqa: PLC0415

        # Strip the package name so argparse only sees "reparse <args>".
        # sys.argv[0] stays as-is (interpreter / __main__); drop sys.argv[1]
        # which is the subcommand, and pass the rest to the subcommand parser.
        sys.exit(reparse_main(sys.argv[2:]))
    else:
        print(f"Unknown command: {command}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
