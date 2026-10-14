import { bind } from 'decko';
import { Component, h } from 'preact';
import { Xterm, XtermOptions } from './xterm';
import '@xterm/xterm/css/xterm.css';
import { Modal } from '../modal';

interface Props extends XtermOptions {
    id: string;
}

interface State {
    modal: boolean;
    contextMenu: {
        visible: boolean;
        x: number;
        y: number;
        hasSelection: boolean;
    };
    copyFeedback: boolean;
}

export class Terminal extends Component<Props, State> {
    private container: HTMLElement;
    private xterm: Xterm;
    private pinchInitialDist: number = 0;
    private pinchInitialFontSize: number = 11;
    private longPressTimer: any = null;
    private touchStartX: number = 0;
    private touchStartY: number = 0;
    private resizeObserver: ResizeObserver | null = null;

    constructor(props: Props) {
        super();
        this.state = {
            modal: false,
            contextMenu: {
                visible: false,
                x: 0,
                y: 0,
                hasSelection: false,
            },
            copyFeedback: false,
        };
        this.xterm = new Xterm(props, this.showModal);
    }

    async componentDidMount() {
        this.xterm.open(this.container);
        await this.xterm.refreshToken();
        this.xterm.connect();

        setTimeout(() => {
            this.xterm.fit();
        }, 50);

        setTimeout(() => {
            this.xterm.fit();
        }, 200);

        if (typeof ResizeObserver !== 'undefined' && this.container) {
            this.resizeObserver = new ResizeObserver(() => {
                if (this.container && this.container.clientWidth > 0 && this.container.clientHeight > 0) {
                    this.xterm.fit();
                }
            });
            this.resizeObserver.observe(this.container);
        }

        const term = this.xterm.getTerminal();
        if (term) {
            term.onSelectionChange(() => {
                const sel = term.getSelection();
                if (sel) {
                    try {
                        navigator.clipboard.writeText(sel);
                    } catch (e) {}
                    const helper = this.container?.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
                    if (helper) {
                        helper.value = sel;
                        helper.select();
                    }
                }
            });
        }

        if (this.container) {
            this.container.addEventListener('touchstart', this.handleTouchStart, { passive: false });
            this.container.addEventListener('touchmove', this.handleTouchMove, { passive: false });
            this.container.addEventListener('touchend', this.handleTouchEnd);
            this.container.addEventListener('wheel', this.handleWheel, { passive: false });
            this.container.addEventListener('contextmenu', this.handleContextMenu);
        }
    }

