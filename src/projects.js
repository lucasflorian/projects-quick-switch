const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PINNED_KEY = 'pinned';
const SCAN_KEY = 'scanned';
const PM_IMPORTED_KEY = 'projectManagerImported';
const SKIPPED_DIRS = new Set(['node_modules', 'vendor', 'bower_components', 'dist', 'build']);

/** @type {vscode.Memento} */
let state;

function init(context) {
	state = context.globalState;
}

function expandHome(p) {
	return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

function tildify(p) {
	const home = os.homedir();
	return p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}

function toUri(value) {
	if (value instanceof vscode.Uri) return value;
	if (typeof value === 'string') return /^[a-z][\w+.-]+:/i.test(value) ? vscode.Uri.parse(value) : vscode.Uri.file(value);
	return vscode.Uri.from(value);
}

/** Deduplication key: the macOS file system is case-insensitive. */
function keyOf(uri) {
	if (uri.scheme === 'file') return uri.fsPath.replace(/[\\/]+$/, '').toLowerCase();
	return uri.toString().replace(/\/+$/, '').toLowerCase();
}

function isWorkspaceFile(uri) {
	return uri.path.endsWith('.code-workspace');
}

function defaultName(uri) {
	const base = path.posix.basename(uri.path) || uri.authority;
	return isWorkspaceFile(uri) ? base.replace(/\.code-workspace$/, '') : base;
}

function currentUri() {
	if (vscode.workspace.workspaceFile && vscode.workspace.workspaceFile.scheme !== 'untitled') return vscode.workspace.workspaceFile;
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length === 1 ? folders[0].uri : undefined;
}

async function exists(uri) {
	if (uri.scheme !== 'file') return true;
	try {
		await fs.promises.access(uri.fsPath);
		return true;
	} catch {
		return false;
	}
}

async function getRecents() {
	let result;
	try {
		result = await vscode.commands.executeCommand('_workbench.getRecentlyOpened');
	} catch {
		return [];
	}
	const recents = [];
	for (const entry of result?.workspaces ?? []) {
		const raw = entry.folderUri ?? entry.workspace?.configPath;
		if (!raw) continue;
		const uri = toUri(raw);
		recents.push({ uri, name: entry.label && uri.scheme !== 'file' ? entry.label : defaultName(uri) });
	}
	const present = await Promise.all(recents.map((r) => exists(r.uri)));
	return recents.filter((_, i) => present[i]);
}

function getPinned() {
	return state.get(PINNED_KEY, []).map((p) => ({ uri: toUri(p.uri), name: p.name || defaultName(toUri(p.uri)) }));
}

async function setPinned(list) {
	await state.update(PINNED_KEY, list.map((p) => ({ uri: p.uri.toString(), name: p.name })));
}

function isPinned(uri) {
	const key = keyOf(uri);
	return getPinned().some((p) => keyOf(p.uri) === key);
}

async function pin(uri, name) {
	if (isPinned(uri)) return false;
	await setPinned([...getPinned(), { uri, name: name || defaultName(uri) }]);
	return true;
}

async function unpin(uri) {
	const key = keyOf(uri);
	await setPinned(getPinned().filter((p) => keyOf(p.uri) !== key));
}

function getScanned() {
	return state.get(SCAN_KEY, []).map((p) => vscode.Uri.file(p));
}

async function scanDir(dir, depth, markers, found) {
	let entries;
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	if (entries.some((e) => markers.has(e.name))) found.push(dir);
	// A project without a git repository (e.g. a PhpStorm project grouping sub-projects) is explored too.
	if (depth <= 0 || entries.some((e) => e.name === '.git')) return;
	await Promise.all(
		entries
			.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIPPED_DIRS.has(e.name))
			.map((e) => scanDir(path.join(dir, e.name), depth - 1, markers, found)),
	);
}

/** Searches the configured folders again. Returns true when the list changed. */
async function rescan() {
	const config = vscode.workspace.getConfiguration('projectSwitcher');
	const roots = config.get('scanFolders', []).map(expandHome);
	const depth = config.get('scanDepth', 2);
	const markers = new Set(config.get('scanMarkers', []));
	const found = [];
	if (markers.size) await Promise.all(roots.map((root) => scanDir(root, depth, markers, found)));
	found.sort();
	const previous = state.get(SCAN_KEY, []);
	if (previous.length === found.length && previous.every((p, i) => p === found[i])) return false;
	await state.update(SCAN_KEY, found);
	return true;
}

function projectManagerFile(context) {
	return path.join(path.dirname(context.globalStorageUri.fsPath), 'alefragnani.project-manager', 'projects.json');
}

/** Imports the projects of the Project Manager extension (alefragnani) as pinned projects. */
async function importProjectManager(context) {
	let projects;
	try {
		projects = JSON.parse(await fs.promises.readFile(projectManagerFile(context), 'utf8'));
	} catch {
		return undefined;
	}
	const pinned = getPinned();
	const keys = new Set(pinned.map((p) => keyOf(p.uri)));
	let added = 0;
	for (const project of Array.isArray(projects) ? projects : []) {
		if (!project.rootPath || project.enabled === false) continue;
		const uri = toUri(expandHome(project.rootPath.replace(/^\$home/, '~')));
		if (keys.has(keyOf(uri))) continue;
		keys.add(keyOf(uri));
		pinned.push({ uri, name: project.name || defaultName(uri) });
		added++;
	}
	await setPinned(pinned);
	await state.update(PM_IMPORTED_KEY, true);
	return added;
}

async function importProjectManagerOnce(context) {
	if (state.get(PM_IMPORTED_KEY)) return;
	await importProjectManager(context);
	await state.update(PM_IMPORTED_KEY, true);
}

module.exports = {
	init,
	tildify,
	keyOf,
	isWorkspaceFile,
	defaultName,
	currentUri,
	getRecents,
	getPinned,
	isPinned,
	pin,
	unpin,
	getScanned,
	rescan,
	importProjectManager,
	importProjectManagerOnce,
};
