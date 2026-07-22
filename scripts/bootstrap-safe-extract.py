#!/usr/bin/env python3
"""Strict, bounded extraction for StealthEye release archives."""

from __future__ import annotations

import gzip
import os
import re
import shutil
import stat
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import BinaryIO, NoReturn

BLOCK = 512
MAX_ARCHIVE_BYTES = int(os.environ.get("BABY_QUIRT_MAX_ARCHIVE_BYTES", 512 * 1024 * 1024))
MAX_FILE_BYTES = int(os.environ.get("BABY_QUIRT_MAX_ARCHIVE_FILE_BYTES", 256 * 1024 * 1024))
MAX_TOTAL_BYTES = int(os.environ.get("BABY_QUIRT_MAX_DECOMPRESSED_BYTES", 512 * 1024 * 1024))
MAX_MEMBERS = int(os.environ.get("BABY_QUIRT_MAX_ARCHIVE_MEMBERS", 20000))
PREFIX = re.compile(r"^[A-Za-z0-9._-]+$")
ZERO_BLOCK = b"\0" * BLOCK


def fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def parse_octal(raw: bytes, label: str) -> int:
    if raw and raw[0] & 0x80:
        fail(f"base-256 tar numeric field is unsupported: {label}")
    value = raw.rstrip(b"\0 ").lstrip(b" ")
    if not value:
        return 0
    if any(byte not in b"01234567" for byte in value):
        fail(f"malformed tar numeric field: {label}")
    return int(value, 8)


def parse_string(raw: bytes, label: str) -> str:
    nul = raw.find(b"\0")
    if nul >= 0:
        if any(raw[nul + 1 :]):
            fail(f"nonzero padding in tar string field: {label}")
        raw = raw[:nul]
    try:
        return raw.decode("utf-8", "strict")
    except UnicodeDecodeError as exc:
        fail(f"non-UTF-8 tar string field: {label}: {exc}")


def validate_checksum(header: bytes) -> None:
    stored = parse_octal(header[148:156], "checksum")
    calculated = sum(header[:148]) + (8 * 32) + sum(header[156:])
    if stored != calculated:
        fail("malformed tar header checksum")


def validate_member_name(name: str, expected_prefix: str) -> PurePosixPath:
    if not name or len(name) > 4096 or "\x00" in name or "\\" in name:
        fail(f"unsafe archive path: {name!r}")
    normalized_input = name[:-1] if name.endswith("/") else name
    components = normalized_input.split("/")
    if name.startswith("/") or any(part in ("", ".", "..") for part in components):
        fail(f"unsafe archive path: {name!r}")
    path = PurePosixPath(normalized_input)
    if path.parts[0] != expected_prefix:
        fail(f"archive entry outside expected prefix: {name!r}")
    return path


@dataclass(frozen=True)
class Entry:
    path: PurePosixPath
    kind: str
    mode: int
    data_offset: int
    size: int


