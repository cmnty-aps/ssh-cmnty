const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.static(path.join(__dirname, '../dist')));
app.use(express.json());

app.get('/token', (req, res) => {
  res.json({ token: '' });
});


app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.get('/api/system-info', (req, res) => {
  let osName = 'debian';
  let osVersion = '12';
  let prettyName = 'Debian GNU/Linux 12 (bookworm)';

  try {
    if (fs.existsSync('/etc/os-release')) {
      const content = fs.readFileSync('/etc/os-release', 'utf-8');
      const lower = content.toLowerCase();
      if (lower.includes('ubuntu')) {
        osName = 'ubuntu';
      } else if (lower.includes('debian')) {
        osName = 'debian';
      } else if (lower.includes('centos')) {
        osName = 'centos';
      } else if (lower.includes('alpine')) {
        osName = 'alpine';
      } else if (lower.includes('fedora')) {
        osName = 'fedora';
      } else if (lower.includes('arch')) {
        osName = 'arch';
      } else if (lower.includes('rhel') || lower.includes('red hat')) {
        osName = 'rhel';
      }

      const vMatch = content.match(/VERSION_ID="?([0-9.]+)"?/);
      if (vMatch) osVersion = vMatch[1];
      const pMatch = content.match(/PRETTY_NAME="?([^"\n]+)"?/);
      if (pMatch) prettyName = pMatch[1];
    }
  } catch (e) {}

  let currentHostname = 'cmnty';
  try {
    const sysHost = os.hostname();
    if (sysHost && sysHost !== 'localhost') {
      currentHostname = sysHost;
    } else if (fs.existsSync('/etc/hostname')) {
      const hContent = fs.readFileSync('/etc/hostname', 'utf-8').trim();
      if (hContent) currentHostname = hContent;
    }
  } catch (e) {}

  res.json({
    os: osName,
    version: osVersion,
    prettyName: prettyName,
    hostname: currentHostname,
    username: 'root'
  });
});


app.post('/api/ssh-test', (req, res) => {
  const { hostname, port = 22, username, password, passphrase, privateKey, totp } = req.body;
  if (!hostname || !username) {
    return res.status(400).json({ success: false, message: 'Hostname and Username are required' });
  }

  const { Client } = require('ssh2');
  const conn = new Client();
  let responded = false;

  conn.on('ready', () => {
    if (responded) return;
    responded = true;
    conn.exec('hostname; cat /etc/os-release 2>/dev/null', (err, stream) => {
      let output = '';
      if (err || !stream) {
        conn.end();
        return res.json({ success: true, message: 'SSH authentication successful', os: 'linux', version: '', remoteHostname: hostname });
      }
      stream.on('data', (data) => {
        output += data.toString();
      });
      stream.on('close', () => {
        conn.end();
        const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
        let remoteHostname = lines[0] || hostname;
        const osContent = lines.slice(1).join('\n').toLowerCase();

        let osName = 'linux';
        let osVersion = '';

        if (osContent.includes('ubuntu')) {
          osName = 'ubuntu';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('debian')) {
          osName = 'debian';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('centos')) {
          osName = 'centos';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('alpine')) {
          osName = 'alpine';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('fedora')) {
          osName = 'fedora';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('arch')) {
          osName = 'arch';
        } else if (osContent.includes('rocky')) {
          osName = 'rocky';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('alma')) {
          osName = 'alma';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('rhel') || osContent.includes('red hat')) {
          osName = 'rhel';
          const match = osContent.match(/version_id="?([0-9.]+)"?/);
          if (match) osVersion = match[1];
        } else if (osContent.includes('suse') || osContent.includes('opensuse')) {
          osName = 'opensuse';
        } else if (osContent.includes('kali')) {
          osName = 'kali';
        } else if (osContent.includes('darwin') || osContent.includes('mac')) {
          osName = 'macos';
        } else if (osContent.includes('windows') || osContent.includes('microsoft')) {
          osName = 'windows';
        }

        res.json({
          success: true,
          message: 'SSH authentication successful',
          os: osName,
          version: osVersion,
          remoteHostname: remoteHostname
        });
      });
    });
  });

  conn.on('error', (err) => {
    if (responded) return;
    responded = true;
    try {
      conn.end();
    } catch (e) {}
    res.status(400).json({ success: false, message: err.message || 'SSH authentication or connection failed' });
  });

  conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
    const answers = prompts.map(prompt => {
      const text = prompt.prompt.toLowerCase();
      if (text.includes('password') || text.includes('verification') || text.includes('code') || text.includes('totp')) {
        return totp ? (password || '') + totp : (password || '');
      }
      return password || '';
    });
    finish(answers);
  });

  try {
    conn.connect({
      host: hostname,
      port: parseInt(port, 10) || 22,
      username: username,
      password: password || undefined,
      passphrase: passphrase || undefined,
      privateKey: privateKey || undefined,
      tryKeyboard: true,
      readyTimeout: 5000,
    });
  } catch (err) {
    if (!responded) {
      responded = true;
      res.status(400).json({ success: false, message: err.message || 'Failed to initialize SSH connection' });
    }
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'));
});

