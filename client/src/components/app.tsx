import { h, Component } from 'preact';
import { Terminal } from './terminal';
import { OsIcon } from './os-icons';
import Swal from 'sweetalert2';

import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import type { ClientOptions, FlowControl } from './terminal/xterm';

interface SessionTab {
    id: string;
    title: string;
    hostname: string;
    username: string;
    port: string;
    password?: string;
    passphrase?: string;
    privateKey?: string;
    totp?: string;
    os?: string;
    version?: string;
    remoteHostname?: string;
}

interface AppState {
    tabs: SessionTab[];
    activeTabId: string;
    hostname: string;
    port: string;
    username: string;
    password: string;
    passphrase: string;
    totp: string;
    privateKey: string;
    status: string;
    waiter: boolean;
    localOs: string;
    localVersion: string;
}

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const path = window.location.pathname.replace(/[/]+$/, '');
const wsUrl = [protocol, '//', window.location.host, path, '/ws', window.location.search].join('');
const tokenUrl = '/token';

const clientOptions = {
    rendererType: 'webgl',
    disableLeaveAlert: false,
    disableResizeOverlay: true,
    enableZmodem: false,
    enableTrzsz: false,
    enableSixel: false,
    closeOnDisconnect: false,
    isWindows: false,
    unicodeVersion: '11',
} as ClientOptions;

const termOptions = {
    fontSize: 11,
    fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, Monaco, Consolas, 'Liberation Mono', monospace",
    letterSpacing: 0,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: 'block',
    theme: {
        foreground: '#cccccc',
        background: '#1e1e1e',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: 'rgba(255, 255, 255, 0.2)',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
    } as ITheme,
    allowProposedApi: true,
} as ITerminalOptions;

const flowControl = {
    limit: 100000,
    highWater: 10,
    lowWater: 4,
} as FlowControl;

export class App extends Component<{}, AppState> {
    constructor() {
        super();
        this.state = {
            tabs: [],
            activeTabId: 'form',
            hostname: '',
            port: '',
            username: '',
            password: '',
            passphrase: '',
            totp: '',
            privateKey: '',
            status: '',
            waiter: false,
            localOs: 'debian',
            localVersion: '12',
        };
    }

    componentDidMount() {
        fetch('/api/system-info')
            .then(res => res.json())
            .then(info => {
                if (info && info.os) {
                    this.setState({
                        localOs: info.os,
                        localVersion: info.version || '',
                        hostname: info.hostname || this.state.hostname,
                    });
                }
            })
            .catch(() => {});
    }

    private handleConnect = async (e: Event) => {
        e.preventDefault();
        this.handleOpenAuthModal();
    };

    private handleQuickConnect = async () => {
        const result = await Swal.fire({
            title: 'Quick SSH Connect',
            input: 'text',
            inputLabel: 'Enter SSH command (e.g. ssh -p 22 user@host or user@host)',
            inputPlaceholder: 'ssh -p 22 user@host',
            showCancelButton: true,
            confirmButtonText: 'Next',
            inputValidator: (value) => {
                if (!value) {
                    return 'Please enter a valid SSH command or target!';
                }
            }
        });

        if (!result.isConfirmed || !result.value) return;
        const sshCommand = result.value;

        const parsed = this.parseSshCommand(sshCommand);
        if (!parsed.valid || !parsed.hostname) {
            await Swal.fire({
                icon: 'error',
                title: 'Invalid SSH Command Format',
                text: 'Please enter a valid SSH target (e.g., user@host, domain name, or IP address).',
                confirmButtonText: 'OK'
            });
            return this.handleQuickConnect();
        }

        const passResult = await Swal.fire({
            title: 'Enter SSH Password',
            input: 'password',
            inputLabel: 'Enter password for connection:',
            inputPlaceholder: 'Password',
            showCancelButton: true,
            confirmButtonText: 'Connect'
        });

        if (!passResult.isConfirmed) {
            return;
        }

        const password = passResult.value || '';
        await this.verifyAndConnect(parsed.hostname, parsed.port, parsed.username, password);
    };

