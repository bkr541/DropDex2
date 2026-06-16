"""Allow `python -m rekordbox_bridge` invocation."""
import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
