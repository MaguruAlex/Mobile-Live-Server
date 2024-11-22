// extension.js
const vscode = require('vscode');
const http = require('http');
const fs = require('fs');
const path = require('path');
const open = require('open');
const WebSocket = require('ws');
const chokidar = require('chokidar');
const util = require('util');
const stat = util.promisify(fs.stat);
const readdir = util.promisify(fs.readdir);

// files
const fontData = require('./font.json');

let server = null;
let wss = null;
let activeWorkspaces = new Map();
const DEFAULT_PORT = 5500;
let statusBarItem;

class StatusBarController {
    constructor() {
        if (!statusBarItem) {
            statusBarItem = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Right, 100
            );
        }

        this.statusBarItem = statusBarItem;
        this.serverRunning = false;
        this.port = null;

        this.updateStatusBar('idle');
        this.statusBarItem.show();

        this.isMobile = false;
    }

    updateStatusBar(state) {
        switch (state) {
            case 'idle':
                this.statusBarItem.text = "$(broadcast) Go Live";
                this.statusBarItem.command = 'extension.alec.startMobileServer';
                this.statusBarItem.tooltip = 'Click to start mobile server';
                break;
            case 'starting':
                this.statusBarItem.text = "$(sync~spin) Starting...";
                this.statusBarItem.command = undefined;
                break;
            case 'running':
                let debugDevice = this.isMobile ? ` $(device-mobile)` : ``;
                this.statusBarItem.text = `$(radio-tower)${debugDevice} - Port:${this.port}`;
                this.statusBarItem.command = 'extension.alec.stopServer';
                this.statusBarItem.tooltip = 'Click to stop server';
                break;
            case 'closing':
                this.statusBarItem.text = "$(trash) Disposing...";
                this.statusBarItem.command = undefined;
                break;
        }
    }

    async startServer(port) {
        this.isMobile = false;

        if (this.serverRunning) {
            return;
        }

        this.updateStatusBar('starting');
        try {
            // Add your server start logic here
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.port = port;
            this.serverRunning = true;
            this.updateStatusBar('running');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to start server');
            this.updateStatusBar('idle');
        }
    }

    async startMobileServer(port) {
        this.isMobile = true;

        if (this.serverRunning) {
            return;
        }

        this.updateStatusBar('starting');
        try {
            // Add your mobile server start logic here
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.port = port;
            this.serverRunning = true;
            this.updateStatusBar('running');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to start mobile server');
            this.updateStatusBar('idle');
        }
    }

    async stopServer() {
        if (!this.serverRunning) {
            return;
        }

        this.updateStatusBar('closing');
        try {
            // Add your server stop logic here
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.serverRunning = false;
            this.port = null;
            this.updateStatusBar('idle');
        } catch (error) {
            vscode.window.showErrorMessage('Failed to stop server');
            this.updateStatusBar('running');
        }
    }

    dispose() {
        this.statusBarItem.dispose();
    }
}

// File icons mapping
const ICONS = {
    folder: '<path d="M20 5h-9.586L8.707 3.293A.997.997 0 0 0 8 3H4c-1.103 0-2 .897-2 2v14c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V7c0-1.103-.897-2-2-2z"></path>',
    folder_open: '<path d="M2.165 19.551c.186.28.499.449.835.449h15c.4 0 .762-.238.919-.606l3-7A.998.998 0 0 0 21 11h-1V7c0-1.103-.897-2-2-2h-6.1L9.616 3.213A.997.997 0 0 0 9 3H4c-1.103 0-2 .897-2 2v14h.007a1 1 0 0 0 .158.551zM17.341 18H4.517l2.143-5h12.824l-2.143 5zM18 7v4H6c-.4 0-.762.238-.919.606L4 14.129V7h14z"></path>',
    default: '<path d="M4 0h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2zm0 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H4z"/>'
};

function getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.alec': 'text/alec',
        '.alc': 'text/alec',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.woff': 'application/font-woff',
        '.ttf': 'application/font-ttf',
        '.eot': 'application/vnd.ms-fontobject',
        '.otf': 'application/font-otf',
        '.wasm': 'application/wasm',
        '.txt': 'text/plain',
        '.md': 'text/markdown',
        '.xml': 'application/xml',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.rar': 'application/x-rar-compressed',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.yaml': 'application/x-yaml',
        '.csv': 'text/csv',
        '.ts': 'application/typescript',
        '.tsx': 'application/typescript',
        '.jsx': 'application/javascript',
        '.sh': 'application/x-sh',
    };
    return contentTypes[ext] || 'application/octet-stream';
}