def decode_archive(archive: Path) -> tuple[BinaryIO, int]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(archive, flags)
    except OSError as exc:
        fail(f"archive path is not a regular file: {exc}")
    output: BinaryIO | None = None
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            fail("archive path is not a regular file")
        if before.st_size < 1 or before.st_size > MAX_ARCHIVE_BYTES:
            fail("archive compressed size is out of bounds")
        raw = os.fdopen(descriptor, "rb")
        descriptor = -1
        output = tempfile.TemporaryFile(prefix="baby-quirt-strict-archive-")
        total = 0
        with raw:
            with gzip.GzipFile(fileobj=raw, mode="rb") as stream:
                while True:
                    chunk = stream.read(64 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_TOTAL_BYTES:
                        fail("decompressed archive exceeds maximum allowed size")
                    output.write(chunk)
            after = os.fstat(raw.fileno())
        if (
            before.st_dev,
            before.st_ino,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            fail("archive changed while it was being read")
    except (OSError, EOFError) as exc:
        if output is not None:
            output.close()
        fail(f"malformed gzip stream: {exc}")
    except RuntimeError:
        if output is not None:
            output.close()
        raise
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if total < 2 * BLOCK or total % BLOCK != 0:
        output.close()
        fail("malformed tar block length")
    output.flush()
    os.fsync(output.fileno())
    output.seek(0)
    return output, total


def read_exact(stream: BinaryIO, size: int, label: str) -> bytes:
    data = stream.read(size)
    if len(data) != size:
        fail(f"truncated tar data: {label}")
    return data


def parse_archive(stream: BinaryIO, total_size: int, expected_prefix: str) -> list[Entry]:
    entries: list[Entry] = []
    kinds: dict[str, str] = {}
    position = 0
    total_file_bytes = 0
    terminator_seen = False
    stream.seek(0)

    while position + BLOCK <= total_size:
        header = read_exact(stream, BLOCK, "header")
        position += BLOCK
        if header == ZERO_BLOCK:
            if read_exact(stream, BLOCK, "second terminator") != ZERO_BLOCK:
                fail("tar archive has only one zero terminator block")
            position += BLOCK
            while True:
                trailing = stream.read(64 * 1024)
                if not trailing:
                    break
                if any(trailing):
                    fail("tar archive contains trailing nonzero garbage")
            terminator_seen = True
            break
        validate_checksum(header)
        if header[257:263] != b"ustar\0" or header[263:265] != b"00":
            fail("unsupported tar format or GNU/PAX metadata")
        if any(header[500:512]):
            fail("nonzero reserved tar header bytes")
        name = parse_string(header[0:100], "name")
        prefix = parse_string(header[345:500], "prefix")
        full_name = f"{prefix}/{name}" if prefix else name
        path = validate_member_name(full_name, expected_prefix)
        normalized = path.as_posix()
        if normalized in kinds:
            fail(f"duplicate normalized archive entry: {full_name}")
        for parent in path.parents:
            if parent == PurePosixPath("."):
                continue
            parent_kind = kinds.get(parent.as_posix())
            if parent_kind == "file":
                fail(f"file/directory archive conflict: {full_name}")
        typeflag = header[156:157]
        if typeflag in (b"\0", b"0"):
            kind = "file"
        elif typeflag == b"5":
            kind = "directory"
        elif typeflag in (b"x", b"g", b"L", b"K", b"S"):
            fail(f"unsupported PAX/GNU/sparse archive metadata: {full_name}")
        else:
            fail(f"forbidden archive entry type {typeflag!r}: {full_name}")
        if kind == "file" and full_name.endswith("/"):
            fail(f"regular file has a directory-form path: {full_name}")
        if parse_string(header[157:257], "linkname"):
            fail(f"allowed archive entry has unexpected link metadata: {full_name}")
        mode = parse_octal(header[100:108], "mode")
        if mode & ~0o777:
            fail(f"forbidden special permission bits or non-permission mode bits: {full_name}")
        if parse_octal(header[108:116], "uid") != 0 or parse_octal(header[116:124], "gid") != 0:
            fail(f"archive ownership must be numeric root:root: {full_name}")
        parse_octal(header[136:148], "mtime")
        if parse_octal(header[329:337], "device major") != 0 or parse_octal(header[337:345], "device minor") != 0:
            fail(f"allowed archive entry has unexpected device metadata: {full_name}")
        size = parse_octal(header[124:136], "size")
        if kind == "directory" and size != 0:
            fail(f"directory entry has content: {full_name}")
        if size < 0 or size > MAX_FILE_BYTES:
            fail(f"archive member size is out of bounds: {full_name}")
        padded = ((size + BLOCK - 1) // BLOCK) * BLOCK
        if position + padded > total_size:
            fail(f"truncated archive member: {full_name}")
        data_offset = position
        stream.seek(size, os.SEEK_CUR)
        padding = read_exact(stream, padded - size, f"padding for {full_name}")
        if any(padding):
            fail(f"nonzero archive member padding: {full_name}")
        position += padded
        total_file_bytes += size
        if total_file_bytes > MAX_TOTAL_BYTES:
            fail("archive member content exceeds maximum total size")
        kinds[normalized] = kind
        entries.append(
            Entry(
                path=path,
                kind=kind,
                mode=mode & 0o777,
                data_offset=data_offset,
                size=size,
            )
        )
        if len(entries) > MAX_MEMBERS:
            fail("archive contains too many entries")

    if not terminator_seen:
        fail("tar archive is missing the two-block terminator")
    root_kind = kinds.get(expected_prefix)
    if root_kind != "directory":
        fail("archive top-level prefix directory is missing")
    for entry in entries:
        if entry.path.as_posix() == expected_prefix:
            continue
        parent = entry.path.parent.as_posix()
        if kinds.get(parent) != "directory":
            fail(f"archive member parent directory is undeclared: {entry.path}")
    return entries


def ensure_within(root: Path, target: Path) -> None:
    if os.path.commonpath((str(root), str(target.resolve(strict=False)))) != str(root):
        fail(f"path traversal detected: {target}")


def extract_entries(entries: list[Entry], stream: BinaryIO, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination.is_symlink() or any(destination.iterdir()):
        fail("destination must be an empty real directory")
    root = destination.resolve()
    directories: list[tuple[Path, int]] = []
    for entry in entries:
        target = destination.joinpath(*entry.path.parts)
        ensure_within(root, target)
        if entry.kind == "directory":
            target.mkdir(mode=0o700)
            directories.append((target, entry.mode))
            continue
        if not target.parent.is_dir() or target.parent.is_symlink():
            fail(f"archive member parent is unsafe: {entry.path}")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(target, flags, 0o600)
        try:
            stream.seek(entry.data_offset)
            remaining = entry.size
            while remaining > 0:
                chunk = stream.read(min(64 * 1024, remaining))
                if not chunk:
                    fail(f"short read extracting archive member: {entry.path}")
                view = memoryview(chunk)
                written = 0
                while written < len(view):
                    count = os.write(fd, view[written:])
                    if count < 1:
                        fail(f"short write extracting archive member: {entry.path}")
                    written += count
                remaining -= len(chunk)
            os.fchmod(fd, entry.mode)
            os.fsync(fd)
        finally:
            os.close(fd)
    for directory, mode in reversed(directories):
        flags = os.O_RDONLY
        if hasattr(os, "O_DIRECTORY"):
            flags |= os.O_DIRECTORY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        fd = os.open(directory, flags)
        try:
            os.fchmod(fd, mode)
            os.fsync(fd)
        finally:
            os.close(fd)
    fd = os.open(destination, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def strict_extract(archive: Path, destination: Path, expected_prefix: str) -> None:
    if not PREFIX.fullmatch(expected_prefix) or expected_prefix in (".", ".."):
        fail("invalid expected top-level prefix")
    stream, total_size = decode_archive(archive)
    try:
        entries = parse_archive(stream, total_size, expected_prefix)
        extract_entries(entries, stream, destination)
    finally:
        stream.close()


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: bootstrap-safe-extract.py <archive.tar.gz> <empty-destination> <expected-prefix>",
            file=sys.stderr,
        )
        return 2
    archive = Path(os.path.abspath(sys.argv[1]))
    destination = Path(os.path.abspath(sys.argv[2]))
    expected_prefix = sys.argv[3]
    destination_existed = os.path.lexists(destination)
    destination_was_empty = (
        destination_existed
        and destination.is_dir()
        and not destination.is_symlink()
        and not any(destination.iterdir())
    )
    try:
        strict_extract(archive, destination, expected_prefix)
    except (OSError, RuntimeError) as exc:
        if destination.exists() and destination.is_dir() and not destination.is_symlink():
            if destination_existed:
                if destination_was_empty:
                    for child in destination.iterdir():
                        if child.is_dir() and not child.is_symlink():
                            shutil.rmtree(child, ignore_errors=True)
                        else:
                            child.unlink(missing_ok=True)
            else:
                shutil.rmtree(destination, ignore_errors=True)
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