const server = http.createServer(app);

const wss = new WebSocketServer({
  noServer: true
});

server.on('upgrade', (request, socket, head) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  } catch (err) {
    socket.destroy();
  }
});

wss.on('connection', (ws, request) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const sshParam = url.searchParams.get('ssh');

  const CMD_OUTPUT = '0';
  const CMD_SET_WINDOW_TITLE = '1';
  const CMD_SET_PREFERENCES = '2';

  const CMD_INPUT = '0';
  const CMD_RESIZE = '1';
  const CMD_PAUSE = '2';
  const CMD_RESUME = '3';

  if (sshParam) {
    let sshConfig = {};
    try {
      sshConfig = JSON.parse(Buffer.from(sshParam, 'base64').toString('utf-8'));
    } catch (e) {
      ws.close(1008, 'Invalid SSH configuration');
      return;
    }

    const { Client } = require('ssh2');
    const conn = new Client();
    let sshStream = null;

    ws.send(CMD_SET_WINDOW_TITLE + `${sshConfig.username}@${sshConfig.hostname}`);
    ws.send(CMD_SET_PREFERENCES + JSON.stringify({}));

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, stream) => {
        if (err) {
          ws.close(1011, err.message);
          return;
        }
        sshStream = stream;

        stream.on('data', (chunk) => {
          if (ws.readyState === ws.OPEN) {
            const payload = Buffer.concat([Buffer.from([0x30]), chunk]);
            ws.send(payload, { binary: true });
          }
        });

        stream.on('close', () => {
          if (ws.readyState === ws.OPEN) {
            ws.close(1000);
          }
          conn.end();
        });
      });
    });

    conn.on('error', (err) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(Buffer.concat([Buffer.from([0x30]), Buffer.from(`\r\nSSH Error: ${err.message}\r\n`)]));
        setTimeout(() => ws.close(1006), 500);
      }
    });

    conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
      const answers = prompts.map(prompt => {
        const text = prompt.prompt.toLowerCase();
        if (text.includes('password') || text.includes('verification') || text.includes('code') || text.includes('totp')) {
          return sshConfig.totp ? (sshConfig.password || '') + sshConfig.totp : (sshConfig.password || '');
        }
        return sshConfig.password || '';
      });
      finish(answers);
    });

    try {
      conn.connect({
        host: sshConfig.hostname,
        port: parseInt(sshConfig.port, 10) || 22,
        username: sshConfig.username,
        password: sshConfig.password || undefined,
        passphrase: sshConfig.passphrase || undefined,
        privateKey: sshConfig.privateKey || undefined,
        tryKeyboard: true,
        readyTimeout: 10000,
      });
    } catch (err) {
      ws.close(1011, err.message);
      return;
    }

    ws.on('message', (message) => {
      const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
      if (!buf || buf.length === 0) return;

      try {
        const firstChar = String.fromCharCode(buf[0]);
        if (firstChar === '{') {
          const initData = JSON.parse(buf.toString('utf-8'));
          if (initData.columns && initData.rows && sshStream) {
            sshStream.setWindow(initData.rows, initData.columns, 0, 0);
          }
          return;
        }

        const cmd = String.fromCharCode(buf[0]);
        const payload = buf.subarray(1);

        if (cmd === CMD_INPUT && sshStream) {
          sshStream.write(payload);
        } else if (cmd === CMD_RESIZE && sshStream) {
          try {
            const resizeData = JSON.parse(payload.toString('utf-8'));
            if (resizeData.columns && resizeData.rows) {
              sshStream.setWindow(resizeData.rows, resizeData.columns, 0, 0);
            }
          } catch (e) {}
        }
      } catch (e) {
        if (sshStream) {
          sshStream.write(buf);
        }
      }
    });

    ws.on('close', () => {
      if (sshStream) {
        try { sshStream.end(); } catch (e) {}
      }
      try { conn.end(); } catch (e) {}
    });

    return;
  }

  const title = 'Terminal 1';
  ws.send(CMD_SET_WINDOW_TITLE + title);

  ws.send(CMD_SET_PREFERENCES + JSON.stringify({}));

  let ptyBridge = null;
  let isInitialized = false;

  const initPty = (cols, rows) => {
    if (isInitialized) return;
    isInitialized = true;

    const bridgeScript = path.join(__dirname, 'pty-bridge.py');
    ptyBridge = spawn('python3', [bridgeScript, String(cols || 80), String(rows || 24)], {
      stdio: ['pipe', 'pipe', 'inherit', 'pipe'],
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        HOSTNAME: 'cmnty',
        USER: 'root',
        LOGNAME: 'root',
        HOME: '/root'
      }
    });

    ptyBridge.stdin.on('error', () => {});
    if (ptyBridge.stdio[3]) {
      ptyBridge.stdio[3].on('error', () => {});
    }

    ptyBridge.stdout.on('data', (chunk) => {
      if (ws.readyState === ws.OPEN) {
        const payload = Buffer.concat([Buffer.from([0x30]), chunk]);
        ws.send(payload, { binary: true });
      }
    });

    ptyBridge.on('close', (code) => {
      if (ws.readyState === ws.OPEN) {
        ws.close(code === 0 ? 1000 : 1006);
      }
    });
  };

  ws.on('message', (message, isBinary) => {
    const buf = Buffer.isBuffer(message) ? message : Buffer.from(message);
    if (!buf || buf.length === 0) return;

    if (!isInitialized) {
      try {
        const initData = JSON.parse(buf.toString('utf-8'));
        const cols = initData.columns || 80;
        const rows = initData.rows || 24;
        initPty(cols, rows);
        return;
      } catch (e) {
        initPty(80, 24);
      }
    }

    const cmd = String.fromCharCode(buf[0]);
    const payload = buf.subarray(1);

    if (cmd === CMD_INPUT) {
      if (ptyBridge && ptyBridge.stdin.writable) {
        ptyBridge.stdin.write(payload);
      }
    } else if (cmd === CMD_RESIZE) {
      try {
        const resizeData = JSON.parse(payload.toString('utf-8'));
        const cols = resizeData.columns;
        const rows = resizeData.rows;
        if (cols && rows && ptyBridge && ptyBridge.stdio[3] && ptyBridge.stdio[3].writable) {
          ptyBridge.stdio[3].write(`RESIZE ${cols} ${rows}\n`);
        }
      } catch (err) {}
    } else if (cmd === CMD_PAUSE) {
      if (ptyBridge && ptyBridge.stdout) {
        ptyBridge.stdout.pause();
      }
    } else if (cmd === CMD_RESUME) {
      if (ptyBridge && ptyBridge.stdout) {
        ptyBridge.stdout.resume();
      }
    }
  });

  ws.on('close', () => {
    if (ptyBridge) {
      if (ptyBridge.stdio[3] && ptyBridge.stdio[3].writable) {
        try {
          ptyBridge.stdio[3].write('KILL\n');
        } catch (e) {}
      }
      try {
        ptyBridge.kill('SIGTERM');
      } catch (e) {}
    }
  });
});

server.listen(PORT, HOST, () => {});