function activate(context) {
    const statusBarController = new StatusBarController();

    async function findFreePort(startPort = DEFAULT_PORT) {
        const net = require('net');
        
        function isPortAvailable(port) {
            return new Promise((resolve) => {
                const server = net.createServer()
                    .once('error', () => resolve(false))
                    .once('listening', () => {
                        server.close();
                        resolve(true);
                    });
                server.listen(port);
            });
        }

        let testedPort = startPort;
        while (!(await isPortAvailable(testedPort))) {
            testedPort++;
        }
        
        return testedPort;
    }

    let startServerCommand = vscode.commands.registerCommand('extension.alec.startServer', async () => {
        const workspace = await selectWorkspace();
        if (!workspace) return;
        
        if (activeWorkspaces.has(workspace.uri.fsPath)) {
            vscode.window.showErrorMessage(
                `Server is already running for Workspace: ${workspace.name}`);
            return;
        }
        
        const port = await findFreePort();
        await statusBarController.startServer(port);
        startServer(workspace.uri.fsPath, port, false);
    });
    

    let startMobileServerCommand = vscode.commands.registerCommand('extension.alec.startMobileServer', async () => {
        const workspace = await selectWorkspace();
        if (!workspace) return;
        
        const port = await findFreePort();
        await statusBarController.startMobileServer(port);
        startServer(workspace.uri.fsPath, port, true);
    });

    let stopServerCommand = vscode.commands.registerCommand('extension.alec.stopServer', async () => {
        const workspace = await selectWorkspace();
        if (!workspace) return;

        if (!activeWorkspaces.has(workspace.uri.fsPath)) {
            return;
        }
        
        await statusBarController.stopServer();
        stopServer(workspace.uri.fsPath);
    });

    context.subscriptions.push(startServerCommand);
    context.subscriptions.push(startMobileServerCommand);
    context.subscriptions.push(stopServerCommand);
    context.subscriptions.push(statusBarController);
}

async function selectWorkspace() {
    const workspaces = vscode.workspace.workspaceFolders;

    if (!workspaces) {
        vscode.window.showErrorMessage('No workspace folder is open');
        return null;
    }

    if (workspaces.length === 1) {
        return workspaces[0];
    }

    const selected = await vscode.window.showQuickPick(
        workspaces.map(ws => ({
            label: ws.name,
            workspace: ws
        })),
        { placeHolder: 'Select workspace to serve' }
    );

    return selected ? selected.workspace : null;
}

function getIcon(filename, isDirectory) {
    if (isDirectory) {
        return ICONS.folder;
    }

    const ext = path.extname(filename).toLowerCase();
    const iconEntry = fontData.find(item => item.extension === ext.slice(1));
    return `ffont-${iconEntry ? iconEntry.key : 'file'}`;
}

