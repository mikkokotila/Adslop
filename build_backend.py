"""Build backend that makes the sdist reproducible.

setuptools writes the current time into the gzip header and into every tar
member's mtime, and orders members by directory walk, so two sdists built from
identical sources at different moments hash differently. The wheel is already
reproducible; the sdist is not.

That matters because the packaging gate asserts two builds of the same source
produce byte-identical artifacts. Without normalisation the assertion is
either false or has to be weakened to the wheel alone, which would leave the
half of the release that consumers audit unverified.

Everything except `build_sdist` is setuptools' own implementation. This
delegates, then rewrites the archive with a fixed epoch, sorted members, and
zeroed ownership.
"""
from __future__ import annotations

import gzip
import os
import tarfile
import tempfile
from collections.abc import Mapping, Sequence
from pathlib import Path

from setuptools import build_meta as _setuptools

build_wheel = _setuptools.build_wheel
build_editable = _setuptools.build_editable
prepare_metadata_for_build_wheel = _setuptools.prepare_metadata_for_build_wheel
prepare_metadata_for_build_editable = _setuptools.prepare_metadata_for_build_editable
get_requires_for_build_wheel = _setuptools.get_requires_for_build_wheel
get_requires_for_build_sdist = _setuptools.get_requires_for_build_sdist
get_requires_for_build_editable = _setuptools.get_requires_for_build_editable


class _BytesReader:
    """Minimal file-like reader over bytes, for `TarFile.addfile`."""

    def __init__(self, data: bytes) -> None:
        self._data = data
        self._offset = 0

    def read(self, size: int = -1) -> bytes:
        """Return up to size bytes from the current offset."""
        if size is None or size < 0:
            size = len(self._data) - self._offset
        start = self._offset
        end = min(len(self._data), start + size)
        self._offset = end
        return self._data[start:end]


def _normalize_tar_gz(source: Path, target: Path) -> None:
    """Rewrite a .tar.gz with deterministic metadata and member order."""
    epoch = int(os.environ.get('SOURCE_DATE_EPOCH', '0'))
    members: list[tuple[tarfile.TarInfo, bytes | None]] = []

    with tarfile.open(source, 'r:gz') as archive:
        for member in sorted(archive.getmembers(), key=lambda item: item.name):
            info = tarfile.TarInfo(member.name)
            info.type = member.type
            info.linkname = member.linkname
            info.size = member.size if member.isfile() else 0
            info.mtime = epoch
            info.uid = 0
            info.gid = 0
            info.uname = ''
            info.gname = ''
            info.mode = 0o755 if member.isdir() else 0o644
            data = None
            if member.isfile():
                extracted = archive.extractfile(member)
                data = extracted.read() if extracted is not None else b''
            members.append((info, data))

    target.parent.mkdir(parents=True, exist_ok=True)
    with (
        target.open('wb') as raw,
        gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=epoch) as gz,
        tarfile.open(fileobj=gz, mode='w', format=tarfile.PAX_FORMAT) as archive,
    ):
        for info, data in members:
            if data is None:
                archive.addfile(info)
            else:
                archive.addfile(info, _BytesReader(data))


def build_sdist(
    sdist_directory: str,
    config_settings: Mapping[str, Sequence[str] | str] | None = None,
) -> str:
    """Build an sdist, then rewrite it with deterministic metadata."""
    with tempfile.TemporaryDirectory() as tmpdir:
        built_name = _setuptools.build_sdist(tmpdir, config_settings)
        _normalize_tar_gz(Path(tmpdir, built_name), Path(sdist_directory, built_name))
    return built_name
