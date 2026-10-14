import os
import sys
import pty
import fcntl
import termios
import struct
import select
import errno
import subprocess

def set_nonblocking(fd):
    flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

def main():
    cols = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    rows = int(sys.argv[2]) if len(sys.argv) > 2 else 24

    master, slave = pty.openpty()

    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except Exception:
        pass

    try:
        subprocess.run(["hostname", "cmnty"], capture_output=True)
    except Exception:
        pass

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["HOSTNAME"] = "cmnty"
    env["USER"] = "root"
    env["LOGNAME"] = "root"
    env["HOME"] = "/root" if os.path.exists("/root") else (os.environ.get("HOME") or "/")
    env["PS1"] = r"\[\e]0;root@cmnty: \w\a\]\[\033[01;31m\]root\[\033[01;37m\]@\[\033[01;32m\]cmnty\[\033[00m\]:\[\033[01;34m\]\w\[\033[01;33m\]#\[\033[00m\] "

    shell = os.environ.get("SHELL") or "/bin/bash"
    if not os.path.exists(shell):
        shell = "/bin/sh"

    cwd = env["HOME"]
    if not os.path.exists(cwd):
        cwd = "/"

    proc = subprocess.Popen(
        [shell, "-i"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
        preexec_fn=os.setsid,
        env=env,
        cwd=cwd
    )
    os.close(slave)

    set_nonblocking(master)
    set_nonblocking(0)

    ctrl_fd = None
    try:
        fcntl.fcntl(3, fcntl.F_GETFL)
        ctrl_fd = 3
        set_nonblocking(3)
    except Exception:
        ctrl_fd = None

    read_list = [master, 0]
    if ctrl_fd is not None:
        read_list.append(ctrl_fd)

    ctrl_buffer = ""

    try:
        while True:
            rlist, _, _ = select.select(read_list, [], [], 0.05)

            if master in rlist:
                try:
                    data = os.read(master, 4096)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                except OSError as e:
                    if e.errno == errno.EIO:
                        break
                    elif e.errno != errno.EAGAIN:
                        raise

            if 0 in rlist:
                try:
                    data = os.read(0, 4096)
                    if data:
                        os.write(master, data)
                    else:
                        read_list.remove(0)
                except OSError as e:
                    if e.errno != errno.EAGAIN:
                        if 0 in read_list:
                            read_list.remove(0)

            if ctrl_fd is not None and ctrl_fd in rlist:
                try:
                    data = os.read(ctrl_fd, 1024)
                    if data:
                        ctrl_buffer += data.decode("utf-8", errors="ignore")
                        while "\n" in ctrl_buffer:
                            line, ctrl_buffer = ctrl_buffer.split("\n", 1)
                            line = line.strip()
                            if not line:
                                continue
                            parts = line.split()
                            if not parts:
                                continue
                            if parts[0] == "RESIZE" and len(parts) >= 3:
                                try:
                                    c, r = int(parts[1]), int(parts[2])
                                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", r, c, 0, 0))
                                except Exception:
                                    pass
                            elif parts[0] == "KILL":
                                try:
                                    proc.terminate()
                                except Exception:
                                    pass
                    else:
                        read_list.remove(ctrl_fd)
                        ctrl_fd = None
                except OSError as e:
                    if e.errno != errno.EAGAIN:
                        if ctrl_fd in read_list:
                            read_list.remove(ctrl_fd)
                        ctrl_fd = None

            if proc.poll() is not None:
                while True:
                    try:
                        data = os.read(master, 4096)
                        if data:
                            sys.stdout.buffer.write(data)
                            sys.stdout.buffer.flush()
                        else:
                            break
                    except OSError:
                        break
                break
    finally:
        try:
            os.close(master)
        except Exception:
            pass
        proc.wait()
        sys.exit(proc.returncode or 0)

if __name__ == "__main__":
    main()