function formatSize(size) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${Math.round(size * 100) / 100} ${units[i]}`;
}

function formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

async function generateDirectoryListing(rootPath, requestPath, isMobile) {
    const fullPath = path.join(rootPath, requestPath);
    const files = await readdir(fullPath);
    const items = await Promise.all(
        files.map(async file => {
            const filePath = path.join(fullPath, file);
            const stats = await stat(filePath);
            const isDirectory = stats.isDirectory();
            return {
                name: file,
                isDirectory,
                size: isDirectory ? '-' : formatSize(stats.size),
                date: formatDate(stats.mtime),
                relativePath: path.join(requestPath, file)
            };
        })
    );

    // Sort directories first, then files
    items.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
            return a.name.localeCompare(b.name);
        }
        return b.isDirectory - a.isDirectory;
    });

    const template = `
    <!DOCTYPE html>
    <html>
    <head>
        ${isMobile ? `<link rel="preload" href="/libs_90f874b19b89a905a96b060ed3876dd266b6cd6b/eruda.js" as="script">` : ``}
        <link rel="preload" href="/assets_c343a20d06c17903580f7c34cd6d1b65749cd412/output.css" as="style">
        <link rel="stylesheet" href="/assets_c343a20d06c17903580f7c34cd6d1b65749cd412/output.css"/>
        ${ isMobile ? `<script src="/libs_90f874b19b89a905a96b060ed3876dd266b6cd6b/eruda.js"></script>
        <title>Directory: ${requestPath || '/'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script>
            (function() {
                const savedTheme = localStorage.getItem('theme') || 'light';
                document.documentElement.setAttribute('data-theme', savedTheme);
                document.documentElement.style.colorScheme = savedTheme;
            })();
        </script>` : ``}
        <link rel="stylesheet" href="/assets_c343a20d06c17903580f7c34cd6d1b65749cd412/ffont.css"/>

        <style>
            input { background-color: transparent; }
        </style>
    </head>
    <body class="min-h-screen bg-base-200">
     <script>
            (function() {
                eruda.init();
                const erudaVisibility = localStorage.getItem('eruda-visibility');
                if (erudaVisibility === 'visible') {
                    eruda.show();
                } else if (erudaVisibility === 'hidden') {
                    eruda.hide();
                }
            
                const originalToggle = eruda._devTools.toggle.bind(eruda._devTools);
                eruda._devTools.toggle = function() {
                    originalToggle();
                    localStorage.setItem('eruda-visibility',
                        eruda._devTools._isShow ? 'visible' : 'hidden'
                    );
                }
            })();
        </script>
        <div class="container mx-auto p-4 max-w-7xl">
            <div class="nav-bar mb-4 flex gap-1.5 rounded-xl border border-base-300 bg-base-100 p-2.5">
                <div class="flex-1" id="navbarContent">
                    <h2 class="my-auto text-lg font-bold">Directory</h2>
                </div>
                <label id="themeToggle" class="theme-toggle btn btn-outline btn-sm border-base-300 hover:bg-base-100 hover:text-base-content swap swap-rotate">
                    <input type="checkbox" class="theme-controller bg-transparent" value="dark" />
                    <svg class="swap-on h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/></svg>
                    <svg class="swap-off h-5 w-5 fill-current" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"/></svg>
                </label>
                <!-- Desktop Search -->
                <div class="hidden md:flex flex-none gap-2">
                    <label for="searchInput" class="input input-sm input-bordered flex items-center gap-2">
                        <input type="text" id="searchInput" placeholder="Search files..." />
                        <kbd class="kbd kbd-sm">CTRL</kbd>
                        <kbd class="kbd kbd-sm">K</kbd>
                    </label>
                </div>

                <button id="searchToggle" class="btn btn-outline btn-sm border-base-300 hover:bg-base-100 hover:text-base-content flex md:hidden">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>

                <!-- Mobile Search Input (Hidden by default) -->
                <div id="mobileSearch" class="hidden w-full">
                    <div class="flex items-center gap-2">
                        <input type="text" id="mobileSearchInput" class="input input-sm input-bordered flex-grow" placeholder="Search files..." />
                        <button id="closeSearch" class="btn btn-outline btn-sm border-base-300 hover:bg-base-100 hover:text-base-content">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

            </div>
            <div class="breadcrumbs w-fit rounded-md border border-base-300 bg-base-100 p-2 text-sm">
                <ul>
                    ${generateBreadcrumb(requestPath)}
                </ul>
            </div>
            <div class="overflow-x-auto bg-base-100 table-container">
                <table class="table table-sm table-zebra">
                    <thead class="bg-base-200 text-base-content/70">
                        <tr>
                            <th class="font-medium w-full text-left">Name</th>
                            <th class="font-medium table-cell">Size</th>
                            <th class="font-medium hidden md:table-cell">Modified</th>
                        </tr>
                    </thead>
                    <tbody>
                    ${items.map(item => `
                        <tr class="file-row hover cursor-pointer" onclick="window.location='${encodeURIComponent(item.name)}${item.isDirectory ? '/' : ''}'">
                            <td>
                                <div class="flex items-center">
                                    ${item.isDirectory
            ? `<svg class="w-6 mr-3 my-auto opacity-70" viewBox="0 0 24 24" fill="currentColor">${ICONS.folder}</svg>`
            : `<i class="ffont ${getIcon(item.name)} mr-3 my-auto text-2xl opacity-70"></i>`
        }
                                    <span class="font-medium">${item.name}</span>
                                </div>
                            </td>
                            <td class="whitespace-nowrap table-cell text-base-content/70">${item.size}</td>
                            <td class="whitespace-nowrap hidden md:table-cell text-base-content/70">${item.date}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    
         <script>
            const themeController = document.querySelector('.theme-controller');
            const html = document.querySelector('html');
            
            themeController.checked = localStorage.getItem('theme') === 'dark';
            
            themeController.addEventListener('change', (e) => {
                const theme = e.target.checked ? 'dark' : 'light';
                html.setAttribute('data-theme', theme);
                localStorage.setItem('theme', theme);
            });

            const searchInput = document.getElementById('searchInput');
            const tableRows = document.querySelectorAll('tbody tr');
            const searchToggle = document.getElementById('searchToggle');
            const mobileSearch = document.getElementById('mobileSearch');
            const closeSearch = document.getElementById('closeSearch');
            const navbarContent = document.getElementById('navbarContent');
            const themeToggle = document.getElementById('themeToggle');
            const mobileSearchInput = document.getElementById('mobileSearchInput');

            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                tableRows.forEach(row => {
                    const fileName = row.querySelector('td:first-child span').textContent.toLowerCase();
                    row.style.display = fileName.includes(searchTerm) ? '' : 'none';
                });
            });

            mobileSearchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                tableRows.forEach(row => {
                    const fileName = row.querySelector('td:first-child span').textContent.toLowerCase();
                    row.style.display = fileName.includes(searchTerm) ? '' : 'none';
                });
            });

            searchToggle.addEventListener('click', () => {
                mobileSearch.classList.remove('hidden');
                navbarContent.classList.add('hidden');
                searchToggle.classList.add('hidden');
                themeToggle.classList.add('hidden');
                mobileSearch.querySelector('input').focus();
            });

            const handleClose = () => {
                mobileSearch.classList.add('hidden');
                navbarContent.classList.remove('hidden');
                searchToggle.classList.remove('hidden');
                themeToggle.classList.remove('hidden');
            }
            
            mobileSearchInput.addEventListener('blur', handleClose);

            closeSearch.addEventListener('click', handleClose);

            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                    e.preventDefault();
                    searchInput.focus();
                }
            });

            (function() {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(wsProtocol + '//' + window.location.host + '/ws');

            ws.onmessage = function(msg) {
                if (msg.data === 'reload') window.location.reload();
            };
            ws.onclose = function() {
                console.log('Live reload connection lost. Retrying...');
                setTimeout(() => window.location.reload(), 2000);
            };
        })();
        </script>
    </body>
    </html>`;


    return template;
}

function generateBreadcrumb(requestPath) {
    const parts = requestPath.split('/').filter(Boolean);
    let currentPath = '';
    const crumbs = [`
                    <li>
                        <a href="/" class="inline-flex gap-2 items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"  class="h-4 w-4 fill-current">
                                <path d="M12.71 2.29a1 1 0 0 0-1.42 0l-9 9a1 1 0 0 0 0 1.42A1 1 0 0 0 3 13h1v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7h1a1 1 0 0 0 1-1 1 1 0 0 0-.29-.71zM6 20v-9.59l6-6 6 6V20z"></path>
                            </svg>
                            root
                        </a>
                    </li>
                `];
    parts.forEach((part, index) => {
        currentPath += '/' + part;
        const isLast = index === parts.length - 1;

        if (isLast) {
            crumbs.push(`
                    <li>
                        <span class="inline-flex gap-2 items-center">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" class="h-4 w-4 fill-current">
                                <path d="M2.165 19.551c.186.28.499.449.835.449h15c.4 0 .762-.238.919-.606l3-7A.998.998 0 0 0 21 11h-1V7c0-1.103-.897-2-2-2h-6.1L9.616 3.213A.997.997 0 0 0 9 3H4c-1.103 0-2 .897-2 2v14h.007a1 1 0 0 0 .158.551zM17.341 18H4.517l2.143-5h12.824l-2.143 5zM18 7v4H6c-.4 0-.762.238-.919.606L4 14.129V7h14z"></path>
                            </svg>
                            ${part}
                        </span>
                    </li>
                `);
        } else {
            crumbs.push(`
                    <li>
                        <a href="${currentPath}/" class="hover:underline cursor-pointer inline-flex gap-2 items-center">
                           
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" class="h-4 w-4 fill-current">
                                <path d="M20 5h-8.586L9.707 3.293A.997.997 0 0 0 9 3H4c-1.103 0-2 .897-2 2v14c0 1.103.897 2 2 2h16c1.103 0 2-.897 2-2V7c0-1.103-.897-2-2-2zM4 19V7h16l.002 12H4z"></path>
                            </svg>
                            ${part}
                        </a>
                    </li>
                `);
        }
    });

    return crumbs.join('');
}

async function handleRequest(req, res, rootPath, isMobile) {
    let requestPath = decodeURIComponent(req.url);
    requestPath = requestPath.replace(/^\/+/, '');


    // Handle eruda.js requests from extension directory
    if (requestPath === 'libs_90f874b19b89a905a96b060ed3876dd266b6cd6b/eruda.js') {
        const erudaPath = path.join(__dirname, '..', 'libs_90f874b19b89a905a96b060ed3876dd266b6cd6b', 'eruda.js');
        try {
            const content = await fs.promises.readFile(erudaPath);
            res.writeHead(200, { 'Content-Type': 'text/javascript' });
            res.end(content);
            return;
        } catch (error) {
            console.log('Error serving eruda.js:', error);
            res.writeHead(404);
            res.end('Not found');
            return;
        }
    }

    if (requestPath.startsWith('assets_c343a20d06c17903580f7c34cd6d1b65749cd412/')) {
        const fontPath = path.join(__dirname, '..', 'assets_c343a20d06c17903580f7c34cd6d1b65749cd412', path.basename(requestPath));
        try {
            const content = await fs.promises.readFile(fontPath);
            const contentType = {
                '.css': 'text/css',
                '.ttf': 'font/ttf',
                '.woff2': 'font/woff2',
                '.woff': 'font/woff',
            }[path.extname(fontPath)];

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
            return;
        } catch (error) {
            console.log('Error serving font:', error);
            res.writeHead(404);
            res.end('Not found');
            return;
        }
    }

    const fullPath = path.join(rootPath, requestPath);

    try {
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
            const listing = await generateDirectoryListing(rootPath, requestPath, isMobile);
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(listing);
        } else {
            const contentType = getContentType(fullPath);
            const content = await fs.promises.readFile(fullPath);

            res.writeHead(200, { 'Content-Type': contentType });
            if (contentType === 'text/html') {
                res.end(injectLiveReloadScript(content.toString(), isMobile));
            } else {
                res.end(content);
            }
        }
    } catch (error) {
        res.writeHead(404);
        res.end('Not found');
    }
}

