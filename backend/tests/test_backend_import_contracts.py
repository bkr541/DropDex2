"""Static contracts for backend package imports.

These tests intentionally avoid importing the application so they can detect a
broken import graph even when the broken graph would prevent pytest collection.
"""

from __future__ import annotations

import ast
from pathlib import Path


APP_ROOT = Path(__file__).resolve().parents[1] / "app"


def _module_name(path: Path) -> str:
    relative = path.relative_to(APP_ROOT).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(("app", *parts))


def _top_level_names(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(
                target.id for target in node.targets if isinstance(target, ast.Name)
            )
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            names.add(node.target.id)
        elif isinstance(node, ast.Import):
            names.update(alias.asname or alias.name.split(".", 1)[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.update(alias.asname or alias.name for alias in node.names)
    return names


def test_relative_symbol_imports_resolve_to_real_module_exports():
    modules: dict[str, tuple[Path, ast.Module, set[str]]] = {}
    package_children: dict[str, set[str]] = {}

    for path in APP_ROOT.rglob("*.py"):
        module = _module_name(path)
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        modules[module] = (path, tree, _top_level_names(tree))
        if "." in module:
            parent, child = module.rsplit(".", 1)
            package_children.setdefault(parent, set()).add(child)

    failures: list[str] = []
    for source_module, (path, tree, _names) in modules.items():
        source_package = source_module.rsplit(".", 1)[0]
        package_parts = source_package.split(".")

        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.level == 0:
                continue

            base_parts = package_parts[: len(package_parts) - node.level + 1]
            target_module = ".".join(
                (*base_parts, *((node.module or "").split(".") if node.module else ()))
            )
            target = modules.get(target_module)
            if target is None:
                continue

            exported_names = target[2]
            child_modules = package_children.get(target_module, set())
            for alias in node.names:
                if alias.name == "*":
                    continue
                if alias.name not in exported_names and alias.name not in child_modules:
                    failures.append(
                        f"{path.relative_to(APP_ROOT.parent)}:{node.lineno} imports "
                        f"missing {target_module}.{alias.name}"
                    )

    assert not failures, "Unresolved relative imports:\n" + "\n".join(sorted(failures))