    private parseSshCommand(input: string): { hostname: string; username: string; port: string; valid: boolean } {
        let hostname = '';
        let username = 'root';
        let port = '22';

        const cleaned = input.trim().replace(/^ssh\s+/, '');
        const portMatch = cleaned.match(/-p\s+(\d+)/);
        if (portMatch) {
            port = portMatch[1];
        }

        const withoutFlags = cleaned.replace(/-\w+(\s+\S+)?/g, '').trim();
        if (withoutFlags.includes('@')) {
            const parts = withoutFlags.split('@');
            username = parts[0].trim();
            hostname = parts[1].trim();
        } else {
            hostname = withoutFlags;
        }

        const valid = Boolean(hostname && (hostname === 'localhost' || hostname === 'cmnty' || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes('.') || hostname.includes('@')));

        return { hostname, username, port, valid };
    }

    private promptAuthInput = async (type: 'password' | 'totp' | 'passphrase' | 'privateKey') => {
        const { hostname, username, port } = this.state;
        if (!hostname || !username) {
            Swal.fire({
                icon: 'warning',
                title: 'Missing Required Fields',
                text: 'Please enter Hostname and Username first before connecting.',
                confirmButtonText: 'OK'
            });
            return;
        }

        if (type === 'password') {
            const res = await Swal.fire({
                title: 'Enter Password',
                input: 'password',
                inputValue: this.state.password,
                inputPlaceholder: 'Enter account password',
                showCancelButton: true,
                confirmButtonText: 'Connect',
                cancelButtonText: 'Cancel',
            });
            if (res.isConfirmed) {
                const password = res.value || '';
                this.setState({ password });
                await this.verifyAndConnect(hostname, port, username, password, this.state.passphrase, this.state.privateKey, this.state.totp);
            }
        } else if (type === 'totp') {
            const res = await Swal.fire({
                title: 'Enter TOTP',
                input: 'text',
                inputValue: this.state.totp,
                inputPlaceholder: 'Enter verification code',
                showCancelButton: true,
                confirmButtonText: 'Connect',
                cancelButtonText: 'Cancel',
            });
            if (res.isConfirmed) {
                const totp = res.value || '';
                this.setState({ totp });
                await this.verifyAndConnect(hostname, port, username, this.state.password, this.state.passphrase, this.state.privateKey, totp);
            }
        } else if (type === 'passphrase') {
            const res = await Swal.fire({
                title: 'Enter Passphrase',
                input: 'password',
                inputValue: this.state.passphrase,
                inputPlaceholder: 'Enter private key passphrase',
                showCancelButton: true,
                confirmButtonText: 'Connect',
                cancelButtonText: 'Cancel',
            });
            if (res.isConfirmed) {
                const passphrase = res.value || '';
                this.setState({ passphrase });
                await this.verifyAndConnect(hostname, port, username, this.state.password, passphrase, this.state.privateKey, this.state.totp);
            }
        } else if (type === 'privateKey') {
            const currentVal = this.state.privateKey || '';
            const res = await Swal.fire({
                title: 'Enter Private Key',
                html: `
                    <div style="text-align: left; font-size: 13px; margin-bottom: 8px; color: #cccccc;">Upload key file or paste text below:</div>
                    <input type="file" id="swal-pk-file" style="margin-bottom: 12px; font-size: 13px; width: 100%;" />
                    <textarea id="swal-pk-text" class="swal2-textarea" style="height: 120px; font-family: monospace; font-size: 12px; margin: 0; width: 100%; box-sizing: border-box;" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...">${currentVal}</textarea>
                `,
                showCancelButton: true,
                confirmButtonText: 'Connect',
                cancelButtonText: 'Cancel',
                didOpen: () => {
                    const fileInput = document.getElementById('swal-pk-file') as HTMLInputElement | null;
                    const textArea = document.getElementById('swal-pk-text') as HTMLTextAreaElement | null;
                    fileInput?.addEventListener('change', () => {
                        const file = fileInput.files?.[0];
                        if (file && textArea) {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                textArea.value = (e.target?.result as string) || '';
                            };
                            reader.readAsText(file);
                        }
                    });
                },
                preConfirm: () => {
                    const textArea = document.getElementById('swal-pk-text') as HTMLTextAreaElement | null;
                    return textArea?.value || '';
                }
            });
            if (res.isConfirmed) {
                const privateKey = (res.value as string) || '';
                this.setState({ privateKey });
                await this.verifyAndConnect(hostname, port, username, this.state.password, this.state.passphrase, privateKey, this.state.totp);
            }
        }
    };

    private handleOpenAuthModal = async () => {
        await Swal.fire({
            title: 'Select Auth Method',
            html: `
                <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 14px;">
                    <button type="button" id="swal-auth-password" class="btn btn-secondary" style="width: 100%; padding: 12px 16px; text-align: left; display: flex; justify-content: space-between; align-items: center; border: 1px solid #3c3c3c; border-radius: 4px; cursor: pointer;">
                        <span style="font-weight: 500; font-size: 14px;">Password</span>
                        <span style="font-size: 12px; font-weight: 600; color: ${this.state.password ? '#4ec9b0' : '#888888'};">${this.state.password ? 'Configured ✓' : 'Not set'}</span>
                    </button>
                    <button type="button" id="swal-auth-privatekey" class="btn btn-secondary" style="width: 100%; padding: 12px 16px; text-align: left; display: flex; justify-content: space-between; align-items: center; border: 1px solid #3c3c3c; border-radius: 4px; cursor: pointer;">
                        <span style="font-weight: 500; font-size: 14px;">Private Key</span>
                        <span style="font-size: 12px; font-weight: 600; color: ${this.state.privateKey ? '#4ec9b0' : '#888888'};">${this.state.privateKey ? 'Configured ✓' : 'Not set'}</span>
                    </button>
                    <button type="button" id="swal-auth-totp" class="btn btn-secondary" style="width: 100%; padding: 12px 16px; text-align: left; display: flex; justify-content: space-between; align-items: center; border: 1px solid #3c3c3c; border-radius: 4px; cursor: pointer;">
                        <span style="font-weight: 500; font-size: 14px;">TOTP</span>
                        <span style="font-size: 12px; font-weight: 600; color: ${this.state.totp ? '#4ec9b0' : '#888888'};">${this.state.totp ? 'Configured ✓' : 'Not set'}</span>
                    </button>
                    <button type="button" id="swal-auth-passphrase" class="btn btn-secondary" style="width: 100%; padding: 12px 16px; text-align: left; display: flex; justify-content: space-between; align-items: center; border: 1px solid #3c3c3c; border-radius: 4px; cursor: pointer;">
                        <span style="font-weight: 500; font-size: 14px;">Passphrase</span>
                        <span style="font-size: 12px; font-weight: 600; color: ${this.state.passphrase ? '#4ec9b0' : '#888888'};">${this.state.passphrase ? 'Configured ✓' : 'Not set'}</span>
                    </button>
                </div>
            `,
            showConfirmButton: false,
            showCancelButton: true,
            cancelButtonText: 'Close',
            didOpen: () => {
                const btnPwd = document.getElementById('swal-auth-password');
                const btnTotp = document.getElementById('swal-auth-totp');
                const btnPass = document.getElementById('swal-auth-passphrase');
                const btnKey = document.getElementById('swal-auth-privatekey');

                btnPwd?.addEventListener('click', () => {
                    Swal.close();
                    this.promptAuthInput('password');
                });
                btnTotp?.addEventListener('click', () => {
                    Swal.close();
                    this.promptAuthInput('totp');
                });
                btnPass?.addEventListener('click', () => {
                    Swal.close();
                    this.promptAuthInput('passphrase');
                });
                btnKey?.addEventListener('click', () => {
                    Swal.close();
                    this.promptAuthInput('privateKey');
                });
            }
        });
    };

    private async verifyAndConnect(hostname: string, port: string, username: string, password?: string, passphrase?: string, privateKey?: string, totp?: string) {
        this.setState({ waiter: true, status: '' });
        try {
            const resp = await fetch('/api/ssh-test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    hostname,
                    port: port || '22',
                    username,
                    password: password || this.state.password,
                    passphrase: passphrase || this.state.passphrase,
                    privateKey: privateKey || this.state.privateKey,
                    totp: totp || this.state.totp,
                }),
            });
            const json = await resp.json();
            this.setState({ waiter: false });

            if (!resp.ok || !json.success) {
                Swal.fire({
                    icon: 'error',
                    title: 'SSH Connection Failed',
                    text: json.message || 'Could not connect to SSH host. Please check hostname, port, and network settings.',
                    confirmButtonText: 'OK',
                });
                return;
            }

            const remoteHost = json.remoteHostname || hostname;
            const newTabId = 'tab_' + Date.now();
            const newTab: SessionTab = {
                id: newTabId,
                title: remoteHost,
                hostname,
                username,
                port,
                password: password || this.state.password,
                passphrase: passphrase || this.state.passphrase,
                privateKey: privateKey || this.state.privateKey,
                totp: totp || this.state.totp,
                os: json.os || 'linux',
                version: json.version || '',
                remoteHostname: remoteHost,
            };

            Swal.fire({
                icon: 'success',
                title: 'Connected',
                text: `Successfully connected to ${remoteHost}`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true,
            });

            this.setState(prev => ({
                tabs: [...prev.tabs, newTab],
                activeTabId: newTabId,
                password: '',
                passphrase: '',
                totp: '',
                privateKey: '',
            }));
        } catch (e) {
            this.setState({ waiter: false });
            Swal.fire({
                icon: 'error',
                title: 'Connection Error',
                text: 'Network error or unreachable host.',
                confirmButtonText: 'OK',
            });
        }
    }

    private handleTtyd = () => {
        this.setState({ waiter: true, status: '' });
        setTimeout(() => {
            const terminalIndex = this.state.tabs.filter(t => t.hostname === 'local' || t.title.startsWith('Terminal ')).length + 1;
            const tabTitle = `Terminal ${terminalIndex}`;
            const newTabId = 'tab_' + Date.now();
            const newTab: SessionTab = {
                id: newTabId,
                title: tabTitle,
                hostname: 'local',
                username: 'root',
                port: '',
                os: this.state.localOs || 'debian',
                version: this.state.localVersion || '12',
                remoteHostname: tabTitle,
            };

            Swal.fire({
                icon: 'success',
                title: 'Terminal Opened',
                text: `Successfully opened ${tabTitle}`,
                toast: true,
                position: 'top-end',
                showConfirmButton: false,
                timer: 2000,
                timerProgressBar: true,
            });

            this.setState(prev => ({
                tabs: [...prev.tabs, newTab],
                activeTabId: newTabId,
                waiter: false,
            }));
        }, 300);
    };

    private handleReset = () => {
        this.setState({
            hostname: '',
            port: '',
            username: '',
            password: '',
            passphrase: '',
            totp: '',
            privateKey: '',
            status: '',
        });
    };

    private closeTab(e: Event, tabId: string) {
        e.stopPropagation();
        const { tabs, activeTabId } = this.state;
        const newTabs = tabs.filter(t => t.id !== tabId);
        let newActive = activeTabId;
        if (activeTabId === tabId) {
            newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].id : 'form';
        }
        this.setState({ tabs: newTabs, activeTabId: newActive });
    }

    render() {
        const { tabs, activeTabId, hostname, port, username, status, waiter } = this.state;

        return (
            <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
                {waiter && <div id="waiter">Connecting ...</div>}

                <div class="tab-bar">
                    <button
                        type="button"
                        class={`new-tab-btn ${activeTabId === 'form' ? 'active' : ''}`}
                        onClick={() => this.setState({ activeTabId: 'form' })}
                    >
                        + New Connection
                    </button>
                    {tabs.map(tab => (
                        <div
                            key={tab.id}
                            class={`terminal-tab ${activeTabId === tab.id ? 'active' : ''}`}
                            onClick={() => this.setState({ activeTabId: tab.id })}
                        >
                            <OsIcon os={tab.os} version={tab.version} size={15} />
                            <span>{tab.hostname === 'local' ? tab.title : `${tab.remoteHostname || tab.title}${tab.version ? ` (${tab.version})` : ''}`}</span>
                            <span class="close-tab" onClick={e => this.closeTab(e, tab.id)}>×</span>
                        </div>
                    ))}
                </div>

                {activeTabId === 'form' ? (
                    <div class="webssh-container" style={{ position: 'absolute', top: '40px', bottom: '0', left: '0', right: '0' }}>
                        <div class="webssh-card">
                            <div class="webssh-card-header">
                                <h1>WebSSH Client</h1>
                            </div>

                            <form id="connect" onSubmit={this.handleConnect}>
                                <div class="row">
                                    <div class="col">
                                        <label for="hostname">Hostname</label>
                                        <input
                                            class="form-control"
                                            type="text"
                                            id="hostname"
                                            name="hostname"
                                            value={hostname}
                                            onInput={e => this.setState({ hostname: (e.target as HTMLInputElement).value })}
                                            placeholder="e.g. 192.168.1.100 or server.example.com"
                                            required
                                        />
                                    </div>
                                    <div class="col">
                                        <label for="port">Port</label>
                                        <input
                                            class="form-control"
                                            type="number"
                                            id="port"
                                            name="port"
                                            placeholder="22"
                                            value={port}
                                            onInput={e => this.setState({ port: (e.target as HTMLInputElement).value })}
                                            min="1"
                                            max="65535"
                                        />
                                    </div>
                                </div>

                                <div class="row">
                                    <div class="col">
                                        <label for="username">Username</label>
                                        <input
                                            class="form-control"
                                            type="text"
                                            id="username"
                                            name="username"
                                            value={username}
                                            onInput={e => this.setState({ username: (e.target as HTMLInputElement).value })}
                                            placeholder="e.g. root or administrator"
                                            required
                                        />
                                    </div>
                                </div>

                                <div class="row" style={{ marginTop: '-4px' }}>
                                    <div class="col">
                                        <label>Authentication Method</label>
                                        <div>
                                            <button
                                                type="button"
                                                class="btn btn-primary"
                                                onClick={this.handleOpenAuthModal}
                                            >
                                                Select Auth Method
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <input type="hidden" id="term" name="term" value="xterm-256color" />
                                <input type="hidden" name="_xsrf" value="csrf-token" />

                                <div class="btn-group">
                                    <div class="btn-left">
                                        <button type="button" class="btn btn-quick" onClick={this.handleQuickConnect}>Quick Connect</button>
                                    </div>
                                    <div class="btn-right">
                                        <button type="button" class="btn btn-secondary btn-ttyd" onClick={this.handleTtyd}>ttyd</button>
                                        <button type="reset" class="btn btn-danger" onClick={this.handleReset}>Reset</button>
                                    </div>
                                </div>
                            </form>

                            <div id="status">{status}</div>
                        </div>
                    </div>
                ) : (
                    tabs.map(tab => (
                        <div
                            key={tab.id}
                            class="terminal-tab-wrapper"
                            style={{
                                display: activeTabId === tab.id ? 'block' : 'none',
                            }}
                        >
                            <Terminal
                                id={`terminal-container-${tab.id}`}
                                wsUrl={
                                    tab.hostname && tab.hostname !== 'local'
                                        ? `${wsUrl.split('?')[0]}?ssh=${encodeURIComponent(btoa(JSON.stringify({
                                              hostname: tab.hostname,
                                              port: tab.port || '22',
                                              username: tab.username,
                                              password: tab.password,
                                              passphrase: tab.passphrase,
                                              privateKey: tab.privateKey,
                                              totp: tab.totp,
                                          })))}`
                                        : wsUrl
                                }
                                tokenUrl={tokenUrl}
                                clientOptions={clientOptions}
                                termOptions={termOptions}
                                flowControl={flowControl}
                            />
                        </div>
                    ))
                )}
            </div>
        );
    }
}