function injectLiveReloadScript(content, isMobile) {
    const erudaScript = isMobile ? `
        <link rel="preload" href="/libs_90f874b19b89a905a96b060ed3876dd266b6cd6b/eruda.js" as="script">
        <script src="/libs_90f874b19b89a905a96b060ed3876dd266b6cd6b/eruda.js"></script>
        <script>
            (function() {
                eruda.init();
                const erudaVisibility = localStorage.getItem('eruda-visibility');
                if (erudaVisibility === 'visible') {
                    eruda.show();
                } else if (erudaVisibility === 'hidden') {
                    eruda.hide();
                }
               
                const originalToggle = eruda._devTools.toggle.bind(eruda._devTools);
                eruda._devTools.toggle = function() {
                    originalToggle();
                    localStorage.setItem('eruda-visibility',
                        eruda._devTools._isShow ? 'visible' : 'hidden'
                    );
                }
            })();
        </script>
    ` : '';

    // Insert right after <head> tag
    if (isMobile) {
        content = content.replace('<head>', '<head>' + erudaScript);
    }

    // Keep WebSocket script in body
    const wsScript = `
        <script>
            (function() {
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const ws = new WebSocket(wsProtocol + '//' + window.location.host + '/ws');
                ws.onmessage = function(msg) {
                    if (msg.data === 'reload') window.location.reload();
                };
                ws.onclose = function() {
                    console.log('Live reload connection lost. Retrying...');
                    setTimeout(() => window.location.reload(), 5000);
                };
            })();
        </script>
    `;

    return content.replace('</body>', wsScript + '</body>');
}

