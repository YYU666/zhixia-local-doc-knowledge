#!/usr/bin/env python3
import base64
import json
import os
import stat
import sys

MAX_REQUEST_BYTES = 16 * 1024


def fail(code):
    raise RuntimeError(code)


def read_request():
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if not raw or len(raw) > MAX_REQUEST_BYTES:
        fail("readonly_openat_request_invalid")
    request = json.loads(raw.decode("utf-8"))
    if not isinstance(request, dict):
        fail("readonly_openat_request_invalid")
    return request


def safe_segment(value):
    return isinstance(value, str) and value not in ("", ".", "..") and "/" not in value and "\0" not in value


def open_directory_chain(root, segments):
    if not os.path.isabs(root) or not all(safe_segment(segment) for segment in segments):
        fail("readonly_openat_request_invalid")
    fds = [os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)]
    try:
        for segment in segments:
            fds.append(os.open(segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fds[-1]))
        return fds
    except Exception:
        for fd in reversed(fds):
            os.close(fd)
        raise


def read_file(root, directory_segments, file_name, max_bytes):
    if not safe_segment(file_name) or not isinstance(max_bytes, int) or max_bytes < 1 or max_bytes > 1024 * 1024:
        fail("readonly_openat_request_invalid")
    fds = open_directory_chain(root, directory_segments)
    file_fd = None
    try:
        file_fd = os.open(file_name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=fds[-1])
        details = os.fstat(file_fd)
        if not stat.S_ISREG(details.st_mode) or details.st_size < 1 or details.st_size > max_bytes:
            fail("readonly_openat_unsafe_file")
        chunks = []
        remaining = details.st_size
        while remaining:
            chunk = os.read(file_fd, min(65536, remaining))
            if not chunk:
                fail("readonly_openat_short_read")
            chunks.append(chunk)
            remaining -= len(chunk)
        if os.read(file_fd, 1):
            fail("readonly_openat_file_grew")
        return {"kind": "file", "bytesBase64": base64.b64encode(b"".join(chunks)).decode("ascii")}
    finally:
        if file_fd is not None:
            os.close(file_fd)
        for fd in reversed(fds):
            os.close(fd)


def list_directory(root, directory_segments):
    fds = open_directory_chain(root, directory_segments)
    try:
        names = os.listdir(fds[-1])
        if len(names) > 64 or not all(safe_segment(name) for name in names):
            fail("readonly_openat_unsafe_directory")
        return {"kind": "directory", "names": sorted(names)}
    finally:
        for fd in reversed(fds):
            os.close(fd)


def main():
    try:
        request = read_request()
        operation = request.get("operation")
        if operation == "read_file":
            result = read_file(
                request.get("root"), request.get("directorySegments"),
                request.get("fileName"), request.get("maxBytes"),
            )
        elif operation == "list_directory":
            result = list_directory(request.get("root"), request.get("directorySegments"))
        else:
            fail("readonly_openat_operation_invalid")
        print(json.dumps({"status": "ok", **result}, separators=(",", ":")))
    except FileNotFoundError:
        print(json.dumps({"status": "error", "error": "readonly_openat_not_found"}, separators=(",", ":")))
        sys.exit(1)
    except (NotADirectoryError, PermissionError):
        print(json.dumps({"status": "error", "error": "readonly_openat_unsafe_path"}, separators=(",", ":")))
        sys.exit(1)
    except OSError:
        print(json.dumps({"status": "error", "error": "readonly_openat_unsafe_path"}, separators=(",", ":")))
        sys.exit(1)
    except Exception as error:
        print(json.dumps({"status": "error", "error": str(error)}, separators=(",", ":")))
        sys.exit(1)


if __name__ == "__main__":
    main()