    componentWillUnmount() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
        }
        this.xterm.dispose();
        if (this.container) {
            this.container.removeEventListener('touchstart', this.handleTouchStart);
            this.container.removeEventListener('touchmove', this.handleTouchMove);
            this.container.removeEventListener('touchend', this.handleTouchEnd);
            this.container.removeEventListener('wheel', this.handleWheel);
            this.container.removeEventListener('contextmenu', this.handleContextMenu);
        }
    }

    @bind
    private handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        this.openContextMenu(e.clientX, e.clientY);
    }

    @bind
    private openContextMenu(clientX: number, clientY: number) {
        const term = this.xterm.getTerminal();
        const hasSelection = Boolean(term && term.hasSelection() && term.getSelection().length > 0);

        const menuWidth = 280;
        let x = clientX - menuWidth / 2;
        if (x < 10) x = 10;
        if (x + menuWidth > window.innerWidth - 10) {
            x = window.innerWidth - menuWidth - 10;
        }

        let y = clientY - 50;
        if (y < 45) {
            y = clientY + 18;
        }
        if (y + 44 > window.innerHeight - 10) {
            y = window.innerHeight - 54;
        }

        this.setState({
            contextMenu: {
                visible: true,
                x,
                y,
                hasSelection,
            },
        });
    }

    @bind
    private closeContextMenu() {
        this.setState({
            contextMenu: {
                visible: false,
                x: 0,
                y: 0,
                hasSelection: false,
            },
        });
    }

    @bind
    private handleCopy(e: Event) {
        e.preventDefault();
        e.stopPropagation();
        const term = this.xterm.getTerminal();
        const text = term ? term.getSelection() : '';
        if (text) {
            navigator.clipboard.writeText(text);
            this.setState({ copyFeedback: true });
            setTimeout(() => {
                this.setState({ copyFeedback: false });
                this.closeContextMenu();
            }, 500);
        } else {
            this.closeContextMenu();
        }
    }

    @bind
    private async handlePaste(e: Event) {
        e.preventDefault();
        e.stopPropagation();
        this.closeContextMenu();
        try {
            const text = await navigator.clipboard.readText();
            if (text) {
                this.xterm.sendData(text);
            }
        } catch (err) {
            const fallback = window.prompt('Paste text:');
            if (fallback) {
                this.xterm.sendData(fallback);
            }
        }
    }

    @bind
    private handleSelectAll(e: Event) {
        e.preventDefault();
        e.stopPropagation();
        const term = this.xterm.getTerminal();
        if (term) {
            term.selectAll();
            const text = term.getSelection();
            if (text) {
                try {
                    navigator.clipboard.writeText(text);
                } catch (err) {}
            }
            this.setState(prev => ({
                contextMenu: {
                    ...prev.contextMenu,
                    hasSelection: true,
                },
            }));
        }
    }

    @bind
    private handleClear(e: Event) {
        e.preventDefault();
        e.stopPropagation();
        this.closeContextMenu();
        const term = this.xterm.getTerminal();
        if (term) {
            term.clear();
        }
    }

    @bind
    private handleTouchStart(e: TouchEvent) {
        if (e.touches.length === 1) {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;

            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
            }

            this.longPressTimer = setTimeout(() => {
                this.openContextMenu(this.touchStartX, this.touchStartY);
            }, 450);
        } else if (e.touches.length === 2) {
            e.preventDefault();
            if (this.longPressTimer) {
                clearTimeout(this.longPressTimer);
            }
            this.closeContextMenu();
            this.pinchInitialDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const term = this.xterm.getTerminal();
            if (term) {
                this.pinchInitialFontSize = term.options.fontSize || 11;
            }
        }
    }

    @bind
    private handleTouchMove(e: TouchEvent) {
        if (e.touches.length === 1) {
            const diffX = Math.abs(e.touches[0].clientX - this.touchStartX);
            const diffY = Math.abs(e.touches[0].clientY - this.touchStartY);
            if (diffX > 8 || diffY > 8) {
                if (this.longPressTimer) {
                    clearTimeout(this.longPressTimer);
                }
            }
        } else if (e.touches.length === 2 && this.pinchInitialDist > 0) {
            e.preventDefault();
            const currentDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const scale = currentDist / this.pinchInitialDist;
            let newSize = Math.round(this.pinchInitialFontSize * scale);
            if (newSize < 8) newSize = 8;
            if (newSize > 36) newSize = 36;

            const term = this.xterm.getTerminal();
            if (term && term.options.fontSize !== newSize) {
                term.options.fontSize = newSize;
                this.xterm.fit();
                term.scrollToBottom();
            }
        }
    }

    @bind
    private handleWheel(e: WheelEvent) {
        if (e.ctrlKey) {
            e.preventDefault();
            const term = this.xterm.getTerminal();
            if (term) {
                let size = term.options.fontSize || 11;
                if (e.deltaY < 0) {
                    size = Math.min(size + 1, 36);
                } else {
                    size = Math.max(size - 1, 8);
                }
                term.options.fontSize = size;
                this.xterm.fit();
                term.scrollToBottom();
            }
        }
    }

    @bind
    private handleTouchEnd(e: TouchEvent) {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
        }
        if (e.touches.length < 2) {
            this.pinchInitialDist = 0;
        }
    }

    render({ id }: Props, { modal, contextMenu, copyFeedback }: State) {
        return (
            <div id={id} class="terminal-container" ref={c => (this.container = c as HTMLElement)}>
                {contextMenu.visible && (
                    <div
                        class="terminal-context-backdrop"
                        onClick={this.closeContextMenu}
                        onTouchEnd={this.closeContextMenu}
                    />
                )}

                {contextMenu.visible && (
                    <div
                        id="terminal-context-menu"
                        class="terminal-context-menu"
                        style={{
                            left: `${contextMenu.x}px`,
                            top: `${contextMenu.y}px`,
                        }}
                        onPointerDown={e => e.stopPropagation()}
                        onTouchStart={e => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            class="context-item"
                            onClick={this.handleCopy}
                            onTouchEnd={this.handleCopy}
                            disabled={!contextMenu.hasSelection}
                            style={{ opacity: contextMenu.hasSelection ? '1' : '0.5' }}
                        >
                            <svg viewBox="0 0 24 24"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                            {copyFeedback ? 'Copied' : 'Copy'}
                        </button>

                        <button
                            type="button"
                            class="context-item"
                            onClick={this.handlePaste}
                            onTouchEnd={this.handlePaste}
                        >
                            <svg viewBox="0 0 24 24"><path d="M19 2h-4.18C14.4 0.84 13.3 0 12 0c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm7 18H5V4h2v3h10V4h2v16z"/></svg>
                            Paste
                        </button>

                        <div class="context-divider"></div>

                        <button
                            type="button"
                            class="context-item"
                            onClick={this.handleSelectAll}
                            onTouchEnd={this.handleSelectAll}
                        >
                            <svg viewBox="0 0 24 24"><path d="M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zm-4 18h2v-2h-2v2zM3 17h2v-2H3v2zm8 4h2v-2h-2v2zm10-8h2v-2h-2v2zm0-4h2V7h-2v2zm0 8h2v-2h-2v2zm-2 4c1.1 0 2-.9 2-2h-2v2zM7 3h2v2H7V3zm10 10V7H9v8h8z"/></svg>
                            Select All
                        </button>

                        <button
                            type="button"
                            class="context-item"
                            onClick={this.handleClear}
                            onTouchEnd={this.handleClear}
                        >
                            <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                            Clear
                        </button>

                        <div class="context-divider"></div>

                        <button
                            type="button"
                            class="context-item close-btn"
                            onClick={this.closeContextMenu}
                            onTouchEnd={this.closeContextMenu}
                            style={{ padding: '7px 8px', color: '#999999' }}
                        >
                            ✕
                        </button>
                    </div>
                )}

                <Modal show={modal}>
                    <label class="file-label">
                        <input onChange={this.sendFile} class="file-input" type="file" multiple />
                        <span class="file-cta">Choose files…</span>
                    </label>
                </Modal>
            </div>
        );
    }

    @bind
    showModal() {
        this.setState({ modal: true });
    }

    @bind
    sendFile(event: Event) {
        this.setState({ modal: false });
        const files = (event.target as HTMLInputElement).files;
        if (files) this.xterm.sendFile(files);
    }
}