function startServer(rootPath, port, isMobile = false) {
    server = http.createServer((req, res) => handleRequest(req, res, rootPath, isMobile));
    wss = new WebSocket.Server({ server });

    // Enhanced file watcher configuration
    const watcher = chokidar.watch(rootPath, {
        ignored: /(^|[\/\\])\..|(node_modules)/,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
            stabilityThreshold: 100,
            pollInterval: 100
        }
    });

    function reloadBrowser(path) {
        console.log('File changed:', path);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send('reload');
            }
        });
    }

    watcher.on('change', reloadBrowser);
    watcher.on('add', reloadBrowser);
    watcher.on('unlink', reloadBrowser);

    server.listen(port, '127.0.0.1', () => {
        const serverUrl = `http://127.0.0.1:${port}`;
        open(serverUrl);
        activeWorkspaces.set(rootPath, { port, server, wss, watcher });
    });
}

function stopServer(rootPath) {
    const serverInfo = activeWorkspaces.get(rootPath);
    if (serverInfo) {
        const { server, wss, watcher } = serverInfo;

        wss.clients.forEach(client => client.close());
        wss.close();
        watcher.close();
        server.close();

        activeWorkspaces.delete(rootPath);
    }
}

function deactivate() {
    for (const [rootPath] of activeWorkspaces) {
        stopServer(rootPath);
    }
}

module.exports = {
    activate,
    deactivate
};