#!/usr/bin/env python3
"""Safely extract a Baby Quirt release archive during a first installation."""

from __future__ import annotations

import os
import shutil
import sys
import tarfile
from pathlib import Path, PurePosixPath

MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 256 * 1024 * 1024
MAX_TOTAL_BYTES = 512 * 1024 * 1024
MAX_MEMBERS = 10000


def fail(message: str) -> "NoReturn":
    raise RuntimeError(message)


def validate_member_name(name: str, expected_prefix: str) -> PurePosixPath:
    if not name or "\x00" in name or "\\" in name:
        fail(f"unsafe archive path: {name!r}")

    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        fail(f"unsafe archive path: {name!r}")
    if path.parts[0] != expected_prefix:
        fail(f"archive entry outside expected prefix: {name!r}")
    return path


def ensure_within(root: Path, target: Path) -> None:
    root_real = root.resolve()
    target_real = target.resolve(strict=False)
    if os.path.commonpath((str(root_real), str(target_real))) != str(root_real):
        fail(f"path traversal detected: {target}")


def safe_extract(archive: Path, destination: Path, expected_prefix: str) -> None:
    if not archive.is_file() or archive.is_symlink():
        fail("archive path is not a regular file")
    if archive.stat().st_size > MAX_ARCHIVE_BYTES:
        fail("archive exceeds maximum allowed size")

    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        fail("destination must be empty")

    seen: set[str] = set()
    directory_modes: list[tuple[Path, int]] = []
    total_bytes = 0

    with tarfile.open(archive, mode="r:gz") as release:
        members = release.getmembers()
        if len(members) > MAX_MEMBERS:
            fail("archive contains too many entries")

        for member in members:
            path = validate_member_name(member.name, expected_prefix)
            normalized = path.as_posix()
            if normalized in seen:
                fail(f"duplicate archive entry: {member.name}")
            seen.add(normalized)

            if member.mode & 0o7000:
                fail(f"forbidden special permission bits: {member.name}")
            if not (member.isdir() or member.isreg()):
                fail(f"forbidden archive entry type: {member.name}")
            if member.size < 0 or member.size > MAX_FILE_BYTES:
                fail(f"file size out of bounds: {member.name}")

            total_bytes += member.size
            if total_bytes > MAX_TOTAL_BYTES:
                fail("decompressed archive exceeds maximum allowed size")

            target = destination.joinpath(*path.parts)
            ensure_within(destination, target)

            mode = member.mode & 0o777
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                directory_modes.append((target, mode or 0o755))
                continue

            target.parent.mkdir(parents=True, exist_ok=True)
            ensure_within(destination, target.parent)
            source = release.extractfile(member)
            if source is None:
                fail(f"could not read archive entry: {member.name}")

            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            fd = os.open(target, flags, mode or 0o644)
            written = 0
            try:
                with os.fdopen(fd, "wb", closefd=False) as output:
                    while True:
                        chunk = source.read(64 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > member.size:
                            fail(f"archive entry exceeded declared size: {member.name}")
                        output.write(chunk)
                    output.flush()
                    os.fsync(output.fileno())
                if written != member.size:
                    fail(f"truncated archive entry: {member.name}")
                os.fchmod(fd, mode or 0o644)
            finally:
                os.close(fd)
                source.close()

    release_root = destination / expected_prefix
    if not release_root.is_dir() or release_root.is_symlink():
        fail("extracted release root is missing")

    for directory, mode in reversed(directory_modes):
        os.chmod(directory, mode)


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: bootstrap-safe-extract.py <archive.tar.gz> <destination> <expected-prefix>",
            file=sys.stderr,
        )
        return 2

    archive = Path(sys.argv[1]).resolve()
    destination = Path(sys.argv[2]).resolve()
    expected_prefix = sys.argv[3]

    if not expected_prefix or "/" in expected_prefix or "\\" in expected_prefix:
        print("invalid expected prefix", file=sys.stderr)
        return 2

    try:
        safe_extract(archive, destination, expected_prefix)
    except (OSError, tarfile.TarError, RuntimeError) as exc:
        shutil.rmtree(destination, ignore_errors=True)
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
